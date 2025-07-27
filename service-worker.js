const CACHE_NAME = 'chat-app-cache-v2'; // Increased version to force update
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  // External resources
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js',
  'https://cdn.socket.io/4.6.1/socket.io.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  // App icons
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install event: cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Activate the new service worker immediately
});

// Fetch event: serve from cache first, then network
self.addEventListener('fetch', (event) => {
  // We only want to cache GET requests
  if (event.request.method !== 'GET') {
      return;
  }
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response; // Return from cache
        }
        // If not in cache, fetch from network
        return fetch(event.request).then(
            (networkResponse) => {
                // Optionally, you can cache dynamic requests here if needed
                return networkResponse;
            }
        ).catch(() => {
            // Handle offline case for navigation requests
            if (event.request.mode === 'navigate') {
                // You could return an offline.html page here
                // return caches.match('/offline.html');
            }
        });
      })
  );
});

// Activate event: clean up old caches
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
    }).then(() => self.clients.claim()) // Take control of all open clients
  );
});

// Push notification event listener
self.addEventListener('push', (event) => {
    if (!event.data) {
        console.log("Push event but no data");
        return;
    }

    const data = event.data.json();
    console.log('Push received:', data);

    const title = data.title || 'Tin nhắn mới';
    const options = {
        // Main content
        body: data.body || 'Bạn có một tin nhắn mới.',
        
        // Visuals
        icon: data.icon || '/icons/icon-192x192.png', // Main icon
        badge: data.badge || '/icons/icon-192x192.png', // Small icon for notification bar (Android)

        // Behavior
        tag: data.url, // Groups notifications, replaces old one with same tag
        renotify: true, // Vibrate/play sound even if a notification with the same tag exists
        
        // Data to pass to the click event
        data: {
            url: data.url || '/' // URL to open when clicked
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click event listener
self.addEventListener('notificationclick', (event) => {
    const clickedNotification = event.notification;
    clickedNotification.close(); // Close the notification

    const urlToOpen = event.notification.data.url;

    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((clientList) => {
            // Check if there's already a window open with the same URL
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                // Use .endsWith() to match URLs like /?roomId=... or /admin?roomId=...
                if (client.url && client.url.endsWith(urlToOpen) && 'focus' in client) {
                    return client.focus();
                }
            }
            // If no window is found, open a new one
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
