require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://hedgealphaoracle-production.up.railway.app';

const freeQueryTracker = {};

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
  } catch (e) {
    return null;
  }
}

async function getStockPrice(symbol) {
  try {
    const fetch = (await import('node-fetch')).default;
    const url = 'https://finnhub.io/api/v1/quote?symbol=' + symbol + '&token=demo';
    const res = await fetch(url);
    const data = await res.json();
    if (!data.c || data.c === 0) return null;
    const price = data.c;
    const prevClose = data.pc;
    const change24h = ((price - prevClose) / prevClose) * 100;
    return { usd: price, usd_24h_change: change24h, usd_market_cap: 0 };
  } catch (e) {
    return null;
  }
}

function generateSignal(price, change24h) {
  if (change24h > 5) return { direction: 'STRONG LONG', sentiment: 85 };
  if (change24h > 2) return { direction: 'LONG', sentiment: 72 };
  if (change24h > 0) return { direction: 'NEUTRAL/LONG', sentiment: 58 };
  if (change24h > -2) return { direction: 'NEUTRAL/SHORT', sentiment: 42 };
  if (change24h > -5) return { direction: 'SHORT', sentiment: 28 };
  return { direction: 'STRONG SHORT', sentiment: 15 };
}

function checkPayment(req, res, next) {
  const tier = req.query.tier || 'sentiment';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const prices = { sentiment: 0.05, fullalpha: 0.10, premium: 0.20 };
  const price = prices[tier] || 0.05;
  const paymentSig = req.headers['x-payment-signature'] || req.query.paymentSig;

  if (tier === 'sentiment' && !freeQueryTracker[ip]) {
    freeQueryTracker[ip] = true;
    req.isFreeQuery = true;
    return next();
  }

  if (!paymentSig) {
    return res.status(402).json({
      error: 'Payment Required',
      message: 'This endpoint requires payment via x402 protocol',
      price: '$' + price,
      payTo: WALLET_ADDRESS,
      network: 'base-mainnet',
      asset: 'USDC',
      facilitator: 'https://x402.org/facilitator',
      instructions: 'Send USDC on Base network and include transaction signature in x-payment-signature header'
    });
  }
  next();
}

// ─────────────────────────────────────────────
// x402 BAZAAR DISCOVERY ENDPOINTS
// These make HedgeAlphaOracle discoverable by
// AI agents searching the Bazaar catalog.
// ─────────────────────────────────────────────

// Bazaar discovery manifest — lists all paid endpoints with metadata
app.get('/x402/discovery', (req, res) => {
  res.json({
    x402Version: 2,
    name: 'HedgeAlphaOracle',
    description: 'Real-time crypto & stock trading signals for AI agents and traders. Sentiment, Full Alpha, and Premium tiers. First sentiment query free.',
    provider: 'Nurse2Web3',
    url: BASE_URL,
    discoverable: true,
    category: 'financial-data',
    tags: ['crypto', 'stocks', 'trading-signals', 'sentiment', 'alpha', 'defi', 'finance'],
    resources: [
      {
        resource: BASE_URL + '/signal/{asset}',
        method: 'GET',
        description: 'Get a trading signal for any supported crypto or stock. Pass tier=sentiment (free first query), tier=fullalpha ($0.10), or tier=premium ($0.20).',
        scheme: 'exact',
        network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS,
        pricing: {
          sentiment: { amount: '50000', display: '$0.05', firstQueryFree: true },
          fullalpha: { amount: '100000', display: '$0.10' },
          premium:   { amount: '200000', display: '$0.20' }
        },
        queryParams: {
          asset: { type: 'string', description: 'Crypto symbol (BTC, ETH, SOL) or stock ticker (AAPL, NVDA, TSLA)', required: true },
          tier: { type: 'string', enum: ['sentiment', 'fullalpha', 'premium'], description: 'Signal detail level. sentiment=free first query, fullalpha=$0.10, premium=$0.20', required: false },
          timeframe: { type: 'string', description: 'Chart timeframe (1m, 5m, 15m, 1h, 4h, 1D, 1W)', required: false }
        },
        output: {
          example: {
            success: true,
            asset: 'BTC',
            assetType: 'crypto',
            tier: 'sentiment',
            timeframe: '1D',
            price: 67432.10,
            change24h: 2.34,
            data: 'SENTIMENT SIGNAL [CRYPTO] - BTC (1D)\nCurrent Price: $67,432.10\n24h Change: 2.34%\nSentiment Score: 72/100\nSignal: LONG\n\nNOT FINANCIAL ADVICE.',
            freeQuery: true
          },
          schema: {
            success: 'boolean',
            asset: 'string',
            assetType: 'string — crypto or stock',
            tier: 'string',
            timeframe: 'string',
            price: 'number',
            change24h: 'number',
            data: 'string — full signal text',
            freeQuery: 'boolean'
          }
        }
      }
    ],
    supportedAssets: {
      crypto: CRYPTO_ASSETS,
      stocks: STOCK_ASSETS
    },
    contact: {
      twitter: 'https://twitter.com/nurse2web3',
      website: 'https://nurse2web3.com'
    }
  });
});

// Standard x402.json well-known endpoint (Bazaar also checks this)
app.get('/.well-known/x402.json', (req, res) => {
  res.json({
    x402Version: 2,
    name: 'HedgeAlphaOracle',
    description: 'Real-time crypto AND stock market signals. Sentiment, full alpha, and premium tiers. First sentiment query free.',
    url: BASE_URL,
    discoverable: true,
    resources: [
      {
        resource: BASE_URL + '/signal/:asset?tier=sentiment',
        description: 'Sentiment signal for crypto or stocks. First query FREE.',
        method: 'GET', scheme: 'exact', network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS, maxAmountRequired: '50000',
        mimeType: 'application/json',
        example: { asset: 'BTC', tier: 'sentiment', timeframe: '1D' }
      },
      {
        resource: BASE_URL + '/signal/:asset?tier=fullalpha',
        description: 'Full alpha signal with entry zone, target and stop loss for crypto or stocks',
        method: 'GET', scheme: 'exact', network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS, maxAmountRequired: '100000',
        mimeType: 'application/json',
        example: { asset: 'AAPL', tier: 'fullalpha', timeframe: '1D' }
      },
      {
        resource: BASE_URL + '/signal/:asset?tier=premium',
        description: 'Premium signal with full thesis, risk assessment for crypto or stocks',
        method: 'GET', scheme: 'exact', network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS, maxAmountRequired: '200000',
        mimeType: 'application/json',
        example: { asset: 'NVDA', tier: 'premium', timeframe: '1W' }
      }
    ]
  });
});

// ─────────────────────────────────────────────
// EXISTING ENDPOINTS (unchanged)
// ─────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    api: 'HedgeAlphaOracle',
    version: '3.3',
    description: 'Real-time crypto & stock signals for AI agents and traders',
    endpoints: {
      '/signal/:asset': 'Get signal for any crypto or stock (BTC, ETH, AAPL, NVDA...)',
      '/signal/:asset?tier=sentiment': 'Sentiment signal — first query FREE',
      '/signal/:asset?tier=fullalpha': 'Full alpha with entry, target, stop loss — $0.10',
      '/signal/:asset?tier=premium': 'Premium thesis + risk assessment — $0.20',
      '/x402/discovery': 'Bazaar discovery manifest',
      '/.well-known/x402.json': 'x402 well-known endpoint',
      '/health': 'API health check'
    },
    payment_wallet: WALLET_ADDRESS,
    pricing: { sentiment: '$0.05 (first FREE)', fullalpha: '$0.10', premium: '$0.20' },
    network: 'Base (x402)',
    bazaar: 'discoverable',
    supported_crypto: ['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','MATIC','LINK'],
    supported_stocks: ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','NFLX','CRM']
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'HedgeAlphaOracle',
    version: '3.3',
    wallet: WALLET_ADDRESS,
    x402: 'enabled',
    bazaar: 'discoverable',
    network: 'base-mainnet',
    freeTier: '1 free sentiment query per user',
    supportedAssets: { crypto: CRYPTO_ASSETS, stocks: STOCK_ASSETS },
    pricing: { sentiment: '$0.05 (first FREE)', fullalpha: '$0.10', premium: '$0.20' }
  });
});

app.get('/signal/:asset', checkPayment, async (req, res) => {
  const asset = req.params.asset.toUpperCase();
  const tier = req.query.tier || 'sentiment';
  const timeframe = req.query.timeframe || '1D';
  const assetType = detectAssetType(asset);

  if (assetType === 'unknown') {
    return res.status(404).json({
      success: false,
      error: asset + ' not supported. Crypto: ' + CRYPTO_ASSETS.join(', ') + '. Stocks: ' + STOCK_ASSETS.join(', ')
    });
  }

  const priceData = assetType === 'crypto'
    ? await getCryptoPrice(asset)
    : await getStockPrice(asset);

  if (!priceData) {
    return res.status(404).json({ success: false, error: 'Could not fetch price data for ' + asset + '. Market may be closed.' });
  }

  const price = priceData.usd;
  const change24h = priceData.usd_24h_change || 0;
  const marketCap = priceData.usd_market_cap || 0;
  const signal = generateSignal(price, change24h);
  const disclaimer = '\n\nNOT FINANCIAL ADVICE. For informational purposes only.';
  const freeNote = req.isFreeQuery ? '\n[FREE TRIAL QUERY - Subsequent queries require payment]' : '';
  const assetLabel = assetType === 'stock' ? 'STOCK' : 'CRYPTO';
  let responseData = '';

  if (tier === 'sentiment') {
    responseData = 'SENTIMENT SIGNAL [' + assetLabel + '] - ' + asset + ' (' + timeframe + ')\n' +
      'Current Price: $' + price.toLocaleString() + '\n' +
      '24h Change: ' + change24h.toFixed(2) + '%\n' +
      'Sentiment Score: ' + signal.sentiment + '/100\n' +
      'Signal: ' + signal.direction + freeNote + disclaimer;
  }
  if (tier === 'fullalpha') {
    responseData = 'FULL ALPHA SIGNAL [' + assetLabel + '] - ' + asset + ' (' + timeframe + ')\n\n' +
      'Current Price: $' + price.toLocaleString() + '\n' +
      '24h Change: ' + change24h.toFixed(2) + '%\n' +
      'Sentiment: ' + signal.sentiment + '/100\n' +
      'Direction: ' + signal.direction + '\n' +
      'Entry Zone: $' + (price * 0.98).toLocaleString() + ' - $' + (price * 1.01).toLocaleString() + '\n' +
      'Target: $' + (price * 1.10).toLocaleString() + ' (+10%)\n' +
      'Stop Loss: $' + (price * 0.95).toLocaleString() + ' (-5%)' + disclaimer;
  }
  if (tier === 'premium') {
    responseData = 'PREMIUM ALPHA SIGNAL [' + assetLabel + '] - ' + asset + ' (' + timeframe + ')\n\n' +
      '=== MARKET DATA ===\n' +
      'Current Price: $' + price.toLocaleString() + '\n' +
      '24h Change: ' + change24h.toFixed(2) + '%\n' +
      'Market Cap: $' + (marketCap / 1e9).toFixed(2) + 'B\n\n' +
      '=== THESIS ===\n' +
      'Sentiment: ' + signal.sentiment + '/100\n' +
      'Direction: ' + signal.direction + '\n' +
      'Entry Zone: $' + (price * 0.98).toLocaleString() + ' - $' + (price * 1.01).toLocaleString() + '\n' +
      'Target: $' + (price * 1.10).toLocaleString() + ' (+10%)\n\n' +
      '=== RISK ASSESSMENT ===\n' +
      'Stop Loss: $' + (price * 0.95).toLocaleString() + ' (-5%)\n' +
      'Position Size: 2-5% max\n' +
      'Risk/Reward: 2:1' + disclaimer;
  }

  res.json({
    success: true, asset: asset, assetType: assetType,
    tier: tier, timeframe: timeframe,
    data: responseData, price: price,
    change24h: parseFloat(change24h.toFixed(2)),
    paymentAddress: WALLET_ADDRESS,
    freeQuery: req.isFreeQuery || false
  });
});

app.listen(PORT, function() {
  console.log('HedgeAlphaOracle v3.3 running on port ' + PORT);
  console.log('Crypto: CoinGecko API | Stocks: Finnhub API');
  console.log('Free tier: 1 sentiment query per user');
  console.log('x402 payments enabled on Base network');
  console.log('x402 Bazaar: discoverable at /x402/discovery');
});
