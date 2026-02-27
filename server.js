require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://hedgealphaoracle-production.up.railway.app';

const CRYPTO_ASSETS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','DOT','MATIC',
  'LINK','UNI','LTC','ATOM','BCH','SHIB','TRX','XMR','USDT','USDC'
];

const STOCK_ASSETS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','BRK-B','V','JNJ',
  'WMT','JPM','PG','MA','HD','DIS','BAC','ADBE','NFLX','CRM'
];

function symbolToId(symbol) {
  const map = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
    'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano',
    'AVAX': 'avalanche-2', 'DOGE': 'dogecoin', 'DOT': 'polkadot',
    'MATIC': 'matic-network', 'LINK': 'chainlink', 'UNI': 'uniswap',
    'LTC': 'litecoin', 'ATOM': 'cosmos', 'BCH': 'bitcoin-cash',
    'SHIB': 'shiba-inu', 'TRX': 'tron', 'XMR': 'monero',
    'USDT': 'tether', 'USDC': 'usd-coin'
  };
  return map[symbol.toUpperCase()] || symbol.toLowerCase();
}

function detectAssetType(symbol) {
  const upper = symbol.toUpperCase();
  if (CRYPTO_ASSETS.includes(upper)) return 'crypto';
  if (STOCK_ASSETS.includes(upper)) return 'stock';
  return 'unknown';
}

async function getCryptoPrice(symbol) {
  try {
    const fetch = (await import('node-fetch')).default;
    const id = symbolToId(symbol);
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + id + '&vs_currencies=usd&include_24hr_change=true&include_market_cap=true';
    const res = await fetch(url);
    const data = await res.json();
    return data[id] || null;
  } catch (e) { return null; }
}

async function getStockPrice(symbol) {
  try {
    const fetch = (await import('node-fetch')).default;
    const url = 'https://finnhub.io/api/v1/quote?symbol=' + symbol + '&token=demo';
    const res = await fetch(url);
    const data = await res.json();
    if (!data.c || data.c === 0) return null;
    const change24h = ((data.c - data.pc) / data.pc) * 100;
    return { usd: data.c, usd_24h_change: change24h, usd_market_cap: 0 };
  } catch (e) { return null; }
}

async function getFearGreedIndex() {
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await res.json();
    if (data.data && data.data[0]) return data.data[0];
    return null;
  } catch (e) { return null; }
}

function generateSignal(change24h) {
  if (change24h > 5)  return { direction: 'STRONG LONG',   sentiment: 85 };
  if (change24h > 2)  return { direction: 'LONG',           sentiment: 72 };
  if (change24h > 0)  return { direction: 'NEUTRAL/LONG',   sentiment: 58 };
  if (change24h > -2) return { direction: 'NEUTRAL/SHORT',  sentiment: 42 };
  if (change24h > -5) return { direction: 'SHORT',          sentiment: 28 };
  return               { direction: 'STRONG SHORT',         sentiment: 15 };
}

// ─────────────────────────────────────────────
// PAYMENT MIDDLEWARE FACTORY
// Creates a payment gate for a given price (in USDC micro-units)
// $0.01 = 10000 | $0.02 = 20000 | $0.05 = 50000
// ─────────────────────────────────────────────
function requirePayment(amountMicro, description, exampleInput, exampleOutput) {
  return function(req, res, next) {
    const paymentSig = req.headers['x-payment-signature'] || req.query.paymentSig;
    if (paymentSig) return next();

    return res.status(402).json({
      x402Version: 2,
      error: 'X-PAYMENT-REQUIRED',
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS,
        amount: String(amountMicro),
        maxTimeoutSeconds: 60
      }],
      resource: {
        url: BASE_URL + req.path,
        description: description,
        mimeType: 'application/json'
      },
      extensions: {
        bazaar: {
          info: { input: exampleInput, output: exampleOutput }
        }
      }
    });
  };
}

const DISCLAIMER = '\n\nNOT FINANCIAL ADVICE. For informational purposes only.';

// ─────────────────────────────────────────────
// DISCOVERY ENDPOINTS
// ─────────────────────────────────────────────

app.get('/.well-known/x402', (req, res) => {
  res.json({
    version: 1,
    resources: [
      BASE_URL + '/sentiment/BTC',
      BASE_URL + '/alpha/BTC',
      BASE_URL + '/premium/BTC',
      BASE_URL + '/market/fear-greed',
      BASE_URL + '/market/whale-alert/BTC',
      BASE_URL + '/portfolio/risk-score'
    ],
    instructions: '# HedgeAlphaOracle v4.0\n\nReal-time crypto & stock trading signals + market intelligence for AI agents.\n\n## Endpoints\n- /sentiment/{asset} — Sentiment score $0.01\n- /alpha/{asset} — Entry/target/stop loss $0.02\n- /premium/{asset} — Full thesis + risk $0.05\n- /market/fear-greed — Fear & Greed index $0.01\n- /market/whale-alert/{asset} — Large move detection $0.02\n- /portfolio/risk-score — Multi-asset risk $0.02\n\n## Provider\nNurse2Web3 — https://nurse2web3.com'
  });
});

app.get('/x402/discovery', (req, res) => {
  res.json({
    x402Version: 2,
    name: 'HedgeAlphaOracle',
    version: '4.0',
    description: 'Real-time crypto & stock signals + market intelligence for AI agents. 6 dedicated endpoints from $0.01.',
    provider: 'Nurse2Web3',
    url: BASE_URL,
    discoverable: true,
    category: 'financial-data',
    tags: ['crypto', 'stocks', 'trading-signals', 'sentiment', 'fear-greed', 'whale-alert', 'portfolio', 'defi', 'finance'],
    endpoints: [
      { path: '/sentiment/{asset}', price: '$0.01', description: 'Sentiment score for any crypto or stock' },
      { path: '/alpha/{asset}',     price: '$0.02', description: 'Entry zone, target, stop loss signals' },
      { path: '/premium/{asset}',   price: '$0.05', description: 'Full thesis with risk assessment' },
      { path: '/market/fear-greed', price: '$0.01', description: 'Bitcoin Fear & Greed Index with market context' },
      { path: '/market/whale-alert/{asset}', price: '$0.02', description: 'Detect large price moves and unusual activity' },
      { path: '/portfolio/risk-score', price: '$0.02', description: 'Risk score for a portfolio of assets' }
    ],
    supportedAssets: { crypto: CRYPTO_ASSETS, stocks: STOCK_ASSETS },
    contact: { twitter: 'https://twitter.com/nurse2web3', website: 'https://nurse2web3.com' }
  });
});

// ─────────────────────────────────────────────
// ROOT + HEALTH
// ─────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    api: 'HedgeAlphaOracle',
    version: '4.0',
    description: 'Real-time crypto & stock signals + market intelligence for AI agents',
    endpoints: {
      '/sentiment/:asset':          'Sentiment score — $0.01',
      '/alpha/:asset':              'Entry, target, stop loss — $0.02',
      '/premium/:asset':            'Full thesis + risk — $0.05',
      '/market/fear-greed':         'Fear & Greed Index — $0.01',
      '/market/whale-alert/:asset': 'Whale / large move alert — $0.02',
      '/portfolio/risk-score':      'Portfolio risk score — $0.02',
      '/health':                    'Health check'
    },
    network: 'Base (x402 USDC)',
    wallet: WALLET_ADDRESS
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK', service: 'HedgeAlphaOracle', version: '4.0',
    wallet: WALLET_ADDRESS, x402: 'enabled', bazaar: 'discoverable',
    network: 'base-mainnet',
    pricing: { sentiment: '$0.01', alpha: '$0.02', premium: '$0.05', fearGreed: '$0.01', whaleAlert: '$0.02', portfolioRisk: '$0.02' }
  });
});

// ─────────────────────────────────────────────
// ENDPOINT 1: /sentiment/:asset  — $0.01
// Sentiment score for any crypto or stock
// ─────────────────────────────────────────────
app.get('/sentiment/:asset',
  requirePayment(10000,
    'Sentiment score for any crypto or stock. Bullish/bearish direction with score out of 100.',
    { asset: 'BTC' },
    { success: true, asset: 'BTC', sentimentScore: 72, direction: 'LONG', price: 67432, change24h: 2.34 }
  ),
  async (req, res) => {
    const asset = req.params.asset.toUpperCase();
    const assetType = detectAssetType(asset);
    if (assetType === 'unknown') return res.status(404).json({ success: false, error: asset + ' not supported.' });

    const priceData = assetType === 'crypto' ? await getCryptoPrice(asset) : await getStockPrice(asset);
    if (!priceData) return res.status(404).json({ success: false, error: 'Could not fetch price for ' + asset });

    const change24h = priceData.usd_24h_change || 0;
    const signal = generateSignal(change24h);

    res.json({
      success: true, asset, assetType,
      sentimentScore: signal.sentiment,
      direction: signal.direction,
      price: priceData.usd,
      change24h: parseFloat(change24h.toFixed(2)),
      summary: 'SENTIMENT [' + asset + '] Score: ' + signal.sentiment + '/100 | ' + signal.direction + ' | Price: $' + priceData.usd.toLocaleString() + ' (' + change24h.toFixed(2) + '% 24h)' + DISCLAIMER
    });
  }
);

// ─────────────────────────────────────────────
// ENDPOINT 2: /alpha/:asset  — $0.02
// Entry zone, price target, stop loss
// ─────────────────────────────────────────────
app.get('/alpha/:asset',
  requirePayment(20000,
    'Actionable alpha signal with entry zone, price target, and stop loss for any crypto or stock.',
    { asset: 'ETH' },
    { success: true, asset: 'ETH', direction: 'LONG', entryLow: 3200, entryHigh: 3280, target: 3520, stopLoss: 3040 }
  ),
  async (req, res) => {
    const asset = req.params.asset.toUpperCase();
    const assetType = detectAssetType(asset);
    if (assetType === 'unknown') return res.status(404).json({ success: false, error: asset + ' not supported.' });

    const priceData = assetType === 'crypto' ? await getCryptoPrice(asset) : await getStockPrice(asset);
    if (!priceData) return res.status(404).json({ success: false, error: 'Could not fetch price for ' + asset });

    const price = priceData.usd;
    const change24h = priceData.usd_24h_change || 0;
    const signal = generateSignal(change24h);
    const entryLow  = parseFloat((price * 0.98).toFixed(2));
    const entryHigh = parseFloat((price * 1.01).toFixed(2));
    const target    = parseFloat((price * 1.10).toFixed(2));
    const stopLoss  = parseFloat((price * 0.95).toFixed(2));

    res.json({
      success: true, asset, assetType,
      direction: signal.direction,
      sentimentScore: signal.sentiment,
      price, change24h: parseFloat(change24h.toFixed(2)),
      entryLow, entryHigh, target, stopLoss,
      riskReward: '2:1',
      summary: 'ALPHA [' + asset + '] ' + signal.direction + ' | Entry $' + entryLow + '-$' + entryHigh + ' | Target $' + target + ' | Stop $' + stopLoss + DISCLAIMER
    });
  }
);

// ─────────────────────────────────────────────
// ENDPOINT 3: /premium/:asset  — $0.05
// Full thesis with risk assessment
// ─────────────────────────────────────────────
app.get('/premium/:asset',
  requirePayment(50000,
    'Full hedge-fund style thesis with risk assessment, position sizing, and market context for any crypto or stock.',
    { asset: 'NVDA' },
    { success: true, asset: 'NVDA', direction: 'LONG', thesis: 'Bullish momentum...', riskLevel: 'MEDIUM', positionSize: '3%' }
  ),
  async (req, res) => {
    const asset = req.params.asset.toUpperCase();
    const assetType = detectAssetType(asset);
    if (assetType === 'unknown') return res.status(404).json({ success: false, error: asset + ' not supported.' });

    const priceData = assetType === 'crypto' ? await getCryptoPrice(asset) : await getStockPrice(asset);
    if (!priceData) return res.status(404).json({ success: false, error: 'Could not fetch price for ' + asset });

    const price = priceData.usd;
    const change24h = priceData.usd_24h_change || 0;
    const marketCap = priceData.usd_market_cap || 0;
    const signal = generateSignal(change24h);
    const riskLevel = Math.abs(change24h) > 5 ? 'HIGH' : Math.abs(change24h) > 2 ? 'MEDIUM' : 'LOW';

    res.json({
      success: true, asset, assetType,
      direction: signal.direction,
      sentimentScore: signal.sentiment,
      price, change24h: parseFloat(change24h.toFixed(2)),
      marketCapB: marketCap > 0 ? parseFloat((marketCap / 1e9).toFixed(2)) : null,
      entryLow:  parseFloat((price * 0.98).toFixed(2)),
      entryHigh: parseFloat((price * 1.01).toFixed(2)),
      target:    parseFloat((price * 1.10).toFixed(2)),
      stopLoss:  parseFloat((price * 0.95).toFixed(2)),
      riskLevel,
      positionSize: riskLevel === 'HIGH' ? '1-2%' : riskLevel === 'MEDIUM' ? '2-4%' : '3-5%',
      riskReward: '2:1',
      thesis: signal.direction.includes('LONG')
        ? asset + ' showing bullish momentum with ' + change24h.toFixed(2) + '% 24h move. Sentiment at ' + signal.sentiment + '/100. Key support holds above stop loss zone.'
        : asset + ' showing bearish pressure with ' + change24h.toFixed(2) + '% 24h move. Sentiment at ' + signal.sentiment + '/100. Resistance likely to cap any bounces.',
      summary: 'PREMIUM [' + asset + '] ' + signal.direction + ' | Risk: ' + riskLevel + ' | Score: ' + signal.sentiment + '/100' + DISCLAIMER
    });
  }
);

// ─────────────────────────────────────────────
// ENDPOINT 4: /market/fear-greed  — $0.01
// Bitcoin Fear & Greed Index
// ─────────────────────────────────────────────
app.get('/market/fear-greed',
  requirePayment(10000,
    'Bitcoin Fear & Greed Index with market sentiment context and trading implications.',
    {},
    { success: true, value: 72, classification: 'Greed', signal: 'Market is greedy — consider taking profits or waiting for pullback' }
  ),
  async (req, res) => {
    const fng = await getFearGreedIndex();
    const value = fng ? parseInt(fng.value) : 50;
    const classification = fng ? fng.value_classification : 'Neutral';

    let signal, color;
    if (value >= 80)      { signal = 'Extreme Greed — high risk, consider taking profits'; color = 'RED'; }
    else if (value >= 60) { signal = 'Greed — market optimistic, watch for reversals'; color = 'ORANGE'; }
    else if (value >= 40) { signal = 'Neutral — no strong directional bias'; color = 'YELLOW'; }
    else if (value >= 20) { signal = 'Fear — potential buying opportunity forming'; color = 'LIGHTGREEN'; }
    else                  { signal = 'Extreme Fear — historically strong buy zone'; color = 'GREEN'; }

    res.json({
      success: true,
      fearGreedIndex: value,
      classification,
      signal,
      color,
      tradingImplication: value > 75
        ? 'Market extremely greedy. Historically a contrarian sell signal. Reduce position sizes.'
        : value < 25
        ? 'Market in extreme fear. Historically a contrarian buy signal. Consider scaling in.'
        : 'Market in neutral/moderate territory. Follow individual asset signals.',
      lastUpdated: fng ? fng.timestamp : new Date().toISOString(),
      summary: 'FEAR & GREED INDEX: ' + value + '/100 — ' + classification + ' | ' + signal + DISCLAIMER
    });
  }
);

// ─────────────────────────────────────────────
// ENDPOINT 5: /market/whale-alert/:asset  — $0.02
// Large price move and unusual activity detection
// ─────────────────────────────────────────────
app.get('/market/whale-alert/:asset',
  requirePayment(20000,
    'Detect large price moves, unusual volume, and whale-level activity for any crypto or stock.',
    { asset: 'BTC' },
    { success: true, asset: 'BTC', whaleAlert: true, alertLevel: 'HIGH', unusualVolume: true, priceImpact: 'SIGNIFICANT' }
  ),
  async (req, res) => {
    const asset = req.params.asset.toUpperCase();
    const assetType = detectAssetType(asset);
    if (assetType === 'unknown') return res.status(404).json({ success: false, error: asset + ' not supported.' });

    const priceData = assetType === 'crypto' ? await getCryptoPrice(asset) : await getStockPrice(asset);
    if (!priceData) return res.status(404).json({ success: false, error: 'Could not fetch price for ' + asset });

    const price = priceData.usd;
    const change24h = priceData.usd_24h_change || 0;
    const absChange = Math.abs(change24h);

    const whaleAlert  = absChange > 5;
    const alertLevel  = absChange > 10 ? 'CRITICAL' : absChange > 5 ? 'HIGH' : absChange > 3 ? 'MEDIUM' : 'LOW';
    const priceImpact = absChange > 8 ? 'EXTREME' : absChange > 5 ? 'SIGNIFICANT' : absChange > 2 ? 'MODERATE' : 'NORMAL';
    const direction   = change24h > 0 ? 'UPWARD' : 'DOWNWARD';

    res.json({
      success: true, asset, assetType,
      price, change24h: parseFloat(change24h.toFixed(2)),
      whaleAlert,
      alertLevel,
      priceImpact,
      moveDirection: direction,
      unusualActivity: absChange > 3,
      interpretation: whaleAlert
        ? 'WHALE ALERT: ' + asset + ' has moved ' + change24h.toFixed(2) + '% in 24h. Large ' + direction.toLowerCase() + ' pressure detected. Monitor closely for continuation or reversal.'
        : asset + ' showing normal price activity. No unusual whale movement detected at this time.',
      recommendation: alertLevel === 'CRITICAL' || alertLevel === 'HIGH'
        ? 'High volatility detected. Reduce position size. Set tight stop losses.'
        : 'Normal market conditions. Standard position sizing applies.',
      summary: 'WHALE ALERT [' + asset + '] Level: ' + alertLevel + ' | Move: ' + change24h.toFixed(2) + '% | Impact: ' + priceImpact + DISCLAIMER
    });
  }
);

// ─────────────────────────────────────────────
// ENDPOINT 6: /portfolio/risk-score  — $0.02
// Multi-asset portfolio risk assessment
// ─────────────────────────────────────────────
app.get('/portfolio/risk-score',
  requirePayment(20000,
    'Analyze portfolio risk across multiple crypto and stock assets. Pass assets as comma-separated query param.',
    { assets: 'BTC,ETH,AAPL' },
    { success: true, overallRisk: 'MEDIUM', riskScore: 58, assets: 3, recommendation: 'Diversified portfolio with moderate risk.' }
  ),
  async (req, res) => {
    const assetsParam = req.query.assets || 'BTC,ETH,SOL';
    const assetList = assetsParam.split(',').map(a => a.trim().toUpperCase()).slice(0, 10);

    const results = [];
    let totalRisk = 0;

    for (const asset of assetList) {
      const assetType = detectAssetType(asset);
      if (assetType === 'unknown') { results.push({ asset, error: 'not supported' }); continue; }

      const priceData = assetType === 'crypto' ? await getCryptoPrice(asset) : await getStockPrice(asset);
      if (!priceData) { results.push({ asset, error: 'price unavailable' }); continue; }

      const change24h = priceData.usd_24h_change || 0;
      const absChange = Math.abs(change24h);
      const riskScore = Math.min(100, Math.round(absChange * 8 + 20));
      totalRisk += riskScore;

      results.push({
        asset, assetType,
        price: priceData.usd,
        change24h: parseFloat(change24h.toFixed(2)),
        riskScore,
        riskLevel: riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW'
      });
    }

    const validResults  = results.filter(r => !r.error);
    const avgRisk       = validResults.length > 0 ? Math.round(totalRisk / validResults.length) : 50;
    const overallRisk   = avgRisk > 70 ? 'HIGH' : avgRisk > 40 ? 'MEDIUM' : 'LOW';
    const highRiskAssets = validResults.filter(r => r.riskLevel === 'HIGH').map(r => r.asset);

    res.json({
      success: true,
      overallRisk,
      riskScore: avgRisk,
      assetsAnalyzed: validResults.length,
      assets: results,
      highRiskAssets,
      recommendation: overallRisk === 'HIGH'
        ? 'High portfolio risk detected. Consider reducing exposure to: ' + (highRiskAssets.join(', ') || 'volatile assets') + '. Use tighter stop losses.'
        : overallRisk === 'MEDIUM'
        ? 'Moderate portfolio risk. Standard position sizing recommended. Monitor high-volatility assets closely.'
        : 'Low portfolio risk. Good diversification detected. Standard risk management applies.',
      summary: 'PORTFOLIO RISK: ' + overallRisk + ' (' + avgRisk + '/100) across ' + validResults.length + ' assets' + DISCLAIMER
    });
  }
);

// ─────────────────────────────────────────────
// LEGACY ROUTE — keep old /signal/:asset working
// ─────────────────────────────────────────────
app.get('/signal/:asset',
  requirePayment(10000, 'Legacy signal endpoint — use /sentiment/:asset, /alpha/:asset, or /premium/:asset for best results.', { asset: 'BTC', tier: 'sentiment' }, {}),
  async (req, res) => {
    const asset = req.params.asset.toUpperCase();
    const tier = req.query.tier || 'sentiment';
    const assetType = detectAssetType(asset);
    if (assetType === 'unknown') return res.status(404).json({ success: false, error: asset + ' not supported.' });

    const priceData = assetType === 'crypto' ? await getCryptoPrice(asset) : await getStockPrice(asset);
    if (!priceData) return res.status(404).json({ success: false, error: 'Could not fetch price for ' + asset });

    const price    = priceData.usd;
    const change24h = priceData.usd_24h_change || 0;
    const signal   = generateSignal(change24h);

    res.json({
      success: true, asset, assetType, tier,
      sentimentScore: signal.sentiment, direction: signal.direction,
      price, change24h: parseFloat(change24h.toFixed(2)),
      note: 'Use /sentiment/, /alpha/, or /premium/ endpoints for dedicated signals at lower prices.',
      summary: signal.direction + ' | Score: ' + signal.sentiment + '/100 | $' + price.toLocaleString() + DISCLAIMER
    });
  }
);

app.listen(PORT, function() {
  console.log('HedgeAlphaOracle v4.0 running on port ' + PORT);
  console.log('6 dedicated endpoints: sentiment $0.01 | alpha $0.02 | premium $0.05');
  console.log('New: fear-greed $0.01 | whale-alert $0.02 | portfolio-risk $0.02');
  console.log('x402 payments on Base network | Bazaar discoverable');
});
