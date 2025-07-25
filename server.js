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

// --- DATABASE CONNECTION ---
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected successfully."))
  .catch(err => console.error("MongoDB connection error:", err));

// --- DATABASE SCHEMAS ---
const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  displayName: { type: String, required: true }, // NEW: Store display name with message
  isAdmin: { type: Boolean, default: false },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const chatRoomSchema = new mongoose.Schema({
  _id: { type: String }, // User's ID (roomId)
  displayName: { type: String, default: 'Sư Huynh Vô Danh' }, // NEW
  lastMessage: { type: String },
  timestamp: { type: Date },
  hasUnreadAdmin: { type: Boolean, default: false },
  isClosed: { type: Boolean, default: false } // NEW: For locking chats
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
            console.log(`Initial admin account created. Email: ${INITIAL_ADMIN_EMAIL}, Password: ${ADMIN_DEFAULT_PASSWORD}`);
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
    const { email, password } = req.body;
    try {
        const admin = await Admin.findOne({ email });
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ message: "Authentication failed." });
        }
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
  
  // UPDATED: user:join now receives an object with displayName
  socket.on('user:join', async ({ userId, displayName }) => {
      socket.join(userId);
      
      // Update or create the chat room, setting the display name
      const room = await ChatRoom.findByIdAndUpdate(
          userId,
          { _id: userId, displayName: displayName || 'Sư Huynh Vô Danh' },
          { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      
      const messages = await Message.find({ roomId: userId }).sort({ timestamp: 1 });
      // UPDATED: Send room details including lock status
      socket.emit('roomDetails', { messages, isClosed: room.isClosed });
  });

  socket.on('admin:viewRoom', async (roomId) => {
      socket.join(roomId);
      await ChatRoom.findByIdAndUpdate(roomId, { hasUnreadAdmin: false });
      const messages = await Message.find({ roomId: roomId }).sort({ timestamp: 1 });
      socket.emit('roomMessages', messages);
      // Update the admin's list in case the unread status changed
      io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));
  });

  // NEW: Handle toggling the lock status of a chat
  socket.on('admin:toggleLock', async ({ roomId, isLocked }) => {
    try {
        const room = await ChatRoom.findByIdAndUpdate(roomId, { isClosed: isLocked }, { new: true });
        if (room) {
            // Notify the user in that room about the lock status change
            io.to(roomId).emit('chat:locked', { isLocked: room.isClosed });
            // Update the list for all admins
            io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));
        }
    } catch (e) {
        console.error("Error toggling lock:", e);
    }
  });

  // UPDATED: sendMessage logic
  socket.on('sendMessage', async (data) => {
    const { roomId, senderId, text, isAdmin, displayName } = data;
    
    // Check if the chat is closed for messages from non-admins
    const room = await ChatRoom.findById(roomId);
    if (room && room.isClosed && !isAdmin) {
        socket.emit('chatError', 'Cuộc trò chuyện này đã bị đóng và không thể gửi tin nhắn.');
        return;
    }

    // Save message with all necessary info
    const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
    await newMessage.save();

    // Update the room's last message, timestamp, and unread status.
    // If a user sends a message, it automatically un-archives/un-closes the chat.
    const roomUpdate = { 
        lastMessage: text, 
        timestamp: new Date(), 
        hasUnreadAdmin: !isAdmin,
        displayName: displayName 
    };
    if(!isAdmin) {
      roomUpdate.isClosed = false;
    }
    
    await ChatRoom.findByIdAndUpdate(roomId, roomUpdate, { upsert: true, new: true, setDefaultsOnInsert: true });

    // Broadcast the new message to the room (user and any admin viewing it)
    io.to(roomId).emit('newMessage', newMessage);

    // Update the chat list for all connected admins
    io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
