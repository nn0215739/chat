// --- UPDATED --- Tăng phiên bản CACHE_NAME và tinh chỉnh lại chiến lược cache
const CACHE_NAME = 'chat-app-cache-v6-stable';
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
      .then(() => self.skipWaiting())
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
    }).then(() => self.clients.claim())
  );
});

// --- REFINED --- Cập nhật lại chiến lược cache để xử lý dứt điểm
// Chiến lược này xử lý các yêu cầu điều hướng (navigation) một cách đặc biệt
// để đảm bảo ứng dụng luôn được khởi chạy từ file index.html gốc,
// giúp Chrome nhận diện PWA một cách ổn định nhất.
self.addEventListener('fetch', (event) => {
    // Chỉ xử lý các yêu cầu GET
    if (event.request.method !== 'GET') {
      return;
    }
  
    // Đối với các yêu cầu điều hướng (mở app, tải lại trang),
    // luôn trả về file index.html chính từ cache.
    // Điều này đảm bảo ứng dụng hoạt động như một Single Page App (SPA) thực thụ.
    if (event.request.mode === 'navigate') {
      event.respondWith(
        caches.match('/index.html').then(response => {
          return response || fetch('/index.html');
        })
      );
      return;
    }
  
    // Đối với các tài nguyên khác (CSS, JS, images),
    // sử dụng chiến lược "Cache First" ổn định.
    event.respondWith(
      caches.match(event.request).then(response => {
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
