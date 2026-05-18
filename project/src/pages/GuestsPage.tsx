import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Plus, Upload, Trash2, Lock,
  FileSpreadsheet, UserPlus, Edit2, ChevronRight,
  Search, CheckSquare, Square, AlertTriangle, X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import { getStatusBadge } from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import { useAuth } from '../contexts/AuthContext';
import { parseCSVFile, validateGuestRow, importGuestsBulk } from '../lib/bulkImport';
import { generateQRToken } from '../lib/qr';
import type { Guest, Event, BulkGuestImport } from '../types';

interface GuestWithEvent extends Guest {
  event: Event;
}

export default function GuestsPage() {
  const { profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [guests, setGuests] = useState<GuestWithEvent[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('single');
  const [importProgress, setImportProgress] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', event_id: '' });
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);

  // ✅ Search
  const [search, setSearch] = useState('');

  // ✅ Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const isSuperAdmin = profile?.role === 'super_admin';

  useEffect(() => { loadInitialData(); }, []);

  async function loadInitialData() {
    setLoading(true);
    const [gRes, eRes] = await Promise.all([
      supabase.from('guests').select('*, event:events(*)').order('created_at', { ascending: false }),
      supabase.from('events').select('*').order('date', { ascending: true })
    ]);
    setGuests((gRes.data || []) as GuestWithEvent[]);
    setEvents(eRes.data || []);
    setLoading(false);
  }

  // ✅ Filtered guests based on search
  const filteredGuests = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return guests;
    return guests.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.phone?.toLowerCase().includes(q) ||
      g.email?.toLowerCase().includes(q) ||
      g.event?.name?.toLowerCase().includes(q)
    );
  }, [guests, search]);

  const checkIsLocked = (event: Event | null) => {
    if (isSuperAdmin || !event) return false;
    if (event.status === 'locked') return true;
    return (new Date(event.date).getTime() - Date.now()) < (2 * 24 * 60 * 60 * 1000);
  };

  // ✅ Select / deselect one
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ✅ Select all visible (filtered) guests
  function toggleSelectAll() {
    if (selectedIds.size === filteredGuests.length && filteredGuests.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredGuests.map(g => g.id)));
    }
  }

  const allSelected = filteredGuests.length > 0 && selectedIds.size === filteredGuests.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  // ✅ Bulk delete
  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);

      // ✅ Delete in correct FK order: scan_logs → qr_codes → guests
      await supabase.from('scan_logs').delete().in('guest_id', ids);
      await supabase.from('qr_codes').delete().in('guest_id', ids);

      // Delete guests
      const { error } = await supabase.from('guests').delete().in('id', ids);
      if (error) throw error;

      setGuests(prev => prev.filter(g => !selectedIds.has(g.id)));
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
    } catch (err: any) {
      alert('Bulk delete failed: ' + err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  // Single delete
  async function handleDeleteGuest(guest: Guest) {
    if (!window.confirm(`Permanently delete ${guest.name}?`)) return;
    // ✅ Delete in correct FK order: scan_logs → qr_codes → guest
    await supabase.from('scan_logs').delete().eq('guest_id', guest.id);
    await supabase.from('qr_codes').delete().eq('guest_id', guest.id);
    const { error } = await supabase.from('guests').delete().eq('id', guest.id);
    if (error) alert(error.message);
    else setGuests(prev => prev.filter(g => g.id !== guest.id));
  }

  async function handleAddGuest() {
    if (!formData.name || !formData.event_id || !formData.phone) {
      return alert("Name, Phone, and Event are required.");
    }
    const { data: guest, error } = await supabase
      .from('guests')
      .insert({
        name: formData.name,
        phone: formData.phone.replace(/\D/g, ''),
        email: formData.email || null,
        event_id: formData.event_id,
        created_by: profile?.id,
        status: 'active'
      })
      .select('id')
      .single();

    if (error) {
      alert("Error adding guest: " + error.message);
    } else {
      await supabase.from('qr_codes').insert({
        guest_id: guest.id,
        event_id: formData.event_id,
        code: generateQRToken(),
        status: 'unused'
      });
      setFormData({ name: '', email: '', phone: '', event_id: '' });
      setIsModalOpen(false);
      await loadInitialData();
    }
  }

  async function handleUpdateGuest() {
    if (!editingGuest) return;
    const { error } = await supabase
      .from('guests')
      .update({ name: editingGuest.name, email: editingGuest.email, phone: editingGuest.phone })
      .eq('id', editingGuest.id);
    if (error) alert(error.message);
    else { setIsEditModalOpen(false); await loadInitialData(); }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !formData.event_id) { alert("Please select an event first."); return; }

    setImporting(true);
    setImportProgress('Parsing file...');

    try {
      const rows = await parseCSVFile(file);
      setImportProgress(`Found ${rows.length} rows. Validating...`);

      const validGuests: BulkGuestImport[] = [];
      const errors: string[] = [];

      rows.forEach((row, index) => {
        const validation = validateGuestRow(row, index);
        if (validation.valid && validation.guest) validGuests.push(validation.guest);
        else if (validation.error) errors.push(validation.error);
      });

      if (validGuests.length === 0) throw new Error(`No valid guests found.\n${errors.join('\n')}`);

      setImportProgress(`Importing ${validGuests.length} guests...`);
      const result = await importGuestsBulk(validGuests, formData.event_id, profile!.id);

      let message = `✅ Successfully imported ${result.imported} guests.`;
      if (result.duplicates > 0) message += `\n⚠️ ${result.duplicates} duplicates skipped.`;
      if (result.errors.length > 0) message += `\n❌ Errors: ${result.errors.join(', ')}`;
      if (errors.length > 0) message += `\n📝 Warnings: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` and ${errors.length - 5} more...` : ''}`;

      alert(message);
      setIsModalOpen(false);
      await loadInitialData();
    } catch (err: any) {
      alert("Import failed: " + err.message);
    } finally {
      setImporting(false);
      setImportProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading && guests.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header
        title="Guest Management"
        subtitle={`${guests.length} total guests across all events`}
        actions={
          <Button icon={<Plus size={18} />} onClick={() => setIsModalOpen(true)}>
            Add Guests
          </Button>
        }
      />

      {/* ✅ Search + Bulk Actions Bar */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, phone, email or event..."
            value={search}
            onChange={e => { setSearch(e.target.value); setSelectedIds(new Set()); }}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 text-sm outline-none focus:border-slate-700 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Bulk delete button */}
        {selectedIds.size > 0 && (
          <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            <Trash2 size={14} />
            Delete {selectedIds.size} selected
          </button>
        )}
      </div>

      {/* Search results count */}
      {search && (
        <p className="text-xs text-slate-500 mt-2">
          {filteredGuests.length} result{filteredGuests.length !== 1 ? 's' : ''} for "{search}"
        </p>
      )}

      {/* ── Select all bar (shows when items exist) ── */}
      {filteredGuests.length > 0 && (
        <div className="mt-4 flex items-center justify-between px-1">
          <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            {allSelected ? <CheckSquare size={16} className="text-indigo-400" /> : someSelected ? <CheckSquare size={16} className="text-indigo-400/50" /> : <Square size={16} />}
            <span>{allSelected ? 'Deselect all' : `Select all (${filteredGuests.length})`}</span>
          </button>
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Clear ({selectedIds.size})
            </button>
          )}
        </div>
      )}

      {/* ── MOBILE: Card list ── */}
      <div className="mt-3 space-y-3 md:hidden">
        {filteredGuests.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm bg-slate-900/50 rounded-2xl border border-slate-800/60">
            {search ? `No guests found matching "${search}"` : 'No guests yet'}
          </div>
        ) : filteredGuests.map(guest => {
          const locked = checkIsLocked(guest.event);
          const isSelected = selectedIds.has(guest.id);
          return (
            <div key={guest.id} className={`bg-slate-900 rounded-2xl border transition-all ${isSelected ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-slate-800/60'}`}>
              <div className="flex items-start gap-3 p-4">
                {/* Checkbox */}
                <button onClick={() => toggleSelect(guest.id)} className="mt-0.5 flex-shrink-0 text-slate-500 hover:text-indigo-400 transition-colors">
                  {isSelected ? <CheckSquare size={18} className="text-indigo-400" /> : <Square size={18} />}
                </button>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-slate-100 font-semibold truncate">{guest.name}</p>
                    {getStatusBadge(guest.status)}
                  </div>
                  <p className="text-sm text-slate-500">{guest.phone}</p>
                  {guest.email && <p className="text-xs text-slate-600 mt-0.5 truncate">{guest.email}</p>}
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-2">
                    {locked ? <Lock size={11} className="text-amber-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    <span className="font-medium text-slate-400">{guest.event?.name}</span>
                    <span>·</span>
                    <span>{guest.event?.date ? new Date(guest.event.date).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </div>
              </div>
              {/* Actions row */}
              <div className="flex items-center gap-2 px-4 pb-3">
                <Link to={`/guests/${guest.id}`} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 text-indigo-400 text-xs font-medium hover:bg-slate-700 transition-colors">
                  <ChevronRight size={13} /> View
                </Link>
                {(!locked || isSuperAdmin) && (
                  <>
                    <button onClick={() => { setEditingGuest(guest); setIsEditModalOpen(true); }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-medium hover:bg-slate-700 transition-colors">
                      <Edit2 size={13} /> Edit
                    </button>
                    <button onClick={() => handleDeleteGuest(guest)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors border border-red-500/20">
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── DESKTOP: Table ── */}
      <div className="mt-3 hidden md:block bg-slate-900/50 backdrop-blur-md rounded-3xl border border-slate-800/60 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-800/60 bg-slate-800/30">
                <th className="pl-6 py-4 w-12" />
                <th className="px-4 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Guest Info</th>
                <th className="px-4 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Event</th>
                <th className="px-4 py-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-4 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filteredGuests.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-16 text-slate-500 text-sm">{search ? `No guests found matching "${search}"` : 'No guests yet'}</td></tr>
              ) : filteredGuests.map(guest => {
                const locked = checkIsLocked(guest.event);
                const isSelected = selectedIds.has(guest.id);
                return (
                  <tr key={guest.id} className={`group transition-all duration-150 ${isSelected ? 'bg-indigo-500/8 border-l-2 border-l-indigo-500' : 'hover:bg-indigo-500/5'}`}>
                    <td className="pl-6 py-4">
                      <button onClick={() => toggleSelect(guest.id)} className="text-slate-500 hover:text-indigo-400 transition-colors">
                        {isSelected ? <CheckSquare size={17} className="text-indigo-400" /> : <Square size={17} />}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-slate-100 font-medium">{guest.name}</div>
                      <div className="text-sm text-slate-500 mt-0.5">{guest.phone}</div>
                      {guest.email && <div className="text-xs text-slate-600 mt-0.5">{guest.email}</div>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-slate-300 font-medium">{guest.event?.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        {locked ? <Lock size={12} className="text-amber-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                        {guest.event?.date ? new Date(guest.event.date).toLocaleDateString() : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-4">{getStatusBadge(guest.status)}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        {(!locked || isSuperAdmin) && (
                          <>
                            <button onClick={() => { setEditingGuest(guest); setIsEditModalOpen(true); }} className="text-slate-500 hover:text-indigo-400 transition-colors"><Edit2 size={16} /></button>
                            <button onClick={() => handleDeleteGuest(guest)} className="text-slate-500 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                          </>
                        )}
                        <Link to={`/guests/${guest.id}`} className="text-indigo-400 hover:text-indigo-300 transition-colors"><ChevronRight size={18} /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredGuests.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-800/60 flex items-center justify-between">
            <p className="text-xs text-slate-500">{selectedIds.size > 0 ? `${selectedIds.size} of ${filteredGuests.length} selected` : `${filteredGuests.length} guest${filteredGuests.length !== 1 ? 's' : ''}`}</p>
            {selectedIds.size > 0 && <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear selection</button>}
          </div>
        )}
      </div>

      {/* ✅ Bulk Delete Confirmation Modal */}
      <Modal
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        title="Delete Selected Guests"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-400 font-semibold">This action cannot be undone</p>
              <p className="text-sm text-red-400/80 mt-1">
                You are about to permanently delete <strong>{selectedIds.size} guest{selectedIds.size !== 1 ? 's' : ''}</strong> and their QR codes.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowBulkDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              icon={<Trash2 size={14} />}
              onClick={handleBulkDelete}
              loading={bulkDeleting}
            >
              Delete {selectedIds.size} Guest{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Guest Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setFormData({ name: '', email: '', phone: '', event_id: '' }); }}
        title="Add Guests"
        size="lg"
      >
        <div className="p-1">
          <div className="mb-6">
            <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2 block">1. Select Event</label>
            <select
              value={formData.event_id}
              onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">Select Event...</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 mb-6">
            <button
              onClick={() => setActiveTab('single')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'single' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
            >
              <UserPlus size={16} /> Individual
            </button>
            <button
              onClick={() => setActiveTab('bulk')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'bulk' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
            >
              <FileSpreadsheet size={16} /> Bulk Import
            </button>
          </div>

          {activeTab === 'single' ? (
            <div className="space-y-4">
              <input placeholder="Full Name *" className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-white outline-none focus:border-indigo-500 transition-colors" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              <input placeholder="Phone Number *" className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-white outline-none focus:border-indigo-500 transition-colors" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
              <input placeholder="Email Address (Optional)" className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-white outline-none focus:border-indigo-500 transition-colors" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
              <Button onClick={handleAddGuest} className="w-full py-4 bg-indigo-600">Save Guest Profile</Button>
            </div>
          ) : (
            <div
              onClick={() => !importing && fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-800 hover:border-indigo-500 bg-slate-900/50 p-10 rounded-2xl text-center cursor-pointer transition-colors"
            >
              {importing ? (
                <div className="flex flex-col items-center gap-3">
                  <LoadingSpinner size="sm" />
                  <p className="text-slate-300 text-sm">{importProgress}</p>
                </div>
              ) : (
                <>
                  <Upload className="text-indigo-500 mx-auto mb-2" size={28} />
                  <h3 className="text-slate-200 font-medium">Click to upload CSV/Excel file</h3>
                  <p className="text-slate-500 text-sm mt-1">Columns: Name, Phone, Email (optional)</p>
                </>
              )}
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.csv" className="hidden" disabled={importing} />
            </div>
          )}
        </div>
      </Modal>

      {/* Edit Guest Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Guest Details">
        <div className="space-y-4 p-1">
          <input placeholder="Name" className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-white outline-none focus:border-indigo-500 transition-colors" value={editingGuest?.name || ''} onChange={e => setEditingGuest(prev => prev ? { ...prev, name: e.target.value } : null)} />
          <input placeholder="Phone" className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-white outline-none focus:border-indigo-500 transition-colors" value={editingGuest?.phone || ''} onChange={e => setEditingGuest(prev => prev ? { ...prev, phone: e.target.value } : null)} />
          <input placeholder="Email" className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-white outline-none focus:border-indigo-500 transition-colors" value={editingGuest?.email || ''} onChange={e => setEditingGuest(prev => prev ? { ...prev, email: e.target.value } : null)} />
          <Button onClick={handleUpdateGuest} className="w-full py-4 bg-indigo-600">Save Changes</Button>
        </div>
      </Modal>
    </Layout>
  );
}