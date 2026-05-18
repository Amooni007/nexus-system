import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, Users, QrCode,
  ScanLine, ShieldCheck, LogOut, Activity, Paintbrush,
  Menu, X, Ticket, ChevronDown, ChevronUp
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  roles?: string[];
  children?: { to: string; label: string }[];
}

const navItems: NavItem[] = [
  { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
  { to: '/events', icon: <CalendarDays size={18} />, label: 'Events', roles: ['super_admin', 'event_manager'] },
  { to: '/guests', icon: <Users size={18} />, label: 'Guests', roles: ['super_admin', 'event_manager'] },
  { to: '/qrcodes', icon: <QrCode size={18} />, label: 'QR Codes', roles: ['super_admin', 'event_manager'] },
  { to: '/templates', icon: <Paintbrush size={18} />, label: 'Templates', roles: ['super_admin', 'event_manager'] },
  { to: '/scanner', icon: <ScanLine size={18} />, label: 'Scanner' },
  { to: '/logs', icon: <Activity size={18} />, label: 'Scan Logs', roles: ['super_admin', 'event_manager'] },
  { to: '/admin', icon: <ShieldCheck size={18} />, label: 'Admin', roles: ['super_admin'] },
];

export default function Sidebar() {
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ticketingOpen, setTicketingOpen] = useState(false);
  const location = useLocation();

  const visibleItems = navItems.filter(
    item => !item.roles || (profile && item.roles.includes(profile.role))
  );

  const isStaff = profile && ['super_admin', 'event_manager'].includes(profile.role);

  // Highlight ticketing section if on an orders/ticket-list route
  const onTicketingRoute = location.pathname.includes('/orders') || location.pathname.includes('/ticket-list');

  const NavContent = ({ onItemClick }: { onItemClick?: () => void }) => (
    <>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <QrCode size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-tight">Nexus</h1>
            <p className="text-xs text-slate-500">Event Access System</p>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onItemClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        {/* ── Ticketing section (staff only) ── */}
        {isStaff && (
          <div>
            <button
              onClick={() => setTicketingOpen(o => !o)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-150
                ${onTicketingRoute
                  ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}`}
            >
              <Ticket size={18} />
              <span className="flex-1 text-left">Ticketing</span>
              {ticketingOpen || onTicketingRoute
                ? <ChevronUp size={14} />
                : <ChevronDown size={14} />}
            </button>

            {(ticketingOpen || onTicketingRoute) && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-700/60 pl-3">
                <p className="text-xs text-slate-600 px-2 pt-1 pb-0.5 font-medium uppercase tracking-wider">
                  Open an event first, then use:
                </p>
                <div className="px-2 py-2 rounded-lg bg-slate-800/40 text-xs text-slate-400 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    <span>Events → select event → <span className="text-indigo-400 font-medium">Orders</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    <span>Events → select event → <span className="text-indigo-400 font-medium">Tickets</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    <span>Public page: <span className="text-emerald-400 font-medium">/event/[id]/tickets</span></span>
                  </div>
                </div>
                <NavLink
                  to="/events"
                  onClick={onItemClick}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-indigo-400 hover:bg-indigo-900/20 transition-colors font-medium"
                >
                  <CalendarDays size={13} /> Go to Events →
                </NavLink>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* User + sign out */}
      <div className="px-3 py-4 border-t border-slate-800/60">
        <div className="px-3 py-2 mb-2">
          <p className="text-sm font-medium text-slate-300 truncate">{profile?.full_name}</p>
          <p className="text-xs text-slate-500 truncate">{profile?.email}</p>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/5 transition-all duration-150"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* ── DESKTOP sidebar (lg+) ── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-slate-950 border-r border-slate-800/60 flex-col z-30">
        <NavContent />
      </aside>

      {/* ── MOBILE top bar ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-slate-950 border-b border-slate-800/60 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <QrCode size={14} className="text-white" />
          </div>
          <span className="text-base font-bold text-slate-100">Nexus</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* ── MOBILE drawer overlay ── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          onClick={() => setMobileOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-72 max-w-[85vw] bg-slate-950 border-r border-slate-800/60 flex flex-col h-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors z-10"
            >
              <X size={18} />
            </button>
            <NavContent onItemClick={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}