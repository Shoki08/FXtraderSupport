// fx-sw.js
// FXトレーダーPro - Service Worker

const CACHE_NAME = 'fx-trader-v1';
const urlsToCache = [
    './',
    './fx-trader-pro.html',
    './fx-trader-app.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// インストール時のキャッシュ
self.addEventListener('install', event => {
    console.log('📦 Service Worker インストール');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ キャッシュを作成');
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('❌ キャッシュ作成エラー:', error);
            })
    );
    
    self.skipWaiting();
});

// アクティベーション時の古いキャッシュ削除
self.addEventListener('activate', event => {
    console.log('🔄 Service Worker アクティベーション');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ 古いキャッシュを削除:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    
    return self.clients.claim();
});

// フェッチイベント（ネットワーク優先）
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // API呼び出しはキャッシュしない
                if (event.request.url.includes('api.exchangerate')) {
                    return response;
                }
                
                // 成功したレスポンスをキャッシュに保存
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                
                return response;
            })
            .catch(() => {
                // ネットワークエラー時はキャッシュから取得
                return caches.match(event.request);
            })
    );
});

// Push通知を受信
self.addEventListener('push', event => {
    console.log('📬 Push通知受信');
    
    let data = {
        title: 'FXトレーダーPro',
        body: '価格アラート',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: 'fx-alert',
        requireInteraction: true
    };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }
    
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || '/icon-192.png',
            badge: data.badge || '/badge-96.png',
            tag: data.tag || 'fx-notification',
            requireInteraction: data.requireInteraction || false,
            data: data.data || {},
            actions: [
                {
                    action: 'view',
                    title: '確認する'
                },
                {
                    action: 'close',
                    title: '閉じる'
                }
            ]
        })
    );
});

// 通知クリック時の処理
self.addEventListener('notificationclick', event => {
    console.log('🔔 通知クリック:', event.action);
    
    event.notification.close();
    
    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// バックグラウンド同期（将来の拡張用）
self.addEventListener('sync', event => {
    console.log('🔄 バックグラウンド同期:', event.tag);
    
    if (event.tag === 'sync-prices') {
        event.waitUntil(syncPrices());
    }
});

async function syncPrices() {
    try {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/JPY');
        const data = await response.json();
        
        // クライアントに通知
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'PRICE_UPDATE',
                data: data.rates
            });
        });
        
        console.log('✅ 価格同期完了');
    } catch (error) {
        console.error('❌ 価格同期エラー:', error);
    }
}

// 定期的なバックグラウンドタスク（実験的機能）
self.addEventListener('periodicsync', event => {
    console.log('⏰ 定期同期:', event.tag);
    
    if (event.tag === 'update-prices') {
        event.waitUntil(syncPrices());
    }
});

console.log('✅ FX Service Worker ロード完了');
