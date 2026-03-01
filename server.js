import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
let token = null;

async function login() {
  token = process.env.KALSHI_API_KEY;
  console.log("Kalshi API key loaded:", token ? "yes" : "no");
}

async function getMarkets(limit = 100) {
  const res = await fetch(`${KALSHI_BASE}/markets?limit=${limit}&status=open`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  return res.json();
}

function getMispricingSignals(markets) {
  return markets
    .filter(m => {
      const sum = (m.yes_bid + m.no_bid) / 100;
      const yes = m.yes_ask / 100;
      return sum < 0.92 && yes > 0.05 && yes < 0.95;
    })
    .map(m => {
      const yes = m.yes_ask / 100;
      const no = m.no_ask / 100;
      const sum = (m.yes_bid + m.no_bid) / 100;
      const edge = parseFloat((Math.abs(0.5 - Math.min(yes, no))).toFixed(2));
      return {
        id: m.ticker,
        strategy: "Mispricing Detector",
        category: "economic",
        market: m.title,
        ticker: m.ticker,
        side: yes < no ? "YES" : "NO",
        yourEdge: edge,
        modelProb: parseFloat((1 - Math.min(yes, no)).toFixed(2)),
        kalshiProb: parseFloat(Math.min(yes, no).toFixed(2)),
        recommendedSize: 25,
        maxSize: 100,
        dataSource: "Kalshi live market data",
        reasoning: `Yes ask: ${m.yes_ask}c, No ask: ${m.no_ask}c. Combined bid price is ${Math.round(sum * 100)}c — potential mispricing detected.`,
        confidence: edge > 0.1 ? "High" : "Medium",
        expiresIn: m.close_time ? new Date(m.close_time).toLocaleDateString() : "unknown",
        timestamp: Date.now(),
      };
    });
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", loggedIn: !!token });
});

app.get("/api/signals", async (req, res) => {
  try {
    if (!token) await login();
    const { markets } = await getMarkets(100);
    if (!markets) return res.json({ signals: [] });
    const signals = getMispricingSignals(markets).sort((a, b) => b.yourEdge - a.yourEdge);
    console.log(`Signals found: ${signals.length}`);
    res.json({ signals });
  } catch (e) {
    console.error("Signals error:", e.message);
    res.json({ signals: [], error: e.message });
  }
});

app.post("/api/bet", async (req, res) => {
  try {
    if (!token) await login();
    const { ticker, side, dollarAmount } = req.body;
    console.log(`Bet request: ${ticker} ${side} $${dollarAmount}`);

    const mktRes = await fetch(`${KALSHI_BASE}/markets/${ticker}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const mktData = await mktRes.json();
    if (!mktData.market) {
      console.error("Market not found:", mktData);
      return res.json({ success: false, error: "Market not found" });
    }

    const market = mktData.market;
    const price = side === "yes" ? market.yes_ask : market.no_ask;
    if (!price || price <= 0) {
      return res.json({ success: false, error: `Invalid price: ${price}` });
    }

    const contracts = Math.max(1, Math.floor((dollarAmount * 100) / price));
    console.log(`Placing order: ${contracts} contracts at ${price}c`);

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
    console.log("Order response:", JSON.stringify(order));

    if (order.error) {
      return res.json({ success: false, error: order.error });
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
  login();
});
