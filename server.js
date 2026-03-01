import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
let token = null;

async function login() {
  token = process.env.KALSHI_API_KEY;
  console.log("Kalshi API key loaded:", token ? "yes" : "no");
}

async function getMarkets(limit = 50) {
  const res = await fetch(`${KALSHI_BASE}/markets?limit=${limit}&status=open`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  return res.json();
}

function analyzeMarket(market) {
  const signals = [];
  const yes = market.yes_ask / 100;
  const no = market.no_ask / 100;
  const sum = (market.yes_bid + market.no_bid) / 100;

  if (sum < 0.92 && yes > 0.05 && yes < 0.95) {
    signals.push({
      id: market.ticker,
      strategy: "Mispricing Detector",
      category: "economic",
      market: market.title,
      ticker: market.ticker,
      side: yes < no ? "YES" : "NO",
      yourEdge: parseFloat((Math.abs(0.5 - Math.min(yes, no))).toFixed(2)),
      modelProb: parseFloat((1 - Math.min(yes, no)).toFixed(2)),
      kalshiProb: parseFloat(Math.min(yes, no).toFixed(2)),
      recommendedSize: 25,
      maxSize: 100,
      dataSource: "Kalshi live market data",
      reasoning: `Yes ask: ${market.yes_ask}c, No ask: ${market.no_ask}c. Combined price is ${Math.round(sum * 100)}c — potential mispricing.`,
      confidence: "Medium",
      expiresIn: market.close_time ? new Date(market.close_time).toLocaleDateString() : "unknown",
      timestamp: Date.now(),
    });
  }
  return signals;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", loggedIn: !!token });
});

app.get("/api/signals", async (req, res) => {
  try {
    if (!token) await login();
    const { markets } = await getMarkets(50);
    if (!markets) return res.json({ signals: [] });
    const signals = markets.flatMap(analyzeMarket);
    res.json({ signals });
  } catch (e) {
    console.error("Error:", e.message);
    res.json({ signals: [], error: e.message });
  }
});

app.post("/api/bet", async (req, res) => {
  try {
    if (!token) await login();
    const { ticker, side, dollarAmount } = req.body;
    const mktRes = await fetch(`${KALSHI_BASE}/markets/${ticker}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const { market } = await mktRes.json();
    const price = side === "yes" ? market.yes_ask : market.no_ask;
    const contracts = Math.max(1, Math.floor((dollarAmount * 100) / price));
    const orderRes = await fetch(`${KALSHI_BASE}/portfolio/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
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
    res.json({ success: true, order });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Kalshi backend running on port ${PORT}`);
  login();
});
