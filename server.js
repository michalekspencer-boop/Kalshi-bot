import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ─── AUTO-TRADE STATE ─────────────────────────────────────────────────────────
let autoTradeEnabled = true;
let autoTradeLog = [];
let placedTickers = new Set();
const DAILY_LIMIT = 50;

function getDailySpend() {
  const midnight = new Date(); midnight.setHours(0,0,0,0);
  return autoTradeLog
    .filter(e => e.type === "BET_PLACED" && e.timestamp >= midnight.getTime())
    .reduce((sum, e) => sum + (e.data?.amount || 0), 0);
}

function logActivity(type, message, data = {}) {
  const entry = { type, message, data, timestamp: Date.now() };
  autoTradeLog.unshift(entry);
  if (autoTradeLog.length > 100) autoTradeLog = autoTradeLog.slice(0, 100);
  console.log(`[${type}] ${message}`);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function signRequest(method, path, timestamp) {
  const message = `${timestamp}${method}${path}`;
  const privateKey = process.env.KALSHI_PRIVATE_KEY.replace(/\\n/g, "\n");
  const sign = crypto.createSign("SHA256");
  sign.update(message);
  sign.end();
  return sign.sign({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, "base64");
}

function authHeaders(method, path) {
  const timestamp = Date.now().toString();
  const signature = signRequest(method, path, timestamp);
  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": process.env.KALSHI_KEY_ID,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function getMarkets(limit = 100) {
  const path = `/trade-api/v2/markets?limit=${limit}&status=open`;
  const res = await fetch(`https://api.elections.kalshi.com${path}`, {
    headers: authHeaders("GET", path),
  });
  return res.json();
}

// ─── QUALITY SCORE ────────────────────────────────────────────────────────────
function calcQualityScore(edge, dataSource, expiresIn, confidence) {
  let score = 0;
  score += Math.min(40, Math.round(edge * 200));
  const sourceScores = { "NOAA Weather API (free)": 30, "FRED (St. Louis Fed)": 28, "Kalshi live market data": 15 };
  score += sourceScores[dataSource] || 10;
  if (expiresIn) {
    try {
      const daysLeft = (new Date(expiresIn) - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft >= 1 && daysLeft <= 7) score += 20;
      else if (daysLeft > 7 && daysLeft <= 30) score += 10;
      else if (daysLeft < 1) score += 5;
    } catch (e) {}
  }
  if (confidence === "High") score += 10;
  else if (confidence === "Medium") score += 5;
  return Math.min(100, score);
}

function getQualityLabel(score) {
  if (score >= 80) return "A+";
  if (score >= 65) return "A";
  if (score >= 50) return "B";
  if (score >= 35) return "C";
  return "D";
}

// ─── STRATEGIES ───────────────────────────────────────────────────────────────
function getMispricingSignals(markets) {
  return markets
    .filter(m => {
      if (m.ticker.includes("CROSSCATEGORY") || m.ticker.includes("MULTIGAME")) return false;
      const title = m.title.toLowerCase();
      if (title.includes("wins by") || title.includes("points scored") ||
          title.includes("rebounds") || title.includes("assists") ||
          title.includes(": 1+") || title.includes(": 2+") || title.includes(": 3+")) return false;
      const sum = (m.yes_bid + m.no_bid) / 100;
      const yes = m.yes_ask / 100;
      const no = m.no_ask / 100;
      return sum < 0.92 && yes > 0.05 && yes < 0.95 && no < 100;
    })
    .map(m => {
      const yes = m.yes_ask / 100;
      const sum = (m.yes_bid + m.no_bid) / 100;
      const edge = parseFloat((Math.abs(0.5 - Math.min(yes, 1 - yes))).toFixed(2));
      const ticker = m.ticker.toLowerCase();
      const title = m.title.toLowerCase();
      let category = "economic";
      if (ticker.includes("weather") || ticker.includes("snow") || ticker.includes("rain") || ticker.includes("temp")) category = "weather";
      else if (ticker.includes("nba") || ticker.includes("nfl") || ticker.includes("mlb") || ticker.includes("nhl") || ticker.includes("sport") || title.includes("game") || title.includes("match")) category = "sports";
      else if (ticker.includes("pol") || ticker.includes("elect") || title.includes("president") || title.includes("senate") || title.includes("congress")) category = "political";
      const expiresIn = m.close_time ? new Date(m.close_time).toLocaleDateString() : "unknown";
      const confidence = edge > 0.1 ? "High" : "Medium";
      const dataSource = "Kalshi live market data";
      const qs = calcQualityScore(edge, dataSource, expiresIn, confidence);
      return {
        id: m.ticker, strategy: "Mispricing Detector", category,
        market: m.title, ticker: m.ticker,
        side: yes < 0.5 ? "YES" : "NO",
        yourEdge: edge,
        modelProb: parseFloat((yes < 0.5 ? 1 - yes : yes).toFixed(2)),
        kalshiProb: parseFloat(Math.min(yes, 1 - yes).toFixed(2)),
        recommendedSize: 25, maxSize: 100, dataSource,
        reasoning: `Yes ask: ${m.yes_ask}c, No ask: ${m.no_ask}c. Combined bid price is ${Math.round(sum * 100)}c — potential mispricing detected.`,
        confidence, expiresIn, qualityScore: qs, qualityLabel: getQualityLabel(qs), timestamp: Date.now(),
      };
    });
}

async function getNOAASignals(markets) {
  const signals = [];
  const weatherMarkets = markets.filter(m =>
    m.title.toLowerCase().includes("snow") || m.title.toLowerCase().includes("rain") ||
    m.title.toLowerCase().includes("temperature") || m.title.toLowerCase().includes("hurricane") ||
    m.title.toLowerCase().includes("inches")
  );
  for (const market of weatherMarkets.slice(0, 5)) {
    try {
      const pointRes = await fetch("https://api.weather.gov/points/40.7128,-74.0060");
      const pointData = await pointRes.json();
      if (!pointData.properties) continue;
      const forecastRes = await fetch(pointData.properties.forecast);
      const forecastData = await forecastRes.json();
      if (!forecastData.properties) continue;
      const pop = forecastData.properties.periods[0]?.probabilityOfPrecipitation?.value;
      if (pop === null || pop === undefined) continue;
      const noaaProb = pop / 100;
      const kalshiProb = market.yes_ask / 100;
      const edge = noaaProb - kalshiProb;
      if (Math.abs(edge) > 0.07) {
        const expiresIn = market.close_time ? new Date(market.close_time).toLocaleDateString() : "soon";
        const confidence = Math.abs(edge) > 0.12 ? "High" : "Medium";
        const dataSource = "NOAA Weather API (free)";
        const qs = calcQualityScore(Math.abs(edge), dataSource, expiresIn, confidence);
        signals.push({
          id: `noaa_${market.ticker}`, strategy: "NOAA Weather Model", category: "weather",
          market: market.title, ticker: market.ticker,
          side: edge > 0 ? "YES" : "NO",
          yourEdge: parseFloat(Math.abs(edge).toFixed(2)),
          modelProb: parseFloat(noaaProb.toFixed(2)),
          kalshiProb: parseFloat(kalshiProb.toFixed(2)),
          recommendedSize: Math.min(75, Math.round(Math.abs(edge) * 300)), maxSize: 100,
          dataSource, reasoning: `NOAA gives ${Math.round(noaaProb * 100)}% precipitation probability. Kalshi prices it at ${Math.round(kalshiProb * 100)}c. Edge: ${Math.round(Math.abs(edge) * 100)} points.`,
          confidence, expiresIn, qualityScore: qs, qualityLabel: getQualityLabel(qs), timestamp: Date.now(),
        });
      }
    } catch (e) { console.error("NOAA error:", e.message); }
  }
  return signals;
}

async function getFedSignals(markets) {
  const signals = [];
  const fedMarkets = markets.filter(m =>
    m.title.toLowerCase().includes("fed") || m.title.toLowerCase().includes("fomc") ||
    m.title.toLowerCase().includes("interest rate") || m.title.toLowerCase().includes("federal funds")
  );
  if (fedMarkets.length === 0) return signals;
  try {
    const fredRes = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=FEDTARMD&api_key=${process.env.FRED_API_KEY}&sort_order=desc&limit=1&file_type=json`);
    const fredData = await fredRes.json();
    const currentRate = parseFloat(fredData.observations?.[0]?.value);
    if (isNaN(currentRate)) return signals;
    for (const market of fedMarkets.slice(0, 5)) {
      const kalshiProb = market.yes_ask / 100;
      const isHold = market.title.toLowerCase().includes("hold") || market.title.toLowerCase().includes("unchanged") || market.title.toLowerCase().includes("pause");
      const modelProb = isHold ? 0.75 : 0.35;
      const edge = modelProb - kalshiProb;
      if (Math.abs(edge) > 0.05) {
        const expiresIn = market.close_time ? new Date(market.close_time).toLocaleDateString() : "soon";
        const confidence = Math.abs(edge) > 0.08 ? "High" : "Medium";
        const dataSource = "FRED (St. Louis Fed)";
        const qs = calcQualityScore(Math.abs(edge), dataSource, expiresIn, confidence);
        signals.push({
          id: `fed_${market.ticker}`, strategy: "Fed Rate Tracker", category: "economic",
          market: market.title, ticker: market.ticker,
          side: edge > 0 ? "YES" : "NO",
          yourEdge: parseFloat(Math.abs(edge).toFixed(2)),
          modelProb: parseFloat(modelProb.toFixed(2)),
          kalshiProb: parseFloat(kalshiProb.toFixed(2)),
          recommendedSize: Math.min(100, Math.round(Math.abs(edge) * 400)), maxSize: 150,
          dataSource, reasoning: `Current Fed funds rate: ${currentRate}%. Model probability: ${Math.round(modelProb * 100)}%. Kalshi: ${Math.round(kalshiProb * 100)}c. Edge: ${Math.round(Math.abs(edge) * 100)} points.`,
          confidence, expiresIn, qualityScore: qs, qualityLabel: getQualityLabel(qs), timestamp: Date.now(),
        });
      }
    }
  } catch (e) { console.error("Fed strategy error:", e.message); }
  return signals;
}

// ─── PLACE BET HELPER ─────────────────────────────────────────────────────────
async function placeBet(ticker, side, dollarAmount) {
  const mktPath = `/trade-api/v2/markets/${ticker}`;
  const mktRes = await fetch(`https://api.elections.kalshi.com${mktPath}`, { headers: authHeaders("GET", mktPath) });
  const mktData = await mktRes.json();
  if (!mktData.market) throw new Error("Market not found");
  const market = mktData.market;
  const price = side === "yes" ? market.yes_ask : market.no_ask;
  if (!price || price <= 0) throw new Error(`Invalid price: ${price}`);
  const contracts = Math.max(1, Math.floor((dollarAmount * 100) / price));
  const orderPath = `/trade-api/v2/portfolio/orders`;
  const orderRes = await fetch(`https://api.elections.kalshi.com${orderPath}`, {
    method: "POST",
    headers: authHeaders("POST", orderPath),
    body: JSON.stringify({
      ticker, action: "buy", side: side.toLowerCase(), count: contracts, type: "limit",
      yes_price: side === "yes" ? price : 100 - price,
      client_order_id: `auto_${Date.now()}`,
    }),
  });
  const order = await orderRes.json();
  if (order.error) throw new Error(order.error.message || JSON.stringify(order.error));
  return { order, contracts, price };
}

// ─── AUTO-TRADE LOOP ──────────────────────────────────────────────────────────
async function runAutoTrade() {
  if (!autoTradeEnabled) return;
  logActivity("SCAN", "Auto-scan started");
  try {
    const { markets } = await getMarkets(100);
    if (!markets) { logActivity("ERROR", "No markets returned"); return; }

    const [mispricing, noaa, fed] = await Promise.all([
      Promise.resolve(getMispricingSignals(markets)),
      getNOAASignals(markets),
      getFedSignals(markets),
    ]);

    const allSignals = [...mispricing, ...noaa, ...fed]
      .filter(s => s.qualityScore >= 65)
      .filter(s => !placedTickers.has(s.ticker))
      .sort((a, b) => b.qualityScore - a.qualityScore);

    logActivity("SCAN", `Found ${allSignals.length} qualifying signals (A or above)`);

    for (const signal of allSignals.slice(0, 3)) {
      const dailySpend = getDailySpend();
      if (dailySpend >= DAILY_LIMIT) {
        logActivity("LIMIT", `Daily limit of $${DAILY_LIMIT} reached ($${dailySpend} spent today) — pausing until midnight`);
        break;
      }
      try {
        const result = await placeBet(signal.ticker, signal.side.toLowerCase(), 5);
        placedTickers.add(signal.ticker);
        logActivity("BET_PLACED", `Auto-placed $5 ${signal.side} on "${signal.market}"`, {
          ticker: signal.ticker,
          strategy: signal.strategy,
          qualityScore: signal.qualityScore,
          qualityLabel: signal.qualityLabel,
          edge: signal.yourEdge,
          contracts: result.contracts,
          price: result.price,
          market: signal.market,
          side: signal.side,
          amount: 5,
        });
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        logActivity("BET_FAILED", `Failed to place bet on "${signal.market}": ${e.message}`, { ticker: signal.ticker });
      }
    }

    if (allSignals.length === 0) {
      logActivity("SCAN", "No qualifying signals found this scan");
    }
  } catch (e) {
    logActivity("ERROR", `Auto-trade error: ${e.message}`);
  }
}

setInterval(runAutoTrade, 15 * 60 * 1000);
setTimeout(runAutoTrade, 10000);

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    loggedIn: !!process.env.KALSHI_KEY_ID && !!process.env.KALSHI_PRIVATE_KEY,
    hasKeyId: !!process.env.KALSHI_KEY_ID,
    hasPrivateKey: !!process.env.KALSHI_PRIVATE_KEY,
    hasFred: !!process.env.FRED_API_KEY,
    autoTradeEnabled,
    dailySpend: getDailySpend(),
    dailyLimit: DAILY_LIMIT,
  });
});

app.get("/api/signals", async (req, res) => {
  try {
    const { markets } = await getMarkets(100);
    if (!markets) return res.json({ signals: [] });
    const [mispricing, noaa, fed] = await Promise.all([
      Promise.resolve(getMispricingSignals(markets)),
      getNOAASignals(markets),
      getFedSignals(markets),
    ]);
    const signals = [...mispricing, ...noaa, ...fed].sort((a, b) => b.qualityScore - a.qualityScore);
    console.log(`Signals — mispricing: ${mispricing.length}, noaa: ${noaa.length}, fed: ${fed.length}`);
    res.json({ signals });
  } catch (e) {
    console.error("Signals error:", e.message);
    res.json({ signals: [], error: e.message });
  }
});

app.get("/api/autotrade/log", (req, res) => {
  res.json({
    enabled: autoTradeEnabled,
    dailySpend: getDailySpend(),
    dailyLimit: DAILY_LIMIT,
    log: autoTradeLog,
  });
});

app.post("/api/autotrade/toggle", (req, res) => {
  autoTradeEnabled = !autoTradeEnabled;
  logActivity(autoTradeEnabled ? "ENABLED" : "DISABLED", `Auto-trading ${autoTradeEnabled ? "enabled" : "disabled"}`);
  res.json({ enabled: autoTradeEnabled });
});

app.post("/api/bet", async (req, res) => {
  try {
    const { ticker, side, dollarAmount } = req.body;
    console.log(`Manual bet: ${ticker} ${side} $${dollarAmount}`);
    const result = await placeBet(ticker, side, dollarAmount);
    console.log("Order response:", JSON.stringify(result.order));
    if (result.order?.error) return res.json({ success: false, error: result.order.error.message || result.order.error });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("Bet error:", e.message);
    res.json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Kalshi backend running on port ${PORT}`);
  console.log(`Auto-trading: ENABLED — scanning every 15 minutes`);
  console.log(`Daily limit: $${DAILY_LIMIT} · Min quality: A (65+) · Max bet: $5`);
});
