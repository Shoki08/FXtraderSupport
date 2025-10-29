// fx-server.js
// FXトレーダーPro - バックグラウンド通知サーバー
// Node.js + Express + web-push

const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(cors());
app.use(express.json());

// =====================================================
// VAPID鍵の設定
// 生成コマンド: npx web-push generate-vapid-keys
// =====================================================
const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || 'YOUR_PUBLIC_KEY_HERE',
    privateKey: process.env.VAPID_PRIVATE_KEY || 'YOUR_PRIVATE_KEY_HERE'
};

webpush.setVapidDetails(
    'mailto:your-email@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// =====================================================
// データストレージ
// =====================================================
let subscriptions = [];
let lastRates = {};
let rateHistory = {};
let alerts = [];

// ファイルから読み込み
function loadData() {
    try {
        if (fs.existsSync('fx-subscriptions.json')) {
            subscriptions = JSON.parse(fs.readFileSync('fx-subscriptions.json', 'utf8'));
            console.log(`📂 ${subscriptions.length}件の購読情報を読み込み`);
        }
        if (fs.existsSync('fx-alerts.json')) {
            alerts = JSON.parse(fs.readFileSync('fx-alerts.json', 'utf8'));
            console.log(`📂 ${alerts.length}件のアラートを読み込み`);
        }
    } catch (error) {
        console.error('データ読み込みエラー:', error);
    }
}

function saveData() {
    try {
        fs.writeFileSync('fx-subscriptions.json', JSON.stringify(subscriptions, null, 2));
        fs.writeFileSync('fx-alerts.json', JSON.stringify(alerts, null, 2));
        console.log('💾 データを保存');
    } catch (error) {
        console.error('データ保存エラー:', error);
    }
}

loadData();

// =====================================================
// エンドポイント
// =====================================================

app.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    
    const exists = subscriptions.some(sub => sub.endpoint === subscription.endpoint);
    
    if (!exists) {
        subscriptions.push({
            ...subscription,
            subscribedAt: new Date().toISOString(),
            userId: generateUserId()
        });
        saveData();
        console.log(`✅ 新規購読 (合計: ${subscriptions.length})`);
    }
    
    res.status(201).json({ success: true, message: '購読登録完了' });
});

app.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    const initialCount = subscriptions.length;
    subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
    saveData();
    
    console.log(`🗑️ 購読解除 (削除: ${initialCount - subscriptions.length}件)`);
    res.json({ success: true, message: '購読解除完了' });
});

app.post('/set-alert', (req, res) => {
    const { userId, pairId, targetPrice, direction } = req.body;
    
    alerts.push({
        id: Date.now(),
        userId,
        pairId,
        targetPrice: parseFloat(targetPrice),
        direction, // 'above' or 'below'
        createdAt: new Date().toISOString(),
        triggered: false
    });
    
    saveData();
    console.log(`🔔 アラート設定: ${pairId} ${direction} ${targetPrice}`);
    
    res.json({ success: true, message: 'アラート設定完了' });
});

app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        subscribers: subscriptions.length,
        alerts: alerts.filter(a => !a.triggered).length,
        lastPriceCheck: lastPriceCheck || 'なし',
        monitoredPairs: Object.keys(lastRates).length,
        uptime: process.uptime()
    });
});

app.post('/send-test-notification', async (req, res) => {
    const payload = JSON.stringify({
        title: '💹 FXトレーダーPro',
        body: 'テスト通知が正常に送信されました！',
        icon: '/icon-192.png',
        tag: 'test',
        data: { type: 'test', timestamp: Date.now() }
    });
    
    try {
        await sendNotificationToAll(payload);
        res.json({ success: true, message: `${subscriptions.length}人に送信` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// 為替レート監視
// =====================================================

const CURRENCY_PAIRS = [
    { id: 'USD_JPY', base: 'USD', quote: 'JPY', name: 'ドル/円' },
    { id: 'EUR_JPY', base: 'EUR', quote: 'JPY', name: 'ユーロ/円' },
    { id: 'GBP_JPY', base: 'GBP', quote: 'JPY', name: 'ポンド/円' },
    { id: 'AUD_JPY', base: 'AUD', quote: 'JPY', name: 'オーストラリアドル/円' },
    { id: 'EUR_USD', base: 'EUR', quote: 'USD', name: 'ユーロ/ドル' },
    { id: 'GBP_USD', base: 'GBP', quote: 'USD', name: 'ポンド/ドル' }
];

let lastPriceCheck = null;

async function checkRatesAndNotify() {
    if (subscriptions.length === 0 && alerts.length === 0) {
        console.log('⏸️ 購読者もアラートもなし、スキップ');
        return;
    }
    
    console.log(`🔍 為替レートチェック (購読者: ${subscriptions.length}, アラート: ${alerts.filter(a => !a.triggered).length})`);
    lastPriceCheck = new Date().toISOString();
    
    try {
        // ExchangeRate-APIから取得
        const response = await axios.get(
            'https://api.exchangerate-api.com/v4/latest/JPY',
            { timeout: 10000 }
        );
        
        const baseRates = response.data.rates;
        
        // 各通貨ペアをチェック
        for (const pair of CURRENCY_PAIRS) {
            const rate = calculatePairRate(pair, baseRates);
            
            if (!rate) continue;
            
            // 履歴を保存
            if (!rateHistory[pair.id]) rateHistory[pair.id] = [];
            rateHistory[pair.id].push({
                rate: rate,
                timestamp: Date.now()
            });
            
            // 最新100件のみ保持
            if (rateHistory[pair.id].length > 100) {
                rateHistory[pair.id].shift();
            }
            
            // 大きな変動をチェック
            await checkVolatilityAlert(pair, rate);
            
            // ユーザー設定のアラートをチェック
            await checkUserAlerts(pair, rate);
            
            // 前回レートを更新
            lastRates[pair.id] = rate;
        }
        
        console.log('✅ レートチェック完了');
        
    } catch (error) {
        console.error('❌ レートチェックエラー:', error.message);
    }
}

function calculatePairRate(pair, baseRates) {
    try {
        if (pair.quote === 'JPY') {
            const rateFromJPY = baseRates[pair.base];
            return rateFromJPY ? 1 / rateFromJPY : null;
        } else {
            const baseRate = baseRates[pair.base];
            const quoteRate = baseRates[pair.quote];
            return (baseRate && quoteRate) ? quoteRate / baseRate : null;
        }
    } catch (error) {
        return null;
    }
}

// 大きな変動をチェック
async function checkVolatilityAlert(pair, currentRate) {
    if (!lastRates[pair.id] || subscriptions.length === 0) return;
    
    const change = ((currentRate - lastRates[pair.id]) / lastRates[pair.id]) * 100;
    
    // 0.5%以上の変動で通知
    if (Math.abs(change) >= 0.5) {
        const direction = change > 0 ? '上昇' : '下落';
        const emoji = change > 0 ? '📈' : '📉';
        
        const payload = JSON.stringify({
            title: `${emoji} ${pair.name} ${direction}`,
            body: `${Math.abs(change).toFixed(2)}%変動 | 現在: ${currentRate.toFixed(3)}`,
            icon: '/icon-192.png',
            badge: '/badge-96.png',
            tag: `volatility-${pair.id}`,
            requireInteraction: true,
            data: {
                type: 'volatility',
                pairId: pair.id,
                pairName: pair.name,
                change: change,
                rate: currentRate
            }
        });
        
        await sendNotificationToAll(payload);
        console.log(`📬 変動通知: ${pair.name} ${change.toFixed(2)}%`);
    }
}

// ユーザー設定のアラートをチェック
async function checkUserAlerts(pair, currentRate) {
    const pairAlerts = alerts.filter(a => 
        a.pairId === pair.id && !a.triggered
    );
    
    for (const alert of pairAlerts) {
        let triggered = false;
        
        if (alert.direction === 'above' && currentRate >= alert.targetPrice) {
            triggered = true;
        } else if (alert.direction === 'below' && currentRate <= alert.targetPrice) {
            triggered = true;
        }
        
        if (triggered) {
            alert.triggered = true;
            alert.triggeredAt = new Date().toISOString();
            
            const payload = JSON.stringify({
                title: `🎯 ${pair.name} 目標到達`,
                body: `設定価格 ${alert.targetPrice} に到達 | 現在: ${currentRate.toFixed(3)}`,
                icon: '/icon-192.png',
                tag: `alert-${alert.id}`,
                requireInteraction: true,
                data: {
                    type: 'user-alert',
                    pairId: pair.id,
                    alertId: alert.id,
                    targetPrice: alert.targetPrice,
                    currentRate: currentRate
                }
            });
            
            // 特定ユーザーに送信
            const userSub = subscriptions.find(s => s.userId === alert.userId);
            if (userSub) {
                await sendNotificationToOne(userSub, payload);
                console.log(`🔔 アラート通知: ${pair.name} → ユーザー ${alert.userId}`);
            }
        }
    }
    
    saveData();
}

// 全購読者に通知
async function sendNotificationToAll(payload) {
    const invalidSubs = [];
    
    const promises = subscriptions.map(async (sub, index) => {
        try {
            await webpush.sendNotification(sub, payload);
            return { success: true, index };
        } catch (error) {
            console.error(`❌ 通知送信失敗 (${index}):`, error.message);
            
            if (error.statusCode === 410 || error.statusCode === 404) {
                invalidSubs.push(sub);
            }
            
            return { success: false, index, error: error.message };
        }
    });
    
    const results = await Promise.all(promises);
    
    // 無効な購読を削除
    if (invalidSubs.length > 0) {
        subscriptions = subscriptions.filter(sub => !invalidSubs.includes(sub));
        saveData();
        console.log(`🗑️ ${invalidSubs.length}件の無効購読を削除`);
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`📬 通知完了: ${successCount}/${subscriptions.length}`);
}

// 特定ユーザーに通知
async function sendNotificationToOne(subscription, payload) {
    try {
        await webpush.sendNotification(subscription, payload);
        return true;
    } catch (error) {
        console.error('通知送信エラー:', error);
        return false;
    }
}

// =====================================================
// cronジョブ: 5分ごとにチェック
// =====================================================
cron.schedule('*/5 * * * *', () => {
    console.log('⏰ 定期チェック実行');
    checkRatesAndNotify();
});

// 起動時に1回実行
setTimeout(() => {
    console.log('🚀 起動時チェック');
    checkRatesAndNotify();
}, 5000);

// =====================================================
// ユーティリティ
// =====================================================
function generateUserId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// =====================================================
// エラーハンドリング
// =====================================================
process.on('uncaughtException', (error) => {
    console.error('❌ 未処理の例外:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ 未処理のPromise拒否:', reason);
});

// =====================================================
// サーバー起動
// =====================================================
app.listen(PORT, () => {
    console.log('🚀 FXトレーダーPro サーバー起動');
    console.log(`📡 ポート: ${PORT}`);
    console.log(`💹 監視通貨ペア: ${CURRENCY_PAIRS.length}`);
    console.log(`👥 購読者: ${subscriptions.length}`);
    console.log(`🔔 アクティブアラート: ${alerts.filter(a => !a.triggered).length}`);
    console.log(`⏰ チェック間隔: 5分ごと`);
    console.log('');
    console.log('エンドポイント:');
    console.log('  GET  /vapid-public-key');
    console.log('  POST /subscribe');
    console.log('  POST /unsubscribe');
    console.log('  POST /set-alert');
    console.log('  POST /send-test-notification');
    console.log('  GET  /status');
});
