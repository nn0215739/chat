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
const ADMIN_ONLY_ROOM_ID = 'admins_only_chat';

// VAPID keys should be stored in environment variables for security
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BLR3ESERJvSd663nWEkEVoQHkfIk6V0akO8_lVv8Tl4ATq3TNJc2wZQQUYajbRUN0rXreHPDA5As_OMOMN8e4Ms";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "qnW902sNFeZ2nrLZsoPAzipwIHWVpejp75hc_SgqyaY";

webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// --- STATE MANAGEMENT ---
const onlineAdmins = new Map(); // CHỈNH SỬA: Theo dõi các quản trị viên đang online { socket.id -> { displayName } }

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
  pushSubscription: { type: Object }
});
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

const adminSubscriptionSchema = new mongoose.Schema({
    subscription: { type: Object, required: true }
});
const AdminSubscription = mongoose.model('AdminSubscription', adminSubscriptionSchema);

const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    displayName: { type: String, default: 'Quản trị viên' }
});
const Admin = mongoose.model('Admin', adminSchema);

// --- UTILITY FUNCTIONS ---
async function sendNotificationToAllAdmins(payload) {
    try {
        const subscriptions = await AdminSubscription.find();
        subscriptions.forEach(({ subscription }) => {
            webpush.sendNotification(subscription, payload).catch(error => {
                if (error.statusCode === 410 || error.statusCode === 404) {
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
            await new Admin({ 
                email: INITIAL_ADMIN_EMAIL, 
                password: hashedPassword,
                displayName: 'Admin Chính' 
            }).save();
            console.log(`Initial admin created. Email: ${INITIAL_ADMIN_EMAIL}`);
        }
    } catch (error) {
        console.error("Error creating initial admin:", error);
    }
}
createInitialAdmin();


// --- API ROUTES ---
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        if (!admin || !await bcrypt.compare(password, admin.password)) {
            return res.status(401).json({ message: "Sai email hoặc mật khẩu." });
        }
        const token = jwt.sign({ id: admin._id, displayName: admin.displayName }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, displayName: admin.displayName });
    } catch (error) {
        res.status(500).json({ message: "Lỗi máy chủ" });
    }
});

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
        res.status(500).json({ message: 'Could not save subscription.' });
    }
});

app.post('/api/save-admin-subscription', async (req, res) => {
    try {
        const { subscription } = req.body;
        if (subscription) {
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
        res.status(500).json({ message: 'Could not save admin subscription.' });
    }
});


// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // CHỈNH SỬA: Cập nhật sự kiện admin:join để xử lý danh sách online
  socket.on('admin:join', async ({ displayName }) => {
    socket.join('admin_room');
    socket.join(ADMIN_ONLY_ROOM_ID);

    // Thêm admin vào danh sách online
    onlineAdmins.set(socket.id, { displayName });

    // Gửi danh sách phòng chat
    const userRooms = await ChatRoom.find().sort({ timestamp: -1 });
    const adminRoomInfo = {
        _id: ADMIN_ONLY_ROOM_ID,
        displayName: '⭐️ Phòng chat Quản trị viên',
        lastMessage: 'Nơi các quản trị viên trao đổi nội bộ...',
        timestamp: new Date(),
        isSpecial: true
    };
    const allRooms = [adminRoomInfo, ...userRooms];
    socket.emit('chatList', allRooms);
    
    // Gửi danh sách admin đang online cho tất cả admin
    io.to('admin_room').emit('admin:list:update', Array.from(onlineAdmins.values()));
  });
  
  socket.on('user:join', async ({ userId, displayName }) => {
      socket.join(userId);
      const isNewRoom = !(await ChatRoom.findById(userId));

      const roomUpdate = { displayName: displayName };
      const room = await ChatRoom.findByIdAndUpdate(userId, roomUpdate, { upsert: true, new: true, setDefaultsOnInsert: true });
      socket.emit('roomDetails', { messages: await Message.find({ roomId: userId }).sort({ timestamp: 1 }), isClosed: room.isClosed });

      if (isNewRoom) {
          const payload = JSON.stringify({
              title: '💬 Cuộc trò chuyện mới!',
              body: `Người dùng "${displayName}" đã bắt đầu một cuộc trò chuyện.`,
              url: `/?roomId=${userId}`
          });
          sendNotificationToAllAdmins(payload);
          const rooms = await ChatRoom.find().sort({ timestamp: -1 });
          const adminRoomInfo = { _id: ADMIN_ONLY_ROOM_ID, displayName: '⭐️ Phòng chat Quản trị viên', lastMessage: 'Nơi các quản trị viên trao đổi nội bộ...', timestamp: new Date(), isSpecial: true };
          io.to('admin_room').emit('chatList', [adminRoomInfo, ...rooms]);
      }
  });

  socket.on('admin:viewRoom', async (roomId) => {
      await socket.join(roomId);
      
      if (roomId === ADMIN_ONLY_ROOM_ID) {
          const messages = await Message.find({ roomId: ADMIN_ONLY_ROOM_ID }).sort({ timestamp: 1 });
          socket.emit('roomDetails', { messages, isClosed: false });
      } else {
          const room = await ChatRoom.findByIdAndUpdate(roomId, { hasUnreadAdmin: false }, { new: true });
          if (room) {
            socket.emit('roomDetails', { messages: await Message.find({ roomId }).sort({ timestamp: 1 }), isClosed: room.isClosed });
            const rooms = await ChatRoom.find().sort({ timestamp: -1 });
            const adminRoomInfo = { _id: ADMIN_ONLY_ROOM_ID, displayName: '⭐️ Phòng chat Quản trị viên', lastMessage: 'Nơi các quản trị viên trao đổi nội bộ...', timestamp: new Date(), isSpecial: true };
            io.to('admin_room').emit('chatList', [adminRoomInfo, ...rooms]);
          }
      }
  });

  socket.on('sendMessage', async (data, callback) => {
    const { roomId, senderId, text, isAdmin, displayName } = data;
    try {
        if (roomId === ADMIN_ONLY_ROOM_ID) {
            if (!isAdmin) {
                return callback({ status: 'error', message: 'Không được phép.' });
            }
            const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
            await newMessage.save();
            io.to(ADMIN_ONLY_ROOM_ID).emit('newMessage', newMessage);
            return callback({ status: 'success' });
        }

        const room = await ChatRoom.findById(roomId);
        if (!room) {
            return callback({ status: 'error', message: 'Cuộc trò chuyện không tồn tại.' });
        }
        if (room.isClosed && !isAdmin) {
            return callback({ status: 'error', message: 'Cuộc trò chuyện này đã bị khoá.' });
        }
        
        const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
        await newMessage.save();

        const roomUpdate = { lastMessage: text, timestamp: new Date(), hasUnreadAdmin: !isAdmin };
        await ChatRoom.findByIdAndUpdate(roomId, roomUpdate);

        io.to(roomId).to('admin_room').emit('newMessage', newMessage);
        
        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        const adminRoomInfo = { _id: ADMIN_ONLY_ROOM_ID, displayName: '⭐️ Phòng chat Quản trị viên', lastMessage: 'Nơi các quản trị viên trao đổi nội bộ...', timestamp: new Date(), isSpecial: true };
        io.to('admin_room').emit('chatList', [adminRoomInfo, ...rooms]);

        if (isAdmin) {
            if (room.pushSubscription) {
                const payload = JSON.stringify({
                    title: `Tin nhắn từ Quản trị viên`, body: text, icon: '/icons/icon-192x192.png', url: `/?roomId=${roomId}`
                });
                webpush.sendNotification(room.pushSubscription, payload).catch(err => console.error('Error sending notification to user:', err));
            }
        } else {
            const payload = JSON.stringify({
                title: `Tin nhắn từ ${displayName}`, body: text, icon: '/icons/icon-192x192.png', url: `/?roomId=${roomId}`
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
      if (roomId === ADMIN_ONLY_ROOM_ID) return;
      await ChatRoom.findByIdAndUpdate(roomId, { isClosed: isLocked });
      io.to(roomId).to('admin_room').emit('chat:locked', { roomId, isLocked });
  });
  
  socket.on('admin:deleteMessage', async ({ messageId, roomId }) => {
      try {
          const deletedMessage = await Message.findByIdAndDelete(messageId);
          if (deletedMessage) {
              io.to(roomId).to('admin_room').emit('messageDeleted', messageId);
              
              if (roomId !== ADMIN_ONLY_ROOM_ID) {
                  const lastMsg = await Message.findOne({ roomId }).sort({ timestamp: -1 });
                  await ChatRoom.findByIdAndUpdate(roomId, {
                      lastMessage: lastMsg ? lastMsg.text : "...",
                      timestamp: lastMsg ? lastMsg.timestamp : new Date()
                  });
                  const rooms = await ChatRoom.find().sort({ timestamp: -1 });
                  const adminRoomInfo = { _id: ADMIN_ONLY_ROOM_ID, displayName: '⭐️ Phòng chat Quản trị viên', lastMessage: 'Nơi các quản trị viên trao đổi nội bộ...', timestamp: new Date(), isSpecial: true };
                  io.to('admin_room').emit('chatList', [adminRoomInfo, ...rooms]);
              }
          }
      } catch (error) {
          console.error("Error deleting message:", error);
      }
  });

  socket.on('admin:deleteConversation', async ({ roomId }) => {
      if (roomId === ADMIN_ONLY_ROOM_ID) return;
      try {
          await Message.deleteMany({ roomId: roomId });
          await ChatRoom.findByIdAndDelete(roomId);
          io.to('admin_room').emit('conversationDeleted', roomId);
          io.to(roomId).emit('chatEndedByAdmin');
      } catch (error) {
          console.error("Error deleting conversation:", error);
      }
  });


  // CHỈNH SỬA: Xử lý khi admin ngắt kết nối
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Kiểm tra nếu người dùng ngắt kết nối là admin
    if (onlineAdmins.has(socket.id)) {
        onlineAdmins.delete(socket.id);
        // Gửi danh sách admin đã cập nhật cho những người còn lại
        io.to('admin_room').emit('admin:list:update', Array.from(onlineAdmins.values()));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
