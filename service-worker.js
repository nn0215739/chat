const CACHE_NAME = 'chat-app-cache-v3-stable'; // Tên cache mới để đảm bảo cập nhật
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache and adding core assets');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Kích hoạt service worker mới ngay lập tức
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Kiểm soát tất cả các client đang mở
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});


// --- HÀM HIỂN THỊ THÔNG BÁO THỐNG NHẤT ---
function displaySystemNotification(payload) {
    const title = payload.title || 'Tin nhắn mới';
    const options = {
        body: payload.body || 'Bạn có một tin nhắn mới.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        vibrate: [200, 100, 200],
        tag: payload.tag, // Gom nhóm thông báo theo tag (ví dụ: roomId)
        renotify: true,
        data: {
            url: payload.url || '/'
        },
        actions: [
            { action: 'explore', title: '➡️ Trả lời' },
            { action: 'close', title: 'Đóng' }
        ]
    };
    return self.registration.showNotification(title, options);
}

// --- LẮNG NGHE SỰ KIỆN PUSH TỪ SERVER ---
self.addEventListener('push', (event) => {
    try {
        const data = event.data.json();
        event.waitUntil(displaySystemNotification(data));
    } catch (e) {
        console.error('Error handling push event:', e);
        // Có thể hiển thị một thông báo mặc định nếu dữ liệu push bị lỗi
        const defaultPayload = { title: 'Bạn có tin nhắn mới' };
        event.waitUntil(displaySystemNotification(defaultPayload));
    }
});

// --- LẮNG NGHE YÊU CẦU TỪ CLIENT (INDEX.HTML) ---
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        event.waitUntil(displaySystemNotification(event.data.payload));
    }
});

// --- LẮNG NGHE SỰ KIỆN NHẤP VÀO THÔNG BÁO ---
self.addEventListener('notificationclick', (event) => {
    const clickedNotification = event.notification;
    clickedNotification.close();

    if (event.action === 'close') {
        return;
    }

    const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((clientList) => {
            for (const client of clientList) {
                // Chuẩn hóa cả hai URL trước khi so sánh
                if (new URL(client.url).href === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
