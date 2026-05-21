// src/pages/InvitationPage.tsx
//
// PHASE 2 — SECURE INVITATION PAGE
//
// Route changed from: /invitation/:guestId  (exposes guest UUID)
// Route changed to:   /invite/:token        (256-bit entropy token)
//
// This page calls the validate-invite Edge Function which:
//   - Looks up the token hash in invitation_tokens table
//   - Returns ONLY safe fields: guest name, event info, QR code
//   - Never returns guest UUID, phone, email, or payment data
//
// The old /invitation/:guestId route is kept as a redirect for backward compat.

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { QrCode, Download, MessageCircle, AlertCircle } from 'lucide-react';
import { generateQRDataURL } from '../lib/qr';
import { downloadInvitationAsPDF } from '../lib/pdf';
import LoadingSpinner from '../components/common/LoadingSpinner';
import InvitationCard from '../components/InvitationCard';
import { format } from 'date-fns';

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface InviteData {
  guest:    { name: string; status: string };
  event:    { name: string; date: string; location: string; description: string };
  qr:       { code: string; status: string; used_at: string | null } | null;
  template: any | null;
}

type PageState = 'loading' | 'valid' | 'invalid' | 'expired' | 'revoked' | 'inactive';

export default function InvitationPage() {
  // Handle both routes:
  //   /invite/:token      — new secure token route
  //   /invitation/:guestId — old route (backward compat)
  const { token, guestId } = useParams<{ token?: string; guestId?: string }>();
  const routeToken = token || guestId; // whichever param is present
  const [state,         setState]         = useState<PageState>('loading');
  const [inviteData,    setInviteData]    = useState<InviteData | null>(null);
  const [qrImage,       setQrImage]       = useState('');
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [invalidReason, setInvalidReason] = useState('');
  const invRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!routeToken) { setState('invalid'); setInvalidReason('No token provided'); return; }

    async function load() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/validate-invite?token=${encodeURIComponent(routeToken)}`,
          {
            headers: {
              // Anon key is fine here — the Edge Function uses service role internally
              // The anon key just allows calling the function
              'apikey': SUPABASE_ANON_KEY,
            },
          }
        );

        const data = await res.json();

        if (!res.ok || !data.valid) {
          const reason = data.reason || 'invalid';
          if (reason === 'expired')       setState('expired');
          else if (reason === 'revoked')  setState('revoked');
          else if (reason === 'guest_inactive') setState('inactive');
          else { setState('invalid'); setInvalidReason(data.reason || 'Unknown error'); }
          return;
        }

        setInviteData(data);

        if (data.qr?.code) {
          const img = await generateQRDataURL(data.qr.code);
          setQrImage(img);
        }

        setState('valid');
      } catch (err) {
        setState('invalid');
        setInvalidReason('Failed to load invitation');
      }
    }

    load();
  }, [routeToken]);

  async function handleDownloadPDF() {
    setDownloadingPDF(true);
    try {
      const name = inviteData?.guest?.name?.replace(/\s+/g, '-') || 'guest';
      await downloadInvitationAsPDF('public-invitation-card', `invitation-${name}`);
    } catch {
      alert('Failed to generate PDF');
    }
    setDownloadingPDF(false);
  }

  function handleWhatsApp() {
    if (!inviteData) return;
    const { guest, event } = inviteData;
    const inviteLink = window.location.href;
    const message = encodeURIComponent(
      `Hi ${guest.name}!\n\nYou're invited to *${event.name}*!\n\n` +
      `📅 ${format(new Date(event.date), 'EEEE, MMMM d, yyyy · h:mm a')}\n` +
      `📍 ${event.location}\n\nView your invitation & QR code here:\n${inviteLink}`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // ── Error states ───────────────────────────────────────────────────────────
  const errorConfig: Record<string, { title: string; message: string }> = {
    invalid:  { title: 'Invitation Not Found',  message: 'This invitation link may be invalid.' },
    expired:  { title: 'Invitation Expired',    message: 'This invitation link has expired. Please contact the event organiser for a new link.' },
    revoked:  { title: 'Invitation Revoked',    message: 'This invitation has been revoked. Please contact the event organiser.' },
    inactive: { title: 'Access Revoked',        message: 'This invitation is no longer valid.' },
  };

  if (state !== 'valid') {
    const cfg = errorConfig[state] || errorConfig.invalid;
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 px-4">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <AlertCircle size={24} className="text-red-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-300 text-center">{cfg.title}</h1>
        <p className="text-slate-500 text-sm text-center max-w-xs">{cfg.message}</p>
      </div>
    );
  }

  const { guest, event, qr, template } = inviteData!;

  // ── Valid invitation ───────────────────────────────────────────────────────
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
            guest={{ name: guest.name, status: guest.status } as any}
            event={{ name: event.name, date: event.date, location: event.location, description: event.description } as any}
            template={template}
            qrImage={qrImage}
            qrCode={qr ? { code: qr.code, status: qr.status } as any : null}
          />
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors">
            <MessageCircle size={16} />
            Share on WhatsApp
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={downloadingPDF}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors border border-slate-700 disabled:opacity-50">
            <Download size={16} />
            {downloadingPDF ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}