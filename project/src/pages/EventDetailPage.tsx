import { generateQRToken } from '../lib/qr';
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Lock, Unlock, CalendarDays, MapPin,
  Users, UserX, QrCode, Edit2, CheckCircle, Ticket,
  ExternalLink, CreditCard, ClipboardList, Copy, Check, ImagePlus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/layout/Layout';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import { getStatusBadge } from '../components/common/Badge';
import FormField, { Input } from '../components/common/FormField';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { logActivity } from '../lib/logger';
import { format } from 'date-fns';
import type { Event, Guest, CreateGuestPayload } from '../types';
import type { TicketCategoryConfig } from '../types/ticketing';
import CategoryTemplateUploader from '../components/ticketing/CategoryTemplateUploader';

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [isAddGuestOpen, setIsAddGuestOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', date: '', location: '', description: '', template_id: '' });
  const [guestForm, setGuestForm] = useState<Omit<CreateGuestPayload, 'event_id'>>({ name: '', phone: '', email: '' });
  const [guestErrors, setGuestErrors] = useState<Partial<typeof guestForm>>({});
  const [submitting, setSubmitting] = useState(false);
  const [generatingQR, setGeneratingQR] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [eventRes, guestsRes, templatesRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', id!).maybeSingle(),
        supabase.from('guests').select('*, qr_code:qr_codes(*)').eq('event_id', id!).order('created_at', { ascending: false }),
        supabase.from('invitation_templates').select('id, name').order('created_at', { ascending: false }),
      ]);
      if (eventRes.error) throw eventRes.error;
      if (guestsRes.error) throw guestsRes.error;
      setEvent(eventRes.data);
      setTemplates(templatesRes.data || []);
      if (eventRes.data) {
        setEditForm({
          name: eventRes.data.name,
          date: eventRes.data.date.slice(0, 16),
          location: eventRes.data.location,
          description: eventRes.data.description || '',
          template_id: eventRes.data.template_id || '',
        });
      }
      setGuests(guestsRes.data?.map((g: any) => ({ ...g, qr_code: g.qr_code?.[0] || null })) || []);
    } catch (error) {
      console.error('Failed to load event data:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function toggleEventLock() {
    if (!event) return;
    try {
      const newStatus = event.status === 'open' ? 'locked' : 'open';
      const { error } = await supabase.from('events').update({ status: newStatus }).eq('id', event.id);
      if (error) throw error;
      await logActivity(profile!.id, 'event_' + newStatus, 'event', event.id);
      loadData();
    } catch (error) { console.error('Failed to toggle event lock:', error); }
  }

  async function handleUpdateEvent() {
    if (!event) return;
    setSubmitting(true);
    try {
      const updateData = { ...editForm, template_id: editForm.template_id || null };
      const { error } = await supabase.from('events').update(updateData).eq('id', event.id);
      if (error) throw error;
      await logActivity(profile!.id, 'update_event', 'event', event.id, updateData);
      setIsEditEventOpen(false);
      loadData();
    } catch (error) { console.error('Failed to update event:', error); }
    finally { setSubmitting(false); }
  }

  function validateGuest(): boolean {
    const errs: Partial<typeof guestForm> = {};
    if (!guestForm.name.trim()) errs.name = 'Guest name is required';
    if (guestForm.phone && !/^\d{8,}$/.test(guestForm.phone.replace(/\D/g, ''))) errs.phone = 'Phone must have at least 8 digits';
    if (guestForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestForm.email)) errs.email = 'Invalid email format';
    setGuestErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAddGuest() {
    if (!validateGuest()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('guests').insert({
        ...guestForm, event_id: id!, created_by: profile!.id,
      }).select().maybeSingle();
      if (error) throw error;
      if (data) {
        await generateQRForGuest(data.id);
        await logActivity(profile!.id, 'add_guest', 'guest', data.id, { name: guestForm.name });
        setIsAddGuestOpen(false);
        setGuestForm({ name: '', phone: '', email: '' });
        loadData();
      }
    } catch (error: any) { console.error('Failed to add guest:', error.message); }
    finally { setSubmitting(false); }
  }

  async function generateQRForGuest(guestId: string) {
    setGeneratingQR(guestId);
    try {
      const existing = await supabase.from('qr_codes').select('id').eq('guest_id', guestId).maybeSingle();
      if (!existing.data) {
        const qrToken = generateQRToken();
        const { error } = await supabase.from('qr_codes').insert({ guest_id: guestId, event_id: id!, code: qrToken, status: 'unused' });
        if (error) throw error;
      }
    } catch (error: any) { console.error('Failed to generate QR:', error.message); }
    finally { setGeneratingQR(null); }
  }

  async function toggleGuestStatus(guest: Guest) {
    try {
      const newStatus = guest.status === 'active' ? 'inactive' : 'active';
      const { error } = await supabase.from('guests').update({ status: newStatus }).eq('id', guest.id);
      if (error) throw error;
      await logActivity(profile!.id, 'guest_' + newStatus, 'guest', guest.id);
      loadData();
    } catch (error) { console.error('Failed to toggle guest status:', error); }
  }

  async function handleTemplatesUpdate(updated: TicketCategoryConfig[]) {
    if (!event) return;
    await supabase.from('events').update({ ticket_categories: updated }).eq('id', event.id);
    loadData();
  }

  function copyTicketLink() {
    const url = window.location.origin + '/event/' + id + '/tickets';
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canManage = (profile?.role === 'super_admin' || profile?.role === 'event_manager') && event?.status === 'open';
  const filtered = guests.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
  const ev = event as any;
  const isPaidEvent = ev?.is_paid === true;
  const ticketCategories: TicketCategoryConfig[] = ev?.ticket_categories || [];
  const publicTicketUrl = window.location.origin + '/event/' + id + '/tickets';

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div></Layout>;

  if (!event) return (
    <Layout>
      <div className="text-center py-20">
        <p className="text-slate-400">Event not found</p>
        <Link to="/events" className="text-blue-400 text-sm mt-2 inline-block">Back to Events</Link>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="mb-6">
        <Link to="/events" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-4">
          <ArrowLeft size={14} /> Back to Events
        </Link>

        {/* Event info card */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800/60 p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-100">{event.name}</h1>
                {getStatusBadge(event.status)}
                {isPaidEvent && (
                  <span className="flex items-center gap-1 text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-medium">
                    <Ticket size={11} /> Paid Event
                  </span>
                )}
              </div>
              {event.description && <p className="text-slate-500 text-sm mb-4">{event.description}</p>}
              <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-slate-600" />
                  {format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a')}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin size={14} className="text-slate-600" /> {event.location}
                </span>
              </div>
            </div>
            {(profile?.role === 'super_admin' || profile?.role === 'event_manager') && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" icon={<Edit2 size={14} />} onClick={() => setIsEditEventOpen(true)}>Edit</Button>
                <Button
                  variant={event.status === 'open' ? 'danger' : 'success'} size="sm"
                  icon={event.status === 'open' ? <Lock size={14} /> : <Unlock size={14} />}
                  onClick={toggleEventLock}
                >
                  {event.status === 'open' ? 'Lock Event' : 'Unlock Event'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── TICKETING PANEL (only for paid events) ──────────────────────────── */}
      {isPaidEvent && (
        <div className="mb-6 bg-slate-900 border border-indigo-800/40 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-4 bg-indigo-900/20 border-b border-indigo-800/30">
            <div className="flex items-center gap-2">
              <Ticket className="text-indigo-400" size={20} />
              <div>
                <p className="text-white font-semibold">Ticket Management</p>
                <p className="text-indigo-300/70 text-xs">
                  {ticketCategories.length} {ticketCategories.length === 1 ? 'category' : 'categories'} ·{' '}
                  {ev.payment_mode === 'host_manual' ? 'Manual M-Pesa verification' : 'Automated STK Push'}
                </p>
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <a href={publicTicketUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-indigo-500/40 text-indigo-400 hover:bg-indigo-900/40 transition-colors font-medium">
                <ExternalLink size={14} /> View Ticket Page
              </a>
              <Link to={'/events/' + id + '/orders'}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors">
                <CreditCard size={14} /> Orders
              </Link>
              <Link to={'/events/' + id + '/ticket-list'}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors">
                <ClipboardList size={14} /> Tickets
              </Link>
            </div>
          </div>

          {/* Ticket categories summary */}
          {ticketCategories.length > 0 && (
            <div className="px-5 py-3 flex flex-wrap gap-2">
              {ticketCategories.map(cat => (
                <div key={cat.name} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                    cat.name === 'VVIP' ? 'bg-yellow-500 text-yellow-950' :
                    cat.name === 'VIP' ? 'bg-slate-300 text-slate-900' : 'bg-blue-500 text-white'
                  }`}>{cat.name}</span>
                  <span className="text-emerald-400 font-semibold">KES {cat.price.toLocaleString()}</span>
                  <span className="text-slate-500 text-xs">{cat.quantity} max</span>
                  {cat.access_zone && <span className="text-slate-500 text-xs">· {cat.access_zone}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Template uploader toggle */}
          {ticketCategories.length > 0 && (
            <div className="border-t border-slate-800/60">
              <button
                onClick={() => setShowTemplates(t => !t)}
                className="w-full flex items-center justify-between px-5 py-3 text-sm text-slate-300 hover:text-white hover:bg-slate-800/30 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ImagePlus size={15} className="text-indigo-400" />
                  <span className="font-medium">Ticket Templates</span>
                  <span className="text-slate-500 text-xs font-normal">
                    {ticketCategories.some(c => (c as any).template_image_url) ? '✓ Templates uploaded' : 'Upload backgrounds per category'}
                  </span>
                </span>
                <span className="text-slate-500 text-xs">{showTemplates ? '▲ Hide' : '▼ Show'}</span>
              </button>

              {showTemplates && (
                <div className="px-5 pb-4">
                  <CategoryTemplateUploader
                    eventId={id!}
                    categories={ticketCategories}
                    onUpdate={handleTemplatesUpdate}
                  />
                </div>
              )}
            </div>
          )}

          {/* Public link copy bar */}
          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/40">
            <p className="text-xs text-slate-500 mb-1.5 font-medium">Public Ticket Purchase Link</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 font-mono truncate">
                {publicTicketUrl}
              </div>
              <button onClick={copyTicketLink}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors flex-shrink-0">
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <a href={publicTicketUrl} target="_blank" rel="noreferrer"
                className="p-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0">
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── GUESTS SECTION ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-200">
            Guests <span className="text-slate-600 font-normal">({guests.length})</span>
          </h2>
          <span className="text-sm text-slate-600">{guests.filter(g => g.status === 'active').length} active</span>
        </div>
        <div className="flex items-center gap-3">
          <input type="text" placeholder="Search guests..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-3 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 text-sm outline-none focus:border-slate-700 transition-colors w-48" />
          {canManage && (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setIsAddGuestOpen(true)}>Add Guest</Button>
          )}
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users size={32} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No guests yet</p>
            {canManage && <p className="text-slate-600 text-sm mt-1">Add guests to generate invitations</p>}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800/60">
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Guest</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Contact</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">QR Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(guest => (
                <tr key={guest.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-slate-300">{guest.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{guest.name}</p>
                        <p className="text-xs text-slate-600">{format(new Date(guest.created_at), 'MMM d, yyyy')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <div className="text-xs text-slate-500 space-y-0.5">
                      {guest.email && <p>{guest.email}</p>}
                      {guest.phone && <p>{guest.phone}</p>}
                      {!guest.email && !guest.phone && <p className="text-slate-700">—</p>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {generatingQR === guest.id ? <LoadingSpinner size="sm" /> :
                     guest.qr_code ? getStatusBadge((guest.qr_code as any).status) : (
                      <button onClick={() => generateQRForGuest(guest.id)}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                        <QrCode size={12} /> Generate
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(guest.status)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={'/guests/' + guest.id} className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2.5 py-1.5 rounded-lg border border-blue-500/20 hover:bg-blue-500/10">View</Link>
                      {canManage && (
                        <button onClick={() => toggleGuestStatus(guest)}
                          className={'text-xs px-2.5 py-1.5 rounded-lg border transition-colors ' + (guest.status === 'active' ? 'text-red-400 border-red-500/20 hover:bg-red-500/10' : 'text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10')}>
                          {guest.status === 'active' ? <UserX size={13} /> : <CheckCircle size={13} />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ADD GUEST MODAL */}
      <Modal isOpen={isAddGuestOpen} onClose={() => { setIsAddGuestOpen(false); setGuestErrors({}); }} title="Add Guest">
        <div className="space-y-4">
          <FormField label="Guest Name" error={guestErrors.name} required>
            <Input value={guestForm.name} onChange={e => setGuestForm({ ...guestForm, name: e.target.value })} placeholder="John Doe" error={!!guestErrors.name} />
          </FormField>
          <FormField label="Phone Number" error={guestErrors.phone}>
            <Input type="tel" value={guestForm.phone} onChange={e => setGuestForm({ ...guestForm, phone: e.target.value })} placeholder="+254 712 345 678" error={!!guestErrors.phone} />
          </FormField>
          <FormField label="Email Address" error={guestErrors.email}>
            <Input type="email" value={guestForm.email} onChange={e => setGuestForm({ ...guestForm, email: e.target.value })} placeholder="guest@example.com" error={!!guestErrors.email} />
          </FormField>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setIsAddGuestOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAddGuest} loading={submitting} className="flex-1">Add Guest</Button>
          </div>
        </div>
      </Modal>

      {/* EDIT EVENT MODAL */}
      <Modal isOpen={isEditEventOpen} onClose={() => setIsEditEventOpen(false)} title="Edit Event" size="lg">
        <div className="space-y-4">
          <FormField label="Event Name" required>
            <Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Date & Time" required>
              <Input type="datetime-local" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
            </FormField>
            <FormField label="Location" required>
              <Input value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Description">
            <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 text-sm outline-none focus:border-blue-500/50 resize-none transition-colors" />
          </FormField>
          <FormField label="Invitation Template">
            <select value={editForm.template_id} onChange={e => setEditForm({ ...editForm, template_id: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 text-sm outline-none focus:border-blue-500/50 transition-colors">
              <option value="">No template</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FormField>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setIsEditEventOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleUpdateEvent} loading={submitting} className="flex-1">Save Changes</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}