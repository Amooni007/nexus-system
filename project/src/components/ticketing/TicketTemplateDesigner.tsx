// src/components/ticketing/TicketTemplateDesigner.tsx
// Professional visual ticket designer using HTML5 Canvas.
// Drag elements, resize, style text, save layout JSON to Supabase.
// No heavy external dependencies — pure React + Canvas API.

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, Save, RotateCcw, ZoomIn, ZoomOut, Eye, EyeOff,
  Lock, Unlock, Grid3X3, Bold, Italic, AlignLeft,
  AlignCenter, AlignRight, Check, Download, Layers,
  Type, Move,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import type { TicketLayoutConfig, LayoutElement, ElementId, TextStyle } from '../../types/ticketLayout';
import { DEFAULT_LAYOUT, SAMPLE_VALUES, ELEMENT_ORDER, FONT_FAMILIES } from '../../types/ticketLayout';
import type { TicketCategoryConfig } from '../../types/ticketing';

const CW = 800;
const CH = 400;

const CAT_COLORS: Record<string, { badge: string; badgeText: string; accent: string }> = {
  VVIP:    { badge: '#f59e0b', badgeText: '#1a1200', accent: '#f59e0b' },
  VIP:     { badge: '#94a3b8', badgeText: '#0f172a', accent: '#94a3b8' },
  Regular: { badge: '#3b82f6', badgeText: '#ffffff',  accent: '#3b82f6' },
};
function cc(name: string) {
  return CAT_COLORS[name] || { badge: '#6366f1', badgeText: '#ffffff', accent: '#6366f1' };
}

const p2x = (p: number, t: number) => (p / 100) * t;
const x2p = (x: number, t: number) => (x / t) * 100;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Props {
  eventId: string;
  category: TicketCategoryConfig;
  onClose: () => void;
  onSaved: () => void;
}

interface DragRef {
  active: boolean; elId: ElementId | null; mode: 'move' | 'resize';
  mx0: number; my0: number; ex0: number; ey0: number; ew0: number; eh0: number;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

export default function TicketTemplateDesigner({ eventId, category, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout,   setLayout]   = useState<TicketLayoutConfig>(DEFAULT_LAYOUT);
  const [selected, setSelected] = useState<ElementId | null>(null);
  const [zoom,     setZoom]     = useState(0.85);
  const [grid,     setGrid]     = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [savedOk,  setSavedOk]  = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  const [bgImg,    setBgImg]    = useState<HTMLImageElement | null>(null);
  const [qrImg,    setQrImg]    = useState<HTMLImageElement | null>(null);
  const [preview,  setPreview]  = useState(false);

  const drag = useRef<DragRef>({
    active: false, elId: null, mode: 'move',
    mx0:0, my0:0, ex0:0, ey0:0, ew0:0, eh0:0,
  });

  // Load saved layout + assets
  useEffect(() => {
    supabase.from('ticket_template_layouts')
      .select('layout_config')
      .eq('event_id', eventId)
      .eq('category_name', category.name)
      .maybeSingle()
      .then(({ data }) => { if (data?.layout_config) setLayout(data.layout_config as TicketLayoutConfig); });

    if (category.template_image_url) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => setBgImg(img);
      img.src = category.template_image_url;
    }

    QRCode.toDataURL(SAMPLE_VALUES.qrCode, {
      width: 300, margin: 1, errorCorrectionLevel: 'H',
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(url => { const img = new Image(); img.onload = () => setQrImg(img); img.src = url; });
  }, [eventId, category]);

  // Render
  const paint = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CW, CH);
    const colors = cc(category.name);

    // Background
    if (bgImg) {
      ctx.drawImage(bgImg, 0, 0, CW, CH);
      ctx.fillStyle = 'rgba(0,0,0,0.48)'; ctx.fillRect(0, 0, CW, CH);
    } else {
      const g = ctx.createLinearGradient(0,0,CW,CH);
      g.addColorStop(0,'#0f172a'); g.addColorStop(1,'#1e293b');
      ctx.fillStyle = g; ctx.fillRect(0,0,CW,CH);
      ctx.fillStyle = colors.accent; ctx.globalAlpha = 0.10;
      ctx.fillRect(0,0,CW,4); ctx.fillRect(0,0,4,CH);
      ctx.globalAlpha = 1;
    }

    // Grid overlay
    if (grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
      for (let x=0; x<=CW; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CH); ctx.stroke(); }
      for (let y=0; y<=CH; y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CW,y); ctx.stroke(); }
    }

    // Draw elements
    for (const id of ELEMENT_ORDER) {
      const el = layout.elements[id];
      if (!el?.style.visible) continue;
      const x = p2x(el.x,CW), y = p2x(el.y,CH), w = p2x(el.width,CW), h = p2x(el.height,CH);
      ctx.globalAlpha = el.style.opacity ?? 1;

      if (id === 'qrCode') {
        ctx.fillStyle = '#ffffff'; rrect(ctx,x,y,w,h,10); ctx.fill();
        if (qrImg) { const pad=8; ctx.drawImage(qrImg,x+pad,y+pad,w-pad*2,h-pad*2); }
        else {
          ctx.fillStyle='#e2e8f0'; rrect(ctx,x+8,y+8,w-16,h-16,6); ctx.fill();
          ctx.fillStyle='#64748b'; ctx.font='bold 13px Arial';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText('QR CODE',x+w/2,y+h/2);
          ctx.textAlign='left'; ctx.textBaseline='alphabetic';
        }
        ctx.globalAlpha=1;
        if (!preview) drawSel(ctx,x,y,w,h,id===selected);
        continue;
      }

      if (id === 'ticketCategory') {
        ctx.fillStyle = colors.badge; rrect(ctx,x,y,w,h,6); ctx.fill();
        ctx.globalAlpha=1;
        const s=el.style;
        ctx.fillStyle=colors.badgeText;
        ctx.font=`${s.fontStyle==='italic'?'italic ':''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        let val=SAMPLE_VALUES.ticketCategory; if(s.uppercase) val=val.toUpperCase();
        ctx.fillText(val,x+w/2,y+h/2);
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
        ctx.globalAlpha=1;
        if (!preview) drawSel(ctx,x,y,w,h,id===selected);
        continue;
      }

      // Text
      const s=el.style;
      ctx.fillStyle=s.color;
      ctx.font=`${s.fontStyle==='italic'?'italic ':''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`;
      let val=SAMPLE_VALUES[id]||el.label; if(s.uppercase) val=val.toUpperCase();
      ctx.textBaseline='top'; ctx.textAlign=s.align as CanvasTextAlign;
      const tx=s.align==='center'?x+w/2:s.align==='right'?x+w:x;
      ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
      ctx.fillText(val,tx,y,w);
      ctx.restore();
      ctx.globalAlpha=1; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      if (!preview) drawSel(ctx,x,y,w,h,id===selected);
    }
    ctx.globalAlpha=1;
  }, [layout, selected, bgImg, qrImg, grid, preview, category]);

  useEffect(() => { paint(); }, [paint]);

  function drawSel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, isSel: boolean) {
    if (isSel) {
      ctx.strokeStyle='#6366f1'; ctx.lineWidth=2; ctx.setLineDash([5,3]);
      ctx.strokeRect(x-1,y-1,w+2,h+2); ctx.setLineDash([]);
      ctx.fillStyle='#6366f1'; ctx.fillRect(x+w-5,y+h-5,10,10);
      ctx.fillStyle='rgba(99,102,241,0.1)'; ctx.fillRect(x,y,w,h);
    } else {
      ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
    }
  }

  function canvasXY(e: React.MouseEvent<HTMLCanvasElement>) {
    const r=canvasRef.current!.getBoundingClientRect();
    return { x:(e.clientX-r.left)*(CW/r.width), y:(e.clientY-r.top)*(CH/r.height) };
  }

  function hit(el: LayoutElement, cx: number, cy: number) {
    const x=p2x(el.x,CW),y=p2x(el.y,CH),w=p2x(el.width,CW),h=p2x(el.height,CH);
    return cx>=x&&cx<=x+w&&cy>=y&&cy<=y+h;
  }

  function onResizeHandle(el: LayoutElement, cx: number, cy: number) {
    const rx=p2x(el.x+el.width,CW)-5, ry=p2x(el.y+el.height,CH)-5;
    return cx>=rx&&cx<=rx+10&&cy>=ry&&cy<=ry+10;
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (preview) return;
    const {x,y}=canvasXY(e);
    for (const id of [...ELEMENT_ORDER].reverse()) {
      const el=layout.elements[id];
      if (!el?.style.visible||el.locked) continue;
      if (hit(el,x,y)) {
        setSelected(id);
        const mode=onResizeHandle(el,x,y)?'resize':'move';
        drag.current={active:true,elId:id,mode,mx0:x,my0:y,ex0:el.x,ey0:el.y,ew0:el.width,eh0:el.height};
        e.preventDefault(); return;
      }
    }
    setSelected(null);
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag.current.active||!drag.current.elId) return;
    const {x,y}=canvasXY(e);
    const dx=x2p(x-drag.current.mx0,CW), dy=x2p(y-drag.current.my0,CH);
    setLayout(prev=>{
      const el=prev.elements[drag.current.elId!]; if(!el) return prev;
      const updated=drag.current.mode==='move'
        ?{...el,x:clamp(drag.current.ex0+dx,0,100-el.width),y:clamp(drag.current.ey0+dy,0,100-el.height)}
        :{...el,width:Math.max(5,drag.current.ew0+dx),height:Math.max(3,drag.current.eh0+dy)};
      return {...prev,elements:{...prev.elements,[el.id]:updated}};
    });
  }

  function onMouseUp() { drag.current.active=false; }

  function updateStyle<K extends keyof TextStyle>(key: K, value: TextStyle[K]) {
    if (!selected) return;
    setLayout(prev=>({...prev,elements:{...prev.elements,[selected]:{...prev.elements[selected],style:{...prev.elements[selected].style,[key]:value}}}}));
  }

  function toggleLayer(id: ElementId, prop: 'locked'|'visible') {
    setLayout(prev=>{
      const el=prev.elements[id];
      if(prop==='locked') return {...prev,elements:{...prev.elements,[id]:{...el,locked:!el.locked}}};
      return {...prev,elements:{...prev.elements,[id]:{...el,style:{...el.style,visible:!el.style.visible}}}};
    });
  }

  async function save() {
    setSaving(true);
    const {error}=await supabase.from('ticket_template_layouts').upsert(
      {event_id:eventId,category_name:category.name,layout_config:layout,updated_at:new Date().toISOString()},
      {onConflict:'event_id,category_name'}
    );
    setSaving(false);
    if(!error){setSavedOk(true);setTimeout(()=>setSavedOk(false),2500);onSaved();}
    else alert('Save failed: '+error.message);
  }

  function downloadPNG() {
    const a=document.createElement('a');
    a.href=canvasRef.current!.toDataURL('image/png');
    a.download=`preview-${category.name.toLowerCase()}.png`; a.click();
  }

  const selEl=selected?layout.elements[selected]:null;
  const colors=cc(category.name);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 overflow-hidden">

      {/* TOP BAR */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors"><X size={18}/></button>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Ticket Designer</p>
            <p className="text-slate-500 text-xs">{category.name} · {eventId.slice(0,8)}</p>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{background:colors.badge,color:colors.badgeText}}>{category.name}</span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={()=>setPreview(p=>!p)}
            className={'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors '+(preview?'border-emerald-500 text-emerald-400 bg-emerald-900/20':'border-slate-600 text-slate-400 hover:text-white')}>
            <Eye size={12}/>{preview?'Exit Preview':'Preview'}
          </button>
          <button onClick={()=>setGrid(g=>!g)}
            className={'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors '+(grid?'border-indigo-500 text-indigo-400 bg-indigo-900/20':'border-slate-600 text-slate-400 hover:text-white')}>
            <Grid3X3 size={12}/>Grid
          </button>
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
            <button onClick={()=>setZoom(z=>clamp(z-0.1,0.3,1.5))} className="text-slate-400 hover:text-white"><ZoomOut size={13}/></button>
            <span className="text-xs text-slate-300 w-10 text-center font-mono">{Math.round(zoom*100)}%</span>
            <button onClick={()=>setZoom(z=>clamp(z+0.1,0.3,1.5))} className="text-slate-400 hover:text-white"><ZoomIn size={13}/></button>
          </div>
          <button onClick={()=>setLayersOpen(l=>!l)}
            className={'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors '+(layersOpen?'border-indigo-500 text-indigo-400':'border-slate-600 text-slate-400')}>
            <Layers size={12}/>Layers
          </button>
          <button onClick={()=>{if(confirm('Reset to default layout?')){setLayout(DEFAULT_LAYOUT);setSelected(null);}}}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-white transition-colors">
            <RotateCcw size={12}/>Reset
          </button>
          <button onClick={downloadPNG}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:text-white transition-colors">
            <Download size={12}/>PNG
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors disabled:opacity-50 min-w-[88px] justify-center">
            {savedOk?<><Check size={12} className="text-emerald-300"/>Saved!</>:saving?'Saving…':<><Save size={12}/>Save</>}
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT: Properties */}
        <div className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2 border-b border-slate-800">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Properties</p>
          </div>
          {selEl?(
            <div className="p-3 space-y-3.5">
              <p className="text-indigo-400 text-xs font-semibold flex items-center gap-1.5"><Type size={11}/>{selEl.label}</p>

              {selEl.id!=='qrCode'&&(<>
                {/* Font size */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">Font Size ({selEl.style.fontSize}px)</label>
                  <input type="range" min="8" max="72" value={selEl.style.fontSize}
                    onChange={e=>updateStyle('fontSize',Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5"/>
                </div>
                {/* Font family */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">Font Family</label>
                  <select value={selEl.style.fontFamily} onChange={e=>updateStyle('fontFamily',e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded-lg px-2 py-1.5 focus:outline-none">
                    {FONT_FAMILIES.map(f=><option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {/* Color */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">Text Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={selEl.style.color} onChange={e=>updateStyle('color',e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0"/>
                    <input type="text" value={selEl.style.color} onChange={e=>updateStyle('color',e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"/>
                  </div>
                </div>
                {/* Style toggles */}
                <div>
                  <label className="text-slate-500 text-xs mb-1.5 block">Style</label>
                  <div className="flex gap-1.5">
                    {[
                      {icon:<Bold size={12}/>,active:selEl.style.fontWeight==='bold',fn:()=>updateStyle('fontWeight',selEl.style.fontWeight==='bold'?'normal':'bold')},
                      {icon:<Italic size={12}/>,active:selEl.style.fontStyle==='italic',fn:()=>updateStyle('fontStyle',selEl.style.fontStyle==='italic'?'normal':'italic')},
                      {icon:<span className="text-xs font-bold leading-none">AA</span>,active:selEl.style.uppercase,fn:()=>updateStyle('uppercase',!selEl.style.uppercase)},
                    ].map((b,i)=>(
                      <button key={i} onClick={b.fn}
                        className={'p-2 rounded-lg border transition-colors '+(b.active?'border-indigo-500 bg-indigo-900/40 text-indigo-300':'border-slate-600 text-slate-400 hover:text-white')}>
                        {b.icon}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Alignment */}
                <div>
                  <label className="text-slate-500 text-xs mb-1.5 block">Alignment</label>
                  <div className="flex gap-1.5">
                    {(['left','center','right'] as const).map(a=>(
                      <button key={a} onClick={()=>updateStyle('align',a)}
                        className={'p-2 rounded-lg border transition-colors '+(selEl.style.align===a?'border-indigo-500 bg-indigo-900/40 text-indigo-300':'border-slate-600 text-slate-400 hover:text-white')}>
                        {a==='left'?<AlignLeft size={12}/>:a==='center'?<AlignCenter size={12}/>:<AlignRight size={12}/>}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Letter spacing */}
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">Letter Spacing ({selEl.style.letterSpacing}px)</label>
                  <input type="range" min="0" max="20" value={selEl.style.letterSpacing}
                    onChange={e=>updateStyle('letterSpacing',Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5"/>
                </div>
              </>)}

              {/* Opacity */}
              <div>
                <label className="text-slate-500 text-xs mb-1 block">Opacity ({Math.round(selEl.style.opacity*100)}%)</label>
                <input type="range" min="10" max="100" value={Math.round(selEl.style.opacity*100)}
                  onChange={e=>updateStyle('opacity',Number(e.target.value)/100)}
                  className="w-full accent-indigo-500 h-1.5"/>
              </div>

              {/* Position */}
              <div className="bg-slate-800/60 rounded-xl p-2.5 text-xs">
                <p className="text-slate-400 font-medium mb-2 flex items-center gap-1"><Move size={10}/>Position (% of canvas)</p>
                <div className="grid grid-cols-2 gap-1">
                  {[{l:'X',v:selEl.x},{l:'Y',v:selEl.y},{l:'W',v:selEl.width},{l:'H',v:selEl.height}].map(p=>(
                    <div key={p.l} className="flex justify-between bg-slate-900 rounded px-2 py-1">
                      <span className="text-slate-500">{p.l}</span>
                      <span className="text-slate-200 font-mono">{p.v.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lock */}
              <button onClick={()=>toggleLayer(selEl.id as ElementId,'locked')}
                className={'w-full flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-colors '+(selEl.locked?'border-amber-500/60 text-amber-400 bg-amber-900/20':'border-slate-700 text-slate-400 hover:text-white')}>
                {selEl.locked?<Lock size={11}/>:<Unlock size={11}/>}
                {selEl.locked?'Locked — click to unlock':'Click to lock position'}
              </button>
            </div>
          ):(
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 space-y-2">
              <Move size={22} className="text-slate-700"/>
              <p className="text-slate-500 text-xs">Click any element on the canvas to select and edit</p>
            </div>
          )}
        </div>

        {/* CENTRE: Canvas */}
        <div className="flex-1 bg-slate-950 flex items-center justify-center overflow-auto p-6"
          style={{backgroundImage:'radial-gradient(circle,#1e293b 1px,transparent 1px)',backgroundSize:'20px 20px'}}>
          <div style={{transform:`scale(${zoom})`,transformOrigin:'center',transition:'transform 0.12s ease'}}>
            <canvas ref={canvasRef} width={CW} height={CH}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove}
              onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              className="rounded-xl shadow-2xl ring-1 ring-slate-700 block"
              style={{cursor:preview?'default':'crosshair'}}/>
            {!preview&&(
              <p className="text-center text-slate-600 text-xs mt-2">
                {CW}×{CH}px · Drag to move · Corner handle ↘ to resize
              </p>
            )}
          </div>
        </div>

        {/* RIGHT: Layers */}
        {layersOpen&&(
          <div className="hidden md:flex w-48 bg-slate-900 border-l border-slate-800 flex-col flex-shrink-0 overflow-y-auto">
            <div className="px-3 py-2 border-b border-slate-800">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Layers</p>
            </div>
            <div className="p-2 space-y-0.5">
              {[...ELEMENT_ORDER].reverse().map(id=>{
                const el=layout.elements[id]; if(!el) return null;
                const isSel=selected===id;
                return (
                  <div key={id} onClick={()=>setSelected(isSel?null:id)}
                    className={'flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors text-xs group '+(isSel?'bg-indigo-900/40 text-indigo-300':'text-slate-400 hover:bg-slate-800 hover:text-slate-200')}>
                    <span className="flex-1 truncate">{el.label}</span>
                    <button onClick={e=>{e.stopPropagation();toggleLayer(id,'visible');}}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white transition-all">
                      {el.style.visible?<Eye size={11}/>:<EyeOff size={11} className="text-slate-600"/>}
                    </button>
                    <button onClick={e=>{e.stopPropagation();toggleLayer(id,'locked');}}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-amber-400 transition-all">
                      {el.locked?<Lock size={11} className="text-amber-400"/>:<Unlock size={11}/>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* MOBILE: Layers quick-select strip */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-2 bg-slate-900/80 border-t border-slate-800 overflow-x-auto flex-shrink-0">
        <span className="text-slate-500 text-xs font-medium flex-shrink-0 pr-1">Select:</span>
        {ELEMENT_ORDER.map(id => {
          const el = layout?.elements?.[id];
          if (!el) return null;
          return (
            <button key={id} onClick={() => setSelected(id as ElementId)}
              className={"flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg border transition-colors " + (
                selected === id
                  ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                  : 'border-slate-700 text-slate-400 active:bg-slate-800'
              )}>
              {el.label}
            </button>
          );
        })}
      </div>

      {/* BOTTOM BAR */}
      <div className="hidden md:flex px-4 py-1.5 bg-slate-900 border-t border-slate-800 items-center gap-6 text-xs text-slate-500 flex-shrink-0">
        <span>🖱 Drag to move</span>
        <span>↘ Bottom-right corner to resize</span>
        <span>Click empty area to deselect</span>
        {preview&&<span className="text-emerald-400 font-medium ml-auto">👁 Preview — sample data shown</span>}
      </div>
    </div>
  );
}