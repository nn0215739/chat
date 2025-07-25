/**
 * Service Worker for Web Push Notifications.
 */

// Listen for push events from the server
self.addEventListener('push', event => {
    // Check if data is present and is JSON
    if (!event.data) {
        console.error('Push event but no data');
        return;
    }

    try {
        const data = event.data.json();
        
        const title = data.title || 'Thông báo mới';
        const options = {
            body: data.body || 'Bạn có một tin nhắn mới.',
            icon: data.icon || '/icon-192x192.png', // A default icon
            badge: data.badge || '/badge-72x72.png', // A default badge for Android
            data: {
                url: self.location.origin // URL to open on click
            }
        };

        // Show the notification
        event.waitUntil(
            self.registration.showNotification(title, options)
        );
    } catch (e) {
        console.error('Error parsing push data:', e);
    }
});

// Listen for notification clicks
self.addEventListener('notificationclick', event => {
    event.notification.close(); // Close the notification

    // Open the app's URL
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientsArr => {
            const hadWindowToFocus = clientsArr.some(windowClient => 
                windowClient.url === event.notification.data.url ? (windowClient.focus(), true) : false
            );

            if (!hadWindowToFocus) {
                clients.openWindow(event.notification.data.url).then(windowClient => windowClient ? windowClient.focus() : null);
            }
        })
    );
});
