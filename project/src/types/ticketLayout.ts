// src/types/ticketLayout.ts

export type ElementId = 'qrCode'|'guestName'|'eventName'|'venue'|'date'|'time'|'ticketCategory'|'ticketId';

export interface TextStyle {
  fontSize: number;
  fontWeight: 'normal'|'bold';
  fontStyle: 'normal'|'italic';
  fontFamily: string;
  color: string;
  align: 'left'|'center'|'right';
  letterSpacing: number;
  opacity: number;
  uppercase: boolean;
  visible: boolean;
}

export interface LayoutElement {
  id: ElementId;
  label: string;
  x: number; y: number; width: number; height: number;
  locked: boolean;
  style: TextStyle;
}

export interface TicketLayoutConfig {
  version: 2;
  canvasWidth: number;
  canvasHeight: number;
  elements: Record<ElementId, LayoutElement>;
}

const S = (overrides: Partial<TextStyle>): TextStyle => ({
  fontSize:13, fontWeight:'normal', fontStyle:'normal', fontFamily:'Arial',
  color:'#ffffff', align:'left', letterSpacing:0, opacity:1, uppercase:false, visible:true,
  ...overrides,
});

export const DEFAULT_LAYOUT: TicketLayoutConfig = {
  version:2, canvasWidth:800, canvasHeight:400,
  elements:{
    ticketCategory:{ id:'ticketCategory', label:'Category Badge', x:5,y:7,width:18,height:9, locked:false, style:S({fontSize:13,fontWeight:'bold',color:'#1a1200',align:'center',uppercase:true}) },
    eventName:     { id:'eventName',      label:'Event Name',     x:5,y:20,width:63,height:14, locked:false, style:S({fontSize:26,fontWeight:'bold',color:'#ffffff'}) },
    guestName:     { id:'guestName',      label:'Guest Name',     x:5,y:40,width:55,height:10, locked:false, style:S({fontSize:17,fontWeight:'bold',color:'#ffffff'}) },
    venue:         { id:'venue',          label:'Venue',          x:5,y:54,width:58,height:9, locked:false, style:S({fontSize:13,color:'#94a3b8'}) },
    date:          { id:'date',           label:'Date',           x:5,y:65,width:40,height:9, locked:false, style:S({fontSize:13,color:'#94a3b8'}) },
    time:          { id:'time',           label:'Time',           x:5,y:76,width:28,height:9, locked:false, style:S({fontSize:13,color:'#94a3b8'}) },
    ticketId:      { id:'ticketId',       label:'Ticket ID',      x:5,y:89,width:45,height:8, locked:false, style:S({fontSize:10,color:'#475569',uppercase:true,letterSpacing:2}) },
    qrCode:        { id:'qrCode',         label:'QR Code',        x:70,y:10,width:26,height:76, locked:false, style:S({opacity:1}) },
  },
};

export const SAMPLE_VALUES: Record<ElementId, string> = {
  qrCode:'NEXUS-TICKET:SAMPLE-PREVIEW-00000000-0000-0000-0000-000000000000',
  guestName:'John Doe', eventName:'Swimming Gala 2026', venue:'Mombasa Aquatic Centre',
  date:'20 May 2026', time:'2:25 PM', ticketCategory:'VVIP', ticketId:'NX-45821',
};

export const ELEMENT_ORDER: ElementId[] = ['eventName','guestName','ticketCategory','venue','date','time','ticketId','qrCode'];
export const FONT_FAMILIES = ['Arial','Georgia','Courier New','Verdana','Trebuchet MS','Times New Roman'];