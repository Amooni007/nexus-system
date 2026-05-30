// src/lib/ticketRenderer.ts
import QRCode from 'qrcode';
import { supabase } from './supabase';
import type { TicketLayoutConfig, ElementId } from '../types/ticketLayout';
import { DEFAULT_LAYOUT, ELEMENT_ORDER } from '../types/ticketLayout';

const CW = 800, CH = 400;
const CAT: Record<string, {badge:string;badgeText:string;bg:string;accent:string}> = {
  VVIP:    {badge:'#f59e0b',badgeText:'#1a1200',bg:'#1a1200',accent:'#f59e0b'},
  VIP:     {badge:'#94a3b8',badgeText:'#0f172a',bg:'#0f172a',accent:'#94a3b8'},
  Regular: {badge:'#3b82f6',badgeText:'#ffffff', bg:'#0c1e3c',accent:'#3b82f6'},
};
const sc=(c:string)=>CAT[c]||{badge:'#6366f1',badgeText:'#ffffff',bg:'#1e1b4b',accent:'#6366f1'};
const p2x=(p:number,t:number)=>(p/100)*t;

// TTL cache — prevents stale layouts from blocking template image updates
const cache:Record<string,{layout:TicketLayoutConfig;ts:number}>={};
const CACHE_TTL = 60000; // 1 minute

function rrect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}

//function loadImg(src:string):Promise<HTMLImageElement|null>{
 // return new Promise(r=>{
 //   const i=new Image();
 //   i.crossOrigin='anonymous';
 //   i.onload=()=>r(i);
 //   i.onerror=()=>{
      // Retry without crossOrigin for public buckets
 //     const i2=new Image();
 //     i2.onload=()=>r(i2);
  //    i2.onerror=()=>r(null);
  //    i2.src=src;
  //  };
  //  i.src=src;
 // });
// } 

function loadImg(src:string):Promise<HTMLImageElement|null>{
  return new Promise(r=>{
    const i=new Image();
    // No crossOrigin for public Supabase Storage URLs.
    // crossOrigin on public bucket images causes CORS preflight failures
    // which taint the canvas and break toDataURL() on some browsers.
    i.onload=()=>r(i);
    i.onerror=()=>r(null);
    i.src=src;
  });
}

export async function getLayout(eventId:string,cat:string):Promise<TicketLayoutConfig>{
  const key=`${eventId}:${cat}`;
  if(cache[key] && Date.now()-cache[key].ts < CACHE_TTL) return cache[key].layout;
  const{data}=await supabase.from('ticket_template_layouts').select('layout_config').eq('event_id',eventId).eq('category_name',cat).maybeSingle();
  const l=(data?.layout_config as TicketLayoutConfig)||DEFAULT_LAYOUT;
  cache[key]={layout:l,ts:Date.now()};
  return l;
}

export function clearLayoutCache(eventId:string,cat:string){delete cache[`${eventId}:${cat}`];}

export interface TicketRenderParams{
  ticketToken:string; customerName:string; ticketCategory:string;
  eventName:string; eventDate:string; eventTime?:string; eventLocation:string;
  ticketId:string; templateImageUrl?:string|null; eventId:string;
}

export async function renderTicketToCanvas(canvas:HTMLCanvasElement,p:TicketRenderParams):Promise<void>{
  canvas.width=CW;canvas.height=CH;
  const ctx=canvas.getContext('2d')!;
  const layout=await getLayout(p.eventId,p.ticketCategory);
  const s=sc(p.ticketCategory);

  // Background — template image takes priority over gradient
  const templateUrl = p.templateImageUrl || (layout as any).templateImageUrl || null;
  if(templateUrl){
    const bg=await loadImg(templateUrl);
    if(bg){
      ctx.drawImage(bg,0,0,CW,CH);
      // Dark overlay so text remains readable on any background image
      ctx.fillStyle='rgba(0,0,0,0.45)';
      ctx.fillRect(0,0,CW,CH);
    } else {
      // Image failed to load — fall back to gradient
      const g=ctx.createLinearGradient(0,0,CW,CH);g.addColorStop(0,s.bg);g.addColorStop(1,'#1e293b');
      ctx.fillStyle=g;ctx.fillRect(0,0,CW,CH);
    }
  } else {
    // No template — use category gradient
    const g=ctx.createLinearGradient(0,0,CW,CH);g.addColorStop(0,s.bg);g.addColorStop(1,'#1e293b');
    ctx.fillStyle=g;ctx.fillRect(0,0,CW,CH);
    ctx.fillStyle=s.accent;ctx.globalAlpha=0.10;ctx.fillRect(0,0,CW,4);ctx.fillRect(0,0,4,CH);ctx.globalAlpha=1;
  }

  // QR — encode token only, never PII
  const qrC=document.createElement('canvas');
  await QRCode.toCanvas(qrC,`NEXUS-TICKET:${p.ticketToken}`,{width:300,margin:1,errorCorrectionLevel:'H',color:{dark:'#0f172a',light:'#ffffff'}});

  const VALUES:Record<ElementId,string>={
    qrCode:'',guestName:p.customerName,eventName:p.eventName,venue:p.eventLocation,
    date:p.eventDate,time:p.eventTime||'',ticketCategory:p.ticketCategory,ticketId:p.ticketId.toUpperCase(),
  };

  for(const id of ELEMENT_ORDER){
    const el=layout.elements[id];if(!el?.style.visible)continue;
    const x=p2x(el.x,CW),y=p2x(el.y,CH),w=p2x(el.width,CW),h=p2x(el.height,CH);
    ctx.globalAlpha=el.style.opacity??1;

    if(id==='qrCode'){
      ctx.fillStyle='#ffffff';rrect(ctx,x,y,w,h,10);ctx.fill();
      const pad=8;ctx.drawImage(qrC,x+pad,y+pad,w-pad*2,h-pad*2);
      ctx.globalAlpha=1;continue;
    }
    if(id==='ticketCategory'){
      ctx.fillStyle=s.badge;rrect(ctx,x,y,w,h,6);ctx.fill();ctx.globalAlpha=1;
      const st=el.style;ctx.fillStyle=s.badgeText;
      ctx.font=`${st.fontStyle==='italic'?'italic ':''}${st.fontWeight} ${st.fontSize}px ${st.fontFamily}`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      let v=p.ticketCategory;if(st.uppercase)v=v.toUpperCase();
      ctx.fillText(v,x+w/2,y+h/2);ctx.textAlign='left';ctx.textBaseline='alphabetic';continue;
    }
    const val=VALUES[id as ElementId];if(!val){ctx.globalAlpha=1;continue;}
    const st=el.style;ctx.fillStyle=st.color;
    ctx.font=`${st.fontStyle==='italic'?'italic ':''}${st.fontWeight} ${st.fontSize}px ${st.fontFamily}`;
    let dv=val;if(st.uppercase)dv=dv.toUpperCase();
    ctx.textBaseline='top';ctx.textAlign=st.align as CanvasTextAlign;
    const tx=st.align==='center'?x+w/2:st.align==='right'?x+w:x;
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillText(dv,tx,y,w);ctx.restore();
    ctx.globalAlpha=1;ctx.textAlign='left';ctx.textBaseline='alphabetic';
  }
  ctx.globalAlpha=1;
}

export async function downloadTicketAsPNG(p:TicketRenderParams,filename?:string){
  const c=document.createElement('canvas');await renderTicketToCanvas(c,p);
  const url=c.toDataURL('image/png',1.0);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename||`ticket-${p.ticketId}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function ticketToDataURL(p:TicketRenderParams):Promise<string>{
  const c=document.createElement('canvas');await renderTicketToCanvas(c,p);return c.toDataURL('image/png',1.0);
}

export async function renderAllOrderTickets(params:{
  tickets:Array<{ticket_token:string;id:string}>;
  customerName:string;ticketCategory:string;eventName:string;
  eventDate:string;eventTime?:string;eventLocation:string;
  templateImageUrl?:string|null;eventId:string;
}):Promise<string[]>{
  const urls:string[]=[];
  for(const t of params.tickets){
    urls.push(await ticketToDataURL({
      ticketToken:t.ticket_token,customerName:params.customerName,ticketCategory:params.ticketCategory,
      eventName:params.eventName,eventDate:params.eventDate,eventTime:params.eventTime,
      eventLocation:params.eventLocation,ticketId:t.ticket_token.slice(0,8),
      templateImageUrl:params.templateImageUrl,eventId:params.eventId,
    }));
  }
  return urls;
}