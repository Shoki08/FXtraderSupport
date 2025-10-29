// fx-trader-app.js
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
// 為替レート取得
// =====================================================

async function fetchExchangeRates() {
    updateApiStatus('loading', '🔄 為替レート取得中...');
    
    try {
        // ExchangeRate-API（無料版）を使用
        const baseRates = await fetchFromExchangeRateAPI();
        
        if (!baseRates) {
            throw new Error('APIからのデータ取得失敗');
        }
        
        // 各通貨ペアのレートを計算
        CURRENCY_PAIRS.forEach(pair => {
            const rate = calculatePairRate(pair, baseRates);
            
            if (rate) {
                // 価格履歴を保存
                if (!priceHistory[pair.id]) priceHistory[pair.id] = [];
                priceHistory[pair.id].push({
                    rate: rate,
                    timestamp: Date.now()
                });
                
                // 最新100件のみ保持
                if (priceHistory[pair.id].length > 100) {
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
            }
        });
        
        updateApiStatus('success', `✅ ${Object.keys(pairData).length}通貨ペア取得完了`);
        updateUI();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('pairs-container').style.display = 'grid';
        
    } catch (error) {
        console.error('❌ 為替レート取得エラー:', error);
        updateApiStatus('error', '⚠️ データ取得エラー');
        showError('為替レートの取得に失敗しました。しばらく待ってから再試行してください。');
    }
}

// ExchangeRate-APIからデータ取得
async function fetchFromExchangeRateAPI() {
    try {
        // 無料版は1ヶ月1500リクエストまで
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/JPY', {
            timeout: 10000
        });
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        
        const data = await response.json();
        return data.rates;
        
    } catch (error) {
        console.error('ExchangeRate-API エラー:', error);
        
        // フォールバック: 固定レート（デモ用）
        return getFallbackRates();
    }
}

// フォールバック用の固定レート
function getFallbackRates() {
    console.warn('⚠️ フォールバックレートを使用');
    return {
        USD: 0.0067,  // 1円 = 0.0067ドル → 1ドル = 149円
        EUR: 0.0062,  // 1円 = 0.0062ユーロ → 1ユーロ = 161円
        GBP: 0.0053,  // 1円 = 0.0053ポンド → 1ポンド = 189円
        AUD: 0.0103,  // 1円 = 0.0103豪ドル → 1豪ドル = 97円
    };
}

// 通貨ペアのレートを計算
function calculatePairRate(pair, baseRates) {
    try {
        if (pair.quote === 'JPY') {
            // XXX/JPY の場合
            const rateFromJPY = baseRates[pair.base];
            if (rateFromJPY) {
                return 1 / rateFromJPY; // JPYベースに変換
            }
        } else {
            // EUR/USD などの場合
            const baseRate = baseRates[pair.base];
            const quoteRate = baseRates[pair.quote];
            if (baseRate && quoteRate) {
                return quoteRate / baseRate;
            }
        }
        return null;
    } catch (error) {
        console.error(`レート計算エラー (${pair.id}):`, error);
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
            recommendation: 'データ収集中',
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: 0,
            riskReward: 0
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
    if (macd.histogram > 0 && macd.histogram > macd.signal) {
        buyScore += 2;
        reasons.push('MACDゴールデンクロス');
    } else if (macd.histogram < 0 && macd.histogram < macd.signal) {
        sellScore += 2;
        reasons.push('MACDデッドクロス');
    }
    
    // ボリンジャーバンド分析
    if (currentPrice < bb.lower) {
        buyScore += 2;
        reasons.push('価格が下限バンド付近（反発期待）');
    } else if (currentPrice > bb.upper) {
        sellScore += 2;
        reasons.push('価格が上限バンド付近（調整期待）');
    }
    
    // 移動平均分析
    if (ma20 && ma50) {
        if (currentPrice > ma20 && ma20 > ma50) {
            buyScore += 2;
            reasons.push('上昇トレンド継続');
        } else if (currentPrice < ma20 && ma20 < ma50) {
            sellScore += 2;
            reasons.push('下降トレンド継続');
        }
    }
    
    // シグナルを決定
    let signal, signalClass;
    const totalScore = buyScore + sellScore;
    const confidence = Math.min((totalScore / 12) * 100, 100);
    
    if (buyScore > sellScore + 3) {
        signal = '強い買い';
        signalClass = 'strong-buy';
    } else if (buyScore > sellScore) {
        signal = '買い';
        signalClass = 'buy';
    } else if (sellScore > buyScore + 3) {
        signal = '強い売り';
        signalClass = 'strong-sell';
    } else if (sellScore > buyScore) {
        signal = '売り';
        signalClass = 'sell';
    } else {
        signal = '様子見';
        signalClass = 'hold';
    }
    
    // エントリー価格、ストップロス、利確目標を計算
    const isBuy = signalClass.includes('buy');
    const atr = calculateATR(history);
    
    let entryPrice = currentPrice;
    let stopLoss, takeProfit;
    
    if (isBuy) {
        // 買いの場合
        stopLoss = currentPrice - (atr * 1.5);  // ATRの1.5倍下にストップロス
        takeProfit = currentPrice + (atr * 3);   // ATRの3倍上に利確目標
    } else {
        // 売りの場合
        stopLoss = currentPrice + (atr * 1.5);
        takeProfit = currentPrice - (atr * 3);
    }
    
    const riskReward = Math.abs((takeProfit - entryPrice) / (entryPrice - stopLoss));
    
    // リスク管理計算
    const riskCalc = calculateRiskManagement(currentPrice, stopLoss, isBuy);
    
    // 推奨メッセージ
    let recommendation = '';
    if (signalClass === 'strong-buy') {
        recommendation = '🚀 強い買いシグナル！エントリー検討';
    } else if (signalClass === 'buy') {
        recommendation = '📈 買い優勢。慎重にエントリー検討';
    } else if (signalClass === 'strong-sell') {
        recommendation = '⚠️ 強い売りシグナル！ショート検討';
    } else if (signalClass === 'sell') {
        recommendation = '📉 売り優勢。慎重にショート検討';
    } else {
        recommendation = '⏸️ 明確なトレンドなし。様子見推奨';
    }
    
    if (reasons.length > 0) {
        recommendation += ` (${reasons[0]})`;
    }
    
    return {
        signal,
        class: signalClass,
        confidence: confidence.toFixed(0),
        rsi: rsi.toFixed(1),
        macd: macd.macd.toFixed(4),
        bb: bb,
        ma20: ma20 ? ma20.toFixed(3) : '--',
        ma50: ma50 ? ma50.toFixed(3) : '--',
        atr: atr.toFixed(3),
        recommendation,
        entryPrice: entryPrice.toFixed(3),
        stopLoss: stopLoss.toFixed(3),
        takeProfit: takeProfit.toFixed(3),
        riskReward: riskReward.toFixed(2),
        riskCalc: riskCalc,
        reasons: reasons
    };
}

// RSI計算
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    const changes = prices.slice(1).map((price, i) => price - prices[i]);
    const gains = changes.slice(-period).map(c => c > 0 ? c : 0);
    const losses = changes.slice(-period).map(c => c < 0 ? -c : 0);
    
    const avgGain = gains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// MACD計算
function calculateMACD(prices) {
    if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    const signal = macd * 0.2; // 簡易計算
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
}

// EMA計算
function calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    
    return ema;
}

// SMA計算
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b) / period;
}

// ボリンジャーバンド計算
function calculateBollingerBands(prices, period = 20) {
    if (prices.length < period) {
        const current = prices[prices.length - 1];
        return { upper: current, middle: current, lower: current };
    }
    
    const sma = calculateSMA(prices, period);
    const recentPrices = prices.slice(-period);
    
    // 標準偏差を計算
    const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
        upper: sma + (stdDev * 2),
        middle: sma,
        lower: sma - (stdDev * 2)
    };
}

// ATR（Average True Range）計算
function calculateATR(history, period = 14) {
    if (history.length < period + 1) {
        // データ不足の場合は簡易計算
        const prices = history.map(h => h.rate);
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        return (high - low) / prices.length;
    }
    
    const trueRanges = [];
    
    for (let i = 1; i < history.length; i++) {
        const high = history[i].rate;
        const low = history[i].rate;
        const prevClose = history[i - 1].rate;
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        
        trueRanges.push(tr);
    }
    
    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((a, b) => a + b) / recentTR.length;
}

// =====================================================
// リスク管理計算
// =====================================================

function calculateRiskManagement(entryPrice, stopLoss, isBuy) {
    const capital = riskSettings.capital;
    const riskPercent = riskSettings.riskPercent;
    const leverage = riskSettings.leverage;
    
    // 許容損失額
    const maxLoss = capital * (riskPercent / 100);
    
    // 1ロット = 1,000通貨単位と仮定
    const lotSize = 1000;
    
    // pips差を計算
    const pipDiff = Math.abs(entryPrice - stopLoss);
    
    // 1pipsあたりの金額（円建ての場合）
    const pipValue = lotSize * 0.01; // 1pips = 10円（1,000通貨の場合）
    
    // 最適ロット数を計算
    const optimalLots = Math.floor(maxLoss / (pipDiff * 100 * pipValue));
    
    // 必要証拠金
    const margin = (entryPrice * lotSize * optimalLots) / leverage;
    
    // リスクリワード比
    const stopLossPips = Math.abs(entryPrice - stopLoss) * 100;
    
    return {
        maxLoss: maxLoss,
        optimalLots: Math.max(1, optimalLots),
        margin: margin,
        stopLossPips: stopLossPips.toFixed(1),
        lotSize: lotSize
    };
}

// =====================================================
// UI更新
// =====================================================

function updateUI() {
    const container = document.getElementById('pairs-container');
    
    const pairs = Object.values(pairData).sort((a, b) => {
        // シグナルの強さでソート
        const order = { 'strong-buy': 0, 'buy': 1, 'hold': 2, 'sell': 3, 'strong-sell': 4 };
        return order[a.analysis.class] - order[b.analysis.class];
    });
    
    container.innerHTML = pairs.map(pair => {
        const analysis = pair.analysis;
        const changeClass = pair.change >= 0 ? 'positive' : 'negative';
        const changeSymbol = pair.change >= 0 ? '+' : '';
        
        return `
            <div class="pair-card signal-${analysis.class}">
                <div class="pair-header">
                    <div class="pair-name">${pair.name}</div>
                    <div class="pair-flag">${pair.flag}</div>
                </div>
                
                <div class="price-display">
                    <div class="current-price">${pair.rate.toFixed(3)}</div>
                    <span class="price-change ${changeClass}">
                        ${changeSymbol}${pair.change.toFixed(2)}%
                    </span>
                </div>
                
                <div class="signal-section">
                    <div class="signal-badge ${analysis.class}">
                        ${analysis.signal}
                    </div>
                    <div class="signal-confidence">
                        <div class="label">信頼度</div>
                        <div class="value">${analysis.confidence}%</div>
                    </div>
                </div>
                
                <div class="trade-info">
                    <div class="trade-info-row">
                        <span class="trade-info-label">📍 エントリー</span>
                        <span class="trade-info-value">${analysis.entryPrice}</span>
                    </div>
                    <div class="trade-info-row">
                        <span class="trade-info-label">🛑 ストップロス</span>
                        <span class="trade-info-value loss">${analysis.stopLoss}</span>
                    </div>
                    <div class="trade-info-row">
                        <span class="trade-info-label">🎯 利確目標</span>
                        <span class="trade-info-value profit">${analysis.takeProfit}</span>
                    </div>
                    <div class="trade-info-row">
                        <span class="trade-info-label">📊 リスクリワード</span>
                        <span class="trade-info-value">1:${analysis.riskReward}</span>
                    </div>
                    <div class="trade-info-row">
                        <span class="trade-info-label">💰 推奨ロット</span>
                        <span class="trade-info-value">${analysis.riskCalc.optimalLots}</span>
                    </div>
                    <div class="trade-info-row">
                        <span class="trade-info-label">⚠️ 最大損失</span>
                        <span class="trade-info-value loss">¥${analysis.riskCalc.maxLoss.toLocaleString()}</span>
                    </div>
                </div>
                
                <div class="indicators">
                    <div class="indicator">
                        <div class="indicator-name">RSI</div>
                        <div class="indicator-value">${analysis.rsi}</div>
                    </div>
                    <div class="indicator">
                        <div class="indicator-name">MACD</div>
                        <div class="indicator-value">${analysis.macd}</div>
                    </div>
                    <div class="indicator">
                        <div class="indicator-name">ATR</div>
                        <div class="indicator-value">${analysis.atr}</div>
                    </div>
                </div>
                
                <div class="chart-container">
                    <canvas id="chart-${pair.id}"></canvas>
                </div>
                
                <div style="background: rgba(26,95,122,0.1); padding: 12px; border-radius: 8px; margin: 15px 0; font-size: 0.9em; color: #333;">
                    <strong>💡 アドバイス:</strong><br>
                    ${analysis.recommendation}
                </div>
                
                <div class="action-buttons">
                    <button class="action-btn buy" onclick="recordTrade('${pair.id}', 'buy')">
                        📈 買いで記録
                    </button>
                    <button class="action-btn sell" onclick="recordTrade('${pair.id}', 'sell')">
                        📉 売りで記録
                    </button>
                    <button class="action-btn alert" onclick="setAlert('${pair.id}')">
                        🔔 アラート設定
                    </button>
                    <button class="action-btn record" onclick="showPairDetails('${pair.id}')">
                        📊 詳細表示
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // チャートを描画
    setTimeout(() => {
        pairs.forEach(pair => {
            if (priceHistory[pair.id] && priceHistory[pair.id].length > 0) {
                const prices = priceHistory[pair.id].map(h => h.rate);
                createChart(`chart-${pair.id}`, prices.slice(-30));
            }
        });
    }, 100);
}

// チャート作成
function createChart(canvasId, prices) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    
    const ctx = canvas.getContext('2d');
    const color = prices[prices.length - 1] > prices[0] ? '#06d6a0' : '#ef4444';
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: prices.map((_, i) => ''),
            datasets: [{
                data: prices,
                borderColor: color,
                backgroundColor: color + '20',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
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
        ? `🎉 利確成功！\n\n利益: ¥${profit.toLocaleString()}`
        : `😔 損切り実行\n\n損失: ¥${profit.toLocaleString()}`;
    
    alert(message);
}

// =====================================================
// ユーティリティ関数
// =====================================================

function updateApiStatus(status, message) {
    const el = document.getElementById('api-status');
    el.className = `api-status ${status}`;
    el.innerHTML = `<strong>${message}</strong>`;
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
        fetchExchangeRates();
    }, 60000); // 1分ごと
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

console.log('✅ FXトレーダーPro アプリロード完了');
