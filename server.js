const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Cho phép kết nối từ mọi nguồn
    methods: ["GET", "POST"]
  }
});

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chatApp";
const JWT_SECRET = process.env.JWT_SECRET || "your-very-secret-key";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_DEFAULT_PASSWORD = "password123"; // Mật khẩu mặc định, nên thay đổi

// --- DATABASE CONNECTION ---
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected successfully."))
  .catch(err => console.error("MongoDB connection error:", err));

// --- DATABASE SCHEMAS ---
const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const chatRoomSchema = new mongoose.Schema({
  _id: { type: String }, // User's UID will be the room ID
  lastMessage: { type: String },
  timestamp: { type: Date },
  hasUnreadAdmin: { type: Boolean, default: false }
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
        const existingAdmin = await Admin.findOne({ email: ADMIN_EMAIL });
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
            const newAdmin = new Admin({
                email: ADMIN_EMAIL,
                password: hashedPassword
            });
            await newAdmin.save();
            console.log(`Initial admin account created. Email: ${ADMIN_EMAIL}, Password: ${ADMIN_DEFAULT_PASSWORD}`);
            console.log("IMPORTANT: Please change this default password in your database.");
        }
    } catch (error) {
        console.error("Error creating initial admin:", error);
    }
}
createInitialAdmin();


// --- API ROUTES ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (email !== ADMIN_EMAIL) {
        return res.status(401).json({ message: "Authentication failed" });
    }
    try {
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(401).json({ message: "Authentication failed" });
        }
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Authentication failed" });
        }
        const token = jwt.sign({ id: admin._id, email: admin.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // For Admin: Join and get chat list
  socket.on('admin:join', async () => {
    socket.join('admin_room');
    const rooms = await ChatRoom.find().sort({ timestamp: -1 });
    socket.emit('chatList', rooms);
  });
  
  // For User: Join their own room
  socket.on('user:join', async (userId) => {
      socket.join(userId);
      currentRoomId = userId;
      const messages = await Message.find({ roomId: userId }).sort({ timestamp: 1 });
      socket.emit('roomMessages', messages);
  });

  // Admin views a specific room
  socket.on('admin:viewRoom', async (roomId) => {
      socket.join(roomId);
      const messages = await Message.find({ roomId: roomId }).sort({ timestamp: 1 });
      socket.emit('roomMessages', messages);
      // Mark room as read
      await ChatRoom.findByIdAndUpdate(roomId, { hasUnreadAdmin: false });
  });

  // Handle new messages
  socket.on('sendMessage', async (data) => {
    const { roomId, senderId, text, isAdmin } = data;
    
    const newMessage = new Message({
      roomId,
      senderId,
      text,
      isAdmin
    });
    await newMessage.save();

    // Update chat room metadata
    const roomUpdate = {
        lastMessage: text,
        timestamp: new Date(),
        hasUnreadAdmin: !isAdmin
    };
    await ChatRoom.findByIdAndUpdate(roomId, roomUpdate, { upsert: true, new: true });

    // Broadcast message to the room (user and admin)
    io.to(roomId).emit('newMessage', newMessage);

    // Notify admin room of the new message to update the list
    const rooms = await ChatRoom.find().sort({ timestamp: -1 });
    io.to('admin_room').emit('chatList', rooms);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
