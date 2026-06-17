import { useState, useMemo, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const PAIRS = ["NQ","ES","MNQ","MES","GC","CL","EUR/USD","GBP/USD","BTC/USD","ETH/USD","Other"];

function fmt(n) { return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`; }
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDay(y, m) { return new Date(y, m, 1).getDay(); }
function dayKey(y, m, d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

function useCountUp(target, dur = 700) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current, diff = target - start, t0 = performance.now();
    const tick = now => {
      const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1-p, 3);
      setV(start + diff * e);
      if (p < 1) requestAnimationFrame(tick); else { setV(target); prev.current = target; }
    };
    requestAnimationFrame(tick);
  }, [target]);
  return v;
}

function EquityCurve({ days, trades }) {
  const svgRef = useRef(null);
  const points = useMemo(() => {
    let running = 0;
    const pts = [{ d: 0, v: 0 }];
    for (let d = 1; d <= days.total; d++) {
      const key = days.keyFn(d);
      if (trades[key]) running += trades[key].totalPnl || 0;
      pts.push({ d, v: running });
    }
    return pts;
  }, [trades, days]);

  const W = 580, H = 80;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const toX = d => (d / days.total) * W;
  const toY = v => H - 8 - ((v - min) / range) * (H - 16);
  const poly = points.map(p => `${toX(p.d)},${toY(p.v)}`).join(" ");
  const area = `${toX(0)},${H} ${poly} ${toX(days.total)},${H}`;
  const lastVal = vals[vals.length - 1];
  const color = lastVal >= 0 ? "#00ff88" : "#ff4444";

  useEffect(() => {
    const el = svgRef.current?.querySelector(".cl");
    if (!el) return;
    const len = el.getTotalLength?.() || 600;
    el.style.strokeDasharray = len;
    el.style.strokeDashoffset = len;
    el.style.transition = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)";
      el.style.strokeDashoffset = 0;
    }));
  }, [poly]);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      <polyline points={area} fill="url(#cg)" stroke="none"/>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" className="cl"/>
    </svg>
  );
}

function ImageViewer({ src, onClose }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.95)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16, cursor:"zoom-out" }}>
      <img src={src} style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:8, objectFit:"contain" }} onClick={e=>e.stopPropagation()}/>
      <button onClick={onClose} style={{ position:"absolute", top:16, right:16, background:"#222", border:"none", color:"#aaa", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>✕ CLOSE</button>
    </div>
  );
}

function DayDetail({ dayKey, account, onClose, onSaved }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedImg, setExpandedImg] = useState(null);
  const fileRefs = useRef({});

  useEffect(() => {
    supabase.from("trade_rows").select("*").eq("day_key", dayKey).eq("account", account).order("id").then(({ data }) => {
      setRows(data?.length ? data : [newRow()]);
      setLoading(false);
    });
  }, [dayKey, account]);

  function newRow() {
    return { id: Date.now() + Math.random(), day_key: dayKey, account, pair: "", bias: "bullish", rr: "", outcome: "win", profit: "", image_url: "", _new: true };
  }

  function updateRow(id, field, val) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val, _dirty: true } : r));
  }

  async function handleImage(id, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => updateRow(id, "image_url", e.target.result);
    reader.readAsDataURL(file);
  }

  async function saveAll() {
    setSaving(true);
    const validRows = rows.filter(r => r.pair || r.profit);
    for (const r of validRows) {
      const payload = { day_key: r.day_key, account: r.account, pair: r.pair, bias: r.bias, rr: r.rr, outcome: r.outcome, profit: parseFloat(r.profit) || 0, image_url: r.image_url || "" };
      if (r._new) {
        const { data } = await supabase.from("trade_rows").insert(payload).select().single();
        if (data) Object.assign(r, data, { _new: false, _dirty: false });
      } else if (r._dirty) {
        await supabase.from("trade_rows").update(payload).eq("id", r.id);
        r._dirty = false;
      }
    }
    const totalPnl = validRows.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);
    const wins = validRows.filter(r => r.outcome === "win").length;
    const tradeCount = validRows.length;
    await supabase.from("trades").upsert({ id: dayKey, account, pnl: totalPnl, trade_count: tradeCount, date: dayKey, wins, losses: tradeCount - wins });
    setSaving(false);
    onSaved({ totalPnl, tradeCount, wins });
  }

  async function deleteRow(id) {
    const r = rows.find(x => x.id === id);
    if (!r._new) await supabase.from("trade_rows").delete().eq("id", id);
    setRows(prev => prev.filter(x => x.id !== id));
  }

  const totalPnl = rows.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);
  const wins = rows.filter(r => r.outcome === "win" && r.profit).length;
  const total = rows.filter(r => r.profit).length;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;

  const [,mm,dd] = dayKey.split("-");
  const label = `${MONTHS[parseInt(mm)-1]} ${parseInt(dd)}`;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:200, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 12px", overflowY:"auto" }}>
      {expandedImg && <ImageViewer src={expandedImg} onClose={() => setExpandedImg(null)}/>}
      <div style={{ background:"#0f0f0f", border:"0.5px solid #222", borderRadius:12, width:"100%", maxWidth:800, padding:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div>
            <div style={{ fontSize:10, color:"#444", letterSpacing:"0.12em", textTransform:"uppercase" }}>Daily breakdown</div>
            <div style={{ fontSize:18, fontWeight:700, color:"#e0e0e0" }}>{label}</div>
          </div>
          <button onClick={onClose} style={{ background:"#1a1a1a", border:"0.5px solid #222", color:"#555", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>✕ ESC</button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16 }}>
          {[
            { label:"Day P&L", value: fmt(totalPnl), color: totalPnl >= 0 ? "#00ff88" : "#ff4444" },
            { label:"Win %", value:`${winPct}%`, color:"#a78bfa" },
            { label:"Trades", value:total, color:"#888" },
          ].map(s => (
            <div key={s.label} style={{ background:"#141414", border:"0.5px solid #1e1e1e", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#444", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {loading ? <div style={{ textAlign:"center", padding:32, color:"#333", fontSize:11 }}>LOADING...</div> : (
          <>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:"0 4px", fontSize:12 }}>
                <thead>
                  <tr>
                    {["Pair","Bias","RR","Outcome","Profit ($)","Chart",""].map(h => (
                      <th key={h} style={{ textAlign:"left", fontSize:9, color:"#444", letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 6px 6px", fontWeight:500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ padding:"0 4px 0 0" }}>
                        <input placeholder="e.g. NQ" value={r.pair} onChange={e => updateRow(r.id,"pair",e.target.value)} style={{ ...inputSt, width:80 }}/>
                      </td>
                      <td style={{ padding:"0 4px" }}>
                        <select value={r.bias} onChange={e => updateRow(r.id,"bias",e.target.value)} style={{ ...inputSt, color: r.bias==="bullish" ? "#00ff88" : "#ff4444" }}>
                          <option value="bullish">▲ Bull</option>
                          <option value="bearish">▼ Bear</option>
                        </select>
                      </td>
                      <td style={{ padding:"0 4px" }}>
                        <input placeholder="1:2" value={r.rr} onChange={e => updateRow(r.id,"rr",e.target.value)} style={{ ...inputSt, width:54 }}/>
                      </td>
                      <td style={{ padding:"0 4px" }}>
                        <div style={{ display:"flex", gap:4 }}>
                          {["win","loss"].map(o => (
                            <button key={o} onClick={() => updateRow(r.id,"outcome",o)} style={{ padding:"5px 8px", borderRadius:4, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700, background: r.outcome===o ? (o==="win" ? "rgba(0,255,136,0.25)" : "rgba(255,68,68,0.25)") : "#1a1a1a", color: r.outcome===o ? (o==="win" ? "#00ff88" : "#ff4444") : "#444" }}>
                              {o.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding:"0 4px" }}>
                        <input type="number" placeholder="0.00" value={r.profit} onChange={e => updateRow(r.id,"profit",e.target.value)} style={{ ...inputSt, width:80, color: parseFloat(r.profit) >= 0 ? "#00ff88" : "#ff4444" }}/>
                      </td>
                      <td style={{ padding:"0 4px" }}>
                        <input type="file" accept="image/*" ref={el => fileRefs.current[r.id] = el} style={{ display:"none" }} onChange={e => handleImage(r.id, e.target.files[0])}/>
                        {r.image_url ? (
                          <img src={r.image_url} onClick={() => setExpandedImg(r.image_url)} style={{ width:36, height:28, objectFit:"cover", borderRadius:4, cursor:"zoom-in", border:"0.5px solid #333" }}/>
                        ) : (
                          <button onClick={() => fileRefs.current[r.id]?.click()} style={{ background:"#1a1a1a", border:"0.5px solid #2a2a2a", color:"#444", borderRadius:4, padding:"5px 8px", cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>+IMG</button>
                        )}
                      </td>
                      <td style={{ padding:"0 0 0 4px" }}>
                        <button onClick={() => deleteRow(r.id)} style={{ background:"none", border:"none", color:"#333", cursor:"pointer", fontSize:14, padding:"4px" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display:"flex", gap:8, marginTop:14 }}>
              <button onClick={() => setRows(prev => [...prev, newRow()])} style={{ background:"#141414", border:"0.5px solid #222", color:"#555", borderRadius:6, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>+ ADD TRADE</button>
              <button onClick={saveAll} disabled={saving} style={{ background:"#00ff88", color:"#000", border:"none", borderRadius:6, padding:"8px 20px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, opacity: saving ? 0.7 : 1 }}>
                {saving ? "SAVING..." : "SAVE DAY"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputSt = { background:"#141414", border:"0.5px solid #222", borderRadius:4, padding:"6px 8px", color:"#e0e0e0", fontSize:12, outline:"none", fontFamily:"'JetBrains Mono',monospace", width:"100%" };

export default function App() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [trades, setTrades] = useState({});
  const [loading, setLoading] = useState(true);
  const [detailDay, setDetailDay] = useState(null);
  const [flashKey, setFlashKey] = useState(null);
  const [visible, setVisible] = useState(true);
  const [animating, setAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState(1);
  const [account, setAccount] = useState("demo");

  useEffect(() => {
    // Show cached data instantly
    const cacheKey = `trades_cache_${account}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { setTrades(JSON.parse(cached)); setLoading(false); } catch {}
    }
    // Then sync from Supabase in background
    supabase.from("trades").select("*").eq("account", account).then(({ data }) => {
      if (data) {
        const map = {};
        data.forEach(r => { map[r.id] = { totalPnl: r.pnl, tradeCount: r.trade_count, wins: r.wins || 0, losses: r.losses || 0 }; });
        setTrades(map);
        localStorage.setItem(cacheKey, JSON.stringify(map));
      }
      setLoading(false);
    });
  }, [account]);

  const mDays = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= mDays; d++) cells.push(d);

  const stats = useMemo(() => {
    let totalPnl = 0, greenDays = 0, redDays = 0, totalTrades = 0, streak = 0;
    for (let d = 1; d <= mDays; d++) {
      const k = dayKey(year, month, d);
      if (trades[k]) {
        totalPnl += trades[k].totalPnl || 0;
        totalTrades += trades[k].tradeCount || 0;
        if (trades[k].totalPnl >= 0) { greenDays++; streak++; } else { redDays++; streak = 0; }
      }
    }
    const greenPct = greenDays + redDays > 0 ? Math.round((greenDays / (greenDays + redDays)) * 100) : 0;
    return { totalPnl, greenDays, redDays, totalTrades, greenPct, streak };
  }, [trades, year, month, mDays]);

  const animPnl = useCountUp(stats.totalPnl);
  const animGP = useCountUp(stats.greenPct);

  const maxAbs = useMemo(() => {
    let m = 0;
    cells.forEach(d => { if (d) { const k = dayKey(year,month,d); if (trades[k]) m = Math.max(m, Math.abs(trades[k].totalPnl||0)); } });
    return m || 1;
  }, [trades, year, month]);

  function changeMonth(dir) {
    if (animating) return;
    setSlideDir(dir); setAnimating(true); setVisible(false);
    setTimeout(() => {
      if (dir === -1) { if (month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1); }
      else { if (month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1); }
      setVisible(true);
      setTimeout(() => setAnimating(false), 350);
    }, 220);
  }

  function handleDaySaved(d, data) {
    const k = dayKey(year, month, d);
    setTrades(prev => {
      const next = { ...prev, [k]: data };
      localStorage.setItem(`trades_cache_${account}`, JSON.stringify(next));
      return next;
    });
    setFlashKey(k);
    setTimeout(() => setFlashKey(null), 600);
  }

  const slideStyle = { transition:"opacity 0.22s ease, transform 0.22s ease", opacity: visible?1:0, transform: visible?"translateX(0)":`translateX(${slideDir===1?"-30px":"30px"})` };

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", color:"#e0e0e0", fontFamily:"'JetBrains Mono','Fira Code',monospace", padding:"20px 16px", boxSizing:"border-box" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0a0a0a;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes flashG{0%{box-shadow:0 0 0 0 rgba(0,255,136,0.6)}100%{box-shadow:0 0 0 10px rgba(0,255,136,0)}}
        @keyframes flashR{0%{box-shadow:0 0 0 0 rgba(255,68,68,0.6)}100%{box-shadow:0 0 0 10px rgba(255,68,68,0)}}
        input:focus,select:focus{border-color:#333!important;}
        select option{background:#141414;}
      `}</style>

      {detailDay && (
        <DayDetail
          dayKey={dayKey(year, month, detailDay)}
          account={account}
          onClose={() => setDetailDay(null)}
          onSaved={(data) => handleDaySaved(detailDay, data)}
        />
      )}

      <div style={{ maxWidth:780, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20 }}>
          <div>
            <div style={{ fontSize:10, color:"#444", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:2 }}>Trading Journal</div>
            <div style={{ fontSize:22, fontWeight:700, color:"#e0e0e0", letterSpacing:"-0.5px" }}>
              P&amp;L_CALENDAR<span style={{ color:"#00ff88", animation:"blink 1.2s step-end infinite" }}>_</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:4 }}>
            {["demo","funded"].map(a => (
              <button key={a} onClick={() => setAccount(a)} style={{ background: account===a ? (a==="funded"?"rgba(255,200,0,0.15)":"rgba(0,255,136,0.12)") : "#141414", border: account===a ? `0.5px solid ${a==="funded"?"rgba(255,200,0,0.4)":"rgba(0,255,136,0.3)"}` : "0.5px solid #222", color: account===a ? (a==="funded"?"#ffc800":"#00ff88") : "#444", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                {a==="funded"?"💰 Funded":"🧪 Demo"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
          {[
            { label:"Net P&L", value:`${animPnl>=0?"+":""}$${Math.abs(animPnl).toFixed(2)}`, color: stats.totalPnl>=0?"#00ff88":"#ff4444" },
            { label:"Green Days %", value:`${Math.round(animGP)}%`, color:"#a78bfa" },
            { label:"Win streak", value:`${stats.streak}d`, color:"#00ff88" },
            { label:"Trade days", value: stats.greenDays+stats.redDays, color:"#888" },
          ].map(s => (
            <div key={s.label} style={{ background:"#141414", border:"0.5px solid #1e1e1e", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#444", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:17, fontWeight:700, color:s.color, fontVariantNumeric:"tabular-nums" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background:"#111", border:"0.5px solid #1e1e1e", borderRadius:8, padding:"12px 14px", marginBottom:16 }}>
          <div style={{ fontSize:9, color:"#444", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:8 }}>Equity curve — {MONTHS[month]} {year}</div>
          <EquityCurve trades={trades} days={{ total: mDays, keyFn: d => dayKey(year,month,d) }}/>
        </div>

        <div style={slideStyle}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <button onClick={() => changeMonth(-1)} style={{ background:"#141414", border:"0.5px solid #222", color:"#666", borderRadius:6, width:32, height:32, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
            <span style={{ fontSize:13, fontWeight:700, color:"#888", letterSpacing:"0.1em", textTransform:"uppercase" }}>{MONTHS[month]} {year}</span>
            <button onClick={() => changeMonth(1)} style={{ background:"#141414", border:"0.5px solid #222", color:"#666", borderRadius:6, width:32, height:32, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign:"center", fontSize:9, color:"#333", letterSpacing:"0.1em", paddingBottom:4 }}>{d}</div>)}
          </div>

          {loading ? (
            <div style={{ textAlign:"center", padding:48, color:"#333", fontSize:11 }}>LOADING...</div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
              {cells.map((day, i) => {
                if (!day) return <div key={`e${i}`}/>;
                const k = dayKey(year, month, day);
                const entry = trades[k];
                const isToday = day===today.getDate() && month===today.getMonth() && year===today.getFullYear();
                const isFlashing = flashKey === k;
                const isWin = entry && entry.totalPnl >= 0;
                const barH = entry ? Math.max(4, (Math.abs(entry.totalPnl||0) / maxAbs) * 14) : 0;
                return (
                  <div key={k} onClick={() => setDetailDay(day)} style={{ minHeight:72, borderRadius:6, padding:"6px 6px 0", background: entry?(isWin?"rgba(0,255,136,0.08)":"rgba(255,68,68,0.08)"):"#111", border: entry?`0.5px solid ${isWin?"rgba(0,255,136,0.25)":"rgba(255,68,68,0.22)"}`:isToday?"0.5px solid #6366f1":"0.5px solid #1a1a1a", cursor:"pointer", boxSizing:"border-box", position:"relative", overflow:"hidden", animation: isFlashing?(isWin?"flashG 0.6s ease-out":"flashR 0.6s ease-out"):"none", transition:"border-color 0.15s" }}>
                    <div style={{ fontSize:10, color:isToday?"#6366f1":"#333", fontWeight:isToday?700:400 }}>{String(day).padStart(2,"0")}</div>
                    {entry && (
                      <>
                        <div style={{ fontSize:11, fontWeight:700, color:isWin?"#00ff88":"#ff4444", marginTop:4, fontVariantNumeric:"tabular-nums", lineHeight:1.2 }}>{fmt(entry.totalPnl||0)}</div>
                        <div style={{ fontSize:9, color:"#444", marginTop:1 }}>{entry.tradeCount}t · {entry.wins||0}W/{entry.losses||0}L</div>
                        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:barH, background:isWin?"rgba(0,255,136,0.25)":"rgba(255,68,68,0.22)", borderRadius:"0 0 6px 6px" }}/>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ fontSize:10, color:"#222", textAlign:"center", marginTop:14 }}>tap any day to view / log trades</div>
      </div>
    </div>
  );
}
