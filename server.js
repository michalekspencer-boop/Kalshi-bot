import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

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
  // Edge strength (0-40 pts)
  score += Math.min(40, Math.round(edge * 200));
  // Data source reliability (0-30 pts)
  const sourceScores = {
    "NOAA Weather API (free)": 30,
    "FRED (St. Louis Fed)": 28,
    "Kalshi live market data": 15,
  };
  score += sourceScores[dataSource] || 10;
  // Time until expiry sweet spot 1-7 days (0-20 pts)
  if (expiresIn) {
    try {
      const daysLeft = (new Date(expiresIn) - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft >= 1 && daysLeft <= 7) score += 20;
      else if (daysLeft > 7 && daysLeft <= 30) score += 10;
      else if (daysLeft < 1) score += 5;
    } catch (e) {}
  }
  // Confidence (0-10 pts)
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

// ─── MISPRICING STRATEGY ─────────────────────────────────────────────────────
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
      return {
        id: m.ticker,
        strategy: "Mispricing Detector",
        category,
        market: m.title,
        ticker: m.ticker,
        side: yes < 0.5 ? "YES" : "NO",
        yourEdge: edge,
        modelProb: parseFloat((yes < 0.5 ? 1 - yes : yes).toFixed(2)),
        kalshiProb: parseFloat(Math.min(yes, 1 - yes).toFixed(2)),
        recommendedSize: 25,
        maxSize: 100,
        dataSource,
        reasoning: `Yes ask: ${m.yes_ask}c, No ask: ${m.no_ask}c. Combined bid price is ${Math.round(sum * 100)}c — potential mispricing detected.`,
        confidence,
        expiresIn,
        qualityScore: calcQualityScore(edge, dataSource, expiresIn, confidence),
        qualityLabel: getQualityLabel(calcQualityScore(edge, dataSource, expiresIn, confidence)),
        timestamp: Date.now(),
      };
    });
}

// ─── NOAA WEATHER STRATEGY ───────────────────────────────────────────────────
async function getNOAASignals(markets) {
  const signals = [];
  const weatherMarkets = markets.filter(m =>
    m.title.toLowerCase().includes("snow") ||
    m.title.toLowerCase().includes("rain") ||
    m.title.toLowerCase().includes("temperature") ||
    m.title.toLowerCase().includes("hurricane") ||
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
      const periods = forecastData.properties.periods;
      const pop = periods[0]?.probabilityOfPrecipitation?.value;
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
          id: `noaa_${market.ticker}`,
          strategy: "NOAA Weather Model",
          category: "weather",
          market: market.title,
          ticker: market.ticker,
          side: edge > 0 ? "YES" : "NO",
          yourEdge: parseFloat(Math.abs(edge).toFixed(2)),
          modelProb: parseFloat(noaaProb.toFixed(2)),
          kalshiProb: parseFloat(kalshiProb.toFixed(2)),
          recommendedSize: Math.min(75, Math.round(Math.abs(edge) * 300)),
          maxSize: 100,
          dataSource,
          reasoning: `NOAA gives ${Math.round(noaaProb * 100)}% precipitation probability. Kalshi prices it at ${Math.round(kalshiProb * 100)}c. Edge: ${Math.round(Math.abs(edge) * 100)} points.`,
          confidence,
          expiresIn,
          qualityScore: qs,
          qualityLabel: getQualityLabel(qs),
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      console.error("NOAA error:", e.message);
    }
  }
  return signals;
}

// ─── FED RATE STRATEGY ───────────────────────────────────────────────────────
async function getFedSignals(markets) {
  const signals = [];
  const fedMarkets = markets.filter(m =>
    m.title.toLowerCase().includes("fed") ||
    m.title.toLowerCase().includes("fomc") ||
    m.title.toLowerCase().includes("interest rate") ||
    m.title.toLowerCase().includes("federal funds")
  );
  if (fedMarkets.length === 0) return signals;
  try {
    const fredRes = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=FEDTARMD&api_key=${process.env.FRED_API_KEY}&sort_order=desc&limit=1&file_type=json`
    );
    const fredData = await fredRes.json();
    const currentRate = parseFloat(fredData.observations?.[0]?.value);
    if (isNaN(currentRate)) return signals;
    console.log(`Current Fed rate from FRED: ${currentRate}%`);
    for (const market of fedMarkets.slice(0, 5)) {
      const kalshiProb = market.yes_ask / 100;
      const isHold = market.title.toLowerCase().includes("hold") ||
                     market.title.toLowerCase().includes("unchanged") ||
                     market.title.toLowerCase().includes("pause");
      const modelProb = isHold ? 0.75 : 0.35;
      const edge = modelProb - kalshiProb;
      if (Math.abs(edge) > 0.05) {
        const expiresIn = market.close_time ? new Date(market.close_time).toLocaleDateString() : "soon";
        const confidence = Math.abs(edge) > 0.08 ? "High" : "Medium";
        const dataSource = "FRED (St. Louis Fed)";
        const qs = calcQualityScore(Math.abs(edge), dataSource, expiresIn, confidence);
        signals.push({
          id: `fed_${market.ticker}`,
          strategy: "Fed Rate Tracker",
          category: "economic",
          market: market.title,
          ticker: market.ticker,
          side: edge > 0 ? "YES" : "NO",
          yourEdge: parseFloat(Math.abs(edge).toFixed(2)),
          modelProb: parseFloat(modelProb.toFixed(2)),
          kalshiProb: parseFloat(kalshiProb.toFixed(2)),
          recommendedSize: Math.min(100, Math.round(Math.abs(edge) * 400)),
          maxSize: 150,
          dataSource,
          reasoning: `Current Fed funds rate: ${currentRate}%. Model probability: ${Math.round(modelProb * 100)}%. Kalshi: ${Math.round(kalshiProb * 100)}c. Edge: ${Math.round(Math.abs(edge) * 100)} points.`,
          confidence,
          expiresIn,
          qualityScore: qs,
          qualityLabel: getQualityLabel(qs),
          timestamp: Date.now(),
        });
      }
    }
  } catch (e) {
    console.error("Fed strategy error:", e.message);
  }
  return signals;
}

// ─── API ENDPOINTS ───────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    loggedIn: !!process.env.KALSHI_KEY_ID && !!process.env.KALSHI_PRIVATE_KEY,
    hasKeyId: !!process.env.KALSHI_KEY_ID,
    hasPrivateKey: !!process.env.KALSHI_PRIVATE_KEY,
    hasFred: !!process.env.FRED_API_KEY,
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
    const signals = [...mispricing, ...noaa, ...fed]
      .sort((a, b) => b.qualityScore - a.qualityScore);
    console.log(`Signals — mispricing: ${mispricing.length}, noaa: ${noaa.length}, fed: ${fed.length}`);
    res.json({ signals });
  } catch (e) {
    console.error("Signals error:", e.message);
    res.json({ signals: [], error: e.message });
  }
});

app.post("/api/bet", async (req, res) => {
  try {
    const { ticker, side, dollarAmount } = req.body;
    console.log(`Bet request: ${ticker} ${side} $${dollarAmount}`);
    const mktPath = `/trade-api/v2/markets/${ticker}`;
    const mktRes = await fetch(`https://api.elections.kalshi.com${mktPath}`, {
      headers: authHeaders("GET", mktPath),
    });
    const mktData = await mktRes.json();
    if (!mktData.market) {
      console.error("Market not found:", JSON.stringify(mktData));
      return res.json({ success: false, error: "Market not found" });
    }
    const market = mktData.market;
    const price = side === "yes" ? market.yes_ask : market.no_ask;
    if (!price || price <= 0) {
      return res.json({ success: false, error: `Invalid price: ${price}` });
    }
    const contracts = Math.max(1, Math.floor((dollarAmount * 100) / price));
    console.log(`Placing order: ${contracts} contracts at ${price}c`);
    const orderPath = `/trade-api/v2/portfolio/orders`;
    const orderRes = await fetch(`https://api.elections.kalshi.com${orderPath}`, {
      method: "POST",
      headers: authHeaders("POST", orderPath),
      body: JSON.stringify({
        ticker,
        action: "buy",
        side: side.toLowerCase(),
        count: contracts,
        type: "limit",
        yes_price: side === "yes" ? price : 100 - price,
        client_order_id: `bot_${Date.now()}`,
      }),
    });
    const order = await orderRes.json();
    console.log("Order response:", JSON.stringify(order));
    if (order.error) {
      return res.json({ success: false, error: order.error.message || order.error });
    }
    res.json({ success: true, order, contracts, price });
  } catch (e) {
    console.error("Bet error:", e.message);
    res.json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Kalshi backend running on port ${PORT}`);
  console.log(`Key ID: ${!!process.env.KALSHI_KEY_ID}, Private key: ${!!process.env.KALSHI_PRIVATE_KEY}, FRED: ${!!process.env.FRED_API_KEY}`);
});
