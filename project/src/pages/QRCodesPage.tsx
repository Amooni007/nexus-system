import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import { getStatusBadge } from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { format } from 'date-fns';
import type { QRCode } from '../types';

interface QRWithGuest extends QRCode {
  guest?: { name: string; id: string };
  event?: { name: string };
}

export default function QRCodesPage() {
  const [codes, setCodes] = useState<QRWithGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unused' | 'used'>('all');

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('qr_codes')
        .select('*, guest:guests(id, name), event:events(name)')
        .order('created_at', { ascending: false });
      setCodes(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = codes.filter((c) => {
    const guestName = (c.guest as any)?.name?.toLowerCase() || '';
    const eventName = (c.event as any)?.name?.toLowerCase() || '';
    const matchesSearch = guestName.includes(search.toLowerCase()) ||
      eventName.includes(search.toLowerCase()) ||
      c.code.includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || c.status === filter;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header title="QR Codes" subtitle={`${codes.length} codes generated`} />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by guest, event, or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 text-sm outline-none focus:border-slate-700 transition-colors"
          />
        </div>
        <div className="flex rounded-xl overflow-hidden border border-slate-800">
          {(['all', 'unused', 'used'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                filter === f ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <QrCode size={40} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400">No QR codes found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800/60">
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Guest</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">Event</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden lg:table-cell">Code</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Created</th>
                <th className="text-right px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((code) => (
                <tr key={code.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-200">{(code.guest as any)?.name || '—'}</p>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <p className="text-sm text-slate-400">{(code.event as any)?.name || '—'}</p>
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <p className="text-xs text-slate-600 font-mono">{code.code.slice(0, 18)}...</p>
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(code.status)}</td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <p className="text-xs text-slate-500">{format(new Date(code.created_at), 'MMM d, yyyy')}</p>
                    {code.used_at && (
                      <p className="text-xs text-slate-600">Used: {format(new Date(code.used_at), 'MMM d, h:mm a')}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {(code.guest as any)?.id && (
                      <Link
                        to={`/guests/${(code.guest as any).id}`}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        View Guest
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
