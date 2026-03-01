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

function getMispricingSignals(markets) {
  return markets
    .filter(m => {
      const sum = (m.yes_bid + m.no_bid) / 100;
      const yes = m.yes_ask / 100;
      return sum < 0.92 && yes > 0.05 && yes < 0.95;
    })
    .map(m => {
      const yes = m.yes_ask / 100;
      const sum = (m.yes_bid + m.no_bid) / 100;
      const edge = parseFloat((Math.abs(0.5 - Math.min(yes, 1 - yes))).toFixed(2));
      return {
        id: m.ticker,
        strategy: "Mispricing Detector",
        category: "economic",
        market: m.title,
        ticker: m.ticker,
        side: yes < 0.5 ? "YES" : "NO",
        yourEdge: edge,
        modelProb: parseFloat((yes < 0.5 ? 1 - yes : yes).toFixed(2)),
        kalshiProb: parseFloat(Math.min(yes, 1 - yes).toFixed(2)),
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
  const hasKey = !!process.env.KALSHI_KEY_ID;
  const hasPrivate = !!process.env.KALSHI_PRIVATE_KEY;
  res.json({ status: "ok", loggedIn: hasKey && hasPrivate, hasKeyId: hasKey, hasPrivateKey: hasPrivate });
});

app.get("/api/signals", async (req, res) => {
  try {
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
  console.log(`Key ID present: ${!!process.env.KALSHI_KEY_ID}`);
  console.log(`Private key present: ${!!process.env.KALSHI_PRIVATE_KEY}`);
});
