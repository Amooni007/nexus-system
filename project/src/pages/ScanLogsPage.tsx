import { useEffect, useState } from 'react';
import { Activity, Search, ScanLine } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import { getStatusBadge } from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { format } from 'date-fns';
import type { ScanLog } from '../types';

interface ScanLogWithRelations extends ScanLog {
  guest?: { name: string };
  event?: { name: string };
  staff?: { full_name: string };
}

export default function ScanLogsPage() {
  const [logs, setLogs] = useState<ScanLogWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'accepted' | 'rejected_inactive' | 'rejected_used' | 'invalid'>('all');

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('scan_logs')
        .select('*, guest:guests(name), event:events(name), staff:profiles(full_name)')
        .order('scanned_at', { ascending: false })
        .limit(200);
      setLogs(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = logs.filter((l) => {
    const guestName = (l.guest as any)?.name?.toLowerCase() || '';
    const eventName = (l.event as any)?.name?.toLowerCase() || '';
    const matchesSearch = guestName.includes(search.toLowerCase()) || eventName.includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || l.result === filter;
    return matchesSearch && matchesFilter;
  });

  const filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'rejected_inactive', label: 'Rejected' },
    { value: 'rejected_used', label: 'Used' },
    { value: 'invalid', label: 'Invalid' },
  ] as const;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header title="Scan Logs" subtitle={`${logs.length} total scan records`} />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by guest or event..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 text-sm outline-none focus:border-slate-700 transition-colors"
          />
        </div>
        <div className="flex rounded-xl overflow-hidden border border-slate-800">
          {filterOptions.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value as typeof filter)}
              className={`px-3 py-2.5 text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <Activity size={40} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400">No scan logs found</p>
          </div>
        ) : (
          <div class="overflow-x-auto"><table className="w-full">
            <thead>
              <tr className="border-b border-slate-800/60">
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Guest</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">Event</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Result</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Scanned By</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <ScanLine size={14} className="text-slate-600 flex-shrink-0" />
                      <p className="text-sm font-medium text-slate-200">{(log.guest as any)?.name || 'Unknown'}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <p className="text-sm text-slate-400">{(log.event as any)?.name || '—'}</p>
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(log.result)}</td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <p className="text-sm text-slate-400">{(log.staff as any)?.full_name || '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs text-slate-500">{format(new Date(log.scanned_at), 'MMM d, yyyy')}</p>
                    <p className="text-xs text-slate-600">{format(new Date(log.scanned_at), 'h:mm:ss a')}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </Layout>
  );
}