import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function fmt(n) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function PnLCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [trades, setTrades] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ pnl: "", trades: "" });

  // Load all trades from Supabase on mount
  useEffect(() => {
    async function loadTrades() {
      setLoading(true);
      const { data, error } = await supabase.from("trades").select("*");
      if (!error && data) {
        const map = {};
        data.forEach(row => { map[row.id] = { pnl: row.pnl, trades: row.trade_count }; });
        setTrades(map);
      }
      setLoading(false);
    }
    loadTrades();
  }, []);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthKey = (d) => `${year}-${String(month + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const stats = useMemo(() => {
    let totalPnl = 0, wins = 0, losses = 0, totalTrades = 0;
    Object.keys(trades).forEach(k => {
      const [y, m] = k.split("-").map(Number);
      if (y === year && m === month + 1) {
        totalPnl += trades[k].pnl;
        totalTrades += trades[k].trades;
        if (trades[k].pnl >= 0) wins++; else losses++;
      }
    });
    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    return { totalPnl, wins, losses, totalTrades, winRate };
  }, [trades, year, month]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function openModal(day) {
    const key = monthKey(day);
    const existing = trades[key];
    setForm({ pnl: existing ? existing.pnl : "", trades: existing ? existing.trades : "" });
    setModal({ day, key });
  }

  async function saveEntry() {
    const pnl = parseFloat(form.pnl);
    const t = parseInt(form.trades) || 1;
    if (isNaN(pnl)) return;
    setSaving(true);
    const { error } = await supabase.from("trades").upsert({
      id: modal.key,
      pnl,
      trade_count: t,
      date: modal.key,
    });
    if (!error) {
      setTrades(prev => ({ ...prev, [modal.key]: { pnl, trades: t } }));
    }
    setSaving(false);
    setModal(null);
  }

  async function deleteEntry() {
    setSaving(true);
    const { error } = await supabase.from("trades").delete().eq("id", modal.key);
    if (!error) {
      setTrades(prev => {
        const next = { ...prev };
        delete next[modal.key];
        return next;
      });
    }
    setSaving(false);
    setModal(null);
  }

  const pnlBg = (pnl) => pnl >= 0 ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)";
  const pnlBorder = (pnl) => pnl >= 0 ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(239,68,68,0.35)";
  const pnlText = (pnl) => pnl >= 0 ? "#4ade80" : "#f87171";

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0f", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 16px", boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "#6366f1", fontWeight: 600, marginBottom: 4 }}>
            Trading Journal
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#f8fafc", letterSpacing: "-0.5px" }}>
            P&amp;L Calendar
          </h1>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Net P&L", value: fmt(stats.totalPnl), color: stats.totalPnl >= 0 ? "#4ade80" : "#f87171" },
            { label: "Win Rate", value: `${stats.winRate}%`, color: "#a78bfa" },
            { label: "Trade Days", value: stats.wins + stats.losses, color: "#94a3b8" },
            { label: "Total Trades", value: stats.totalTrades, color: "#94a3b8" },
          ].map(s => (
            <div key={s.label} style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Month nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <button onClick={prevMonth} style={navBtn}>‹</button>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#e2e8f0" }}>{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} style={navBtn}>›</button>
        </div>

        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, color: "#475569", fontWeight: 600, letterSpacing: "0.08em", paddingBottom: 6 }}>{d}</div>
          ))}
        </div>

        {/* Calendar */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#475569", fontSize: 14 }}>Loading your trades...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} />;
              const key = monthKey(day);
              const entry = trades[key];
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              return (
                <div key={key} onClick={() => openModal(day)} style={{
                  minHeight: 72, borderRadius: 8, padding: "8px 7px 6px",
                  background: entry ? pnlBg(entry.pnl) : "#12121a",
                  border: entry ? pnlBorder(entry.pnl) : isToday ? "1px solid #6366f1" : "1px solid #1e1e2e",
                  cursor: "pointer", boxSizing: "border-box", position: "relative",
                  transition: "opacity 0.15s",
                }}>
                  <div style={{ fontSize: 11, color: isToday ? "#818cf8" : "#475569", fontWeight: isToday ? 700 : 500, marginBottom: 6 }}>
                    {String(day).padStart(2, "0")}
                  </div>
                  {entry && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: pnlText(entry.pnl), fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                        {fmt(entry.pnl)}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>
                        {entry.trades} {entry.trades === 1 ? "trade" : "trades"}
                      </div>
                    </>
                  )}
                  {!entry && (
                    <div style={{ position: "absolute", bottom: 8, right: 8, fontSize: 16, color: "#1e1e2e" }}>+</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p style={{ fontSize: 12, color: "#334155", textAlign: "center", marginTop: 18 }}>Tap any day to log a trade</p>
      </div>

      {/* Modal */}
      {modal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
        }} onClick={() => setModal(null)}>
          <div style={{
            background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 16,
            padding: 24, width: "100%", maxWidth: 340,
          }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#f8fafc" }}>
              {MONTHS[month]} {modal.day}, {year}
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 12, color: "#475569" }}>Log your trade result</p>

            <label style={labelStyle}>P&L ($)</label>
            <input
              type="number" step="0.01" placeholder="e.g. 250.00 or -120.50"
              value={form.pnl} onChange={e => setForm(f => ({ ...f, pnl: e.target.value }))}
              style={inputStyle} autoFocus
            />

            <label style={labelStyle}>Number of Trades</label>
            <input
              type="number" min="1" placeholder="1"
              value={form.trades} onChange={e => setForm(f => ({ ...f, trades: e.target.value }))}
              style={inputStyle}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveEntry} disabled={saving} style={{
                flex: 1, background: "#6366f1", color: "#fff", border: "none",
                borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
              }}>{saving ? "Saving..." : "Save"}</button>
              {trades[modal.key] && (
                <button onClick={deleteEntry} disabled={saving} style={{
                  background: "rgba(239,68,68,0.15)", color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8,
                  padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>Delete</button>
              )}
              <button onClick={() => setModal(null)} style={{
                background: "#1e1e2e", color: "#94a3b8", border: "1px solid #2d2d3f",
                borderRadius: 8, padding: "11px 16px", fontSize: 14, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn = {
  background: "#12121a", border: "1px solid #1e1e2e", color: "#94a3b8",
  borderRadius: 8, width: 36, height: 36, fontSize: 20, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
const labelStyle = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#64748b",
  letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6,
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", background: "#0a0a0f",
  border: "1px solid #1e1e2e", borderRadius: 8, padding: "10px 12px",
  color: "#e2e8f0", fontSize: 15, marginBottom: 14, outline: "none", fontFamily: "inherit",
};
