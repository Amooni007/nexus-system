import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, Users, QrCode, ScanLine, TrendingUp,
  Clock, Ticket, CreditCard, ShieldAlert, ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import { getStatusBadge } from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { format } from 'date-fns';
import type { Event, ScanLog } from '../types';
import type { TicketCategoryConfig } from '../types/ticketing';

interface Stats {
  events: number; guests: number; qrCodes: number; scansToday: number;
  pendingOrders: number; confirmedTickets: number; ticketRevenue: number; flaggedOrders: number;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats>({
    events: 0, guests: 0, qrCodes: 0, scansToday: 0,
    pendingOrders: 0, confirmedTickets: 0, ticketRevenue: 0, flaggedOrders: 0,
  });
  const [recentEvents, setRecentEvents] = useState<Event[]>([]);
  const [recentScans, setRecentScans] = useState<ScanLog[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isStaff = profile?.role === 'super_admin' || profile?.role === 'event_manager';

  useEffect(() => {
    async function loadData() {
      const today = new Date(); today.setHours(0, 0, 0, 0);

      const baseQueries = [
        supabase.from('events').select('id', { count: 'exact', head: true }),
        supabase.from('guests').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('qr_codes').select('id', { count: 'exact', head: true }),
        supabase.from('scan_logs').select('id', { count: 'exact', head: true }).gte('scanned_at', today.toISOString()),
        supabase.from('events').select('*').order('created_at', { ascending: false }).limit(6),
        supabase.from('scan_logs').select('*, guest:guests(name), event:events(name)').order('scanned_at', { ascending: false }).limit(8),
      ];

      const ticketingQueries = [
        supabase.from('ticket_orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'pending_verification'),
        supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'unused'),
        supabase.from('ticket_orders').select('total_amount').eq('payment_status', 'confirmed'),
        supabase.from('ticket_orders').select('id', { count: 'exact', head: true }).eq('is_flagged', true).neq('payment_status', 'cancelled'),
        supabase.from('ticket_orders').select('*, event:events(name, id)').eq('payment_status', 'pending_verification').order('created_at', { ascending: false }).limit(5),
      ];

      const [eventsRes, guestsRes, qrRes, scansRes, recentEventsRes, recentScansRes,
             pendingRes, ticketsRes, revenueRes, flaggedRes, pendingOrdersRes] =
        await Promise.all([...baseQueries, ...ticketingQueries]);

      const revenue = (revenueRes.data || []).reduce((sum: number, o: any) => sum + (o.total_amount || 0), 0);

      setStats({
        events: eventsRes.count || 0,
        guests: guestsRes.count || 0,
        qrCodes: qrRes.count || 0,
        scansToday: scansRes.count || 0,
        pendingOrders: pendingRes.count || 0,
        confirmedTickets: ticketsRes.count || 0,
        ticketRevenue: revenue,
        flaggedOrders: flaggedRes.count || 0,
      });

      setRecentEvents(recentEventsRes.data || []);
      setRecentScans(recentScansRes.data || []);
      setPendingOrders(pendingOrdersRes.data || []);
      setLoading(false);
    }
    loadData();
  }, []);

  const mainStats = [
    { label: 'Total Events',  value: stats.events,     icon: <CalendarDays size={20} />, color: 'text-blue-400',    bg: 'bg-blue-500/10',    link: '/events' },
    { label: 'Active Guests', value: stats.guests,     icon: <Users size={20} />,        color: 'text-emerald-400', bg: 'bg-emerald-500/10', link: '/guests' },
    { label: 'QR Codes',      value: stats.qrCodes,    icon: <QrCode size={20} />,       color: 'text-amber-400',   bg: 'bg-amber-500/10',   link: '/qrcodes' },
    { label: 'Scans Today',   value: stats.scansToday, icon: <ScanLine size={20} />,     color: 'text-cyan-400',    bg: 'bg-cyan-500/10',    link: '/logs' },
  ];

  const ticketStats = [
    { label: 'Pending Verification', display: stats.pendingOrders,                  numeric: stats.pendingOrders,    icon: <Clock size={18} />,       color: 'text-amber-400',   bg: 'bg-amber-500/10',   urgent: stats.pendingOrders > 0 },
    { label: 'Active Tickets',       display: stats.confirmedTickets,               numeric: stats.confirmedTickets, icon: <Ticket size={18} />,      color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  urgent: false },
    { label: 'Revenue (KES)',        display: stats.ticketRevenue.toLocaleString(),  numeric: stats.ticketRevenue,    icon: <CreditCard size={18} />,  color: 'text-emerald-400', bg: 'bg-emerald-500/10', urgent: false },
    { label: 'Flagged Orders',       display: stats.flaggedOrders,                  numeric: stats.flaggedOrders,    icon: <ShieldAlert size={18} />, color: 'text-red-400',     bg: 'bg-red-500/10',     urgent: stats.flaggedOrders > 0 },
  ];

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div></Layout>;

  return (
    <Layout>
      <Header
        title={`Good ${getGreeting()}, ${profile?.full_name?.split(' ')[0]}`}
        subtitle="System overview and activity"
      />

      {/* Main stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-4">
        {mainStats.map(card => (
          <Link key={card.label} to={card.link}
            className="p-4 lg:p-5 rounded-2xl bg-slate-900 border border-slate-800/60 hover:border-slate-700 transition-all duration-150 group">
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-xl ${card.bg}`}><span className={card.color}>{card.icon}</span></div>
              <TrendingUp size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
            </div>
            <p className="text-2xl lg:text-3xl font-bold text-slate-100">{card.value}</p>
            <p className="text-xs lg:text-sm text-slate-500 mt-1">{card.label}</p>
          </Link>
        ))}
      </div>

      {/* Ticketing stats — only for staff */}
      {isStaff && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Ticket size={15} className="text-indigo-400" />
            <p className="text-sm font-semibold text-slate-300">Ticketing Overview</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {ticketStats.map(card => (
              <div key={card.label}
                className={`p-4 rounded-2xl border transition-all ${card.urgent ? 'bg-slate-900 border-amber-500/30 ring-1 ring-amber-500/20' : 'bg-slate-900 border-slate-800/60'}`}>
                <div className={`inline-flex p-2 rounded-xl ${card.bg} mb-3`}>
                  <span className={card.color}>{card.icon}</span>
                </div>
                <p className={`text-xl font-bold ${card.color}`}>{card.display}</p>
                <p className="text-xs text-slate-500 mt-0.5">{card.label}</p>
                {card.urgent && card.numeric > 0 && (
                  <p className="text-amber-400 text-xs mt-1 font-medium">Needs attention</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Recent Events */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
          <div className="px-4 lg:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Recent Events</h2>
            <Link to="/events" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">View all</Link>
          </div>
          <div className="divide-y divide-slate-800/60">
            {recentEvents.length === 0 ? (
              <p className="px-6 py-8 text-sm text-slate-500 text-center">No events yet</p>
            ) : recentEvents.map(event => {
              const ev = event as any;
              return (
                <Link key={event.id} to={'/events/' + event.id}
                  className="flex items-center gap-3 px-4 lg:px-6 py-4 hover:bg-slate-800/30 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${ev.is_paid ? 'bg-indigo-500/10' : 'bg-blue-500/10'}`}>
                    {ev.is_paid
                      ? <Ticket size={15} className="text-indigo-400" />
                      : <CalendarDays size={15} className="text-blue-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{event.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {ev.is_paid
                        ? (ev.ticket_categories as TicketCategoryConfig[] || []).map((c: TicketCategoryConfig) => c.name).join(' · ') || 'Paid event'
                        : event.location}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.is_paid && (
                      <span className="text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded-full">Paid</span>
                    )}
                    {getStatusBadge(event.status)}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Pending orders OR recent scans */}
        {isStaff && pendingOrders.length > 0 ? (
          <div className="bg-slate-900 rounded-2xl border border-amber-500/20 overflow-hidden">
            <div className="px-4 lg:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between bg-amber-900/10">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-amber-400" />
                <h2 className="text-sm font-semibold text-amber-300">Pending Payment Verification</h2>
              </div>
              <span className="text-xs bg-amber-500 text-amber-950 font-bold px-2 py-0.5 rounded-full">{pendingOrders.length}</span>
            </div>
            <div className="divide-y divide-slate-800/60">
              {pendingOrders.map((order: any) => (
                <Link key={order.id} to={'/events/' + order.event_id + '/orders'}
                  className="flex items-center gap-3 px-4 lg:px-6 py-3.5 hover:bg-slate-800/30 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <CreditCard size={14} className="text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{order.customer_name}</p>
                    <p className="text-xs text-slate-500">
                      {order.ticket_category} · {order.quantity} ticket{order.quantity > 1 ? 's' : ''} · KES {order.total_amount.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium flex-shrink-0">
                    Verify <ExternalLink size={11} />
                  </div>
                </Link>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-800/60">
              <Link to="/events" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                Go to Events → select event → Orders to verify all payments
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
            <div className="px-4 lg:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Recent Scans</h2>
              <Link to="/logs" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">View all</Link>
            </div>
            <div className="divide-y divide-slate-800/60">
              {recentScans.length === 0 ? (
                <p className="px-6 py-8 text-sm text-slate-500 text-center">No scans yet</p>
              ) : recentScans.map(scan => (
                <div key={scan.id} className="flex items-center gap-3 px-4 lg:px-6 py-3.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
                    <ScanLine size={15} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{(scan as any).guest?.name || 'Unknown'}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock size={10} />{format(new Date(scan.scanned_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                  {getStatusBadge(scan.result)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}