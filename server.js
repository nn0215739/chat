// ... (Các phần import cũ giữ nguyên)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
// ... (các import khác)
const webpush = require('web-push');
// THÊM DÒNG NÀY:
const TelegramBot = require('node-telegram-bot-api'); 

require('dotenv').config();

// ... (Phần khởi tạo app, server giữ nguyên)

// --- CONFIGURATION ---
// ... (Giữ nguyên các config cũ)
const ADMIN_ONLY_ROOM_ID = 'admins_only_chat';

// --- TELEGRAM CONFIG ---
// Bạn nên đưa vào file .env, ở đây mình để ví dụ
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID || "YOUR_TELEGRAM_CHAT_ID"; 

// Khởi tạo Bot
// polling: true để bot có thể lắng nghe tin nhắn reply từ bạn
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ... (Phần Database Schema giữ nguyên)

// ... (Phần Utility Functions giữ nguyên)

// --- TELEGRAM LOGIC ---

// 1. Hàm gửi tin nhắn từ Web sang Telegram
function sendToTelegram(room, messageText) {
    if (!TELEGRAM_ADMIN_ID || !TELEGRAM_TOKEN) return;

    // Format tin nhắn để sau này dễ trích xuất Room ID khi reply
    // Lưu ý: Dòng chứ chứ ID cực kỳ quan trọng để bot biết trả lời cho ai
    const msg = `📩 <b>Tin nhắn mới từ Web!</b>\n` +
                `👤 Tên: ${room.displayName}\n` +
                `🆔 RoomID: <code>${room._id}</code>\n` + 
                `-----------------------\n` +
                `${messageText}`;

    bot.sendMessage(TELEGRAM_ADMIN_ID, msg, { parse_mode: 'HTML' })
       .catch(err => console.error("Telegram Error:", err.message));
}

// 2. Lắng nghe Admin trả lời trên Telegram để bắn ngược về Web
bot.on('message', async (msg) => {
    // Chỉ xử lý tin nhắn từ đúng Admin ID để bảo mật
    if (msg.chat.id.toString() !== TELEGRAM_ADMIN_ID.toString()) return;
    
    // Kiểm tra xem có phải là Reply cho một tin nhắn của bot không
    if (msg.reply_to_message && msg.reply_to_message.text) {
        const originalText = msg.reply_to_message.text;
        
        // Trích xuất RoomID từ tin nhắn gốc (Dựa vào format ở hàm sendToTelegram)
        // Regex tìm chuỗi sau chữ "RoomID: "
        const match = originalText.match(/RoomID: (user_[a-zA-Z0-9_]+)/); // Cập nhật regex phù hợp với ID của bạn
        // Hoặc đơn giản hơn nếu ID của bạn không có format cố định:
        // const match = originalText.match(/RoomID: (.+?)\n/);

        if (match && match[1]) {
            const roomId = match[1];
            const replyText = msg.text;

            try {
                // A. Lưu vào Database (Giống như admin chat trên web)
                const newMessage = new Message({
                    roomId: roomId,
                    senderId: 'admin',
                    displayName: 'Quản trị viên (Telegram)', // Đánh dấu để biết nguồn
                    isAdmin: true,
                    text: replyText
                });
                await newMessage.save();

                // B. Cập nhật trạng thái phòng chat
                const roomUpdate = { 
                    lastMessage: replyText, 
                    timestamp: new Date(), 
                    hasUnreadAdmin: false 
                };
                await ChatRoom.findByIdAndUpdate(roomId, roomUpdate);

                // C. Bắn Socket cho người dùng Web (Realtime)
                io.to(roomId).to('admin_room').emit('newMessage', newMessage);
                
                // Cập nhật danh sách chat cho Admin Web (nếu đang mở web)
                const rooms = await ChatRoom.find().sort({ timestamp: -1 });
                const adminRoomInfo = { _id: ADMIN_ONLY_ROOM_ID, displayName: '⭐️ Phòng chat Quản trị viên', lastMessage: '...', timestamp: new Date(), isSpecial: true };
                io.to('admin_room').emit('chatList', [adminRoomInfo, ...rooms]);

                // D. Gửi Push Notification (Web Push) cho user (để backup)
                const room = await ChatRoom.findById(roomId);
                if (room && room.pushSubscription) {
                     const payload = JSON.stringify({
                        title: `Tin nhắn từ Quản trị viên`,
                        body: replyText,
                        icon: '/icons/icon-192x192.png',
                        url: `/?roomId=${roomId}`
                    });
                    webpush.sendNotification(room.pushSubscription, payload).catch(e => console.log(e));
                }

                // E. Phản hồi lại Telegram để Admin biết đã gửi thành công
                // (Optional: thả tim hoặc reply ok)
                // bot.sendMessage(TELEGRAM_ADMIN_ID, "✅ Đã gửi.");

            } catch (error) {
                console.error("Error sending reply from Telegram:", error);
                bot.sendMessage(TELEGRAM_ADMIN_ID, "❌ Lỗi: Không thể gửi tin nhắn xuống Web.");
            }
        } else {
            bot.sendMessage(TELEGRAM_ADMIN_ID, "⚠️ Không tìm thấy RoomID. Hãy reply đúng tin nhắn có chứa RoomID.");
        }
    }
});


// ... (Phần Socket.IO logic cũ)

io.on('connection', (socket) => {
  // ... (giữ nguyên)

  socket.on('sendMessage', async (data, callback) => {
    const { roomId, senderId, text, isAdmin, displayName } = data;
    try {
        // ... (Logic cũ xử lý ADMIN_ONLY_ROOM_ID giữ nguyên)
        if (roomId === ADMIN_ONLY_ROOM_ID) {
            // ...
            return callback({ status: 'success' });
        }

        // ... (Logic kiểm tra room tồn tại giữ nguyên)
        const room = await ChatRoom.findById(roomId);
        if (!room) { return callback({ status: 'error', message: 'Cuộc trò chuyện không tồn tại.' }); }
        
        // ... (Lưu tin nhắn vào DB như cũ)
        const newMessage = new Message({ roomId, senderId, text, isAdmin, displayName });
        await newMessage.save();

        // ... (Cập nhật ChatRoom như cũ)
        const roomUpdate = { lastMessage: text, timestamp: new Date(), hasUnreadAdmin: !isAdmin };
        await ChatRoom.findByIdAndUpdate(roomId, roomUpdate);

        // ... (Emit Socket như cũ)
        io.to(roomId).to('admin_room').emit('newMessage', newMessage);
        
        // ... (Emit update list chat như cũ)
        const rooms = await ChatRoom.find().sort({ timestamp: -1 });
        const adminRoomInfo = { _id: ADMIN_ONLY_ROOM_ID, displayName: '⭐️ Phòng chat Quản trị viên', ... };
        io.to('admin_room').emit('chatList', [adminRoomInfo, ...rooms]);

        // --- XỬ LÝ THÔNG BÁO ---
        if (isAdmin) {
            // Admin nhắn trên web -> Gửi Push cho user (giữ nguyên code cũ)
            if (room.pushSubscription) {
                // ... code webpush cũ
            }
        } else {
            // User nhắn -> Gửi cho Admin
            
            // 1. Gửi Web Push cho Admin (giữ nguyên code cũ)
            const payload = JSON.stringify({
                title: `Tin nhắn từ ${displayName}`, body: text, icon: '/icons/icon-192x192.png', url: `/?roomId=${roomId}`
            });
            sendNotificationToAllAdmins(payload);

            // 2. [MỚI] GỬI VỀ TELEGRAM
            sendToTelegram({ _id: roomId, displayName: displayName }, text);
        }

        if (callback) callback({ status: 'success' });
    } catch (error) {
        // ...
    }
  });

  // ... (Các phần còn lại giữ nguyên)
});
