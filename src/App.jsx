import { useState, useMemo, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function fmt(n) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDay(y, m) { return new Date(y, m, 1).getDay(); }

function useCountUp(target, duration = 800) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current;
    const diff = target - start;
    const startTime = performance.now();
    const tick = (now) => {
      const p = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(start + diff * ease);
      if (p < 1) requestAnimationFrame(tick);
      else { setVal(target); prev.current = target; }
    };
    requestAnimationFrame(tick);
  }, [target]);
  return val;
}

function EquityCurve({ trades, year, month }) {
  const svgRef = useRef(null);
  const points = useMemo(() => {
    const days = getDaysInMonth(year, month);
    let running = 0;
    const pts = [{ d: 0, v: 0 }];
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      if (trades[key]) running += trades[key].pnl;
      pts.push({ d, v: running });
    }
    return pts;
  }, [trades, year, month]);

  const W = 580, H = 80;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const toX = (d) => (d / (getDaysInMonth(year, month))) * W;
  const toY = (v) => H - 8 - ((v - min) / range) * (H - 16);
  const polyline = points.map(p => `${toX(p.d)},${toY(p.v)}`).join(" ");
  const area = `${toX(0)},${H} ${polyline} ${toX(getDaysInMonth(year,month))},${H}`;
  const lastVal = vals[vals.length - 1];
  const color = lastVal >= 0 ? "#00ff88" : "#ff4444";

  useEffect(() => {
    const el = svgRef.current?.querySelector(".curve-line");
    if (!el) return;
    const len = el.getTotalLength?.() || 600;
    el.style.strokeDasharray = len;
    el.style.strokeDashoffset = len;
    el.style.transition = "none";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)";
        el.style.strokeDashoffset = 0;
      });
    });
  }, [polyline]);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }}>
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      <polyline points={area} fill="url(#curveGrad)" stroke="none"/>
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" className="curve-line"/>
    </svg>
  );
}

export default function App() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [trades, setTrades] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ pnl: "", tradeCount: "" });
  const [flashKey, setFlashKey] = useState(null);
  const [slideDir, setSlideDir] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    supabase.from("trades").select("*").then(({ data }) => {
      if (data) {
        const map = {};
        data.forEach(r => { map[r.id] = { pnl: r.pnl, trades: r.trade_count }; });
        setTrades(map);
      }
      setLoading(false);
    });
  }, []);

  const monthKey = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const stats = useMemo(() => {
    let totalPnl = 0, wins = 0, losses = 0, totalTrades = 0, streak = 0, maxStreak = 0;
    const days = getDaysInMonth(year, month);
    for (let d = 1; d <= days; d++) {
      const k = monthKey(d);
      if (trades[k]) {
        totalPnl += trades[k].pnl;
        totalTrades += trades[k].trades;
        if (trades[k].pnl >= 0) { wins++; streak++; maxStreak = Math.max(maxStreak, streak); }
        else { losses++; streak = 0; }
      }
    }
    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    return { totalPnl, wins, losses, totalTrades, winRate, streak, maxStreak };
  }, [trades, year, month]);

  const animPnl = useCountUp(stats.totalPnl);
  const animWR = useCountUp(stats.winRate);

  function changeMonth(dir) {
    if (animating) return;
    setSlideDir(dir);
    setAnimating(true);
    setVisible(false);
    setTimeout(() => {
      if (dir === -1) {
        if (month === 0) { setYear(y => y - 1); setMonth(11); }
        else setMonth(m => m - 1);
      } else {
        if (month === 11) { setYear(y => y + 1); setMonth(0); }
        else setMonth(m => m + 1);
      }
      setVisible(true);
      setTimeout(() => setAnimating(false), 350);
    }, 220);
  }

  async function saveEntry() {
    const pnl = parseFloat(form.pnl);
    const t = parseInt(form.tradeCount) || 1;
    if (isNaN(pnl)) return;
    await supabase.from("trades").upsert({ id: modal.key, pnl, trade_count: t, date: modal.key });
    setTrades(prev => ({ ...prev, [modal.key]: { pnl, trades: t } }));
    setFlashKey(modal.key);
    setTimeout(() => setFlashKey(null), 600);
    setModal(null);
  }

  async function deleteEntry() {
    await supabase.from("trades").delete().eq("id", modal.key);
    setTrades(prev => { const n = { ...prev }; delete n[modal.key]; return n; });
    setModal(null);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const maxAbs = useMemo(() => {
    let m = 0;
    cells.forEach(d => { if (d) { const k = monthKey(d); if (trades[k]) m = Math.max(m, Math.abs(trades[k].pnl)); } });
    return m || 1;
  }, [trades, year, month]);

  const slideStyle = {
    transition: "opacity 0.22s ease, transform 0.22s ease",
    opacity: visible ? 1 : 0,
    transform: visible ? "translateX(0)" : `translateX(${slideDir === 1 ? "-30px" : "30px"})`,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e0e0e0", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: "20px 16px", boxSizing: "border-box", margin: 0 }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 2 }}>Trading Journal</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#e0e0e0", letterSpacing: "-0.5px" }}>
            P&amp;L_CALENDAR<span style={{ color: "#00ff88", animation: "blink 1.2s step-end infinite" }}>_</span>
          </div>
        </div>

        <style>{`
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
          @keyframes flashGreen { 0%{box-shadow:0 0 0 0 rgba(0,255,136,0.6)} 100%{box-shadow:0 0 0 8px rgba(0,255,136,0)} }
          @keyframes flashRed { 0%{box-shadow:0 0 0 0 rgba(255,68,68,0.6)} 100%{box-shadow:0 0 0 8px rgba(255,68,68,0)} }
        `}</style>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
          {[
            { label: "Net P&L", value: `${animPnl >= 0 ? "+" : ""}$${Math.abs(animPnl).toFixed(2)}`, color: stats.totalPnl >= 0 ? "#00ff88" : "#ff4444" },
            { label: "Win rate", value: `${Math.round(animWR)}%`, color: "#a78bfa" },
            { label: "Win streak", value: `${stats.streak} days`, color: "#00ff88" },
            { label: "Trade days", value: stats.wins + stats.losses, color: "#888" },
          ].map(s => (
            <div key={s.label} style={{ background: "#141414", border: "0.5px solid #1e1e1e", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#111", border: "0.5px solid #1e1e1e", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Equity curve — {MONTHS[month]} {year}</div>
          <EquityCurve trades={trades} year={year} month={month} />
        </div>

        <div style={slideStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <button onClick={() => changeMonth(-1)} style={{ background: "#141414", border: "0.5px solid #222", color: "#666", borderRadius: 6, width: 32, height: 32, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#888", letterSpacing: "0.1em", textTransform: "uppercase" }}>{MONTHS[month]} {year}</span>
            <button onClick={() => changeMonth(1)} style={{ background: "#141414", border: "0.5px solid #222", color: "#666", borderRadius: 6, width: 32, height: 32, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 9, color: "#333", letterSpacing: "0.1em", paddingBottom: 4 }}>{d}</div>)}
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 48, color: "#333", fontSize: 11 }}>LOADING...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
              {cells.map((day, i) => {
                if (!day) return <div key={`e${i}`}/>;
                const key = monthKey(day);
                const entry = trades[key];
                const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                const isFlashing = flashKey === key;
                const barH = entry ? Math.max(4, (Math.abs(entry.pnl) / maxAbs) * 14) : 0;
                const isWin = entry && entry.pnl >= 0;
                return (
                  <div key={key} onClick={() => { setModal({ day, key }); setForm({ pnl: entry?.pnl ?? "", tradeCount: entry?.trades ?? "" }); }}
                    style={{
                      minHeight: 68, borderRadius: 6, padding: "6px 6px 0",
                      background: entry ? (isWin ? "rgba(0,255,136,0.08)" : "rgba(255,68,68,0.08)") : "#111",
                      border: entry ? `0.5px solid ${isWin ? "rgba(0,255,136,0.25)" : "rgba(255,68,68,0.22)"}` : isToday ? "0.5px solid #6366f1" : "0.5px solid #1a1a1a",
                      cursor: "pointer", boxSizing: "border-box", position: "relative", overflow: "hidden",
                      animation: isFlashing ? (isWin ? "flashGreen 0.6s ease-out" : "flashRed 0.6s ease-out") : "none",
                      transition: "border-color 0.15s",
                    }}>
                    <div style={{ fontSize: 10, color: isToday ? "#6366f1" : "#333", fontWeight: isToday ? 700 : 400 }}>{String(day).padStart(2,"0")}</div>
                    {entry && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: isWin ? "#00ff88" : "#ff4444", marginTop: 4, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{fmt(entry.pnl)}</div>
                        <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>{entry.trades}t</div>
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: barH, background: isWin ? "rgba(0,255,136,0.25)" : "rgba(255,68,68,0.22)", borderRadius: "0 0 6px 6px" }}/>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#222", textAlign: "center", marginTop: 14 }}>tap any day to log a trade</div>
      </div>

      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setModal(null)}>
          <div style={{ background: "#111", border: "0.5px solid #222", borderRadius: 12, padding: 24, width: "100%", maxWidth: 320 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>{MONTHS[month]} {modal.day}, {year}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: "#e0e0e0" }}>Log trade</div>
            {[["P&L ($)", "pnl", "e.g. 250.00 or -120.50", "number"], ["No. of trades", "tradeCount", "1", "number"]].map(([label, field, ph, type]) => (
              <div key={field}>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                <input type={type} placeholder={ph} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", background: "#0a0a0a", border: "0.5px solid #222", borderRadius: 6, padding: "10px 12px", color: "#e0e0e0", fontSize: 14, marginBottom: 14, outline: "none", fontFamily: "inherit" }} autoFocus={field === "pnl"} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={saveEntry} style={{ flex: 1, background: "#00ff88", color: "#000", border: "none", borderRadius: 6, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>SAVE</button>
              {trades[modal.key] && <button onClick={deleteEntry} style={{ background: "rgba(255,68,68,0.12)", color: "#ff4444", border: "0.5px solid rgba(255,68,68,0.3)", borderRadius: 6, padding: "11px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>DEL</button>}
              <button onClick={() => setModal(null)} style={{ background: "#1a1a1a", color: "#555", border: "0.5px solid #222", borderRadius: 6, padding: "11px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ESC</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
