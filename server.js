import { useState, useEffect } from "react";

const BACKEND_URL = "https://kalshi-bot-production-db66.up.railway.app";

const CATEGORY_COLOR = { weather: "#a78bfa", economic: "#38bdf8", sports: "#4ade80", political: "#fb923c" };
const CATEGORY_ICON = { weather: "◈", economic: "◆", sports: "◉", political: "◇" };
const CONFIDENCE_COLOR = { High: "#4ade80", Medium: "#facc15", Low: "#f87171" };
const QUALITY_COLOR = (score) => score >= 65 ? "#4ade80" : score >= 35 ? "#facc15" : "#f87171";

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function AutoTradePanel() {
  const [log, setLog] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [dailySpend, setDailySpend] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [loading, setLoading] = useState(true);

  const fetchLog = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/autotrade/log`);
      const data = await res.json();
      setLog(data.log || []);
      setEnabled(data.enabled);
      setDailySpend(data.dailySpend || 0);
      setDailyLimit(data.dailyLimit || 50);
    } catch (e) {
      console.error("Failed to fetch log:", e);
    } finally {
      setLoading(false);
    }
  };

  const toggleAutoTrade = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/autotrade/toggle`, { method: "POST" });
      const data = await res.json();
      setEnabled(data.enabled);
    } catch (e) {
      console.error("Toggle failed:", e);
    }
  };

  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 30000);
    return () => clearInterval(interval);
  }, []);

  const betsPlaced = log.filter(e => e.type === "BET_PLACED");
  const todayBets = betsPlaced.filter(e => Date.now() - e.timestamp < 86400000);

  const LOG_COLORS = {
    BET_PLACED: "#4ade80", BET_FAILED: "#f87171", SCAN: "#475569",
    ERROR: "#f87171", ENABLED: "#4ade80", DISABLED: "#facc15", LIMIT: "#fb923c",
  };

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      <div style={{ padding: "16px 20px", background: "#0a0f18", border: `1px solid ${enabled ? "#4ade8033" : "#f8717133"}`, borderRadius: 4, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: enabled ? "#4ade80" : "#f87171", animation: enabled ? "pulse 2s infinite" : "none" }} />
            <div style={{ fontSize: 13, color: enabled ? "#4ade80" : "#f87171", fontWeight: 600 }}>AUTO-TRADING {enabled ? "ACTIVE" : "PAUSED"}</div>
          </div>
          <div style={{ fontSize: 11, color: "#475569" }}>Scans every 15 min · $5 max per bet · A-grade signals only · $50/day limit</div>
        </div>
        <button onClick={toggleAutoTrade} style={{ background: enabled ? "#1a0808" : "#0a1a0f", border: `1px solid ${enabled ? "#f87171" : "#4ade80"}`, color: enabled ? "#f87171" : "#4ade80", padding: "8px 16px", fontFamily: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 2 }}>
          {enabled ? "⏸ PAUSE" : "▶ RESUME"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
        {[
          { label: "BETS TODAY", value: todayBets.length, color: "#38bdf8" },
          { label: "ALL-TIME BETS", value: betsPlaced.length, color: "#4ade80" },
          { label: "SPENT TODAY", value: `$${dailySpend}`, color: "#facc15" },
          { label: "DAILY LIMIT", value: `$${dailyLimit}`, color: dailySpend >= dailyLimit ? "#f87171" : "#475569" },
        ].map(s => (
          <div key={s.label} style={{ padding: "14px", background: "#0a0f18", border: "1px solid #1e293b", borderRadius: 4, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.12em", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 20, color: s.color, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569", marginBottom: 6 }}>
          <span>Daily spend</span>
          <span style={{ color: dailySpend >= dailyLimit ? "#f87171" : "#94a3b8" }}>${dailySpend} / ${dailyLimit}</span>
        </div>
        <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ width: `${Math.min((dailySpend / dailyLimit) * 100, 100)}%`, height: "100%", background: dailySpend >= dailyLimit ? "#f87171" : "#4ade80", transition: "width 0.4s ease" }} />
        </div>
      </div>

      {betsPlaced.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.12em", marginBottom: 12 }}>RECENT AUTO-BETS</div>
          {betsPlaced.slice(0, 5).map((entry, i) => (
            <div key={i} style={{ padding: "12px 16px", marginBottom: 8, background: "#0a1a0f", border: "1px solid #4ade8022", borderLeft: "3px solid #4ade80", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 3 }}>{entry.data?.market}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#4ade8099" }}>BUY {entry.data?.side} · {entry.data?.strategy}</span>
                  <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 2, background: "#4ade8022", color: "#4ade80" }}>{entry.data?.qualityLabel}</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, color: "#4ade80", fontWeight: 600 }}>${entry.data?.amount}</div>
                <div style={{ fontSize: 10, color: "#334155" }}>{timeAgo(entry.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.12em" }}>FULL ACTIVITY LOG</div>
          <button onClick={fetchLog} style={{ background: "transparent", border: "1px solid #1e293b", color: "#475569", padding: "4px 10px", fontFamily: "inherit", fontSize: 10, cursor: "pointer", borderRadius: 2 }}>↻ refresh</button>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", padding: "24px", color: "#334155", fontSize: 12 }}>Loading...</div>
        ) : log.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px", color: "#334155", fontSize: 12 }}>No activity yet — first scan runs 10 seconds after deploy</div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {log.map((entry, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 12px", borderBottom: "1px solid #0a0f18" }}>
                <div style={{ fontSize: 10, color: "#334155", whiteSpace: "nowrap", marginTop: 1 }}>{timeAgo(entry.timestamp)}</div>
                <div style={{ width: 80, fontSize: 10, color: LOG_COLORS[entry.type] || "#475569", flexShrink: 0 }}>{entry.type}</div>
                <div style={{ fontSize: 11, color: entry.type === "BET_PLACED" ? "#e2e8f0" : "#475569", lineHeight: 1.5 }}>{entry.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EdgeExplainer() {
  const [example, setExample] = useState(0);
  const examples = [
    { label: "NOAA Weather", modelProb: 72, kalshiProb: 58, edge: 14, side: "YES", color: "#a78bfa", description: "NOAA's ensemble model shows 72% precipitation probability. Kalshi crowd prices it at 58¢. You buy YES at 58¢ when the real probability is 72% — a 14-point edge." },
    { label: "Fed Rate Hold", modelProb: 81, kalshiProb: 72, edge: 9, side: "YES", color: "#38bdf8", description: "CME futures imply 81% chance Fed holds rates. Kalshi prices it at 72¢. You buy YES at 72¢ when the real probability is 81% — a 9-point edge." },
    { label: "Mispricing", modelProb: 55, kalshiProb: 42, edge: 13, side: "YES", color: "#4ade80", description: "YES + NO bids only sum to 88¢ instead of 100¢. The market is mispriced. Buying YES at 42¢ when fair value is ~55¢ captures the 13-point gap." },
  ];
  const ex = examples[example];
  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      <div style={{ padding: "20px 24px", background: "#0a0f18", border: "1px solid #1e293b", borderRadius: 4, marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.15em", marginBottom: 12 }}>THE CORE CONCEPT</div>
        <div style={{ fontSize: 15, color: "#e2e8f0", lineHeight: 1.8, marginBottom: 16 }}>
          Kalshi prices work like probabilities — a market at <span style={{ color: "#38bdf8" }}>58¢</span> means the crowd thinks there's a <span style={{ color: "#38bdf8" }}>58% chance</span> it happens. Your edge is the gap between what your <span style={{ color: "#4ade80" }}>data source</span> says vs. what <span style={{ color: "#94a3b8" }}>Kalshi's crowd</span> believes.
        </div>
        <div style={{ padding: "14px 16px", background: "#060c14", border: "1px solid #38bdf844", borderRadius: 3 }}>
          <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: 600, marginBottom: 6 }}>EDGE FORMULA</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "monospace" }}>Edge = Model Probability − Kalshi Price</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>If Edge {">"} 0 → buy YES &nbsp;|&nbsp; If Edge {"<"} 0 → buy NO</div>
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.15em", marginBottom: 12 }}>LIVE EXAMPLES</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {examples.map((e, i) => (
            <button key={i} onClick={() => setExample(i)} style={{ background: example === i ? e.color : "transparent", border: `1px solid ${example === i ? e.color : "#1e293b"}`, color: example === i ? "#060c14" : "#475569", padding: "6px 14px", fontFamily: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 2, fontWeight: example === i ? 600 : 400 }}>{e.label}</button>
          ))}
        </div>
        <div style={{ padding: "20px 24px", background: "#0a0f18", border: `1px solid ${ex.color}33`, borderLeft: `3px solid ${ex.color}`, borderRadius: 4 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569", marginBottom: 8 }}><span>0¢</span><span>25¢</span><span>50¢</span><span>75¢</span><span>100¢</span></div>
            <div style={{ position: "relative", height: 32, background: "#060c14", borderRadius: 3, border: "1px solid #1e293b" }}>
              <div style={{ position: "absolute", left: `${ex.kalshiProb}%`, top: 0, bottom: 0, width: 2, background: "#475569" }}>
                <div style={{ position: "absolute", top: -20, left: -20, fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>KALSHI {ex.kalshiProb}¢</div>
              </div>
              <div style={{ position: "absolute", left: `${ex.modelProb}%`, top: 0, bottom: 0, width: 2, background: ex.color }}>
                <div style={{ position: "absolute", top: -20, left: -20, fontSize: 10, color: ex.color, whiteSpace: "nowrap" }}>MODEL {ex.modelProb}¢</div>
              </div>
              <div style={{ position: "absolute", left: `${Math.min(ex.kalshiProb, ex.modelProb)}%`, width: `${Math.abs(ex.modelProb - ex.kalshiProb)}%`, top: 4, bottom: 4, background: `${ex.color}44`, borderRadius: 2 }} />
            </div>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <span style={{ fontSize: 11, color: "#475569" }}>Edge gap: </span>
              <span style={{ fontSize: 18, color: ex.color, fontWeight: 700 }}>+{ex.edge} points</span>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: 8 }}>→ buy {ex.side} at {ex.kalshiProb}¢</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>{ex.description}</div>
        </div>
      </div>
      <div style={{ padding: "16px 20px", background: "#0a0f18", border: "1px solid #facc1522", borderRadius: 4 }}>
        <div style={{ fontSize: 10, color: "#facc15", letterSpacing: "0.15em", marginBottom: 10 }}>⚠ IMPORTANT</div>
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8 }}>Edge means you have a statistical advantage over time — not that any individual bet will win. Never bet more than you can afford to lose.</div>
      </div>
    </div>
  );
}

function ProbCompare({ modelProb, kalshiProb, side }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#94a3b8", marginBottom: 2 }}>MODEL</div>
        <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 15 }}>{Math.round(modelProb * 100)}c</div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ position: "relative", height: 6, background: "#1e293b", borderRadius: 3 }}>
          <div style={{ position: "absolute", left: `${Math.min(modelProb, kalshiProb) * 100}%`, width: `${Math.abs(modelProb - kalshiProb) * 100}%`, height: "100%", background: side === "YES" ? "#38bdf8" : "#fb923c", borderRadius: 3, opacity: 0.8 }} />
          <div style={{ position: "absolute", left: `${kalshiProb * 100}%`, transform: "translateX(-50%)", width: 2, height: "100%", background: "#94a3b8" }} />
          <div style={{ position: "absolute", left: `${modelProb * 100}%`, transform: "translateX(-50%)", width: 2, height: "100%", background: "#e2e8f0" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, color: "#475569", fontSize: 10 }}>
          <span>0</span><span>50</span><span>100</span>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#94a3b8", marginBottom: 2 }}>KALSHI</div>
        <div style={{ color: "#94a3b8", fontWeight: 600, fontSize: 15 }}>{Math.round(kalshiProb * 100)}c</div>
      </div>
    </div>
  );
}

function BetCard({ bet, onApprove, onReject }) {
  const [size, setSize] = useState(bet.recommendedSize || 25);
  const [expanded, setExpanded] = useState(false);
  const catColor = CATEGORY_COLOR[bet.category] || "#38bdf8";
  const qColor = QUALITY_COLOR(bet.qualityScore || 0);
  return (
    <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #0c1220 100%)", border: `1px solid ${catColor}33`, borderLeft: `3px solid ${catColor}`, borderRadius: 4, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ color: catColor, fontSize: 11, letterSpacing: "0.1em" }}>{CATEGORY_ICON[bet.category] || "◆"} {bet.strategy.toUpperCase()}</span>
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 2, background: `${CONFIDENCE_COLOR[bet.confidence] || "#facc15"}22`, color: CONFIDENCE_COLOR[bet.confidence] || "#facc15", border: `1px solid ${CONFIDENCE_COLOR[bet.confidence] || "#facc15"}44` }}>{bet.confidence}</span>
              <span style={{ fontSize: 10, color: "#475569" }}>{timeAgo(bet.timestamp)}</span>
            </div>
            <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 500, lineHeight: 1.4 }}>{bet.market}</div>
          </div>
          <div style={{ textAlign: "right", marginLeft: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 2, background: bet.side === "YES" ? "#0d2d1a" : "#2d0d0d", border: `1px solid ${bet.side === "YES" ? "#4ade8044" : "#f8717144"}`, color: bet.side === "YES" ? "#4ade80" : "#f87171", fontSize: 12, fontWeight: 700 }}>BUY {bet.side}</div>
            <div style={{ fontSize: 11, color: "#475569" }}>expires {bet.expiresIn}</div>
          </div>
        </div>
        <ProbCompare modelProb={bet.modelProb} kalshiProb={bet.kalshiProb} side={bet.side} />
        <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: "#475569" }}>EDGE</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 13, color: CONFIDENCE_COLOR[bet.confidence] || "#facc15", fontWeight: 600 }}>+{Math.round(bet.yourEdge * 100)}pts</div>
              <div style={{ height: 4, width: 50, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(bet.yourEdge * 500, 100)}%`, height: "100%", background: CONFIDENCE_COLOR[bet.confidence] || "#facc15" }} />
              </div>
            </div>
          </div>
          {bet.qualityScore !== undefined && (
            <div>
              <div style={{ fontSize: 10, color: "#475569" }}>QUALITY</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: qColor }}>{bet.qualityLabel}</div>
                <div style={{ fontSize: 10, color: "#334155" }}>{bet.qualityScore}/100</div>
              </div>
            </div>
          )}
          <div><div style={{ fontSize: 10, color: "#475569" }}>SIZE</div><div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>${size}</div></div>
          <div><div style={{ fontSize: 10, color: "#475569" }}>SOURCE</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{bet.dataSource}</div></div>
          <div style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>{expanded ? "▲ less" : "▼ more"}</div>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid #1e293b" }}>
          <div style={{ paddingTop: 12, fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 12 }}>💡 {bet.reasoning}</div>
          {bet.qualityScore !== undefined && (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: "#060c14", border: `1px solid ${qColor}33`, borderRadius: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "#475569" }}>SIGNAL QUALITY</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: qColor }}>{bet.qualityLabel} — {bet.qualityScore}/100</div>
              </div>
              <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${bet.qualityScore}%`, height: "100%", background: qColor, transition: "width 0.6s ease" }} />
              </div>
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
              <span>Bet size</span>
              <span style={{ color: "#e2e8f0" }}>${size} <span style={{ color: "#475569" }}>(Kelly rec: ${bet.recommendedSize})</span></span>
            </div>
            <input type="range" min={5} max={bet.maxSize || 100} value={size} onChange={e => setSize(Number(e.target.value))} style={{ width: "100%", accentColor: catColor, cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#334155", marginTop: 2 }}><span>$5 min</span><span>${bet.maxSize || 100} max</span></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 12px", background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 3 }}>
            <div><div style={{ fontSize: 10, color: "#475569", marginBottom: 2 }}>IF WIN</div><div style={{ fontSize: 14, color: "#4ade80", fontWeight: 600 }}>+${Math.round(size * (1 / (bet.side === "YES" ? bet.kalshiProb : 1 - bet.kalshiProb) - 1))}</div></div>
            <div><div style={{ fontSize: 10, color: "#475569", marginBottom: 2 }}>IF LOSE</div><div style={{ fontSize: 14, color: "#f87171", fontWeight: 600 }}>-${size}</div></div>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid #1e293b" }}>
        <button onClick={() => onReject(bet.id)} style={{ background: "transparent", border: "none", borderRight: "1px solid #1e293b", color: "#475569", padding: "11px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}
          onMouseEnter={e => { e.target.style.background = "#1e0808"; e.target.style.color = "#f87171"; }}
          onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.color = "#475569"; }}>✕ SKIP</button>
        <button onClick={() => onApprove(bet.id, size)} style={{ background: "transparent", border: "none", color: "#38bdf8", padding: "11px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}
          onMouseEnter={e => { e.target.style.background = "#051a2e"; e.target.style.color = "#7dd3fc"; }}
          onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.color = "#38bdf8"; }}>✓ CONFIRM BET — ${size}</button>
      </div>
    </div>
  );
}

export default function KalshiBot() {
  const [bets, setBets] = useState([]);
  const [approved, setApproved] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [activeTab, setActiveTab] = useState("queue");
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState("all");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleScan = async () => {
    setScanning(true); setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/signals`);
      const data = await res.json();
      if (data.signals && data.signals.length > 0) {
        setBets(data.signals);
        showToast(`Found ${data.signals.length} signal${data.signals.length !== 1 ? "s" : ""}!`, "success");
      } else {
        showToast("No signals found right now", "neutral");
      }
    } catch (e) {
      setError("Could not reach backend: " + e.message);
    }
    setScanning(false);
  };

  const handleApprove = async (id, size) => {
    const bet = bets.find(b => b.id === id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/bet`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: bet.ticker, side: bet.side.toLowerCase(), dollarAmount: size }),
      });
      const data = await res.json();
      if (data.success) {
        setApproved(prev => [...prev, { ...bet, finalSize: size, approvedAt: Date.now() }]);
        setBets(prev => prev.filter(b => b.id !== id));
        showToast(`✓ Bet placed: ${bet.side} $${size}`, "success");
      } else {
        showToast(`Bet failed: ${data.error}`, "neutral");
      }
    } catch (e) {
      showToast("Could not place bet: " + e.message, "neutral");
    }
  };

  const handleReject = (id) => {
    const bet = bets.find(b => b.id === id);
    setRejected(prev => [...prev, { ...bet, rejectedAt: Date.now() }]);
    setBets(prev => prev.filter(b => b.id !== id));
    showToast("Skipped", "neutral");
  };

  const filteredBets = filter === "all" ? bets : bets.filter(b => b.category === filter);
  const totalApprovedValue = approved.reduce((s, b) => s + b.finalSize, 0);

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', 'Courier New', monospace", background: "#060c14", color: "#94a3b8", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .tab-btn { background:transparent; border:none; color:#475569; padding:10px 0; margin-right:24px; font-family:inherit; font-size:12px; letter-spacing:0.08em; cursor:pointer; border-bottom:2px solid transparent; transition:all 0.15s; }
        .tab-btn:hover { color:#94a3b8; }
        .tab-btn.active { color:#38bdf8; border-bottom-color:#38bdf8; }
        .filter-btn { background:transparent; border:1px solid #1e293b; padding:5px 12px; font-family:inherit; font-size:11px; cursor:pointer; transition:all 0.15s; border-radius:2px; color:#475569; }
        .filter-btn.active { color:#060c14; font-weight:600; }
      `}</style>

      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, padding: "10px 18px", background: toast.type === "success" ? "#0d2d1a" : "#0f172a", border: `1px solid ${toast.type === "success" ? "#4ade8066" : "#334155"}`, color: toast.type === "success" ? "#4ade80" : "#94a3b8", fontSize: 12, fontFamily: "inherit", borderRadius: 3, animation: "slideIn 0.25s ease" }}>
          {toast.msg}
        </div>
      )}

      <div style={{ borderBottom: "1px solid #0f1e30", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#07101a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div>
            <div style={{ fontSize: 9, color: "#1e4d7b", letterSpacing: "0.2em", marginBottom: 1 }}>KALSHI</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, color: "#e2e8f0", fontWeight: 700 }}>Signal Bot</div>
          </div>
          <div style={{ width: 1, height: 32, background: "#0f1e30" }} />
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "PENDING", value: bets.length, color: "#38bdf8" },
              { label: "PLACED", value: approved.length, color: "#4ade80" },
              { label: "SKIPPED", value: rejected.length, color: "#475569" },
              { label: "DEPLOYED", value: `$${totalApprovedValue}`, color: "#facc15" },
            ].map(stat => (
              <div key={stat.label}>
                <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.12em" }}>{stat.label}</div>
                <div style={{ fontSize: 16, color: stat.color, fontWeight: 600 }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#1e4d7b" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#38bdf8", animation: "pulse 2s infinite" }} />
            LIVE
          </div>
          <button onClick={handleScan} style={{ background: scanning ? "#0a1a2e" : "transparent", border: "1px solid #1e4d7b", color: "#38bdf8", padding: "7px 16px", fontFamily: "inherit", fontSize: 11, cursor: "pointer", letterSpacing: "0.08em", borderRadius: 2 }}>
            {scanning ? <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>◌</span> SCANNING...</span> : "⟳ SCAN FOR SIGNALS"}
          </button>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #0f1e30", padding: "0 28px", background: "#07101a" }}>
        <button className={`tab-btn${activeTab === "queue" ? " active" : ""}`} onClick={() => setActiveTab("queue")}>
          SIGNAL QUEUE {bets.length > 0 && <span style={{ color: "#38bdf8", marginLeft: 4 }}>({bets.length})</span>}
        </button>
        <button className={`tab-btn${activeTab === "auto" ? " active" : ""}`} onClick={() => setActiveTab("auto")}>
          AUTO-TRADE <span style={{ marginLeft: 4, fontSize: 9, color: "#4ade80" }}>● LIVE</span>
        </button>
        <button className={`tab-btn${activeTab === "history" ? " active" : ""}`} onClick={() => setActiveTab("history")}>HISTORY</button>
        <button className={`tab-btn${activeTab === "edge" ? " active" : ""}`} onClick={() => setActiveTab("edge")}>HOW EDGE WORKS</button>
      </div>

      <div style={{ padding: "20px 28px", maxWidth: 800 }}>
        {error && (
          <div style={{ padding: "12px 16px", marginBottom: 16, background: "#1a0808", border: "1px solid #f8717144", color: "#f87171", fontSize: 12, borderRadius: 3 }}>⚠ {error}</div>
        )}

        {activeTab === "queue" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#334155", marginRight: 4 }}>FILTER</span>
              {["all", "weather", "economic", "sports", "political"].map(cat => (
                <button key={cat} className={`filter-btn${filter === cat ? " active" : ""}`}
                  style={filter === cat ? { background: CATEGORY_COLOR[cat] || "#38bdf8", borderColor: CATEGORY_COLOR[cat] || "#38bdf8" } : {}}
                  onClick={() => setFilter(cat)}>
                  {cat === "all" ? "ALL" : `${CATEGORY_ICON[cat]} ${cat.toUpperCase()}`}
                </button>
              ))}
            </div>
            {filteredBets.length === 0 ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12, color: "#1e293b" }}>◌</div>
                <div style={{ fontSize: 13, color: "#334155", marginBottom: 8 }}>No signals yet</div>
                <div style={{ fontSize: 11, color: "#1e293b", marginBottom: 16 }}>Click Scan or check the Auto-Trade tab to see what the bot has been doing</div>
              </div>
            ) : (
              filteredBets.map(bet => <BetCard key={bet.id} bet={bet} onApprove={handleApprove} onReject={handleReject} />)
            )}
          </div>
        )}

        {activeTab === "auto" && <AutoTradePanel />}

        {activeTab === "history" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            {approved.length === 0 && rejected.length === 0 ? (
              <div style={{ padding: "48px 0", textAlign: "center", color: "#334155", fontSize: 13 }}>No manual bet history yet.</div>
            ) : (
              <>
                {approved.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.12em", marginBottom: 12 }}>CONFIRMED BETS</div>
                    {approved.map(b => (
                      <div key={b.id} style={{ padding: "12px 16px", marginBottom: 8, background: "#0a1a0f", border: "1px solid #4ade8022", borderLeft: "3px solid #4ade80", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 3 }}>{b.market}</div>
                          <div style={{ fontSize: 11, color: "#4ade8099" }}>BUY {b.side} · {b.strategy}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 14, color: "#4ade80", fontWeight: 600 }}>${b.finalSize}</div>
                          <div style={{ fontSize: 10, color: "#334155" }}>{timeAgo(b.approvedAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {rejected.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", marginBottom: 12 }}>SKIPPED</div>
                    {rejected.map(b => (
                      <div key={b.id} style={{ padding: "12px 16px", marginBottom: 8, background: "#0a0f14", border: "1px solid #1e293b", borderLeft: "3px solid #1e293b", display: "flex", justifyContent: "space-between", opacity: 0.6 }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 3 }}>{b.market}</div>
                          <div style={{ fontSize: 11, color: "#334155" }}>{b.strategy}</div>
                        </div>
                        <div style={{ fontSize: 10, color: "#334155" }}>{timeAgo(b.rejectedAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "edge" && <EdgeExplainer />}
      </div>
    </div>
  );
}
