require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '0x3278657Fd9013D48692C146Bb7FC730e67EAa192';
const PORT = process.env.PORT || 8080;
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

app.get('/', function(req, res) {
  res.redirect('https://nwright38-ops.github.io/HedgeAlphaOracle');
});

app.get('/.well-known/x402.json', function(req, res) {
  res.json({
    x402Version: 2,
    name: 'HedgeAlphaOracle',
    description: 'Real-time crypto AND stock market signals.',
    url: BASE_URL,
    resources: [
      {
        resource: BASE_URL + '/signal/:asset?tier=sentiment',
        description: 'Sentiment signal for crypto or stocks. First query FREE.',
        method: 'GET', scheme: 'exact', network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS, maxAmountRequired: '50000',
        mimeType: 'application/json'
      },
      {
        resource: BASE_URL + '/signal/:asset?tier=fullalpha',
        description: 'Full alpha signal with entry zone, target and stop loss.',
        method: 'GET', scheme: 'exact', network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS, maxAmountRequired: '100000',
        mimeType: 'application/json'
      },
      {
        resource: BASE_URL + '/signal/:asset?tier=premium',
        description: 'Premium signal with full thesis and risk assessment.',
        method: 'GET', scheme: 'exact', network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: WALLET_ADDRESS, maxAmountRequired: '200000',
        mimeType: 'application/json'
      }
    ]
  });
});

app.get('/health', function(req, res) {
  res.json({
    status: 'OK',
    service: 'HedgeAlphaOracle',
    version: '3.2',
    wallet: WALLET_ADDRESS,
    x402: 'enabled',
    network: 'base-mainnet',
    freeTier: '1 free sentiment query per user',
    supportedAssets: { crypto: CRYPTO_ASSETS, stocks: STOCK_ASSETS },
    pricing: { sentiment: '$0.05 (first FREE)', fullalpha: '$0.10', premium: '$0.20' }
  });
});

app.get('/signal/:asset', checkPayment, async function(req, res) {
  const asset = req.params.asset.toUpperCase();
  const tier = req.query.tier || 'sentiment';
  const timeframe = req.query.timeframe || '1D';
  const assetType = detectAssetType(asset);

  if (assetType === 'unknown') {
    return res.status(404).json({
      success: false,
      error: asset + ' not supported.'
    });
  }

  const priceData = assetType === 'crypto'
    ? await getCryptoPrice(asset)
    : await getStockPrice(asset);

  if (!priceData) {
    return res.status(404).json({ success: false, error: 'Could not fetch price data for ' + asset });
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
  console.log('HedgeAlphaOracle v3.2 running on port ' + PORT);
  console.log('Crypto: CoinGecko API | Stocks: Finnhub API');
  console.log('Free tier: 1 sentiment query per user');
  console.log('x402 payments enabled on Base network');
});
