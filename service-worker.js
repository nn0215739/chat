// --- THAY ĐỔI TÊN CACHE ĐỂ ÉP TRÌNH DUYỆT CẬP NHẬT GIAO DIỆN MỚI ---
const CACHE_NAME = 'chat-app-cache-v4-image-update'; 
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
          // Xóa tất cả các cache cũ không phải là v4
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
  // Bỏ qua cache đối với các yêu cầu API hoặc Socket để đảm bảo dữ liệu luôn mới
  if (event.request.url.includes('/socket.io/') || event.request.method !== 'GET') {
      return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Trả về cache nếu có, nếu không thì fetch từ mạng
        return response || fetch(event.request);
      })
  );
});

// --- CÁC PHẦN XỬ LÝ THÔNG BÁO (GIỮ NGUYÊN) ---
function displaySystemNotification(payload) {
    const title = payload.title || 'Tin nhắn mới';
    const options = {
        body: payload.body || 'Bạn có một tin nhắn mới.',
        icon: payload.icon || '/icons/icon-192x192.png', // Ưu tiên icon từ payload
        badge: '/icons/icon-192x192.png',
        vibrate: [200, 100, 200],
        tag: payload.tag,
        renotify: true,
        data: {
            url: payload.url || '/'
        },
        actions: [
            { action: 'explore', title: '➡️ Xem ngay' },
            { action: 'close', title: 'Đóng' }
        ]
    };
    return self.registration.showNotification(title, options);
}

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

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        event.waitUntil(displaySystemNotification(event.data.payload));
    }
});

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
