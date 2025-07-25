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

// Serve the service worker file
app.use(express.static(__dirname));

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
const INITIAL_ADMIN_EMAIL = "admin@example.com";
const ADMIN_DEFAULT_PASSWORD = "password123";

// VAPID keys should be stored in environment variables for security
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BLR3ESERJvSd663nWEkEVoQHkfIk6V0akO8_lVv8Tl4ATq3TNJc2wZQQUYajbRUN0rXreHPDA5As_OMOMN8e4Ms";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "qnW902sNFeZ2nrLZsoPAzipwIHWVpejp75hc_SgqyaY";

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
  displayName: {type: String, default: 'Sư huynh'},
  isAdmin: { type: Boolean, default: false },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const chatRoomSchema = new mongoose.Schema({
  _id: { type: String }, // Room ID (same as userId)
  displayName: { type: String, default: 'Sư huynh Vô Danh' },
  lastMessage: { type: String },
  timestamp: { type: Date },
  hasUnreadAdmin: { type: Boolean, default: false },
  isClosed: { type: Boolean, default: false }, // To lock/unlock chat
  pushSubscription: { type: Object } // To store user's push subscription
});
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const Admin = mongoose.model('Admin', adminSchema);

// --- INITIAL ADMIN CREATION ---
async function createInitialAdmin() {
    try {
        const existingAdmin = await Admin.findOne({ email: INITIAL_ADMIN_EMAIL });
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
            await new Admin({ email: INITIAL_ADMIN_EMAIL, password: hashedPassword }).save();
            console.log(`Initial admin created. Email: ${INITIAL_ADMIN_EMAIL}`);
        }
    } catch (error) {
        console.error("Error creating initial admin:", error);
    }
}
createInitialAdmin();


// --- API ROUTES ---
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        if (!admin || !await bcrypt.compare(password, admin.password)) {
            return res.status(401).json({ message: "Sai email hoặc mật khẩu." });
        }
        const token = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: "Lỗi máy chủ" });
    }
});

app.post('/api/save-subscription', async (req, res) => {
    try {
        const { subscription, roomId } = req.body;
        await ChatRoom.findByIdAndUpdate(roomId, { pushSubscription: subscription }, { upsert: true });
        res.status(201).json({ message: 'Subscription saved.' });
    } catch (error) {
        console.error("Error saving subscription:", error);
        res.status(500).json({ message: 'Could not save subscription.' });
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
      const roomUpdate = { displayName: displayName };
      const room = await ChatRoom.findByIdAndUpdate(userId, roomUpdate, { upsert: true, new: true });
      socket.emit('roomDetails', { messages: await Message.find({ roomId: userId }).sort({ timestamp: 1 }), isClosed: room.isClosed });
  });

  socket.on('admin:viewRoom', async (roomId) => {
      const room = await ChatRoom.findByIdAndUpdate(roomId, { hasUnreadAdmin: false }, { new: true });
      if (room) {
        socket.emit('roomDetails', { messages: await Message.find({ roomId }).sort({ timestamp: 1 }), isClosed: room.isClosed });
        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        io.to('admin_room').emit('chatList', rooms);
      }
  });

  socket.on('sendMessage', async (data) => {
    const { roomId, senderId, text, isAdmin, displayName } = data;
    const room = await ChatRoom.findById(roomId);

    if (room && room.isClosed && !isAdmin) {
        return socket.emit('chatError', 'Cuộc trò chuyện này đã bị khoá. Bạn không thể gửi tin nhắn.');
    }
    
    const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
    await newMessage.save();

    const roomUpdate = { lastMessage: text, timestamp: new Date(), hasUnreadAdmin: !isAdmin };
    await ChatRoom.findByIdAndUpdate(roomId, roomUpdate);

    io.to(roomId).emit('newMessage', newMessage);
    io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));

    // Send push notification if it's a user message
    if (!isAdmin && room && room.pushSubscription) {
        const payload = JSON.stringify({
            title: `Tin nhắn mới từ ${displayName}`,
            body: text,
            icon: '/favicon.ico' // Optional: path to an icon
        });
        webpush.sendNotification(room.pushSubscription, payload).catch(error => {
            console.error('Error sending push notification:', error);
        });
    }
  });

  socket.on('admin:toggleLock', async ({ roomId, isLocked }) => {
      await ChatRoom.findByIdAndUpdate(roomId, { isClosed: isLocked });
      io.to(roomId).emit('chat:locked', { roomId, isLocked });
      io.to('admin_room').emit('chat:locked', { roomId, isLocked });
  });
  
  // NEW: Handle message deletion
  socket.on('admin:deleteMessage', async ({ messageId, roomId }) => {
      try {
          const deletedMessage = await Message.findByIdAndDelete(messageId);
          if (deletedMessage) {
              io.to(roomId).emit('messageDeleted', messageId);
              // Optional: Update last message in chat room if the deleted one was the last one
              const lastMsg = await Message.findOne({ roomId }).sort({ timestamp: -1 });
              await ChatRoom.findByIdAndUpdate(roomId, {
                  lastMessage: lastMsg ? lastMsg.text : "Tin nhắn đã bị xóa",
                  timestamp: lastMsg ? lastMsg.timestamp : new Date()
              });
              io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));
          }
      } catch (error) {
          console.error("Error deleting message:", error);
      }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
