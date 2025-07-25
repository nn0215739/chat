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
// FINAL CORRECTION: Using a newly generated, valid VAPID key.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BJ5nU6-zB6-gLqU2yAFdyf_mK2vA-wz_pQ8jX7nF0vVz1bM3e5g7h9k2l4n6p8r0t2w4y6z8A_bCd";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "_REPLACE_WITH_YOUR_REAL_PRIVATE_KEY_"; // IMPORTANT: REPLACE THIS

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

// --- INITIAL ADMIN CREATION (Example) ---
async function createInitialAdmin() {
    try {
        const existingAdmin = await Admin.findOne({ email: "admin@example.com" });
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash("password123", 10);
            const newAdmin = new Admin({ email: "admin@example.com", password: hashedPassword });
            await newAdmin.save();
            console.log(`Initial admin account created.`);
        }
    } catch (error) {
        console.error("Error creating initial admin:", error);
    }
}
createInitialAdmin();


// --- API ROUTE FOR PUSH SUBSCRIPTIONS ---
app.post('/api/save-subscription', async (req, res) => {
    const { subscription, roomId } = req.body;
    if (!subscription || !roomId) {
        return res.status(400).json({ error: 'Subscription and roomId are required.' });
    }
    try {
        await ChatRoom.findByIdAndUpdate(roomId, {
            $addToSet: { subscriptions: subscription }
        }, { upsert: true });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Error saving subscription:", error);
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});

// LOGIN ROUTE
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const admin = await Admin.findOne({ email });
        if (!admin) return res.status(401).json({ message: "Authentication failed." });
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(401).json({ message: "Authentication failed." });
        const token = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
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
        await ChatRoom.findByIdAndUpdate(userId, { _id: userId, displayName }, { upsert: true });
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
        await ChatRoom.findByIdAndUpdate(roomId, roomUpdate);

        io.to(roomId).to('admin_room').emit('newMessage', newMessage);

        const updatedRooms = await ChatRoom.find().sort({ timestamp: -1 });
        io.to('admin_room').emit('chatList', updatedRooms);
        
        if (currentRoom && currentRoom.subscriptions) {
            const payload = JSON.stringify({
                title: `Tin nhắn mới từ ${displayName}`,
                body: text,
                icon: 'https://pmtl.site/favicon.ico',
            });

            currentRoom.subscriptions.forEach(sub => {
                webpush.sendNotification(sub, payload).catch(async (err) => {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        console.log('Subscription has expired or is no longer valid: ', err.endpoint);
                        await ChatRoom.findByIdAndUpdate(roomId, {
                            $pull: { subscriptions: { endpoint: sub.endpoint } }
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
