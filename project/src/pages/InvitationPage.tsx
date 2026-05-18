import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { QrCode, Download, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generateQRDataURL } from '../lib/qr';
import { downloadInvitationAsPDF } from '../lib/pdf';
import LoadingSpinner from '../components/common/LoadingSpinner';
import InvitationCard from '../components/InvitationCard';
import { format } from 'date-fns';
import type { Guest, Event, QRCode } from '../types';

export default function InvitationPage() {
  const [template, setTemplate] = useState<any>(null);
  const { guestId } = useParams<{ guestId: string }>();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [qrCode, setQrCode] = useState<QRCode | null>(null);
  const [qrImage, setQrImage] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const invRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const { data: guestData } = await supabase
        .from('guests')
        .select('*')
        .eq('id', guestId!)
        .maybeSingle();

      if (!guestData) { setNotFound(true); setLoading(false); return; }
      setGuest(guestData);

      const [eventRes, qrRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', guestData.event_id).maybeSingle(),
        supabase.from('qr_codes').select('*').eq('guest_id', guestId!).maybeSingle(),
      ]);

      setEvent(eventRes.data);
      setQrCode(qrRes.data);

// Check if the event has a template assigned to it
if (eventRes.data?.template_id) {
  const { data: templateData } = await supabase
    .from('invitation_templates')
    .select('*')
    .eq('id', eventRes.data.template_id)
    .maybeSingle();

  // Save the template data so we can use it to change colors/fonts
  if (templateData) {
    setTemplate(templateData);
  }
}


      if (qrRes.data) {
        const img = await generateQRDataURL(qrRes.data.code);
        setQrImage(img);
      }

      setLoading(false);
    }
    load();
  }, [guestId]);

  async function handleDownloadPDF() {
    setDownloadingPDF(true);
    try {
      await downloadInvitationAsPDF('public-invitation-card', `invitation-${guest?.name.replace(/\s+/g, '-')}`);
    } catch {
      alert('Failed to generate PDF');
    }
    setDownloadingPDF(false);
  }

  function handleWhatsApp() {
    if (!guest || !event) return;
    const inviteLink = window.location.href;
    const message = encodeURIComponent(
      `Hi ${guest.name}!\n\nYou're invited to *${event.name}*!\n\n📅 ${format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a')}\n📍 ${event.location}\n\nView your invitation & QR code here:\n${inviteLink}`
    );
    const phone = guest.phone?.replace(/\D/g, '');
    const url = phone ? `https://wa.me/${phone}?text=${message}` : `https://wa.me/?text=${message}`;
    window.open(url, '_blank');
  }
  console.log("DEBUG - Template Data:", template);


  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (notFound || !guest || !event) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <QrCode size={40} className="text-slate-700" />
        <h1 className="text-xl font-semibold text-slate-300">Invitation Not Found</h1>
        <p className="text-slate-500 text-sm">This invitation link may be invalid or expired.</p>
      </div>
    );
  }

  if (guest.status === 'inactive') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <QrCode size={40} className="text-slate-700" />
        <h1 className="text-xl font-semibold text-slate-300">Access Revoked</h1>
        <p className="text-slate-500 text-sm">This invitation is no longer valid.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <QrCode size={16} className="text-white" />
          </div>
          <span className="text-white font-bold text-lg">Nexus</span>
        </div>

        <div id="public-invitation-card" ref={invRef} className="w-full">
  <InvitationCard 
    guest={guest} 
    event={event} 
    template={template} 
    qrImage={qrImage} 
    qrCode={qrCode} 
  />
</div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
          >
            <MessageCircle size={16} />
            Share on WhatsApp
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={downloadingPDF}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors border border-slate-700 disabled:opacity-50"
          >
            <Download size={16} />
            {downloadingPDF ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
