import { useState, useMemo, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────
// Supabase connection — paste your anon key between the quotes below.
// (Settings → API Keys → Legacy → "anon public", starts with eyJ...)
const SUPABASE_URL = "https://xucfcvzsfjxqvtwoqff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Y2Zjdnp2c2ZqeHF2dHdvcWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDIwODMsImV4cCI6MjA5NzIxODA4M30.zscwCygl4omKiUFTXbe-6TvvRhNLS-ezE7pkivJWy1Y";
// ─────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// pre-warm
supabase.from("accounts").select("id").limit(1);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function fmt(n) { return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`; }
function getDIM(y,m){ return new Date(y,m+1,0).getDate(); }
function getFD(y,m){ return new Date(y,m,1).getDay(); }
function dk(y,m,d){ return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function lsGet(k){ try{ const d=localStorage.getItem(k); return d?JSON.parse(d):null; }catch{ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} }

function useCountUp(target, dur=600){
  const [v,setV]=useState(target);
  const prev=useRef(target);
  useEffect(()=>{
    const start=prev.current,diff=target-start,t0=performance.now();
    if(!diff) return;
    const tick=now=>{
      const p=Math.min((now-t0)/dur,1),e=1-Math.pow(1-p,3);
      setV(start+diff*e);
      if(p<1) requestAnimationFrame(tick); else { setV(target); prev.current=target; }
    };
    requestAnimationFrame(tick);
  },[target]);
  return v;
}

function EquityCurve({ trades, year, month }){
  const svgRef=useRef(null);
  const total=getDIM(year,month);
  const points=useMemo(()=>{
    let run=0; const pts=[{d:0,v:0}];
    for(let d=1;d<=total;d++){
      const k=dk(year,month,d);
      if(trades[k]) run+=trades[k].totalPnl||0;
      pts.push({d,v:run});
    }
    return pts;
  },[trades,year,month]);
  const W=580,H=70,vals=points.map(p=>p.v);
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  const toX=d=>(d/total)*W;
  const toY=v=>H-6-((v-min)/range)*(H-12);
  const poly=points.map(p=>`${toX(p.d)},${toY(p.v)}`).join(" ");
  const area=`${toX(0)},${H} ${poly} ${toX(total)},${H}`;
  const color=(vals[vals.length-1]||0)>=0?"#00ff88":"#ff4444";
  useEffect(()=>{
    const el=svgRef.current?.querySelector(".cl");
    if(!el) return;
    const len=el.getTotalLength?.()||600;
    el.style.strokeDasharray=len; el.style.strokeDashoffset=len; el.style.transition="none";
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      el.style.transition="stroke-dashoffset 1s ease"; el.style.strokeDashoffset=0;
    }));
  },[poly]);
  return(
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:70}}>
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
        <stop offset="100%" stopColor={color} stopOpacity="0.01"/>
      </linearGradient></defs>
      <polyline points={area} fill="url(#cg)" stroke="none"/>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" className="cl"/>
    </svg>
  );
}

function ImageViewer({ src, onClose }){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.96)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16,cursor:"zoom-out"}}>
      <img src={src} style={{maxWidth:"100%",maxHeight:"90vh",borderRadius:8,objectFit:"contain"}}/>
      <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"#222",border:"none",color:"#aaa",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:11}}>✕ CLOSE</button>
    </div>
  );
}

const iSt={background:"#141414",border:"0.5px solid #222",borderRadius:4,padding:"6px 8px",color:"#e0e0e0",fontSize:12,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"};

function DayDetail({ dayKey, accountId, allRows, onClose, onSaved }){
  const [rows,setRows]=useState(()=>{
    const c=(allRows||{})[dayKey]||[];
    return c.length?c.map(r=>({...r})):[newRow()];
  });
  const [saving,setSaving]=useState(false);
  const [expandedImg,setExpandedImg]=useState(null);
  const [syncing,setSyncing]=useState(false);
  const [pasteTarget,setPasteTarget]=useState(null);
  const fileRefs=useRef({});

  useEffect(()=>{
    setSyncing(true);
    supabase.from("trade_rows").select("*").eq("day_key",dayKey).eq("account_id",accountId).order("id").then(({data})=>{
      if(data&&data.length) setRows(data.map(r=>({...r})));
      setSyncing(false);
    });
  },[dayKey,accountId]);

  useEffect(()=>{
    function onPaste(e){
      const items=e.clipboardData?.items;
      if(!items) return;
      for(const item of items){
        if(item.type.startsWith("image/")){
          const file=item.getAsFile();
          if(!file) return;
          const tid=pasteTarget||rows[rows.length-1]?.id;
          if(tid){ handleImage(tid,file); setPasteTarget(null); }
          break;
        }
      }
    }
    window.addEventListener("paste",onPaste);
    return ()=>window.removeEventListener("paste",onPaste);
  },[pasteTarget,rows]);

  function newRow(){ return {id:`new_${Date.now()}_${Math.random()}`,day_key:dayKey,account_id:accountId,pair:"",bias:"bullish",rr:"",outcome:"win",profit:"",image_url:"",trade_note:"",_new:true}; }
  function updateRow(id,f,v){ setRows(p=>p.map(r=>r.id===id?{...r,[f]:v,_dirty:true}:r)); }
  function handleImage(id,file){ const rd=new FileReader(); rd.onload=e=>updateRow(id,"image_url",e.target.result); rd.readAsDataURL(file); }

  async function saveAll(){
    setSaving(true);
    const valid=rows.filter(r=>r.pair||r.profit!=="");
    const saved=[];
    for(const r of valid){
      const payload={day_key:r.day_key,account_id:r.account_id,pair:r.pair,bias:r.bias,rr:r.rr,outcome:r.outcome,profit:parseFloat(r.profit)||0,image_url:r.image_url||"",trade_note:r.trade_note||""};
      if(String(r.id).startsWith("new_")){
        const {data}=await supabase.from("trade_rows").insert(payload).select().single();
        saved.push(data||{...payload,id:r.id});
      } else {
        await supabase.from("trade_rows").update(payload).eq("id",r.id);
        saved.push({...r,...payload});
      }
    }
    const totalPnl=valid.reduce((s,r)=>s+(parseFloat(r.profit)||0),0);
    const wins=valid.filter(r=>r.outcome==="win").length;
    const tradeCount=valid.length;
    if(tradeCount===0){
      // Delete the day entry so it goes grey
      await supabase.from("trades").delete().eq("day_key",dayKey).eq("account_id",accountId);
    } else {
      await supabase.from("trades").upsert({day_key:dayKey,account_id:accountId,pnl:totalPnl,trade_count:tradeCount,wins,losses:tradeCount-wins},{onConflict:"day_key,account_id"});
    }
    setSaving(false);
    onSaved({totalPnl,tradeCount,wins,losses:tradeCount-wins},saved,tradeCount===0);
  }

  async function deleteRow(id){
    if(!String(id).startsWith("new_")) await supabase.from("trade_rows").delete().eq("id",id);
    setRows(p=>p.filter(x=>x.id!==id));
  }

  const totalPnl=rows.reduce((s,r)=>s+(parseFloat(r.profit)||0),0);
  const validRows=rows.filter(r=>r.profit!=="");
  const wins=validRows.filter(r=>r.outcome==="win").length;
  const winPct=validRows.length>0?Math.round((wins/validRows.length)*100):0;
  const [,mm,dd]=dayKey.split("-");
  const label=`${MONTHS[parseInt(mm)-1]} ${parseInt(dd)}`;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.93)",zIndex:200,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"16px 12px",overflowY:"auto"}}>
      {expandedImg&&<ImageViewer src={expandedImg} onClose={()=>setExpandedImg(null)}/>}
      <div style={{background:"#0f0f0f",border:"0.5px solid #222",borderRadius:12,width:"100%",maxWidth:860,padding:18}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <div style={{fontSize:9,color:"#444",letterSpacing:"0.12em",textTransform:"uppercase"}}>Daily breakdown {syncing?"· syncing...":""}</div>
            <div style={{fontSize:18,fontWeight:700,color:"#e0e0e0"}}>{label}</div>
          </div>
          <button onClick={onClose} style={{background:"#1a1a1a",border:"0.5px solid #222",color:"#555",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11}}>✕ ESC</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
          {[{label:"Day P&L",value:fmt(totalPnl),color:totalPnl>=0?"#00ff88":"#ff4444"},{label:"Win %",value:`${winPct}%`,color:"#a78bfa"},{label:"Trades",value:validRows.length,color:"#888"}].map(s=>(
            <div key={s.label} style={{background:"#141414",border:"0.5px solid #1e1e1e",borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:9,color:"#444",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>{s.label}</div>
              <div style={{fontSize:18,fontWeight:700,color:s.color}}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:"0 3px",fontSize:12,minWidth:620}}>
            <thead><tr>{["Pair","Bias","RR","Outcome","Profit ($)","Notes","Chart",""].map(h=>(
              <th key={h} style={{textAlign:"left",fontSize:9,color:"#333",letterSpacing:"0.1em",textTransform:"uppercase",padding:"0 5px 6px",fontWeight:500}}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id}>
                  <td style={{padding:"0 3px 3px 0"}}><input placeholder="e.g. NQ" value={r.pair} onChange={e=>updateRow(r.id,"pair",e.target.value)} style={{...iSt,width:70}}/></td>
                  <td style={{padding:"0 3px 3px"}}>
                    <select value={r.bias} onChange={e=>updateRow(r.id,"bias",e.target.value)} style={{...iSt,width:90,color:r.bias==="bullish"?"#00ff88":"#ff4444"}}>
                      <option value="bullish">▲ Bull</option>
                      <option value="bearish">▼ Bear</option>
                    </select>
                  </td>
                  <td style={{padding:"0 3px 3px"}}><input placeholder="1:2" value={r.rr} onChange={e=>updateRow(r.id,"rr",e.target.value)} style={{...iSt,width:52}}/></td>
                  <td style={{padding:"0 3px 3px"}}>
                    <div style={{display:"flex",gap:3}}>
                      {["win","loss"].map(o=>(
                        <button key={o} onClick={()=>updateRow(r.id,"outcome",o)} style={{padding:"5px 7px",borderRadius:4,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,background:r.outcome===o?(o==="win"?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"):"#1a1a1a",color:r.outcome===o?(o==="win"?"#00ff88":"#ff4444"):"#333"}}>
                          {o.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td style={{padding:"0 3px 3px"}}><input type="number" placeholder="0.00" value={r.profit} onChange={e=>updateRow(r.id,"profit",e.target.value)} style={{...iSt,width:80,color:parseFloat(r.profit)>=0?"#00ff88":"#ff4444"}}/></td>
                  <td style={{padding:"0 3px 3px",minWidth:150}}>
                    <textarea placeholder="Trade notes..." value={r.trade_note||""} onChange={e=>updateRow(r.id,"trade_note",e.target.value)} rows={2} style={{width:"100%",background:"#141414",border:"0.5px solid #222",borderRadius:4,padding:"5px 7px",color:"#e0e0e0",fontSize:11,fontFamily:"'JetBrains Mono',monospace",resize:"none",outline:"none",lineHeight:1.4,boxSizing:"border-box"}}/>
                  </td>
                  <td style={{padding:"0 3px 3px"}}>
                    <input type="file" accept="image/*" ref={el=>fileRefs.current[r.id]=el} style={{display:"none"}} onChange={e=>handleImage(r.id,e.target.files[0])}/>
                    {r.image_url
                      ?<div style={{position:"relative",display:"inline-block"}}>
                        <img src={r.image_url} onClick={()=>setExpandedImg(r.image_url)} style={{width:36,height:28,objectFit:"cover",borderRadius:4,cursor:"zoom-in",border:"0.5px solid #333",display:"block"}}/>
                        <button onClick={()=>updateRow(r.id,"image_url","")} style={{position:"absolute",top:-4,right:-4,background:"#ff4444",border:"none",color:"#000",borderRadius:"50%",width:12,height:12,fontSize:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                      </div>
                      :<button onClick={()=>setPasteTarget(r.id)} title="Click then Ctrl+V" style={{background:pasteTarget===r.id?"rgba(0,255,136,0.15)":"#1a1a1a",border:pasteTarget===r.id?"0.5px solid rgba(0,255,136,0.5)":"0.5px solid #222",color:pasteTarget===r.id?"#00ff88":"#444",borderRadius:4,padding:"5px 7px",cursor:"pointer",fontSize:9,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        {pasteTarget===r.id?"⌘V NOW":"+IMG"}
                      </button>
                    }
                  </td>
                  <td style={{padding:"0 0 3px 3px"}}><button onClick={()=>deleteRow(r.id)} style={{background:"none",border:"none",color:"#2a2a2a",cursor:"pointer",fontSize:14}}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={()=>setRows(p=>[...p,newRow()])} style={{background:"#141414",border:"0.5px solid #222",color:"#555",borderRadius:6,padding:"8px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:11}}>+ ADD TRADE</button>
          <button onClick={saveAll} disabled={saving} style={{background:"#00ff88",color:"#000",border:"none",borderRadius:6,padding:"8px 20px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,opacity:saving?0.7:1}}>
            {saving?"SAVING...":"SAVE DAY"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const today=new Date();
  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [accounts,setAccounts]=useState(()=>lsGet("pnl_accounts")||[]);
  const [activeAccount,setActiveAccount]=useState(()=>lsGet("pnl_active")||null);
  const [trades,setTrades]=useState({});
  const [allRows,setAllRows]=useState({});
  const [detailDay,setDetailDay]=useState(null);
  const [flashKey,setFlashKey]=useState(null);
  const [visible,setVisible]=useState(true);
  const [animating,setAnimating]=useState(false);
  const [slideDir,setSlideDir]=useState(1);
  const [syncing,setSyncing]=useState(false);
  const [newAccName,setNewAccName]=useState("");
  const [showNewAcc,setShowNewAcc]=useState(false);

  // Load accounts from Supabase on mount
  useEffect(()=>{
    supabase.from("accounts").select("*").order("created_at").then(({data})=>{
      if(data&&data.length){
        setAccounts(data);
        lsSet("pnl_accounts",data);
        if(!activeAccount) { setActiveAccount(data[0].id); lsSet("pnl_active",data[0].id); }
      }
    });
  },[]);

  // Load trades when account changes
  useEffect(()=>{
    if(!activeAccount) return;
    const cached=lsGet(`pnl_t_${activeAccount}`);
    if(cached) setTrades(cached);
    const rowsCached=lsGet(`pnl_r_${activeAccount}`);
    if(rowsCached) setAllRows(rowsCached);
    setSyncing(true);
    Promise.all([
      supabase.from("trades").select("*").eq("account_id",activeAccount),
      supabase.from("trade_rows").select("*").eq("account_id",activeAccount)
    ]).then(([{data:tData},{data:rData}])=>{
      if(tData){
        const map={};
        tData.forEach(r=>{ map[r.day_key]={totalPnl:r.pnl,tradeCount:r.trade_count,wins:r.wins||0,losses:r.losses||0}; });
        setTrades(map); lsSet(`pnl_t_${activeAccount}`,map);
      }
      if(rData){
        const map={};
        rData.forEach(r=>{ if(!map[r.day_key]) map[r.day_key]=[]; map[r.day_key].push(r); });
        setAllRows(map); lsSet(`pnl_r_${activeAccount}`,map);
      }
      setSyncing(false);
    });
  },[activeAccount]);

  async function createAccount(){
    if(!newAccName.trim()) return;
    const {data}=await supabase.from("accounts").insert({name:newAccName.trim()}).select().single();
    if(data){
      const updated=[...accounts,data];
      setAccounts(updated); lsSet("pnl_accounts",updated);
      setActiveAccount(data.id); lsSet("pnl_active",data.id);
      setTrades({}); setAllRows({});
    }
    setNewAccName(""); setShowNewAcc(false);
  }

  async function deleteAccount(id){
    if(!window.confirm("Delete this account and all its trades?")) return;
    await supabase.from("trades").delete().eq("account_id",id);
    await supabase.from("trade_rows").delete().eq("account_id",id);
    await supabase.from("accounts").delete().eq("id",id);
    localStorage.removeItem(`pnl_t_${id}`);
    localStorage.removeItem(`pnl_r_${id}`);
    const updated=accounts.filter(a=>a.id!==id);
    setAccounts(updated); lsSet("pnl_accounts",updated);
    if(activeAccount===id){
      const next=updated[0]?.id||null;
      setActiveAccount(next); lsSet("pnl_active",next);
      setTrades({}); setAllRows({});
    }
  }

  const mDays=getDIM(year,month);
  const cells=useMemo(()=>{
    const c=[]; const fd=getFD(year,month);
    for(let i=0;i<fd;i++) c.push(null);
    for(let d=1;d<=mDays;d++) c.push(d);
    return c;
  },[year,month]);

  const stats=useMemo(()=>{
    let totalPnl=0,green=0,red=0,streak=0;
    for(let d=1;d<=mDays;d++){
      const k=dk(year,month,d);
      if(trades[k]){
        totalPnl+=trades[k].totalPnl||0;
        if(trades[k].totalPnl>=0){green++;streak++;}else{red++;streak=0;}
      }
    }
    return{totalPnl,green,red,greenPct:green+red>0?Math.round((green/(green+red))*100):0,streak};
  },[trades,year,month,mDays]);

  const animPnl=useCountUp(stats.totalPnl);
  const animGP=useCountUp(stats.greenPct);
  const maxAbs=useMemo(()=>{
    let m=0;
    cells.forEach(d=>{ if(d){ const k=dk(year,month,d); if(trades[k]) m=Math.max(m,Math.abs(trades[k].totalPnl||0)); } });
    return m||1;
  },[trades,year,month]);

  function changeMonth(dir){
    if(animating) return;
    setSlideDir(dir); setAnimating(true); setVisible(false);
    setTimeout(()=>{
      if(dir===-1){if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1);}
      else{if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1);}
      setVisible(true); setTimeout(()=>setAnimating(false),300);
    },200);
  }

  function handleDaySaved(d,data,savedRows,isEmpty){
    const k=dk(year,month,d);
    setTrades(prev=>{
      const next={...prev};
      if(isEmpty) delete next[k]; else next[k]=data;
      lsSet(`pnl_t_${activeAccount}`,next);
      return next;
    });
    setAllRows(prev=>{
      const next={...prev,[k]:savedRows};
      lsSet(`pnl_r_${activeAccount}`,next);
      return next;
    });
    setFlashKey(k); setTimeout(()=>setFlashKey(null),600);
  }

  const slideStyle={transition:"opacity 0.2s ease,transform 0.2s ease",opacity:visible?1:0,transform:visible?"translateX(0)":`translateX(${slideDir===1?"-24px":"24px"})`};
  const activeAcc=accounts.find(a=>a.id===activeAccount);

  return(
    <div style={{minHeight:"100vh",background:"#0a0a0a",color:"#e0e0e0",fontFamily:"'JetBrains Mono','Fira Code',monospace",padding:"18px 14px",boxSizing:"border-box"}}>
      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes flashG{0%{box-shadow:0 0 0 0 rgba(0,255,136,0.5)}100%{box-shadow:0 0 0 8px rgba(0,255,136,0)}}
        @keyframes flashR{0%{box-shadow:0 0 0 0 rgba(255,68,68,0.5)}100%{box-shadow:0 0 0 8px rgba(255,68,68,0)}}
        input:focus,select:focus,textarea:focus{border-color:#333!important;outline:none;}
        select option{background:#141414;}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0a0a0a}
        ::-webkit-scrollbar-thumb{background:#222;border-radius:2px}
      `}</style>

      {detailDay&&activeAccount&&(
        <DayDetail
          dayKey={dk(year,month,detailDay)}
          accountId={activeAccount}
          allRows={allRows}
          onClose={()=>setDetailDay(null)}
          onSaved={(data,savedRows,isEmpty)=>handleDaySaved(detailDay,data,savedRows,isEmpty)}
        />
      )}

      <div style={{maxWidth:800,margin:"0 auto"}}>
        {/* Header */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:9,color:"#444",letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:2}}>
            Trading Journal {syncing&&<span style={{color:"#333"}}>· syncing</span>}
          </div>
          <div style={{fontSize:20,fontWeight:700,color:"#e0e0e0"}}>
            P&amp;L_CALENDAR<span style={{color:"#00ff88",animation:"blink 1.2s step-end infinite"}}>_</span>
          </div>
        </div>

        {/* Account tabs */}
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
          {accounts.map(a=>(
            <div key={a.id} style={{display:"flex",alignItems:"center",gap:0}}>
              <button onClick={()=>{ setActiveAccount(a.id); lsSet("pnl_active",a.id); setTrades(lsGet(`pnl_t_${a.id}`)||{}); setAllRows(lsGet(`pnl_r_${a.id}`)||{}); }}
                style={{background:activeAccount===a.id?"rgba(99,102,241,0.2)":"#111",border:activeAccount===a.id?"0.5px solid rgba(99,102,241,0.5)":"0.5px solid #1a1a1a",color:activeAccount===a.id?"#818cf8":"#444",borderRadius:"6px 0 0 6px",padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:activeAccount===a.id?700:400}}>
                {a.name}
              </button>
              <button onClick={()=>deleteAccount(a.id)}
                style={{background:activeAccount===a.id?"rgba(99,102,241,0.1)":"#111",border:activeAccount===a.id?"0.5px solid rgba(99,102,241,0.5)":"0.5px solid #1a1a1a",borderLeft:"none",color:"#333",borderRadius:"0 6px 6px 0",padding:"7px 8px",cursor:"pointer",fontFamily:"inherit",fontSize:10,lineHeight:1}}>
                ✕
              </button>
            </div>
          ))}
          {showNewAcc?(
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <input autoFocus placeholder="Account name..." value={newAccName} onChange={e=>setNewAccName(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") createAccount(); if(e.key==="Escape") setShowNewAcc(false); }}
                style={{background:"#111",border:"0.5px solid #333",borderRadius:6,padding:"7px 10px",color:"#e0e0e0",fontSize:11,fontFamily:"inherit",outline:"none",width:160}}/>
              <button onClick={createAccount} style={{background:"#6366f1",border:"none",color:"#fff",borderRadius:6,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700}}>ADD</button>
              <button onClick={()=>setShowNewAcc(false)} style={{background:"#111",border:"0.5px solid #1a1a1a",color:"#444",borderRadius:6,padding:"7px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:11}}>✕</button>
            </div>
          ):(
            <button onClick={()=>setShowNewAcc(true)} style={{background:"#111",border:"0.5px solid #1a1a1a",color:"#444",borderRadius:6,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11}}>+ New Account</button>
          )}
        </div>

        {!activeAccount?(
          <div style={{textAlign:"center",padding:60,color:"#333",fontSize:12}}>Create an account to get started</div>
        ):(
          <>
            {/* Stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
              {[
                {label:"Net P&L",value:`${animPnl>=0?"+":""}$${Math.abs(animPnl).toFixed(2)}`,color:stats.totalPnl>=0?"#00ff88":"#ff4444"},
                {label:"Green Days %",value:`${Math.round(animGP)}%`,color:"#a78bfa"},
                {label:"Win streak",value:`${stats.streak}d`,color:"#00ff88"},
                {label:"Trade days",value:stats.green+stats.red,color:"#555"},
              ].map(s=>(
                <div key={s.label} style={{background:"#111",border:"0.5px solid #1a1a1a",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:"#333",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>{s.label}</div>
                  <div style={{fontSize:16,fontWeight:700,color:s.color,fontVariantNumeric:"tabular-nums"}}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Equity curve */}
            <div style={{background:"#111",border:"0.5px solid #1a1a1a",borderRadius:8,padding:"10px 14px",marginBottom:14}}>
              <div style={{fontSize:9,color:"#333",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Equity curve — {MONTHS[month]} {year}</div>
              <EquityCurve trades={trades} year={year} month={month}/>
            </div>

            {/* Calendar */}
            <div style={slideStyle}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <button onClick={()=>changeMonth(-1)} style={{background:"#111",border:"0.5px solid #1a1a1a",color:"#555",borderRadius:6,width:30,height:30,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
                <span style={{fontSize:12,fontWeight:700,color:"#555",letterSpacing:"0.12em",textTransform:"uppercase"}}>{MONTHS[month]} {year}</span>
                <button onClick={()=>changeMonth(1)} style={{background:"#111",border:"0.5px solid #1a1a1a",color:"#555",borderRadius:6,width:30,height:30,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
                {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"#2a2a2a",letterSpacing:"0.1em",paddingBottom:3}}>{d}</div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
                {cells.map((day,i)=>{
                  if(!day) return <div key={`e${i}`}/>;
                  const k=dk(year,month,day);
                  const entry=trades[k];
                  const isToday=day===today.getDate()&&month===today.getMonth()&&year===today.getFullYear();
                  const isWin=entry&&(entry.totalPnl||0)>=0;
                  const barH=entry?Math.max(3,(Math.abs(entry.totalPnl||0)/maxAbs)*12):0;
                  return(
                    <div key={k} onClick={()=>setDetailDay(day)} style={{minHeight:68,borderRadius:6,padding:"5px 5px 0",background:entry?(isWin?"rgba(0,255,136,0.07)":"rgba(255,68,68,0.07)"):"#111",border:entry?`0.5px solid ${isWin?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.2)"}`:isToday?"0.5px solid #6366f1":"0.5px solid #161616",cursor:"pointer",boxSizing:"border-box",position:"relative",overflow:"hidden",animation:flashKey===k?(isWin?"flashG 0.6s ease-out":"flashR 0.6s ease-out"):"none",transition:"border-color 0.12s"}}>
                      <div style={{fontSize:10,color:isToday?"#6366f1":"#2a2a2a",fontWeight:isToday?700:400}}>{String(day).padStart(2,"0")}</div>
                      {entry&&<>
                        <div style={{fontSize:11,fontWeight:700,color:isWin?"#00ff88":"#ff4444",marginTop:3,fontVariantNumeric:"tabular-nums",lineHeight:1.2}}>{fmt(entry.totalPnl||0)}</div>
                        <div style={{fontSize:9,color:"#333",marginTop:1}}>{entry.wins||0}W {entry.losses||0}L</div>
                        <div style={{position:"absolute",bottom:0,left:0,right:0,height:barH,background:isWin?"rgba(0,255,136,0.2)":"rgba(255,68,68,0.18)",borderRadius:"0 0 6px 6px"}}/>
                      </>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{fontSize:9,color:"#1e1e1e",textAlign:"center",marginTop:12,letterSpacing:"0.1em"}}>TAP ANY DAY TO LOG TRADES</div>
          </>
        )}
      </div>
    </div>
  );
}
