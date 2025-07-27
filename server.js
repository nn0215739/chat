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

// Serve the service worker file from the root directory
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
  isClosed: { type: Boolean, default: false }, 
  pushSubscription: { type: Object } // To store user's push subscription
});
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

// NEW: Schema to store admin's push subscriptions
const adminSubscriptionSchema = new mongoose.Schema({
    subscription: { type: Object, required: true }
});
const AdminSubscription = mongoose.model('AdminSubscription', adminSubscriptionSchema);


const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const Admin = mongoose.model('Admin', adminSchema);

// --- UTILITY FUNCTIONS ---
async function sendNotificationToAllAdmins(payload) {
    try {
        const subscriptions = await AdminSubscription.find();
        subscriptions.forEach(({ subscription }) => {
            webpush.sendNotification(subscription, payload).catch(error => {
                // If a subscription is expired or invalid, remove it
                if (error.statusCode === 410 || error.statusCode === 404) {
                    console.log('Subscription expired or invalid. Removing...');
                    AdminSubscription.deleteOne({ 'subscription.endpoint': subscription.endpoint }).exec();
                } else {
                    console.error('Error sending push notification to admin:', error);
                }
            });
        });
    } catch (error) {
        console.error("Failed to fetch admin subscriptions:", error);
    }
}


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

// Route for USER to save their subscription
app.post('/api/save-subscription', async (req, res) => {
    try {
        const { subscription, roomId } = req.body;
        if (roomId && subscription) {
            await ChatRoom.findByIdAndUpdate(roomId, { pushSubscription: subscription }, { upsert: true });
            res.status(201).json({ message: 'User subscription saved.' });
        } else {
            res.status(400).json({ message: 'Room ID and subscription are required.' });
        }
    } catch (error) {
        console.error("Error saving user subscription:", error);
        res.status(500).json({ message: 'Could not save subscription.' });
    }
});

// NEW: Route for ADMIN to save their subscription
app.post('/api/save-admin-subscription', async (req, res) => {
    try {
        const { subscription } = req.body;
        if (subscription) {
            // Avoid duplicates
            await AdminSubscription.updateOne(
                { 'subscription.endpoint': subscription.endpoint },
                { $set: { subscription } },
                { upsert: true }
            );
            res.status(201).json({ message: 'Admin subscription saved.' });
        } else {
            res.status(400).json({ message: 'Subscription is required.' });
        }
    } catch (error) {
        console.error("Error saving admin subscription:", error);
        res.status(500).json({ message: 'Could not save admin subscription.' });
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
      // Check if this is a new room
      const isNewRoom = !(await ChatRoom.findById(userId));

      const roomUpdate = { displayName: displayName };
      const room = await ChatRoom.findByIdAndUpdate(userId, roomUpdate, { upsert: true, new: true, setDefaultsOnInsert: true });
      socket.emit('roomDetails', { messages: await Message.find({ roomId: userId }).sort({ timestamp: 1 }), isClosed: room.isClosed });

      // If it's a brand new chat, notify admins
      if (isNewRoom) {
          const payload = JSON.stringify({
              title: '💬 Cuộc trò chuyện mới!',
              body: `Người dùng "${displayName}" đã bắt đầu một cuộc trò chuyện.`,
              url: `/admin?roomId=${userId}` // Direct link for admin
          });
          sendNotificationToAllAdmins(payload);
      }
  });

  socket.on('admin:viewRoom', async (roomId) => {
      await socket.join(roomId);
      const room = await ChatRoom.findByIdAndUpdate(roomId, { hasUnreadAdmin: false }, { new: true });
      if (room) {
        socket.emit('roomDetails', { messages: await Message.find({ roomId }).sort({ timestamp: 1 }), isClosed: room.isClosed });
        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        io.to('admin_room').emit('chatList', rooms);
      }
  });

  socket.on('sendMessage', async (data, callback) => {
    const { roomId, senderId, text, isAdmin, displayName } = data;
    try {
        const room = await ChatRoom.findById(roomId);

        if (!room) {
            if (callback) callback({ status: 'error', message: 'Cuộc trò chuyện không tồn tại.' });
            return;
        }

        if (room.isClosed && !isAdmin) {
            if (callback) callback({ status: 'error', message: 'Cuộc trò chuyện này đã bị khoá.' });
            return socket.emit('chatError', 'Cuộc trò chuyện này đã bị khoá.');
        }
        
        const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
        await newMessage.save();

        const roomUpdate = { lastMessage: text, timestamp: new Date(), hasUnreadAdmin: !isAdmin };
        await ChatRoom.findByIdAndUpdate(roomId, roomUpdate);

        io.to(roomId).to('admin_room').emit('newMessage', newMessage);
        io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));

        // --- ENHANCED NOTIFICATION LOGIC ---
        if (isAdmin) {
            // Admin sent a message, notify the USER
            if (room.pushSubscription) {
                const payload = JSON.stringify({
                    title: `Tin nhắn từ Quản trị viên`,
                    body: text,
                    icon: '/icons/icon-192x192.png',
                    url: `/?roomId=${roomId}` // URL for user to open chat
                });
                webpush.sendNotification(room.pushSubscription, payload).catch(err => console.error('Error sending notification to user:', err));
            }
        } else {
            // User sent a message, notify ALL ADMINS
            const payload = JSON.stringify({
                title: `Tin nhắn từ ${displayName}`,
                body: text,
                icon: '/icons/icon-192x192.png',
                url: `/admin?roomId=${roomId}` // URL for admin to open chat
            });
            sendNotificationToAllAdmins(payload);
        }

        if (callback) callback({ status: 'success' });
    } catch (error) {
        console.error("Error sending message:", error);
        if (callback) callback({ status: 'error', message: 'Lỗi máy chủ khi gửi tin nhắn.' });
        socket.emit('chatError', 'Không thể gửi tin nhắn. Vui lòng thử lại.');
    }
  });

  socket.on('admin:toggleLock', async ({ roomId, isLocked }) => {
      await ChatRoom.findByIdAndUpdate(roomId, { isClosed: isLocked });
      io.to(roomId).to('admin_room').emit('chat:locked', { roomId, isLocked });
  });
  
  socket.on('admin:deleteMessage', async ({ messageId, roomId }) => {
      try {
          const deletedMessage = await Message.findByIdAndDelete(messageId);
          if (deletedMessage) {
              io.to(roomId).to('admin_room').emit('messageDeleted', messageId);
              
              const lastMsg = await Message.findOne({ roomId }).sort({ timestamp: -1 });
              await ChatRoom.findByIdAndUpdate(roomId, {
                  lastMessage: lastMsg ? lastMsg.text : "...",
                  timestamp: lastMsg ? lastMsg.timestamp : new Date()
              });
              io.to('admin_room').emit('chatList', await ChatRoom.find().sort({ timestamp: -1 }));
          }
      } catch (error) {
          console.error("Error deleting message:", error);
      }
  });

  socket.on('admin:deleteConversation', async ({ roomId }) => {
      try {
          await Message.deleteMany({ roomId: roomId });
          await ChatRoom.findByIdAndDelete(roomId);
          io.to('admin_room').emit('conversationDeleted', roomId);
          io.to(roomId).emit('chatEndedByAdmin');
      } catch (error) {
          console.error("Error deleting conversation:", error);
      }
  });


  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
