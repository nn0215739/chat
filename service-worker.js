const CACHE_NAME = 'chat-app-cache-v4'; // Increased version
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js',
  'https://cdn.socket.io/4.6.1/socket.io.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

// --- UNIFIED NOTIFICATION DISPLAY FUNCTION ---
function displayNotification(payload) {
    const { title, body, url } = payload;
    const options = {
        body: body || 'Bạn có một tin nhắn mới.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        vibrate: [200, 100, 200],
        tag: url, // Group notifications by the URL
        renotify: true,
        data: {
            url: url || '/'
        },
        actions: [
            { action: 'explore', title: '➡️ Trả lời' },
            { action: 'close', title: 'Đóng' }
        ]
    };
    // self.registration.showNotification returns a promise, which we must use
    return self.registration.showNotification(title || 'Tin nhắn mới', options);
}

// --- LISTENER FOR PUSH EVENTS FROM SERVER ---
self.addEventListener('push', (event) => {
    if (!event.data) return;
    try {
        const data = event.data.json();
        console.log('Push received from server:', data);
        event.waitUntil(displayNotification(data));
    } catch (e) {
        console.error('Error parsing push data:', e);
    }
});

// --- LISTENER FOR MESSAGES FROM THE CLIENT PAGE (index.html) ---
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        console.log('Notification request from client:', event.data.payload);
        // This doesn't need to be in a waitUntil as the service worker is already active
        displayNotification(event.data.payload);
    }
});

// --- LISTENER FOR NOTIFICATION CLICKS ---
self.addEventListener('notificationclick', (event) => {
    const clickedNotification = event.notification;
    clickedNotification.close();

    if (event.action === 'close') {
        return;
    }

    const urlToOpen = event.notification.data.url;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
            for (const client of clientList) {
                // If a window is already open, focus it
                if (client.url === self.location.origin + '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise, open a new window
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
