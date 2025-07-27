const CACHE_NAME = 'chat-app-cache-v3'; // Increased version again
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
    }).then(() => self.clients.claim())
  );
});

// Fetch event: serve from cache first, then network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});


// --- ENHANCED PUSH NOTIFICATION LOGIC ---
self.addEventListener('push', (event) => {
    if (!event.data) {
        console.log("Push event but no data");
        return;
    }

    const data = event.data.json();
    console.log('Push received:', data);

    const title = data.title || 'Tin nhắn mới';
    const options = {
        body: data.body || 'Bạn có một tin nhắn mới.',
        icon: data.icon || '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png', // Small icon for notification bar (Android)
        
        // Make notification more engaging
        vibrate: [200, 100, 200], // Vibrate pattern
        tag: data.url, // Group notifications by conversation
        renotify: true, // Re-alert user for new messages in same conversation
        
        // Data to pass to the click event
        data: {
            url: data.url || '/' 
        },
        
        //  *** NEW: Action Buttons ***
        actions: [
            { 
                action: 'explore', 
                title: '➡️ Trả lời',
                // icon: '/icons/reply-icon.png' // Optional: You can add icons to buttons
            },
            { 
                action: 'close', 
                title: 'Đóng',
                // icon: '/icons/close-icon.png'
            }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});


// --- ENHANCED NOTIFICATION CLICK LOGIC ---
self.addEventListener('notificationclick', (event) => {
    const clickedNotification = event.notification;
    clickedNotification.close(); // Always close the notification

    // --- Handle Action Button Clicks ---
    if (event.action === 'close') {
        // User clicked the 'Close' button, do nothing further.
        console.log('Notification closed by user action.');
        return;
    }

    // --- Handle Click on Notification Body or 'Explore' Button ---
    const urlToOpen = event.notification.data.url;

    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((clientList) => {
            // Check if there's already a window open for this app
            for (const client of clientList) {
                // If found, focus it
                if (client.url === self.location.origin + '/' && 'focus' in client) {
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
