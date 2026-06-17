import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Pre-warm Supabase on page load (prevents cold start delay)
supabase.from("trades").select("id").limit(1);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function fmt(n) { return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`; }
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDay(y, m) { return new Date(y, m, 1).getDay(); }
function dayKey(y, m, d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function cacheKey(account) { return `pnl_trades_${account}`; }
function rowCacheKey(account) { return `pnl_rows_${account}`; }

function loadCache(key) {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : null; } catch { return null; }
}
function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function useCountUp(target, dur = 600) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const start = prev.current, diff = target - start, t0 = performance.now();
    if (diff === 0) return;
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

  const W = 580, H = 70;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const toX = d => (d / days.total) * W;
  const toY = v => H - 6 - ((v - min) / range) * (H - 12);
  const poly = points.map(p => `${toX(p.d)},${toY(p.v)}`).join(" ");
  const area = `${toX(0)},${H} ${poly} ${toX(days.total)},${H}`;
  const color = (vals[vals.length-1] || 0) >= 0 ? "#00ff88" : "#ff4444";

  useEffect(() => {
    const el = svgRef.current?.querySelector(".cl");
    if (!el) return;
    const len = el.getTotalLength?.() || 600;
    el.style.strokeDasharray = len;
    el.style.strokeDashoffset = len;
    el.style.transition = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "stroke-dashoffset 1s ease";
      el.style.strokeDashoffset = 0;
    }));
  }, [poly]);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:70 }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
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
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.96)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:16, cursor:"zoom-out" }}>
      <img src={src} style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:8, objectFit:"contain" }}/>
      <button onClick={onClose} style={{ position:"absolute", top:16, right:16, background:"#222", border:"none", color:"#aaa", borderRadius:6, padding:"6px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>✕ CLOSE</button>
    </div>
  );
}

const inputSt = { background:"#141414", border:"0.5px solid #222", borderRadius:4, padding:"6px 8px", color:"#e0e0e0", fontSize:12, outline:"none", fontFamily:"'JetBrains Mono',monospace", width:"100%" };

function DayDetail({ dk, account, allRows, onClose, onSaved }) {
  // Load rows instantly from the shared allRows cache
  const [rows, setRows] = useState(() => {
    const cached = (allRows || {})[dk] || [];
    return cached.length ? cached.map(r => ({ ...r })) : [newRow(dk, account)];
  });
  const [saving, setSaving] = useState(false);
  const [expandedImg, setExpandedImg] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const fileRefs = useRef({});

  // Background sync from Supabase (non-blocking)
  useEffect(() => {
    setSyncing(true);
    supabase.from("trade_rows").select("*").eq("day_key", dk).eq("account", account).order("id").then(({ data }) => {
      if (data && data.length) setRows(data.map(r => ({ ...r })));
      setSyncing(false);
    });
  }, [dk, account]);

  function newRow(dk, acc) {
    return { id: `new_${Date.now()}_${Math.random()}`, day_key: dk, account: acc, pair:"", bias:"bullish", rr:"", outcome:"win", profit:"", image_url:"", _new:true };
  }

  function updateRow(id, field, val) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val, _dirty:true } : r));
  }

  function handleImage(id, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => updateRow(id, "image_url", e.target.result);
    reader.readAsDataURL(file);
  }

  async function saveAll() {
    setSaving(true);
    const valid = rows.filter(r => r.pair || r.profit !== "");
    const saved = [];
    for (const r of valid) {
      const payload = { day_key: r.day_key, account: r.account, pair: r.pair, bias: r.bias, rr: r.rr, outcome: r.outcome, profit: parseFloat(r.profit) || 0, image_url: r.image_url || "" };
      if (String(r.id).startsWith("new_")) {
        const { data } = await supabase.from("trade_rows").insert(payload).select().single();
        saved.push(data || { ...payload, id: r.id });
      } else {
        await supabase.from("trade_rows").update(payload).eq("id", r.id);
        saved.push({ ...r, ...payload });
      }
    }
    const totalPnl = valid.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);
    const wins = valid.filter(r => r.outcome === "win").length;
    const tradeCount = valid.length;
    await supabase.from("trades").upsert({ id: dk, account, pnl: totalPnl, trade_count: tradeCount, date: dk, wins, losses: tradeCount - wins });
    setRows(saved);
    setSaving(false);
    onSaved({ totalPnl, tradeCount, wins, losses: tradeCount - wins }, saved);
  }

  async function deleteRow(id) {
    if (!String(id).startsWith("new_")) await supabase.from("trade_rows").delete().eq("id", id);
    setRows(prev => prev.filter(x => x.id !== id));
  }

  const totalPnl = rows.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0);
  const validRows = rows.filter(r => r.profit !== "");
  const wins = validRows.filter(r => r.outcome === "win").length;
  const winPct = validRows.length > 0 ? Math.round((wins / validRows.length) * 100) : 0;
  const [,mm,dd] = dk.split("-");
  const label = `${MONTHS[parseInt(mm)-1]} ${parseInt(dd)}`;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.93)", zIndex:200, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"16px 12px", overflowY:"auto" }}>
      {expandedImg && <ImageViewer src={expandedImg} onClose={() => setExpandedImg(null)}/>}
      <div style={{ background:"#0f0f0f", border:"0.5px solid #222", borderRadius:12, width:"100%", maxWidth:820, padding:18 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div>
            <div style={{ fontSize:9, color:"#444", letterSpacing:"0.12em", textTransform:"uppercase" }}>Daily breakdown {syncing ? "· syncing..." : ""}</div>
            <div style={{ fontSize:18, fontWeight:700, color:"#e0e0e0" }}>{label}</div>
          </div>
          <button onClick={onClose} style={{ background:"#1a1a1a", border:"0.5px solid #222", color:"#555", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>✕ ESC</button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
          {[
            { label:"Day P&L", value:fmt(totalPnl), color: totalPnl>=0?"#00ff88":"#ff4444" },
            { label:"Win %", value:`${winPct}%`, color:"#a78bfa" },
            { label:"Trades", value:validRows.length, color:"#888" },
          ].map(s => (
            <div key={s.label} style={{ background:"#141414", border:"0.5px solid #1e1e1e", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#444", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:3 }}>{s.label}</div>
              <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:"0 3px", fontSize:12, minWidth:560 }}>
            <thead>
              <tr>{["Pair","Bias","RR","Outcome","Profit ($)","Chart",""].map(h => (
                <th key={h} style={{ textAlign:"left", fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 5px 6px", fontWeight:500 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ padding:"0 3px 3px 0" }}>
                    <input placeholder="e.g. NQ" value={r.pair} onChange={e => updateRow(r.id,"pair",e.target.value)} style={{ ...inputSt, width:70 }}/>
                  </td>
                  <td style={{ padding:"0 3px 3px" }}>
                    <select value={r.bias} onChange={e => updateRow(r.id,"bias",e.target.value)} style={{ ...inputSt, width:90, color: r.bias==="bullish"?"#00ff88":"#ff4444" }}>
                      <option value="bullish">▲ Bull</option>
                      <option value="bearish">▼ Bear</option>
                    </select>
                  </td>
                  <td style={{ padding:"0 3px 3px" }}>
                    <input placeholder="1:2" value={r.rr} onChange={e => updateRow(r.id,"rr",e.target.value)} style={{ ...inputSt, width:52 }}/>
                  </td>
                  <td style={{ padding:"0 3px 3px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      {["win","loss"].map(o => (
                        <button key={o} onClick={() => updateRow(r.id,"outcome",o)} style={{ padding:"5px 7px", borderRadius:4, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700, background: r.outcome===o?(o==="win"?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"):"#1a1a1a", color: r.outcome===o?(o==="win"?"#00ff88":"#ff4444"):"#333" }}>
                          {o.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding:"0 3px 3px" }}>
                    <input type="number" placeholder="0.00" value={r.profit} onChange={e => updateRow(r.id,"profit",e.target.value)} style={{ ...inputSt, width:80, color: parseFloat(r.profit)>=0?"#00ff88":"#ff4444" }}/>
                  </td>
                  <td style={{ padding:"0 3px 3px" }}>
                    <input type="file" accept="image/*" ref={el => fileRefs.current[r.id]=el} style={{ display:"none" }} onChange={e => handleImage(r.id, e.target.files[0])}/>
                    {r.image_url
                      ? <img src={r.image_url} onClick={() => setExpandedImg(r.image_url)} style={{ width:36, height:28, objectFit:"cover", borderRadius:4, cursor:"zoom-in", border:"0.5px solid #333" }}/>
                      : <button onClick={() => fileRefs.current[r.id]?.click()} style={{ background:"#1a1a1a", border:"0.5px solid #222", color:"#444", borderRadius:4, padding:"5px 7px", cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>+IMG</button>
                    }
                  </td>
                  <td style={{ padding:"0 0 3px 3px" }}>
                    <button onClick={() => deleteRow(r.id)} style={{ background:"none", border:"none", color:"#2a2a2a", cursor:"pointer", fontSize:14 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button onClick={() => setRows(prev => [...prev, newRow(dk, account)])} style={{ background:"#141414", border:"0.5px solid #222", color:"#555", borderRadius:6, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>+ ADD TRADE</button>
          <button onClick={saveAll} disabled={saving} style={{ background:"#00ff88", color:"#000", border:"none", borderRadius:6, padding:"8px 20px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, opacity:saving?0.7:1 }}>
            {saving?"SAVING...":"SAVE DAY"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [account, setAccount] = useState("demo");

  // Load from cache instantly, sync in background
  const [trades, setTrades] = useState(() => loadCache(cacheKey("demo")) || {});
  const [allRows, setAllRows] = useState(() => loadCache(rowCacheKey("demo")) || {});
  const [synced, setSynced] = useState(false);
  const [detailDay, setDetailDay] = useState(null);
  const [flashKey, setFlashKey] = useState(null);
  const [visible, setVisible] = useState(true);
  const [animating, setAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState(1);

  // Single query to fetch ALL data at once
  useEffect(() => {
    const cached = loadCache(cacheKey(account));
    if (cached) setTrades(cached);
    const rowsCached = loadCache(rowCacheKey(account));
    if (rowsCached) setAllRows(rowsCached);
    setSynced(false);

    // Fetch everything in parallel — one round trip each
    Promise.all([
      supabase.from("trades").select("*").eq("account", account),
      supabase.from("trade_rows").select("*").eq("account", account)
    ]).then(([{ data: tData }, { data: rData }]) => {
      if (tData) {
        const map = {};
        tData.forEach(r => { map[r.id] = { totalPnl: r.pnl, tradeCount: r.trade_count, wins: r.wins||0, losses: r.losses||0 }; });
        setTrades(map);
        saveCache(cacheKey(account), map);
      }
      if (rData) {
        const map = {};
        rData.forEach(r => {
          if (!map[r.day_key]) map[r.day_key] = [];
          map[r.day_key].push(r);
        });
        setAllRows(map);
        saveCache(rowCacheKey(account), map);
      }
      setSynced(true);
    });
  }, [account]);

  const mDays = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const cells = useMemo(() => {
    const c = [];
    for (let i = 0; i < firstDay; i++) c.push(null);
    for (let d = 1; d <= mDays; d++) c.push(d);
    return c;
  }, [year, month]);

  const stats = useMemo(() => {
    let totalPnl=0, greenDays=0, redDays=0, streak=0;
    for (let d=1; d<=mDays; d++) {
      const k = dayKey(year,month,d);
      if (trades[k]) {
        totalPnl += trades[k].totalPnl||0;
        if (trades[k].totalPnl>=0) { greenDays++; streak++; } else { redDays++; streak=0; }
      }
    }
    const greenPct = greenDays+redDays>0 ? Math.round((greenDays/(greenDays+redDays))*100) : 0;
    return { totalPnl, greenDays, redDays, greenPct, streak };
  }, [trades, year, month, mDays]);

  const animPnl = useCountUp(stats.totalPnl);
  const animGP = useCountUp(stats.greenPct);

  const maxAbs = useMemo(() => {
    let m=0;
    cells.forEach(d => { if(d){ const k=dayKey(year,month,d); if(trades[k]) m=Math.max(m,Math.abs(trades[k].totalPnl||0)); } });
    return m||1;
  }, [trades, year, month]);

  function changeMonth(dir) {
    if (animating) return;
    setSlideDir(dir); setAnimating(true); setVisible(false);
    setTimeout(() => {
      if (dir===-1) { if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1); }
      else { if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1); }
      setVisible(true);
      setTimeout(() => setAnimating(false), 300);
    }, 200);
  }

  function handleDaySaved(d, data, savedRows) {
    const k = dayKey(year, month, d);
    setTrades(prev => {
      const next = { ...prev, [k]: data };
      saveCache(cacheKey(account), next);
      return next;
    });
    setAllRows(prev => {
      const next = { ...prev, [k]: savedRows };
      saveCache(rowCacheKey(account), next);
      return next;
    });
    setFlashKey(k);
    setTimeout(() => setFlashKey(null), 600);
  }

  const slideStyle = { transition:"opacity 0.2s ease, transform 0.2s ease", opacity:visible?1:0, transform:visible?"translateX(0)":`translateX(${slideDir===1?"-24px":"24px"})` };

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", color:"#e0e0e0", fontFamily:"'JetBrains Mono','Fira Code',monospace", padding:"18px 14px", boxSizing:"border-box" }}>
      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes flashG{0%{box-shadow:0 0 0 0 rgba(0,255,136,0.5)}100%{box-shadow:0 0 0 8px rgba(0,255,136,0)}}
        @keyframes flashR{0%{box-shadow:0 0 0 0 rgba(255,68,68,0.5)}100%{box-shadow:0 0 0 8px rgba(255,68,68,0)}}
        input:focus,select:focus{border-color:#333!important;outline:none;}
        select option{background:#141414;}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0a0a0a}
        ::-webkit-scrollbar-thumb{background:#222;border-radius:2px}
      `}</style>

      {detailDay && (
        <DayDetail
          dk={dayKey(year,month,detailDay)}
          account={account}
          allRows={allRows}
          onClose={() => setDetailDay(null)}
          onSaved={(data, savedRows) => handleDaySaved(detailDay, data, savedRows)}
        />
      )}

      <div style={{ maxWidth:780, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:18 }}>
          <div>
            <div style={{ fontSize:9, color:"#444", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:2 }}>
              Trading Journal {!synced && <span style={{ color:"#333" }}>· syncing</span>}
            </div>
            <div style={{ fontSize:20, fontWeight:700, color:"#e0e0e0" }}>
              P&amp;L_CALENDAR<span style={{ color:"#00ff88", animation:"blink 1.2s step-end infinite" }}>_</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:4 }}>
            {["demo","funded"].map(a => (
              <button key={a} onClick={() => setAccount(a)} style={{ background: account===a?(a==="funded"?"rgba(255,200,0,0.12)":"rgba(0,255,136,0.1)"):"#111", border: account===a?`0.5px solid ${a==="funded"?"rgba(255,200,0,0.35)":"rgba(0,255,136,0.25)"}`:"0.5px solid #1a1a1a", color: account===a?(a==="funded"?"#ffc800":"#00ff88"):"#333", borderRadius:6, padding:"6px 11px", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>
                {a==="funded"?"💰 Funded":"🧪 Demo"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
          {[
            { label:"Net P&L", value:`${animPnl>=0?"+":""}$${Math.abs(animPnl).toFixed(2)}`, color:stats.totalPnl>=0?"#00ff88":"#ff4444" },
            { label:"Green Days %", value:`${Math.round(animGP)}%`, color:"#a78bfa" },
            { label:"Win streak", value:`${stats.streak}d`, color:"#00ff88" },
            { label:"Trade days", value:stats.greenDays+stats.redDays, color:"#555" },
          ].map(s => (
            <div key={s.label} style={{ background:"#111", border:"0.5px solid #1a1a1a", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:3 }}>{s.label}</div>
              <div style={{ fontSize:16, fontWeight:700, color:s.color, fontVariantNumeric:"tabular-nums" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background:"#111", border:"0.5px solid #1a1a1a", borderRadius:8, padding:"10px 14px", marginBottom:14 }}>
          <div style={{ fontSize:9, color:"#333", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Equity curve — {MONTHS[month]} {year}</div>
          <EquityCurve trades={trades} days={{ total:mDays, keyFn: d => dayKey(year,month,d) }}/>
        </div>

        <div style={slideStyle}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <button onClick={() => changeMonth(-1)} style={{ background:"#111", border:"0.5px solid #1a1a1a", color:"#555", borderRadius:6, width:30, height:30, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
            <span style={{ fontSize:12, fontWeight:700, color:"#555", letterSpacing:"0.12em", textTransform:"uppercase" }}>{MONTHS[month]} {year}</span>
            <button onClick={() => changeMonth(1)} style={{ background:"#111", border:"0.5px solid #1a1a1a", color:"#555", borderRadius:6, width:30, height:30, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign:"center", fontSize:9, color:"#2a2a2a", letterSpacing:"0.1em", paddingBottom:3 }}>{d}</div>)}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`}/>;
              const k = dayKey(year,month,day);
              const entry = trades[k];
              const isToday = day===today.getDate() && month===today.getMonth() && year===today.getFullYear();
              const isWin = entry && (entry.totalPnl||0) >= 0;
              const barH = entry ? Math.max(3, (Math.abs(entry.totalPnl||0)/maxAbs)*12) : 0;
              return (
                <div key={k} onClick={() => setDetailDay(day)} style={{ minHeight:68, borderRadius:6, padding:"5px 5px 0", background:entry?(isWin?"rgba(0,255,136,0.07)":"rgba(255,68,68,0.07)"):"#111", border:entry?`0.5px solid ${isWin?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"}`:isToday?"0.5px solid #6366f1":"0.5px solid #161616", cursor:"pointer", boxSizing:"border-box", position:"relative", overflow:"hidden", animation:flashKey===k?(isWin?"flashG 0.6s ease-out":"flashR 0.6s ease-out"):"none", transition:"border-color 0.12s" }}>
                  <div style={{ fontSize:10, color:isToday?"#6366f1":"#2a2a2a", fontWeight:isToday?700:400 }}>{String(day).padStart(2,"0")}</div>
                  {entry && <>
                    <div style={{ fontSize:11, fontWeight:700, color:isWin?"#00ff88":"#ff4444", marginTop:3, fontVariantNumeric:"tabular-nums", lineHeight:1.2 }}>{fmt(entry.totalPnl||0)}</div>
                    <div style={{ fontSize:9, color:"#333", marginTop:1 }}>{entry.wins||0}W {entry.losses||0}L</div>
                    <div style={{ position:"absolute", bottom:0, left:0, right:0, height:barH, background:isWin?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.18)", borderRadius:"0 0 6px 6px" }}/>
                  </>}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize:9, color:"#1e1e1e", textAlign:"center", marginTop:12, letterSpacing:"0.1em" }}>TAP ANY DAY TO LOG TRADES</div>
      </div>
    </div>
  );
}
