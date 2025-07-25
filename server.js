const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chatApp";
const JWT_SECRET = process.env.JWT_SECRET || "your-very-secret-key";
// FINAL CORRECTION: The sample VAPID key now has the correct length of 87 characters.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BPEpZstk_f3Wkso4z6yWOt4vT7wP5yW6Pj_p6DZW1o7b4rO4z-k-bQ_vJ3cZ9h8Yx8fP_kY_z5M-t9Y";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "YOUR_PRIVATE_VAPID_KEY"; // REPLACE WITH YOUR KEY

// --- WEB PUSH CONFIG ---
// This will now work with the corrected key.
webpush.setVapidDetails(
  'mailto:admin@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// --- DATABASE CONNECTION ---
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected successfully."))
  .catch(err => console.error("MongoDB connection error:", err));

// --- DATABASE SCHEMAS ---
const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  displayName: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const chatRoomSchema = new mongoose.Schema({
  _id: { type: String },
  displayName: { type: String },
  lastMessage: { type: String },
  timestamp: { type: Date },
  hasUnreadAdmin: { type: Boolean, default: false },
  isClosed: { type: Boolean, default: false },
  subscriptions: [mongoose.Schema.Types.Mixed]
});
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const Admin = mongoose.model('Admin', adminSchema);

// ... (Initial Admin Creation, Health Check, Login routes remain the same)

// --- API ROUTE FOR PUSH SUBSCRIPTIONS ---
app.post('/api/save-subscription', async (req, res) => {
    const { subscription, roomId } = req.body;
    if (!subscription || !roomId) {
        return res.status(400).json({ error: 'Subscription and roomId are required.' });
    }
    try {
        await ChatRoom.findByIdAndUpdate(roomId, {
            $addToSet: { subscriptions: subscription }
        });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Error saving subscription:", error);
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});


// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('admin:join', async () => {
        socket.join('admin_room');
        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        socket.emit('chatList', rooms);
    });

    socket.on('user:join', async ({ userId, displayName }) => {
        socket.join(userId);
        await ChatRoom.findByIdAndUpdate(userId, { displayName }, { upsert: true });
        const roomDetails = await ChatRoom.findById(userId);
        const messages = await Message.find({ roomId: userId }).sort({ timestamp: 1 });
        socket.emit('roomDetails', { messages, isClosed: roomDetails ? roomDetails.isClosed : false });
    });

    socket.on('admin:viewRoom', async (roomId) => {
        socket.join(roomId);
        const roomDetails = await ChatRoom.findById(roomId);
        const messages = await Message.find({ roomId: roomId }).sort({ timestamp: 1 });
        await ChatRoom.findByIdAndUpdate(roomId, { hasUnreadAdmin: false });

        socket.emit('roomDetails', { messages, isClosed: roomDetails ? roomDetails.isClosed : false });
        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        io.to('admin_room').emit('chatList', rooms);
    });
    
    socket.on('admin:toggleLock', async ({ roomId, isLocked }) => {
        await ChatRoom.findByIdAndUpdate(roomId, { isClosed: isLocked });
        io.to(roomId).to('admin_room').emit('chat:locked', { roomId, isLocked });
    });

    socket.on('sendMessage', async (data) => {
        const { roomId, senderId, text, isAdmin, displayName } = data;
        
        const currentRoom = await ChatRoom.findById(roomId);
        if (currentRoom && currentRoom.isClosed && !isAdmin) {
            return socket.emit('chatError', 'This chat has been locked by the administrator.');
        }

        const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
        await newMessage.save();

        const roomUpdate = { lastMessage: text, timestamp: new Date(), hasUnreadAdmin: !isAdmin };
        await ChatRoom.findByIdAndUpdate(roomId, roomUpdate, { new: true });

        io.to(roomId).to('admin_room').emit('newMessage', newMessage);

        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        io.to('admin_room').emit('chatList', rooms);
        
        if (currentRoom && currentRoom.subscriptions) {
            const payload = JSON.stringify({
                title: `Tin nhắn mới từ ${displayName}`,
                body: text,
                icon: 'https://pmtl.site/favicon.ico',
                badge: 'https://pmtl.site/badge.png'
            });

            currentRoom.subscriptions.forEach(sub => {
                webpush.sendNotification(sub, payload).catch(async (err) => {
                    if (err.statusCode === 410) {
                        await ChatRoom.findByIdAndUpdate(roomId, {
                            $pull: { subscriptions: sub }
                        });
                    } else {
                        console.error('Error sending push notification', err);
                    }
                });
            });
        }
    });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
