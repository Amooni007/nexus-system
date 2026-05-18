import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, QrCode, Download, MessageCircle,
  Mail, Phone, Calendar, MapPin, RefreshCw, User
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/layout/Layout';
import Button from '../components/common/Button';
import { getStatusBadge } from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { generateQRDataURL } from '../lib/qr';
import { downloadInvitationAsPDF } from '../lib/pdf';
import { logActivity } from '../lib/logger';
import { format } from 'date-fns';
import InvitationCard from '../components/InvitationCard'; // ✅ NEW
import type { Guest, Event, QRCode, InvitationTemplate } from '../types'; // ✅ NEW

export default function GuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [qrCode, setQrCode] = useState<QRCode | null>(null);
  const [qrImage, setQrImage] = useState<string>('');
  const [template, setTemplate] = useState<InvitationTemplate | null>(null); // ✅ NEW
  const [loading, setLoading] = useState(true);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const invitationRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    const { data: guestData } = await supabase
      .from('guests')
      .select('*')
      .eq('id', id!)
      .maybeSingle();

    if (!guestData) { setLoading(false); return; }
    setGuest(guestData);

    const [eventRes, qrRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', guestData.event_id).maybeSingle(),
      supabase.from('qr_codes').select('*').eq('guest_id', id!).maybeSingle(),
    ]);

    setEvent(eventRes.data);
    setQrCode(qrRes.data);

    // ✅ FIX: Load the template linked to this event
    if (eventRes.data?.template_id) {
      const { data: templateData } = await supabase
        .from('invitation_templates')
        .select('*')
        .eq('id', eventRes.data.template_id)
        .maybeSingle();

      if (templateData) setTemplate(templateData);
    }

    if (qrRes.data?.code) {
      const img = await generateQRDataURL(qrRes.data.code);
      setQrImage(img);
    }

    setLoading(false);
  }

  async function generateQR() {
    if (!guest) return;
    setRegenerating(true);

    const existing = await supabase
      .from('qr_codes')
      .select('*')
      .eq('guest_id', guest.id)
      .maybeSingle();

    let code = existing.data;

    if (!code) {
      const { data } = await supabase.from('qr_codes').insert({
        guest_id: guest.id,
        event_id: guest.event_id,
      }).select().maybeSingle();
      code = data;
    }

    if (code) {
      setQrCode(code);
      const img = await generateQRDataURL(code.code);
      setQrImage(img);
      await logActivity(profile!.id, 'generate_qr', 'qr_code', code.id, { guest_id: guest.id });
    }

    setRegenerating(false);
  }

  async function handleDownloadPDF() {
    setDownloadingPDF(true);
    try {
      // ✅ FIX: Target the InvitationCard element, not the old hardcoded layout
      await downloadInvitationAsPDF('invitation-card', `invitation-${guest?.name.replace(/\s+/g, '-')}`);
      await logActivity(profile!.id, 'download_pdf', 'guest', guest?.id);
    } catch {
      alert('Failed to generate PDF. Please try again.');
    }
    setDownloadingPDF(false);
  }

  function handleWhatsApp() {
    if (!guest || !event) return;
    const inviteLink = `${window.location.origin}/invitation/${guest.id}`;
    const message = encodeURIComponent(
      `Hi ${guest.name}! 🎉\n\nYou're invited to *${event.name}*!\n\n📅 ${format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a')}\n📍 ${event.location}\n\nView your invitation & QR code here:\n${inviteLink}`
    );
    const phone = guest.phone?.replace(/\D/g, '');
    const url = phone ? `https://wa.me/${phone}?text=${message}` : `https://wa.me/?text=${message}`;
    window.open(url, '_blank');
    logActivity(profile!.id, 'send_whatsapp', 'guest', guest.id);
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  if (!guest || !event) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="text-slate-400">Guest not found</p>
        </div>
      </Layout>
    );
  }

  const invitationLink = `${window.location.origin}/invitation/${guest.id}`;

  return (
    <Layout>
      <div className="mb-6">
        <Link
          to={`/events/${guest.event_id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to {event.name}
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-100">{guest.name}</h1>
              {getStatusBadge(guest.status)}
            </div>
            <p className="text-slate-500 text-sm">
              Added {format(new Date(guest.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {qrImage && (
              <>
                <Button
                  variant="secondary"
                  icon={<MessageCircle size={15} />}
                  onClick={handleWhatsApp}
                  size="sm"
                >
                  Send WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  icon={<Download size={15} />}
                  onClick={handleDownloadPDF}
                  loading={downloadingPDF}
                  size="sm"
                >
                  Download PDF
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Guest info + QR + link */}
        <div className="space-y-5">
          <div className="bg-slate-900 rounded-2xl border border-slate-800/60 p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Guest Details</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <User size={16} className="text-slate-600" />
                <div>
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="text-sm text-slate-200">{guest.name}</p>
                </div>
              </div>
              {guest.email && (
                <div className="flex items-center gap-3">
                  <Mail size={16} className="text-slate-600" />
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="text-sm text-slate-200">{guest.email}</p>
                  </div>
                </div>
              )}
              {guest.phone && (
                <div className="flex items-center gap-3">
                  <Phone size={16} className="text-slate-600" />
                  <div>
                    <p className="text-xs text-slate-500">Phone</p>
                    <p className="text-sm text-slate-200">{guest.phone}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Calendar size={16} className="text-slate-600" />
                <div>
                  <p className="text-xs text-slate-500">Event</p>
                  <p className="text-sm text-slate-200">{event.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MapPin size={16} className="text-slate-600" />
                <div>
                  <p className="text-xs text-slate-500">Location</p>
                  <p className="text-sm text-slate-200">{event.location}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300">QR Code</h2>
              {!qrCode && (
                <Button size="sm" icon={<QrCode size={13} />} onClick={generateQR} loading={regenerating}>
                  Generate QR
                </Button>
              )}
              {qrCode && (
                <div className="flex items-center gap-2">
                  {getStatusBadge(qrCode.status)}
                  {qrCode.status === 'unused' && (
                    <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={generateQR} loading={regenerating}>
                      Regen
                    </Button>
                  )}
                </div>
              )}
            </div>

            {qrImage ? (
              <div className="flex flex-col items-center">
                <div className="bg-white p-3 rounded-xl">
                  <img src={qrImage} alt="QR Code" className="w-40 h-40" />
                </div>
                <p className="text-xs text-slate-600 mt-3 font-mono break-all text-center">{qrCode?.code}</p>
                {qrCode?.used_at && (
                  <p className="text-xs text-slate-500 mt-1">
                    Used: {format(new Date(qrCode.used_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-slate-600">
                <QrCode size={40} className="mb-2 text-slate-700" />
                <p className="text-sm">No QR code generated yet</p>
              </div>
            )}
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800/60 p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Invitation Link</h2>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={invitationLink}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-xs font-mono outline-none"
              />
              <button
                onClick={() => navigator.clipboard.writeText(invitationLink)}
                className="px-3 py-2 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: ✅ FIX — Now uses InvitationCard with the real template */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">Invitation Preview</h2>
            {/* Show which template is being used */}
            {template ? (
              <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                Template: {template.name}
              </span>
            ) : (
              <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                No template assigned
              </span>
            )}
          </div>

          {/* ✅ This is the element captured for PDF */}
          <div id="invitation-card" ref={invitationRef}>
            <InvitationCard
              guest={guest}
              event={event}
              template={template}
              qrImage={qrImage}
              qrCode={qrCode}
              mode="final"
            />
          </div>

          {/* Show a hint if no template is assigned */}
          {!template && (
            <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-amber-400 text-xs">
                No template is assigned to this event. 
                <Link to={`/events/${event.id}`} className="underline ml-1 hover:text-amber-300">
                  Edit the event
                </Link>
                {' '}to select a template.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}