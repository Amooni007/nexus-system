import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2,
  RefreshCw, Flag, Download, Search, CreditCard,
  Clock, Users, ChevronDown, ChevronUp, Ticket, ShieldAlert,
  Image as ImageIcon, Copy, Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  confirmOrderAndGenerateTickets, flagOrder, cancelOrder, getEventOrders,
} from '../lib/TicketingLib';
import Layout from '../components/layout/Layout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import type { TicketOrder } from '../types/ticketing';

type FilterStatus = 'all' | 'pending_verification' | 'confirmed' | 'failed' | 'cancelled';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:              { bg: 'bg-blue-900/40',   text: 'text-blue-300',   label: 'Pending' },
  pending_verification: { bg: 'bg-amber-900/40',  text: 'text-amber-300',  label: 'Awaiting Verification' },
  confirmed:            { bg: 'bg-emerald-900/40', text: 'text-emerald-300', label: 'Confirmed' },
  failed:               { bg: 'bg-red-900/40',    text: 'text-red-300',    label: 'Failed' },
  cancelled:            { bg: 'bg-slate-700/40',  text: 'text-slate-400',  label: 'Cancelled' },
};

export default function TicketOrdersPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventName, setEventName] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCat, setFilterCat] = useState('all');
  const [search, setSearch] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const [ev, ords] = await Promise.all([
      supabase.from('events').select('name').eq('id', eventId).maybeSingle(),
      getEventOrders(eventId),
    ]);
    setEventName(ev.data?.name || '');
    setOrders(ords);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { loadData(); }, [loadData]);

  const categories = [...new Set(orders.map(o => o.ticket_category))];

  const filtered = orders.filter(o => {
    if (filterStatus !== 'all' && o.payment_status !== filterStatus) return false;
    if (filterCat !== 'all' && o.ticket_category !== filterCat) return false;
    if (search) {
      const s = search.toLowerCase();
      return o.customer_name.toLowerCase().includes(s)
        || o.customer_phone.includes(s)
        || (o.mpesa_transaction_code || '').toLowerCase().includes(s);
    }
    return true;
  });

  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.payment_status === 'pending_verification').length,
    confirmed: orders.filter(o => o.payment_status === 'confirmed').length,
    flagged: orders.filter(o => o.is_flagged).length,
    revenue: orders.filter(o => o.payment_status === 'confirmed').reduce((s, o) => s + o.total_amount, 0),
  };

  async function handleConfirm(order: TicketOrder) {
    setProcessingId(order.id);
    try {
      await confirmOrderAndGenerateTickets(order.id, profile!.id);
      await loadData();
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally { setProcessingId(null); }
  }

  async function handleFlag(order: TicketOrder) {
    const reason = prompt('Flag reason (e.g. amount mismatch, suspicious code):');
    if (!reason) return;
    setProcessingId(order.id);
    await flagOrder(order.id, reason);
    await loadData();
    setProcessingId(null);
  }

  async function handleCancel(order: TicketOrder) {
    if (!confirm('Cancel order from ' + order.customer_name + '? This cannot be undone.')) return;
    setProcessingId(order.id);
    await cancelOrder(order.id);
    await loadData();
    setProcessingId(null);
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function exportCSV() {
    const rows = [
      ['Order ID','Name','Phone','Category','Qty','Total (KES)','Status','Tx Code','Submitted KES','Mismatch','Flagged','Date'].join(','),
      ...filtered.map(o => [
        o.id.slice(0, 8),
        '"' + o.customer_name + '"',
        o.customer_phone,
        o.ticket_category,
        o.quantity,
        o.total_amount,
        o.payment_status,
        o.mpesa_transaction_code || '',
        (o as any).submitted_amount || '',
        (o as any).amount_mismatch ? 'YES' : 'no',
        o.is_flagged ? 'YES' : 'no',
        format(new Date(o.created_at), 'dd/MM/yyyy HH:mm'),
      ].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    a.download = 'orders-' + eventId?.slice(0, 6) + '.csv';
    a.click();
  }

  if (loading) return <Layout><div className="flex justify-center mt-20"><LoadingSpinner /></div></Layout>;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to={'/events/' + eventId} className="text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2"><Ticket size={20} className="text-indigo-400" /> Ticket Orders</h1>
            <p className="text-slate-400 text-sm">{eventName}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: stats.total, color: 'text-white', icon: <Users size={14} /> },
            { label: 'Pending', value: stats.pending, color: 'text-amber-400', icon: <Clock size={14} /> },
            { label: 'Confirmed', value: stats.confirmed, color: 'text-emerald-400', icon: <CheckCircle2 size={14} /> },
            { label: 'Flagged', value: stats.flagged, color: 'text-red-400', icon: <ShieldAlert size={14} /> },
            { label: 'Revenue (KES)', value: stats.revenue.toLocaleString(), color: 'text-emerald-300', icon: <CreditCard size={14} /> },
          ].map(s => (
            <div key={s.label} className="bg-slate-900 border border-slate-700 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">{s.icon} {s.label}</div>
              <p className={'text-xl font-bold ' + s.color}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone, tx code…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as FilterStatus)}
            className="bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-3 py-2 focus:outline-none">
            <option value="all">All Statuses</option>
            <option value="pending_verification">Awaiting Verification</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {categories.length > 1 && (
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-3 py-2 focus:outline-none">
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button onClick={exportCSV} className="bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-xl flex items-center gap-1.5 text-sm transition-colors">
            <Download size={14} /> Export
          </button>
          <button onClick={loadData} className="bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-xl transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Orders list */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500 bg-slate-900 rounded-2xl border border-slate-800">
            <Ticket size={36} className="mx-auto mb-3 opacity-30" />
            <p>No orders found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(order => {
              const ss = STATUS_STYLES[order.payment_status] || STATUS_STYLES.pending;
              const isExpanded = expandedId === order.id;
              const isProcessing = processingId === order.id;
              const ov = order as any;
              const hasMismatch = ov.amount_mismatch === true;

              return (
                <div key={order.id}
                  className={'bg-slate-900 border rounded-2xl overflow-hidden transition-all ' + (order.is_flagged ? 'border-red-500/50' : hasMismatch ? 'border-amber-500/30' : 'border-slate-700')}>

                  {/* Main row */}
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">{order.customer_name}</span>
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + ss.bg + ' ' + ss.text}>{ss.label}</span>
                        {order.is_flagged && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 font-medium flex items-center gap-1">
                            <Flag size={10} /> Flagged
                          </span>
                        )}
                        {hasMismatch && !order.is_flagged && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-400 font-medium flex items-center gap-1">
                            <AlertTriangle size={10} /> Amount Mismatch
                          </span>
                        )}
                        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{order.ticket_category}</span>
                      </div>
                      <div className="text-slate-400 text-sm mt-0.5">
                        {order.customer_phone} · {order.quantity} ticket{order.quantity > 1 ? 's' : ''} ·{' '}
                        <span className="text-emerald-400 font-semibold">KES {order.total_amount.toLocaleString()}</span>
                        {hasMismatch && ov.submitted_amount && (
                          <span className="text-amber-400 ml-1">(submitted KES {Number(ov.submitted_amount).toLocaleString()})</span>
                        )}
                      </div>
                      <div className="text-slate-600 text-xs mt-0.5">
                        {format(new Date(order.created_at), 'dd MMM yyyy HH:mm')}
                        {order.mpesa_transaction_code && (
                          <> · <span className="font-mono text-slate-500">{order.mpesa_transaction_code}</span></>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {order.payment_status === 'pending_verification' && (
                        <button onClick={() => handleConfirm(order)} disabled={isProcessing}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50">
                          {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                          Confirm
                        </button>
                      )}
                      <button onClick={() => setExpandedId(isExpanded ? null : order.id)}
                        className="text-slate-400 hover:text-white transition-colors p-1">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/60 px-4 py-4 space-y-4">

                      {/* Security panel */}
                      {(hasMismatch || order.is_flagged || ov.proof_image_url) && (
                        <div className={'rounded-xl border p-3 space-y-2 ' + (order.is_flagged ? 'bg-red-900/20 border-red-500/30' : 'bg-amber-900/20 border-amber-500/30')}>
                          <p className={'text-xs font-semibold flex items-center gap-1.5 ' + (order.is_flagged ? 'text-red-400' : 'text-amber-400')}>
                            <ShieldAlert size={13} /> Security Review
                          </p>
                          {hasMismatch && (
                            <p className="text-xs text-slate-300">
                              Expected <strong className="text-white">KES {order.total_amount.toLocaleString()}</strong> · Customer submitted <strong className="text-amber-300">KES {Number(ov.submitted_amount).toLocaleString()}</strong>
                            </p>
                          )}
                          {order.flag_reason && <p className="text-xs text-slate-400">Reason: {order.flag_reason}</p>}
                          {ov.proof_image_url && (
                            <a href={ov.proof_image_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                              <ImageIcon size={12} /> View Receipt Screenshot
                            </a>
                          )}
                        </div>
                      )}

                      {/* Details grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                          <span className="text-slate-500 text-xs block">Order ID</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 font-mono text-xs">{order.id.slice(0, 12)}…</span>
                            <button onClick={() => copyText(order.id, order.id)} className="text-slate-600 hover:text-slate-300">
                              {copiedId === order.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                            </button>
                          </div>
                        </div>
                        <div><span className="text-slate-500 text-xs block">Unit Price</span><span className="text-slate-300">KES {order.unit_price.toLocaleString()}</span></div>
                        <div><span className="text-slate-500 text-xs block">Payment Mode</span><span className="text-slate-300 capitalize">{order.payment_mode.replace('_', ' ')}</span></div>
                        {ov.submitted_at && (
                          <div><span className="text-slate-500 text-xs block">Submitted At</span><span className="text-slate-300">{format(new Date(ov.submitted_at), 'dd MMM HH:mm')}</span></div>
                        )}
                        {order.payment_confirmed_at && (
                          <div><span className="text-slate-500 text-xs block">Confirmed At</span><span className="text-emerald-400">{format(new Date(order.payment_confirmed_at), 'dd MMM HH:mm')}</span></div>
                        )}
                      </div>

                      {/* Tickets */}
                      {order.tickets && order.tickets.length > 0 && (
                        <div>
                          <p className="text-slate-500 text-xs mb-1.5 font-medium">Generated Tickets ({order.tickets.length})</p>
                          <div className="space-y-1">
                            {order.tickets.map((t: any) => (
                              <div key={t.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2 text-xs">
                                <span className="font-mono text-slate-300">{t.ticket_token.slice(0, 16).toUpperCase()}…</span>
                                <div className="flex gap-2">
                                  <span className={'px-1.5 py-0.5 rounded ' + (t.status === 'used' ? 'bg-amber-900/50 text-amber-400' : t.status === 'cancelled' ? 'bg-slate-700 text-slate-400' : 'bg-emerald-900/50 text-emerald-400')}>
                                    {t.status}
                                  </span>
                                  <span className={'px-1.5 py-0.5 rounded ' + (t.delivery_status === 'sent' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400')}>
                                    {t.delivery_status}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {!order.is_flagged && order.payment_status !== 'confirmed' && order.payment_status !== 'cancelled' && (
                          <button onClick={() => handleFlag(order)} disabled={isProcessing}
                            className="text-xs px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded-lg flex items-center gap-1 transition-colors">
                            <Flag size={12} /> Flag for Review
                          </button>
                        )}
                        {order.payment_status !== 'cancelled' && order.payment_status !== 'confirmed' && (
                          <button onClick={() => handleCancel(order)} disabled={isProcessing}
                            className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg flex items-center gap-1 transition-colors">
                            <XCircle size={12} /> Cancel Order
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}