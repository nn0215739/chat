// --- UPDATED --- Tăng phiên bản CACHE_NAME để đảm bảo service worker được cập nhật
const CACHE_NAME = 'chat-app-cache-v4-stable'; 
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

// --- UPDATED --- Sử dụng chiến lược "Stale-While-Revalidate"
// Chiến lược này giúp ứng dụng tải nhanh hơn bằng cách hiển thị nội dung từ cache ngay lập tức,
// đồng thời gửi yêu cầu ra mạng để lấy phiên bản mới nhất và cập nhật cache cho lần truy cập sau.
self.addEventListener('fetch', (event) => {
    // Bỏ qua các yêu cầu không phải là GET hoặc các yêu cầu đến máy chủ khác (ví dụ: API backend, CDN)
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                // Tạo một promise để lấy dữ liệu từ mạng
                const fetchedResponsePromise = fetch(event.request).then((networkResponse) => {
                    // Cập nhật cache bằng dữ liệu mới từ mạng
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                }).catch(error => {
                    console.error('Fetch failed:', error);
                    // Có thể trả về một trang offline mặc định ở đây nếu cần
                });

                // Trả về dữ liệu từ cache ngay lập tức nếu có, nếu không thì đợi dữ liệu từ mạng
                return cachedResponse || fetchedResponsePromise;
            });
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
