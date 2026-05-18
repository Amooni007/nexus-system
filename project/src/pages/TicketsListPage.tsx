// src/pages/TicketsListPage.tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Ticket, Search, RefreshCw, Download,
  Send, QrCode, Loader2, Copy, Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import {
  getEventTickets, markTicketDelivered,
  buildWhatsAppTicketMessage, formatKEPhone,
} from '../lib/TicketingLib';
import { downloadTicketAsPNG } from '../lib/ticketRenderer';
import Layout from '../components/layout/Layout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import TicketViewer from '../components/ticketing/TicketViewer';
import type { Ticket as ITicket, TicketCategoryConfig } from '../types/ticketing';
import type { TicketRenderParams } from '../lib/ticketRenderer';

type FilterStatus   = 'all' | 'unused' | 'used' | 'cancelled';
type FilterDelivery = 'all' | 'pending' | 'sent';

const CAT_BADGE: Record<string, string> = {
  VVIP:    'bg-yellow-400 text-yellow-950',
  VIP:     'bg-slate-300 text-slate-900',
  Regular: 'bg-blue-500 text-white',
};
const CAT_ROW: Record<string, string> = {
  VVIP:    'border-yellow-500/20 bg-yellow-900/5',
  VIP:     'border-slate-500/20 bg-slate-800/20',
  Regular: 'border-blue-500/20 bg-blue-900/5',
};

export default function TicketsListPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [tickets,       setTickets]       = useState<ITicket[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [eventName,     setEventName]     = useState('');
  const [eventDate,     setEventDate]     = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [categories,    setCategories]    = useState<TicketCategoryConfig[]>([]);
  const [search,        setSearch]        = useState('');
  const [filterStatus,  setFilterStatus]  = useState<FilterStatus>('all');
  const [filterDelivery,setFilterDelivery]= useState<FilterDelivery>('all');
  const [filterCat,     setFilterCat]     = useState('all');
  const [ticketModal,   setTicketModal]   = useState<ITicket | null>(null);
  const [sendingId,     setSendingId]     = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedId,      setCopiedId]      = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const [ev, tix] = await Promise.all([
      supabase.from('events').select('name,date,location,ticket_categories').eq('id', eventId).maybeSingle(),
      getEventTickets(eventId),
    ]);
    setEventName(ev.data?.name || '');
    setEventDate(ev.data?.date || '');
    setEventLocation(ev.data?.location || '');
    setCategories(ev.data?.ticket_categories || []);
    setTickets(tix);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { loadData(); }, [loadData]);

  const catNames = [...new Set(tickets.map(t => t.ticket_category))];

  const filtered = tickets.filter(t => {
    if (filterStatus   !== 'all' && t.status           !== filterStatus)   return false;
    if (filterDelivery !== 'all' && t.delivery_status  !== filterDelivery) return false;
    if (filterCat      !== 'all' && t.ticket_category  !== filterCat)      return false;
    if (search) {
      const s = search.toLowerCase();
      return t.customer_name.toLowerCase().includes(s)
        || t.customer_phone.includes(s)
        || t.ticket_token.toLowerCase().includes(s.replace(/-/g,''));
    }
    return true;
  });

  const stats = {
    total:  tickets.length,
    used:   tickets.filter(t => t.status === 'used').length,
    unused: tickets.filter(t => t.status === 'unused').length,
    unsent: tickets.filter(t => t.delivery_status === 'pending' && t.status !== 'cancelled').length,
  };

  function getTemplateUrl(categoryName: string): string | null {
    const cat = categories.find(c => c.name === categoryName);
    return (cat as any)?.template_image_url || null;
  }

  function buildParams(ticket: ITicket): TicketRenderParams {
    return {
      ticketToken:     ticket.ticket_token,
      customerName:    ticket.customer_name,
      ticketCategory:  ticket.ticket_category,
      eventName,
      eventDate:       eventDate ? format(new Date(eventDate), 'dd MMM yyyy') : '',
      eventTime:       eventDate ? format(new Date(eventDate), 'h:mm a') : '',
      eventLocation,
      ticketId:        ticket.ticket_token.slice(0, 8),
      templateImageUrl: getTemplateUrl(ticket.ticket_category),
      eventId:         eventId!,
    };
  }

  async function handleDownload(ticket: ITicket) {
    setDownloadingId(ticket.id);
    try {
      await downloadTicketAsPNG(buildParams(ticket), `nexus-ticket-${ticket.ticket_token.slice(0,8)}.png`);
    } finally { setDownloadingId(null); }
  }

  async function sendWhatsApp(ticket: ITicket) {
    setSendingId(ticket.id);
    const waPhone = formatKEPhone(ticket.customer_phone);
    const msg = buildWhatsAppTicketMessage({
      customerName:   ticket.customer_name,
      eventName,
      eventDate:      eventDate ? format(new Date(eventDate), 'dd MMM yyyy, h:mm a') : '',
      eventLocation,
      ticketCategory: ticket.ticket_category,
      ticketToken:    ticket.ticket_token,
    });
    window.open('https://wa.me/' + waPhone + '?text=' + msg, '_blank');
    await markTicketDelivered(ticket.id);
    await loadData();
    setSendingId(null);
  }

  async function sendAllUnsent() {
    const unsent = filtered.filter(t => t.delivery_status === 'pending' && t.status !== 'cancelled');
    for (const t of unsent) { await sendWhatsApp(t); await new Promise(r => setTimeout(r, 600)); }
  }

  function copyToken(ticket: ITicket) {
    navigator.clipboard.writeText(ticket.ticket_token);
    setCopiedId(ticket.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function exportCSV() {
    const rows = [
      ['Ticket ID','Customer','Phone','Category','Status','Delivery','Scanned At','Created'].join(','),
      ...filtered.map(t => [
        t.ticket_token, '"'+t.customer_name+'"', t.customer_phone,
        t.ticket_category, t.status, t.delivery_status,
        t.scanned_at ? format(new Date(t.scanned_at),'dd/MM HH:mm') : '',
        format(new Date(t.created_at),'dd/MM HH:mm'),
      ].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows],{type:'text/csv'}));
    a.download = 'tickets-'+eventId?.slice(0,6)+'.csv'; a.click();
  }

  if (loading) return <Layout><div className="flex justify-center mt-20"><LoadingSpinner/></div></Layout>;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to={'/events/'+eventId} className="text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20}/></Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white flex items-center gap-2"><Ticket size={20} className="text-indigo-400"/>Tickets</h1>
            <p className="text-slate-400 text-sm">{eventName}</p>
          </div>
          {stats.unsent > 0 && (
            <button onClick={sendAllUnsent}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors">
              <Send size={14}/> Send All Unsent ({stats.unsent})
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            {label:'Total',   value:stats.total,  color:'text-white'},
            {label:'Unused',  value:stats.unused,  color:'text-emerald-400'},
            {label:'Scanned', value:stats.used,    color:'text-amber-400'},
            {label:'Unsent',  value:stats.unsent,  color:stats.unsent>0?'text-red-400':'text-slate-500'},
          ].map(s=>(
            <div key={s.label} className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-center">
              <p className={'text-2xl font-bold '+s.color}>{s.value}</p>
              <p className="text-slate-500 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, phone, ticket ID…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"/>
          </div>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value as FilterStatus)}
            className="bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-3 py-2 focus:outline-none">
            <option value="all">All Statuses</option>
            <option value="unused">Unused</option>
            <option value="used">Used</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={filterDelivery} onChange={e=>setFilterDelivery(e.target.value as FilterDelivery)}
            className="bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-3 py-2 focus:outline-none">
            <option value="all">All Delivery</option>
            <option value="pending">Not Sent</option>
            <option value="sent">Sent</option>
          </select>
          {catNames.length > 1 && (
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-3 py-2 focus:outline-none">
              <option value="all">All Categories</option>
              {catNames.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button onClick={exportCSV}
            className="bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-xl flex items-center gap-1.5 text-sm transition-colors">
            <Download size={14}/> Export
          </button>
          <button onClick={loadData}
            className="bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-xl transition-colors">
            <RefreshCw size={14}/>
          </button>
        </div>

        {/* Tickets list */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500 bg-slate-900 rounded-2xl border border-slate-800">
            <Ticket size={36} className="mx-auto mb-3 opacity-30"/>
            <p>No tickets found</p>
            <p className="text-xs mt-1">Tickets are generated after an order is confirmed</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(ticket => (
              <div key={ticket.id}
                className={'border rounded-2xl flex items-center gap-3 px-4 py-3 transition-all hover:border-slate-500 ' +
                  (CAT_ROW[ticket.ticket_category] || 'border-slate-700 bg-slate-900/50')}>

                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  ticket.status==='used'?'bg-amber-400':ticket.status==='cancelled'?'bg-slate-600':'bg-emerald-400'
                }`}/>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{ticket.customer_name}</span>
                    <span className={'text-xs font-bold px-1.5 py-0.5 rounded-full '+(CAT_BADGE[ticket.ticket_category]||'bg-purple-500 text-white')}>
                      {ticket.ticket_category}
                    </span>
                    {ticket.status==='used'&&(
                      <span className="text-xs bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded">
                        Scanned {ticket.scanned_at?format(new Date(ticket.scanned_at),'HH:mm'):''}
                      </span>
                    )}
                    {ticket.status==='cancelled'&&(
                      <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">Cancelled</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                    <span>{ticket.customer_phone}</span>
                    <button onClick={()=>copyToken(ticket)}
                      className="flex items-center gap-1 font-mono hover:text-slate-300 transition-colors">
                      {ticket.ticket_token.slice(0,8).toUpperCase()}
                      {copiedId===ticket.id?<Check size={10} className="text-emerald-400"/>:<Copy size={10}/>}
                    </button>
                    <span className={ticket.delivery_status==='sent'?'text-emerald-500':'text-slate-600'}>
                      {ticket.delivery_status==='sent'?'✓ Sent':'○ Not sent'}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={()=>setTicketModal(ticket)}
                    className="p-2 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-colors" title="View ticket">
                    <QrCode size={15}/>
                  </button>
                  <button onClick={()=>handleDownload(ticket)} disabled={downloadingId===ticket.id}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors" title="Download PNG">
                    {downloadingId===ticket.id?<Loader2 size={15} className="animate-spin"/>:<Download size={15}/>}
                  </button>
                  {ticket.status!=='cancelled'&&(
                    <button onClick={()=>sendWhatsApp(ticket)} disabled={sendingId===ticket.id}
                      className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors" title="Send WhatsApp">
                      {sendingId===ticket.id?<Loader2 size={15} className="animate-spin"/>:<Send size={15}/>}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ticket Viewer Modal */}
      {ticketModal&&(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={()=>setTicketModal(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-2xl space-y-4"
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{ticketModal.customer_name}</h3>
                <p className="text-slate-400 text-sm">{ticketModal.customer_phone}</p>
              </div>
              <span className={'text-sm font-bold px-2.5 py-1 rounded-full '+(CAT_BADGE[ticketModal.ticket_category]||'bg-purple-500 text-white')}>
                {ticketModal.ticket_category}
              </span>
            </div>
            <TicketViewer
              params={buildParams(ticketModal)}
              onSendWhatsApp={()=>{sendWhatsApp(ticketModal);setTicketModal(null);}}
              onClose={()=>setTicketModal(null)}
            />
          </div>
        </div>
      )}
    </Layout>
  );
}