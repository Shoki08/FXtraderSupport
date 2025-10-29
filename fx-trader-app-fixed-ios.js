// fx-trader-app.js - 改善版
// FXトレーダーPro - メインアプリケーションロジック

// =====================================================
// グローバル変数
// =====================================================

const CURRENCY_PAIRS = [
    { 
        id: 'USD_JPY', 
        name: 'ドル/円', 
        symbol: 'USD/JPY', 
        flag: '🇺🇸/🇯🇵',
        base: 'USD',
        quote: 'JPY'
    },
    { 
        id: 'EUR_JPY', 
        name: 'ユーロ/円', 
        symbol: 'EUR/JPY', 
        flag: '🇪🇺/🇯🇵',
        base: 'EUR',
        quote: 'JPY'
    },
    { 
        id: 'GBP_JPY', 
        name: 'ポンド/円', 
        symbol: 'GBP/JPY', 
        flag: '🇬🇧/🇯🇵',
        base: 'GBP',
        quote: 'JPY'
    },
    { 
        id: 'AUD_JPY', 
        name: 'オーストラリアドル/円', 
        symbol: 'AUD/JPY', 
        flag: '🇦🇺/🇯🇵',
        base: 'AUD',
        quote: 'JPY'
    },
    { 
        id: 'EUR_USD', 
        name: 'ユーロ/ドル', 
        symbol: 'EUR/USD', 
        flag: '🇪🇺/🇺🇸',
        base: 'EUR',
        quote: 'USD'
    },
    { 
        id: 'GBP_USD', 
        name: 'ポンド/ドル', 
        symbol: 'GBP/USD', 
        flag: '🇬🇧/🇺🇸',
        base: 'GBP',
        quote: 'USD'
    }
];

let pairData = {};
let priceHistory = {};
let chartInstances = {};
let tradeHistory = [];
let updateTimer = null;
let countdown = 60;

// リスク設定のデフォルト値
let riskSettings = {
    capital: 100000,
    riskPercent: 2,
    leverage: 10
};

// =====================================================
// 初期化
// =====================================================

window.addEventListener('load', () => {
    console.log('🚀 FXトレーダーPro 起動');
    
    // iOS Safari PWA検出
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true || 
                        window.matchMedia('(display-mode: standalone)').matches;
    
    if (isiOS) {
        console.log('📱 iOS端末を検出');
        if (isStandalone) {
            console.log('✅ PWAモードで動作中');
        } else {
            console.warn('⚠️ ブラウザモードで動作中 - ホーム画面に追加してPWAモードで使用することを推奨');
        }
    }
    
    // 保存されたリスク設定を読み込み
    loadRiskSettings();
    
    // 初心者ガイドの表示判定
    if (!localStorage.getItem('tutorialCompleted')) {
        document.getElementById('beginner-guide').classList.add('show');
    }
    
    // トレード履歴を読み込み
    loadTradeHistory();
    
    // リスク設定の変更を監視
    setupRiskSettingsListeners();
    
    // 為替レート取得開始
    fetchExchangeRates();
    
    // 自動更新タイマー開始
    startAutoUpdate();
});

// =====================================================
// リスク設定管理
// =====================================================

function loadRiskSettings() {
    const saved = localStorage.getItem('fxRiskSettings');
    if (saved) {
        riskSettings = JSON.parse(saved);
        document.getElementById('capital').value = riskSettings.capital;
        document.getElementById('risk-percent').value = riskSettings.riskPercent;
        document.getElementById('leverage').value = riskSettings.leverage;
    }
}

function saveRiskSettings() {
    riskSettings = {
        capital: parseFloat(document.getElementById('capital').value),
        riskPercent: parseFloat(document.getElementById('risk-percent').value),
        leverage: parseInt(document.getElementById('leverage').value)
    };
    localStorage.setItem('fxRiskSettings', JSON.stringify(riskSettings));
    console.log('💾 リスク設定を保存');
}

function setupRiskSettingsListeners() {
    ['capital', 'risk-percent', 'leverage'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            saveRiskSettings();
            updateAllPairCalculations();
        });
    });
}

function updateAllPairCalculations() {
    Object.keys(pairData).forEach(pairId => {
        if (pairData[pairId]) {
            const analysis = pairData[pairId].analysis;
            if (analysis) {
                analysis.riskCalc = calculateRiskManagement(
                    pairData[pairId].rate,
                    analysis.stopLoss,
                    analysis.signal.includes('buy')
                );
            }
        }
    });
    updateUI();
}

// =====================================================
// 為替レート取得 - 改善版
// =====================================================

async function fetchExchangeRates() {
    console.log('🔄 為替レート取得開始');
    updateApiStatus('loading', '🔄 為替レート取得中...');
    
    try {
        // 複数のAPIから取得を試行
        const result = await fetchFromExchangeRateAPI();
        
        if (!result || !result.rates || Object.keys(result.rates).length === 0) {
            throw new Error('APIからのデータ取得失敗');
        }
        
        const { rates, apiName } = result;
        console.log(`✅ ${apiName}から${Object.keys(rates).length}通貨のレート取得成功`);
        console.log('レートデータサンプル:', { USD: rates.USD, EUR: rates.EUR, GBP: rates.GBP });
        
        // 各通貨ペアのレートを計算
        let successCount = 0;
        let failedPairs = [];
        
        CURRENCY_PAIRS.forEach(pair => {
            const rate = calculatePairRate(pair, rates);
            
            if (rate && rate > 0) {
                successCount++;
                console.log(`✅ ${pair.id}: ${rate.toFixed(3)}`);
                
                // 価格履歴を保存
                if (!priceHistory[pair.id]) priceHistory[pair.id] = [];
                priceHistory[pair.id].push({
                    rate: rate,
                    timestamp: Date.now()
                });
                
                // iOS Safari対応: メモリ節約のため50件に制限
                const maxHistory = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 50 : 100;
                if (priceHistory[pair.id].length > maxHistory) {
                    priceHistory[pair.id].shift();
                }
                
                // 変動率を計算
                const change = calculateChange(priceHistory[pair.id]);
                
                // テクニカル分析
                const analysis = analyzeSignal(priceHistory[pair.id], pair);
                
                // データを保存
                pairData[pair.id] = {
                    ...pair,
                    rate: rate,
                    change: change,
                    analysis: analysis,
                    lastUpdate: new Date().toLocaleString('ja-JP')
                };
            } else {
                console.error(`❌ ${pair.id}: レート計算失敗 (rate=${rate})`);
                failedPairs.push(pair.id);
            }
        });
        
        if (successCount > 0) {
            updateUI();
            document.getElementById('loading').style.display = 'none';
            document.getElementById('pairs-container').style.display = 'grid';
            
            // 成功メッセージを表示
            const statusMsg = failedPairs.length > 0 
                ? `✅ ${successCount}/${CURRENCY_PAIRS.length}通貨ペア取得完了 (${apiName})`
                : `✅ ${successCount}通貨ペア取得完了 (${apiName})`;
            updateApiStatus('success', statusMsg);
            
            console.log(`✅ ${successCount}通貨ペア取得完了`);
            if (failedPairs.length > 0) {
                console.warn('⚠️ 取得失敗:', failedPairs.join(', '));
            }
        } else {
            throw new Error('有効な通貨ペアデータなし - すべてのレート計算が失敗');
        }
        
    } catch (error) {
        console.error('❌ 為替レート取得エラー:', error);
        console.error('エラー詳細:', error.stack);
        
        // エラーでも最低限のUI表示
        if (Object.keys(pairData).length > 0) {
            // 以前のデータがあれば表示
            updateApiStatus('error', '⚠️ 最新データ取得失敗（前回データ表示中）');
            document.getElementById('loading').style.display = 'none';
            document.getElementById('pairs-container').style.display = 'grid';
        } else {
            // データがない場合はエラー表示
            updateApiStatus('error', '⚠️ データ取得エラー');
            document.getElementById('loading').innerHTML = `
                <div style="color: #ef4444;">
                    <strong>❌ 為替レート取得エラー</strong><br>
                    <p style="margin: 20px 0;">以下を確認してください:</p>
                    <ul style="text-align: left; display: inline-block; line-height: 1.8;">
                        <li>インターネット接続</li>
                        <li>HTTPSでの接続（http://ではなくhttps://）</li>
                        <li>ブラウザのコンソールでエラー確認</li>
                    </ul>
                    <p style="margin: 20px 0; font-size: 0.9em;">エラー内容: ${error.message}</p>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 12px 24px; background: #1a5f7a; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1em;">
                        🔄 再読み込み
                    </button>
                </div>
            `;
        }
    }
}

// 為替レート取得（複数APIのフォールバック対応） - 改善版
async function fetchFromExchangeRateAPI() {
    // API1: Frankfurter（完全無料・CORS対応）
    try {
        console.log('📡 Frankfurter APIで取得試行...');
        // iOS Safari対応: タイムアウトを10秒に延長
        const timeout = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 10000 : 8000;
        const response = await Promise.race([
            fetch('https://api.frankfurter.app/latest?from=JPY'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
        
        if (response.ok) {
            const data = await response.json();
            if (data && data.rates && Object.keys(data.rates).length > 0) {
                console.log('✅ Frankfurter APIから取得成功');
                console.log('Frankfurter データ:', data);
                return { rates: data.rates, apiName: 'Frankfurter' };
            }
        }
    } catch (error) {
        console.warn('⚠️ Frankfurter API失敗:', error.message);
    }
    
    // API2: ExchangeRate.host（完全無料・CORS対応）
    try {
        console.log('📡 ExchangeRate.host APIで取得試行...');
        const timeout = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 10000 : 8000;
        const response = await Promise.race([
            fetch('https://api.exchangerate.host/latest?base=JPY'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
        
        if (response.ok) {
            const data = await response.json();
            if (data && data.rates && Object.keys(data.rates).length > 0) {
                console.log('✅ ExchangeRate.host APIから取得成功');
                console.log('ExchangeRate.host データ:', data);
                return { rates: data.rates, apiName: 'ExchangeRate.host' };
            }
        }
    } catch (error) {
        console.warn('⚠️ ExchangeRate.host API失敗:', error.message);
    }
    
    // API3: ExchangeRate-API
    try {
        console.log('📡 ExchangeRate-APIで取得試行...');
        const timeout = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 10000 : 8000;
        const response = await Promise.race([
            fetch('https://api.exchangerate-api.com/v4/latest/JPY'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
        
        if (response.ok) {
            const data = await response.json();
            if (data && data.rates && Object.keys(data.rates).length > 0) {
                console.log('✅ ExchangeRate-APIから取得成功');
                console.log('ExchangeRate-API データ:', data);
                return { rates: data.rates, apiName: 'ExchangeRate-API' };
            }
        }
    } catch (error) {
        console.warn('⚠️ ExchangeRate-API失敗:', error.message);
    }
    
    // すべて失敗した場合: デモレートを使用
    console.warn('⚠️ すべてのAPIが失敗、デモレートを使用');
    return { rates: getFallbackRates(), apiName: 'デモモード' };
}

// フォールバック用の固定レート（実際の相場に近い値）
function getFallbackRates() {
    console.warn('⚠️ デモモードで動作中（実際のレートではありません）');
    
    // 2024年10月現在の概算レート (1 JPY = X 外貨)
    return {
        USD: 0.00671,  // 1円 = 0.00671ドル → 1ドル = 149円
        EUR: 0.00617,  // 1円 = 0.00617ユーロ → 1ユーロ = 162円
        GBP: 0.00528,  // 1円 = 0.00528ポンド → 1ポンド = 189円
        AUD: 0.01025,  // 1円 = 0.01025豪ドル → 1豪ドル = 97.5円
        CHF: 0.00586,  // 1円 = 0.00586フラン → 1フラン = 170円
        CAD: 0.00924,  // 1円 = 0.00924カナダドル → 1カナダドル = 108円
    };
}

// 通貨ペアのレートを計算 - 改善版
function calculatePairRate(pair, baseRates) {
    try {
        console.log(`🔢 ${pair.id}のレート計算中...`, { base: pair.base, quote: pair.quote });
        
        if (pair.quote === 'JPY') {
            // XXX/JPY の場合
            // baseRatesは「1 JPY = X 外貨」なので、「1 外貨 = Y JPY」に変換
            const rateFromJPY = baseRates[pair.base];
            
            if (!rateFromJPY || rateFromJPY === 0) {
                console.error(`❌ ${pair.id}: ${pair.base}のレートが見つからないか0: ${rateFromJPY}`);
                return null;
            }
            
            const result = 1 / rateFromJPY;
            console.log(`✅ ${pair.id} 計算: 1/${rateFromJPY} = ${result.toFixed(3)}`);
            return result;
            
        } else {
            // EUR/USD などの場合
            // baseRatesは「1 JPY = X 外貨」形式
            const baseRate = baseRates[pair.base];
            const quoteRate = baseRates[pair.quote];
            
            if (!baseRate || baseRate === 0 || !quoteRate || quoteRate === 0) {
                console.error(`❌ ${pair.id}: レートが見つからないか0:`, { 
                    [pair.base]: baseRate, 
                    [pair.quote]: quoteRate 
                });
                return null;
            }
            
            // EUR/USD = (1 JPY = X EUR) / (1 JPY = Y USD)
            // = (EUR per JPY) / (USD per JPY)
            // = USD per EUR を求めたい
            // 実際は: 1 EUR = ? USD を求める
            // EUR per JPY / USD per JPY では逆になる
            // 正しくは: (USD per JPY) / (EUR per JPY) = USD per EUR
            const result = quoteRate / baseRate;
            console.log(`✅ ${pair.id} 計算: ${quoteRate}/${baseRate} = ${result.toFixed(5)}`);
            return result;
        }
    } catch (error) {
        console.error(`❌ レート計算エラー (${pair.id}):`, error);
        console.error('エラー詳細:', error.stack);
        return null;
    }
}

// 変動率を計算
function calculateChange(history) {
    if (history.length < 2) return 0;
    
    const current = history[history.length - 1].rate;
    const previous = history[0].rate;
    
    return ((current - previous) / previous) * 100;
}

// =====================================================
// テクニカル分析
// =====================================================

function analyzeSignal(history, pair) {
    if (history.length < 20) {
        return {
            signal: 'データ収集中',
            class: 'hold',
            confidence: 0,
            rsi: 50,
            macd: 'データ収集中',
            atr: 'データ収集中',
            ma20: 0,
            ma50: 0,
            recommendation: 'データ収集中',
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: 0,
            riskReward: 0,
            reasons: ['データ収集中（20データポイント必要）'],
            riskCalc: {
                optimalLots: 0,
                maxLoss: 0,
                margin: 0
            }
        };
    }
    
    const prices = history.map(h => h.rate);
    const currentPrice = prices[prices.length - 1];
    
    // テクニカル指標を計算
    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const bb = calculateBollingerBands(prices);
    const ma20 = calculateSMA(prices, 20);
    const ma50 = calculateSMA(prices, Math.min(50, prices.length));
    const atr = calculateATR(history);
    
    // シグナルスコアを計算
    let buyScore = 0;
    let sellScore = 0;
    const reasons = [];
    
    // RSI分析
    if (rsi < 30) {
        buyScore += 3;
        reasons.push('RSI超売られ過ぎ（買いチャンス）');
    } else if (rsi < 40) {
        buyScore += 1.5;
        reasons.push('RSI売られ気味');
    } else if (rsi > 70) {
        sellScore += 3;
        reasons.push('RSI超買われ過ぎ（売りチャンス）');
    } else if (rsi > 60) {
        sellScore += 1.5;
        reasons.push('RSI買われ気味');
    }
    
    // MACD分析
    if (macd.histogram > 0 && macd.macd > macd.signal) {
        buyScore += 2;
        reasons.push('MACD買いシグナル');
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
        sellScore += 2;
        reasons.push('MACD売りシグナル');
    }
    
    // ボリンジャーバンド分析
    if (currentPrice < bb.lower) {
        buyScore += 2;
        reasons.push('価格が下限バンド下（反発期待）');
    } else if (currentPrice > bb.upper) {
        sellScore += 2;
        reasons.push('価格が上限バンド上（調整期待）');
    }
    
    // 移動平均分析
    if (currentPrice > ma20 && currentPrice > ma50) {
        buyScore += 1;
        reasons.push('価格が移動平均線上（上昇トレンド）');
    } else if (currentPrice < ma20 && currentPrice < ma50) {
        sellScore += 1;
        reasons.push('価格が移動平均線下（下降トレンド）');
    }
    
    // 総合判定
    const totalScore = buyScore - sellScore;
    let signal, signalClass, confidence;
    
    if (totalScore >= 5) {
        signal = '強い買い';
        signalClass = 'strong-buy';
        confidence = Math.min(95, 60 + totalScore * 5);
    } else if (totalScore >= 2) {
        signal = '買い';
        signalClass = 'buy';
        confidence = 55 + totalScore * 5;
    } else if (totalScore <= -5) {
        signal = '強い売り';
        signalClass = 'strong-sell';
        confidence = Math.min(95, 60 + Math.abs(totalScore) * 5);
    } else if (totalScore <= -2) {
        signal = '売り';
        signalClass = 'sell';
        confidence = 55 + Math.abs(totalScore) * 5;
    } else {
        signal = '様子見';
        signalClass = 'hold';
        confidence = 50;
    }
    
    // エントリー・エグジット価格を計算
    const isBuy = totalScore > 0;
    const stopLossPips = atr * 1.5;
    const takeProfitPips = atr * 3;
    
    const entryPrice = currentPrice.toFixed(3);
    const stopLoss = isBuy 
        ? (currentPrice - stopLossPips).toFixed(3)
        : (currentPrice + stopLossPips).toFixed(3);
    const takeProfit = isBuy
        ? (currentPrice + takeProfitPips).toFixed(3)
        : (currentPrice - takeProfitPips).toFixed(3);
    
    const riskReward = (takeProfitPips / stopLossPips).toFixed(1);
    
    // リスク管理計算
    const riskCalc = calculateRiskManagement(currentPrice, parseFloat(stopLoss), isBuy);
    
    return {
        signal,
        class: signalClass,
        confidence: Math.round(confidence),
        rsi: Math.round(rsi),
        macd: `${macd.macd.toFixed(4)} / ${macd.signal.toFixed(4)}`,
        atr: atr.toFixed(4),
        ma20: ma20.toFixed(3),
        ma50: ma50.toFixed(3),
        recommendation: `${signal}（信頼度${Math.round(confidence)}%）`,
        entryPrice,
        stopLoss,
        takeProfit,
        riskReward,
        reasons,
        riskCalc
    };
}

// RSI計算
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// MACD計算
function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    
    // シグナルライン（MACD の9期間EMA）
    const macdLine = [macd];
    const signal = calculateEMA(macdLine, 9);
    
    return {
        macd: macd,
        signal: signal,
        histogram: macd - signal
    };
}

// EMA計算
function calculateEMA(prices, period) {
    if (prices.length === 0) return 0;
    
    const k = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    
    return ema;
}

// SMA計算
function calculateSMA(prices, period) {
    if (prices.length < period) period = prices.length;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ボリンジャーバンド計算
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
    const sma = calculateSMA(prices, period);
    const slice = prices.slice(-period);
    
    const variance = slice.reduce((sum, price) => {
        return sum + Math.pow(price - sma, 2);
    }, 0) / period;
    
    const stdDev = Math.sqrt(variance);
    
    return {
        upper: sma + (stdDev * multiplier),
        middle: sma,
        lower: sma - (stdDev * multiplier)
    };
}

// ATR計算（Average True Range）
function calculateATR(history, period = 14) {
    if (history.length < period + 1) return 0.01;
    
    let trSum = 0;
    for (let i = history.length - period; i < history.length; i++) {
        const high = history[i].rate;
        const low = history[i].rate * 0.999; // 簡略化
        const prevClose = history[i - 1].rate;
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trSum += tr;
    }
    
    return trSum / period;
}

// リスク管理計算
function calculateRiskManagement(currentPrice, stopLoss, isBuy) {
    const capital = riskSettings.capital;
    const riskPercent = riskSettings.riskPercent;
    const leverage = riskSettings.leverage;
    
    // 最大許容損失額
    const maxLoss = capital * (riskPercent / 100);
    
    // ストップロスまでのpips
    const stopLossPips = Math.abs(currentPrice - stopLoss);
    
    // 1ロット = 10万通貨（標準）
    const lotSize = 100000;
    
    // 最適ロット数を計算
    // maxLoss = stopLossPips * lotSize * lots
    const optimalLots = stopLossPips > 0 
        ? (maxLoss / (stopLossPips * lotSize))
        : 0.01;
    
    // 必要証拠金
    const margin = (currentPrice * lotSize * Math.max(0.01, optimalLots)) / leverage;
    
    return {
        optimalLots: Math.max(0.01, Math.min(optimalLots, 10)).toFixed(2),
        maxLoss: Math.round(maxLoss),
        margin: Math.round(margin)
    };
}

// =====================================================
// UI更新
// =====================================================

function updateUI() {
    const container = document.getElementById('pairs-container');
    
    container.innerHTML = Object.values(pairData).map(pair => {
        const analysis = pair.analysis;
        const changeClass = pair.change >= 0 ? 'positive' : 'negative';
        const changeSymbol = pair.change >= 0 ? '+' : '';
        
        return `
            <div class="pair-card signal-${analysis.class}">
                <div class="pair-header">
                    <div>
                        <div class="pair-name">${pair.name}</div>
                        <div style="font-size: 0.85em; color: #666;">${pair.symbol}</div>
                    </div>
                    <div class="pair-flag">${pair.flag}</div>
                </div>
                
                <div class="price-display">
                    <div class="current-price">${pair.rate.toFixed(3)}</div>
                    <div class="price-change ${changeClass}">
                        ${changeSymbol}${pair.change.toFixed(2)}%
                        <span>${pair.change >= 0 ? '📈' : '📉'}</span>
                    </div>
                </div>
                
                <div class="signal-badge ${analysis.class}">
                    ${analysis.signal}
                    <div style="font-size: 0.85em; margin-top: 3px;">信頼度 ${analysis.confidence}%</div>
                </div>
                
                <div class="indicators">
                    <div class="indicator-item">
                        <div class="indicator-label">RSI</div>
                        <div class="indicator-value">${analysis.rsi}</div>
                    </div>
                    <div class="indicator-item">
                        <div class="indicator-label">MA20</div>
                        <div class="indicator-value">${analysis.ma20}</div>
                    </div>
                    <div class="indicator-item">
                        <div class="indicator-label">MA50</div>
                        <div class="indicator-value">${analysis.ma50}</div>
                    </div>
                </div>
                
                <div class="trade-info">
                    <div style="margin-bottom: 10px;">
                        <strong style="color: #1a5f7a;">推奨エントリー</strong>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 0.9em;">
                        <div>
                            <div style="color: #666; font-size: 0.85em;">エントリー</div>
                            <div style="font-weight: bold; color: #1a5f7a;">${analysis.entryPrice}</div>
                        </div>
                        <div>
                            <div style="color: #666; font-size: 0.85em;">R:R比率</div>
                            <div style="font-weight: bold; color: #06d6a0;">1:${analysis.riskReward}</div>
                        </div>
                        <div>
                            <div style="color: #666; font-size: 0.85em;">ストップロス</div>
                            <div style="font-weight: bold; color: #ef4444;">${analysis.stopLoss}</div>
                        </div>
                        <div>
                            <div style="color: #666; font-size: 0.85em;">利確目標</div>
                            <div style="font-weight: bold; color: #06d6a0;">${analysis.takeProfit}</div>
                        </div>
                    </div>
                </div>
                
                <div class="risk-info">
                    <div style="font-size: 0.9em; color: #666; margin-bottom: 8px;">
                        <strong>💼 リスク管理</strong>
                    </div>
                    <div style="font-size: 0.85em; line-height: 1.6;">
                        推奨ロット: <strong>${analysis.riskCalc.optimalLots}</strong><br>
                        最大損失: <strong>¥${analysis.riskCalc.maxLoss.toLocaleString()}</strong><br>
                        必要証拠金: <strong>¥${analysis.riskCalc.margin.toLocaleString()}</strong>
                    </div>
                </div>
                
                <div class="reasons">
                    <div style="font-size: 0.85em; font-weight: bold; margin-bottom: 5px; color: #1a5f7a;">
                        💡 分析理由:
                    </div>
                    ${analysis.reasons.map(r => `
                        <div style="font-size: 0.8em; padding: 3px 0; color: #555;">• ${r}</div>
                    `).join('')}
                </div>
                
                <div class="action-buttons">
                    <button class="action-btn buy" onclick="recordTrade('${pair.id}', 'buy')">
                        📈 買いエントリー
                    </button>
                    <button class="action-btn sell" onclick="recordTrade('${pair.id}', 'sell')">
                        📉 売りエントリー
                    </button>
                    <button class="action-btn details" onclick="showPairDetails('${pair.id}')">
                        📊 詳細
                    </button>
                    <button class="action-btn alert" onclick="setAlert('${pair.id}')">
                        🔔 アラート
                    </button>
                </div>
                
                <div style="margin-top: 15px;">
                    <canvas id="chart-${pair.id}" height="80"></canvas>
                </div>
                
                <div style="text-align: center; margin-top: 10px; font-size: 0.75em; color: #999;">
                    最終更新: ${pair.lastUpdate}
                </div>
            </div>
        `;
    }).join('');
    
    // チャートを更新
    updateCharts();
}

// チャート更新
function updateCharts() {
    Object.keys(pairData).forEach(pairId => {
        const history = priceHistory[pairId];
        if (!history || history.length < 2) return;
        
        const canvas = document.getElementById(`chart-${pairId}`);
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // 既存のチャートを破棄
        if (chartInstances[pairId]) {
            chartInstances[pairId].destroy();
        }
        
        // 新しいチャートを作成
        chartInstances[pairId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: history.map((_, i) => ''),
                datasets: [{
                    data: history.map(h => h.rate),
                    borderColor: pairData[pairId].change >= 0 ? '#06d6a0' : '#ef4444',
                    backgroundColor: pairData[pairId].change >= 0 
                        ? 'rgba(6, 214, 160, 0.1)' 
                        : 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    });
}

// =====================================================
// トレード記録
// =====================================================

function recordTrade(pairId, direction) {
    const pair = pairData[pairId];
    if (!pair) return;
    
    const trade = {
        id: Date.now(),
        pairId: pairId,
        pairName: pair.name,
        direction: direction,
        entryPrice: pair.rate,
        stopLoss: pair.analysis.stopLoss,
        takeProfit: pair.analysis.takeProfit,
        lots: pair.analysis.riskCalc.optimalLots,
        timestamp: new Date().toISOString(),
        status: 'open',
        profit: 0
    };
    
    tradeHistory.unshift(trade);
    saveTradeHistory();
    
    alert(`✅ ${direction === 'buy' ? '買い' : '売り'}トレードを記録しました\n\n${pair.name}\nエントリー: ${pair.rate.toFixed(3)}\nストップロス: ${pair.analysis.stopLoss}\n利確目標: ${pair.analysis.takeProfit}`);
}

function loadTradeHistory() {
    const saved = localStorage.getItem('fxTradeHistory');
    if (saved) {
        tradeHistory = JSON.parse(saved);
        console.log(`📊 ${tradeHistory.length}件のトレード履歴を読み込み`);
    }
}

function saveTradeHistory() {
    localStorage.setItem('fxTradeHistory', JSON.stringify(tradeHistory));
    console.log('💾 トレード履歴を保存');
}

function showTradeModal() {
    updateTradeStats();
    document.getElementById('trade-modal').style.display = 'block';
}

function closeTradeModal() {
    document.getElementById('trade-modal').style.display = 'none';
}

function updateTradeStats() {
    const totalTrades = tradeHistory.length;
    const closedTrades = tradeHistory.filter(t => t.status === 'closed');
    const winningTrades = closedTrades.filter(t => t.profit > 0);
    const winRate = closedTrades.length > 0 
        ? ((winningTrades.length / closedTrades.length) * 100).toFixed(1)
        : 0;
    const totalProfit = closedTrades.reduce((sum, t) => sum + t.profit, 0);
    
    document.getElementById('total-trades').textContent = totalTrades;
    document.getElementById('win-rate').textContent = winRate + '%';
    document.getElementById('total-profit').textContent = '¥' + totalProfit.toLocaleString();
    document.getElementById('total-profit').style.color = totalProfit >= 0 ? '#06d6a0' : '#ef4444';
    
    // トレードリストを表示
    const container = document.getElementById('trade-list');
    container.innerHTML = tradeHistory.slice(0, 20).map(trade => {
        const profitClass = trade.profit > 0 ? 'profit' : trade.profit < 0 ? 'loss' : '';
        const statusText = trade.status === 'open' ? 'ポジション保有中' : '決済済み';
        
        return `
            <div class="trade-item ${profitClass}">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <strong style="color: #1a5f7a;">${trade.pairName}</strong>
                    <span style="color: #666;">${new Date(trade.timestamp).toLocaleString('ja-JP', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</span>
                </div>
                <div style="color: #666; font-size: 0.9em;">
                    ${trade.direction === 'buy' ? '📈 買い' : '📉 売り'} | 
                    ${trade.lots} ロット | 
                    ${statusText}
                </div>
                <div style="margin-top: 8px; font-size: 0.85em; color: #666;">
                    エントリー: ${trade.entryPrice} | 
                    SL: ${trade.stopLoss} | 
                    TP: ${trade.takeProfit}
                </div>
                ${trade.status === 'closed' ? `
                    <div style="margin-top: 8px; font-weight: bold; color: ${trade.profit >= 0 ? '#06d6a0' : '#ef4444'};">
                        損益: ¥${trade.profit.toLocaleString()}
                    </div>
                ` : `
                    <div style="margin-top: 10px;">
                        <button onclick="closeTrade(${trade.id}, 'profit')" style="background: #06d6a0; color: white; border: none; padding: 5px 15px; border-radius: 5px; margin-right: 5px; cursor: pointer;">利確</button>
                        <button onclick="closeTrade(${trade.id}, 'loss')" style="background: #ef4444; color: white; border: none; padding: 5px 15px; border-radius: 5px; cursor: pointer;">損切り</button>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

function closeTrade(tradeId, result) {
    const trade = tradeHistory.find(t => t.id === tradeId);
    if (!trade) return;
    
    const pair = pairData[trade.pairId];
    if (!pair) return;
    
    const currentPrice = pair.rate;
    let profit = 0;
    
    if (result === 'profit') {
        // 利確
        profit = Math.abs(trade.takeProfit - trade.entryPrice) * trade.lots * 1000;
        if (trade.direction === 'sell') profit = -profit;
    } else {
        // 損切り
        profit = -Math.abs(trade.stopLoss - trade.entryPrice) * trade.lots * 1000;
        if (trade.direction === 'sell') profit = -profit;
    }
    
    trade.status = 'closed';
    trade.profit = profit;
    trade.exitPrice = currentPrice;
    trade.closedAt = new Date().toISOString();
    
    saveTradeHistory();
    updateTradeStats();
    
    const message = profit >= 0 
        ? `🎉 利確成功!\n\n利益: ¥${profit.toLocaleString()}`
        : `😔 損切り実行\n\n損失: ¥${profit.toLocaleString()}`;
    
    alert(message);
}

// =====================================================
// ユーティリティ関数
// =====================================================

function updateApiStatus(status, message) {
    const el = document.getElementById('api-status');
    if (el) {
        el.className = `api-status ${status}`;
        el.innerHTML = `<strong>${message}</strong>`;
    }
}

function showError(message) {
    alert('⚠️ エラー\n\n' + message);
}

function refreshData() {
    console.log('🔄 データ更新');
    fetchExchangeRates();
}

function startAutoUpdate() {
    setInterval(() => {
        console.log('⏰ 自動更新実行');
        fetchExchangeRates();
    }, 60000); // 1分ごと
    
    // iOS Safari対応: メモリクリーンアップ（5分ごと）
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        setInterval(() => {
            console.log('🧹 メモリクリーンアップ実行');
            cleanupMemory();
        }, 300000); // 5分ごと
    }
}

// iOS Safari用メモリクリーンアップ
function cleanupMemory() {
    // 古いチャートを破棄
    Object.keys(chartInstances).forEach(key => {
        if (chartInstances[key]) {
            try {
                chartInstances[key].destroy();
            } catch (e) {
                console.warn(`チャート破棄エラー: ${key}`, e);
            }
        }
    });
    chartInstances = {};
    
    // 履歴を制限
    Object.keys(priceHistory).forEach(key => {
        if (priceHistory[key] && priceHistory[key].length > 50) {
            priceHistory[key] = priceHistory[key].slice(-50);
        }
    });
    
    // チャートを再作成
    if (Object.keys(pairData).length > 0) {
        updateCharts();
    }
    
    console.log('✅ メモリクリーンアップ完了');
}

function closeBeginnerGuide() {
    document.getElementById('beginner-guide').classList.remove('show');
    localStorage.setItem('tutorialCompleted', 'true');
}

function showTutorial() {
    document.getElementById('tutorial-modal').style.display = 'block';
}

function closeTutorial() {
    document.getElementById('tutorial-modal').style.display = 'none';
}

function setAlert(pairId) {
    const pair = pairData[pairId];
    if (!pair) return;
    
    const targetPrice = prompt(`${pair.name} の目標価格を入力してください\n\n現在価格: ${pair.rate.toFixed(3)}`, pair.rate.toFixed(3));
    
    if (targetPrice) {
        alert(`🔔 アラート設定完了\n\n${pair.name}\n目標価格: ${targetPrice}\n\n※ 現在はデモ機能です`);
    }
}

function showPairDetails(pairId) {
    const pair = pairData[pairId];
    if (!pair) return;
    
    const analysis = pair.analysis;
    
    let details = `
📊 ${pair.name} 詳細情報

現在価格: ${pair.rate.toFixed(3)}
変動率: ${pair.change >= 0 ? '+' : ''}${pair.change.toFixed(2)}%

🎯 売買シグナル
${analysis.signal} (信頼度: ${analysis.confidence}%)

📍 推奨エントリー
エントリー価格: ${analysis.entryPrice}
ストップロス: ${analysis.stopLoss}
利確目標: ${analysis.takeProfit}
リスクリワード: 1:${analysis.riskReward}

💰 リスク管理
推奨ロット数: ${analysis.riskCalc.optimalLots}
最大許容損失: ¥${analysis.riskCalc.maxLoss.toLocaleString()}
必要証拠金: ¥${analysis.riskCalc.margin.toLocaleString()}

📊 テクニカル指標
RSI: ${analysis.rsi}
MACD: ${analysis.macd}
ATR: ${analysis.atr}
MA20: ${analysis.ma20}
MA50: ${analysis.ma50}

💡 理由
${analysis.reasons.join('\n')}
    `.trim();
    
    alert(details);
}

function shareApp() {
    if (navigator.share) {
        navigator.share({
            title: 'FXトレーダーPro',
            text: '初心者でも安心のFXデイトレ支援アプリ',
            url: window.location.href
        }).catch(err => {
            if (err.name !== 'AbortError') {
                copyUrl();
            }
        });
    } else {
        copyUrl();
    }
}

function copyUrl() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href);
        alert('📋 URLをコピーしました');
    }
}

// iOS Safari用: 画面にデバッグログを表示（開発時のみ）
function showDebugLog(message, duration = 3000) {
    if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
    
    const debugDiv = document.createElement('div');
    debugDiv.style.cssText = `
        position: fixed;
        top: env(safe-area-inset-top, 0);
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 10px;
        font-size: 12px;
        z-index: 10000;
        word-wrap: break-word;
    `;
    debugDiv.textContent = message;
    document.body.appendChild(debugDiv);
    
    setTimeout(() => {
        if (debugDiv.parentNode) {
            debugDiv.parentNode.removeChild(debugDiv);
        }
    }, duration);
}

console.log('✅ FXトレーダーPro アプリロード完了（改善版 + iOS最適化）');
