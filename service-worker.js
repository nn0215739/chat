// --- UPDATED --- Tăng phiên bản CACHE_NAME và quay lại chiến lược cache cũ
const CACHE_NAME = 'chat-app-cache-v5-stable';
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

// --- REVERTED --- Quay lại chiến lược "Cache first, then network" để ổn định hành vi PWA
// Chiến lược này ưu tiên tốc độ và tính nhất quán bằng cách luôn tải từ cache nếu có.
// Nó sẽ giải quyết vấn đề thông báo "sao chép địa chỉ" hiển thị lặp lại.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            // Trả về từ cache nếu tìm thấy, nếu không thì đi lấy từ mạng.
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
        tag: payload.tag,
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
