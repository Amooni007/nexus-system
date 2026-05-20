import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, CalendarDays, MapPin, Users, ChevronRight,
  Search, Trash2, AlertTriangle, X, Archive, Ticket,
  CreditCard, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import { getStatusBadge } from '../components/common/Badge';
import FormField, { Input, Textarea, Select } from '../components/common/FormField';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { logActivity } from '../lib/logger';
import { format } from 'date-fns';
import type { Event, CreateEventPayload, InvitationTemplate } from '../types';
import TicketCategoryManager from '../components/ticketing/TicketCategoryManager';
import PaymentSettingsPanel, { DEFAULT_PAYMENT_CONFIG } from '../components/ticketing/PaymentSettingsPanel';
import type { PaymentConfig } from '../components/ticketing/PaymentSettingsPanel';
import type { TicketCategoryConfig } from '../types/ticketing';

export default function EventsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [templates, setTemplates] = useState<InvitationTemplate[]>([]);
  const [formData, setFormData] = useState<CreateEventPayload>({ name: '', date: '', location: '', description: '' });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [errors, setErrors] = useState<Partial<CreateEventPayload>>({});
  const [submitting, setSubmitting] = useState(false);
  const [guestCounts, setGuestCounts] = useState<Record<string, number>>({});

  // Ticketing state
  const [isPaid, setIsPaid] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'platform_mpesa' | 'host_manual'>('host_manual');
  const [hostTill, setHostTill] = useState('');
  const [hostPaybill, setHostPaybill] = useState('');
  const [ticketCategories, setTicketCategories] = useState<TicketCategoryConfig[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>(DEFAULT_PAYMENT_CONFIG);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null);
  const [deleteMode, setDeleteMode] = useState<'archive' | 'permanent'>('archive');
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => { loadEvents(); loadTemplates(); }, []);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function loadTemplates() {
    const { data } = await supabase.from('invitation_templates').select('*').order('created_at', { ascending: false });
    setTemplates(data || []);
    const defaultTemplate = data?.find((t: any) => t.is_default);
    if (defaultTemplate) setSelectedTemplateId(defaultTemplate.id);
  }

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').neq('status', 'archived').order('date', { ascending: false });
    if (data && data.length > 0) {
      const { data: counts } = await supabase.from('guests').select('event_id').eq('status', 'active').in('event_id', data.map((e: any) => e.id));
      const countMap: Record<string, number> = {};
      counts?.forEach((g: any) => { countMap[g.event_id] = (countMap[g.event_id] || 0) + 1; });
      setGuestCounts(countMap);
    }
    setEvents(data || []);
    setLoading(false);
  }

  function resetCreateForm() {
    setFormData({ name: '', date: '', location: '', description: '' });
    setSelectedTemplateId('');
    setIsPaid(false);
    setPaymentMode('host_manual');
    setHostTill('');
    setHostPaybill('');
    setTicketCategories([]);
    setErrors({});
  }

  function validate(): boolean {
    const errs: Partial<CreateEventPayload> = {};
    if (!formData.name.trim()) errs.name = 'Event name is required';
    if (!formData.date) errs.date = 'Event date is required';
    if (!formData.location.trim()) errs.location = 'Location is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleCreate() {
    if (!validate()) return;
    setSubmitting(true);
    const { data, error } = await supabase.from('events').insert({
      ...formData,
      template_id: selectedTemplateId || null,
      created_by: profile!.id,
      is_paid: isPaid,
      payment_mode: isPaid ? paymentConfig.payment_mode : 'host_manual',
      allow_stk_push: isPaid ? paymentConfig.allow_stk_push : false,
      allow_manual: isPaid ? paymentConfig.allow_manual : false,
      host_till: isPaid && paymentConfig.host_till ? paymentConfig.host_till : null,
      host_paybill: isPaid && paymentConfig.host_paybill ? paymentConfig.host_paybill : null,
      business_name: isPaid && paymentConfig.business_name ? paymentConfig.business_name : null,
      payment_timeout: isPaid ? paymentConfig.payment_timeout : 2,
      account_format: isPaid ? paymentConfig.account_format : 'name_ref',
      ticket_categories: isPaid ? ticketCategories : [],
    }).select().maybeSingle();

    if (!error && data) {
      await logActivity(profile!.id, 'create_event', 'event', data.id, { name: formData.name, is_paid: isPaid });
      setIsModalOpen(false);
      resetCreateForm();
      loadEvents();
      if (isPaid) navigate('/events/' + data.id);
    }
    setSubmitting(false);
  }

  async function handleArchive() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('events').update({ status: 'archived' }).eq('id', deleteTarget.id);
      if (error) throw error;
      await logActivity(profile!.id, 'archive_event', 'event', deleteTarget.id, { name: deleteTarget.name });
      setEvents(prev => prev.filter(e => e.id !== deleteTarget.id));
      setDeleteTarget(null); setDeleteConfirmText('');
      showToast('"' + deleteTarget.name + '" has been archived.', 'success');
    } catch (err: any) {
      showToast('Failed to archive: ' + err.message, 'error');
    } finally { setDeleting(false); }
  }

  async function handlePermanentDelete() {
    if (!deleteTarget || deleteConfirmText !== deleteTarget.name) return;
    setDeleting(true);
    try {
      const eventId = deleteTarget.id;
      const { data: guests } = await supabase.from('guests').select('id').eq('event_id', eventId);
      const guestIds = guests?.map((g: any) => g.id) || [];
      // SERVER-SIDE: delete_event RPC handles cascade deletion atomically
      // Validates super_admin role, deletes all related data in correct FK order
      const { data: delResult, error: delErr } = await supabase.rpc('delete_event', {
        p_event_id: eventId,
        p_staff_id: profile!.id,
      });
      if (delErr) throw delErr;
      if (!delResult?.success) throw new Error(delResult?.error || 'Failed to delete event');
      const { error } = await supabase.from('events').delete().eq('id', eventId);
      if (error) throw error;
      await logActivity(profile!.id, 'delete_event', 'event', eventId, { name: deleteTarget.name });
      setEvents(prev => prev.filter(e => e.id !== eventId));
      setDeleteTarget(null); setDeleteConfirmText('');
      showToast('"' + deleteTarget.name + '" permanently deleted.', 'success');
    } catch (err: any) {
      showToast('Failed to delete: ' + err.message, 'error');
    } finally { setDeleting(false); }
  }

  const filtered = useMemo(() => events.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.location.toLowerCase().includes(search.toLowerCase())
  ), [events, search]);

  const canCreate = profile?.role === 'super_admin' || profile?.role === 'event_manager';
  const canDelete = profile?.role === 'super_admin';

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div></Layout>;

  return (
    <Layout>
      {toast && (
        <div className={`fixed top-4 right-4 left-4 sm:left-auto sm:w-80 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-950 border-emerald-500/30 text-emerald-300' : 'bg-red-950 border-red-500/30 text-red-300'}`}>
          {toast.type === 'success' ? '✅' : '❌'}
          <span className="flex-1">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
        </div>
      )}

      <Header
        title="Events"
        subtitle={events.length + ' event' + (events.length !== 1 ? 's' : '') + ' total'}
        actions={canCreate ? <Button icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>New Event</Button> : undefined}
      />

      <div className="mb-6 relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" placeholder="Search events..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 text-sm outline-none focus:border-slate-700 transition-colors" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={14} /></button>}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 rounded-2xl border border-slate-800/60">
          <CalendarDays size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No events found</p>
          {canCreate && <p className="text-slate-600 text-sm mt-1">Create your first event to get started</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(event => {
            const ev = event as any;
            return (
              <div key={event.id} className="group bg-slate-900 rounded-2xl border border-slate-800/60 hover:border-slate-700 transition-all duration-150 relative">
                {canDelete && (
                  <button onClick={e => { e.preventDefault(); setDeleteTarget(event); setDeleteMode('archive'); setDeleteConfirmText(''); }}
                    className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all" title="Delete event">
                    <Trash2 size={15} />
                  </button>
                )}
                <Link to={'/events/' + event.id} className="block p-5">
                  <div className="flex items-start justify-between mb-3 pr-6">
                    <div className="flex-1 min-w-0 mr-3">
                      <h3 className="text-base font-semibold text-slate-100 truncate group-hover:text-blue-400 transition-colors">{event.name}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {ev.is_paid && (
                        <span className="flex items-center gap-1 text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded-full font-medium">
                          <Ticket size={10} /> Paid
                        </span>
                      )}
                      {getStatusBadge(event.status)}
                      <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                    </div>
                  </div>
                  {event.description && <p className="text-sm text-slate-500 mb-3 line-clamp-2">{event.description}</p>}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <CalendarDays size={12} className="text-slate-600 flex-shrink-0" />
                      <span className="truncate">{format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                      <span className="truncate">{event.location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Users size={12} className="text-slate-600 flex-shrink-0" />
                      {guestCounts[event.id] || 0} active guest{(guestCounts[event.id] || 0) !== 1 ? 's' : ''}
                    </div>
                    {ev.is_paid && ev.ticket_categories && ev.ticket_categories.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                        {ev.ticket_categories.map((c: TicketCategoryConfig) => (
                          <span key={c.name} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                            {c.name} · KES {c.price.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* DELETE MODAL */}
      <Modal isOpen={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteConfirmText(''); }} title="Delete Event">
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-400">You are about to delete:</p>
                <p className="text-base font-bold text-white mt-0.5">"{deleteTarget.name}"</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteMode('archive')} className={'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm font-medium transition-all ' + (deleteMode === 'archive' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-slate-800/50 border-slate-700 text-slate-400')}>
                <Archive size={18} /><span>Archive</span><span className="text-xs font-normal opacity-70">Recoverable</span>
              </button>
              <button onClick={() => setDeleteMode('permanent')} className={'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm font-medium transition-all ' + (deleteMode === 'permanent' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-slate-800/50 border-slate-700 text-slate-400')}>
                <Trash2 size={18} /><span>Permanent</span><span className="text-xs font-normal opacity-70">Cannot undo</span>
              </button>
            </div>
            {deleteMode === 'permanent' && (
              <div className="space-y-2">
                <p className="text-xs text-red-400 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">⚠️ Permanently deletes event, all guests, QR codes, orders and tickets.</p>
                <p className="text-xs text-slate-400">Type <strong className="text-slate-200">{deleteTarget.name}</strong> to confirm:</p>
                <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={deleteTarget.name}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm outline-none focus:border-red-500/50" />
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(''); }}>Cancel</Button>
              {deleteMode === 'archive'
                ? <Button variant="danger" className="flex-1" icon={<Archive size={14} />} onClick={handleArchive} loading={deleting}>Archive</Button>
                : <Button variant="danger" className="flex-1" icon={<Trash2 size={14} />} onClick={handlePermanentDelete} loading={deleting} disabled={deleteConfirmText !== deleteTarget.name}>Delete Forever</Button>
              }
            </div>
          </div>
        )}
      </Modal>

      {/* CREATE EVENT MODAL */}
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); resetCreateForm(); }} title="Create New Event" size="lg">
        <div className="space-y-4">
          <FormField label="Event Name" error={errors.name} required>
            <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Annual Gala 2025" error={!!errors.name} />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Date & Time" error={errors.date} required>
              <Input type="datetime-local" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} error={!!errors.date} />
            </FormField>
            <FormField label="Location" error={errors.location} required>
              <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} placeholder="Grand Ballroom, Nairobi" error={!!errors.location} />
            </FormField>
          </div>
          <FormField label="Description">
            <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description..." rows={2} />
          </FormField>
          <FormField label="Invitation Template">
            <Select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}>
              <option value="">No template</option>
              {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (Default)' : ''}</option>)}
            </Select>
          </FormField>

          {/* PAID TICKETING TOGGLE */}
          <div className="border border-slate-700 rounded-2xl overflow-hidden">
            <button type="button" onClick={() => setIsPaid(p => !p)}
              className={'w-full flex items-center justify-between px-4 py-3 text-left transition-colors ' + (isPaid ? 'bg-indigo-900/30' : 'bg-slate-800/50')}>
              <div className="flex items-center gap-2.5">
                <Ticket size={18} className={isPaid ? 'text-indigo-400' : 'text-slate-500'} />
                <div>
                  <p className={'text-sm font-semibold ' + (isPaid ? 'text-indigo-300' : 'text-slate-300')}>Enable Paid Ticketing</p>
                  <p className="text-xs text-slate-500">Sell tickets with M-Pesa, auto-generate QR codes</p>
                </div>
              </div>
              {isPaid ? <ToggleRight size={28} className="text-indigo-400 flex-shrink-0" /> : <ToggleLeft size={28} className="text-slate-600 flex-shrink-0" />}
            </button>

            {isPaid && (
              <div className="px-4 pb-4 pt-3 space-y-4 border-t border-slate-700/60">
                <PaymentSettingsPanel
                  config={paymentConfig}
                  onChange={setPaymentConfig}
                />

                <div>
                  <label className="text-slate-400 text-xs font-medium mb-2 block">Ticket Categories</label>
                  <TicketCategoryManager categories={ticketCategories} onChange={setTicketCategories} />
                  {ticketCategories.length === 0 && (
                    <p className="text-amber-400 text-xs mt-2">⚠ Add at least one ticket category.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetCreateForm(); }} className="flex-1">Cancel</Button>
            <Button onClick={handleCreate} loading={submitting} className="flex-1" disabled={isPaid && ticketCategories.length === 0}>
              {isPaid ? '🎟 Create Ticketed Event' : 'Create Event'}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}