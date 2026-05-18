import { Move, Paintbrush } from 'lucide-react';
import type { Guest, Event, InvitationTemplate, QRCode } from '../types';

interface InvitationCardProps {
  guest: Guest | { name: string };
  event: Event | { name: string };
  template: InvitationTemplate | null;
  qrImage: string | null;
  qrCode: QRCode | null;
  mode?: 'editor' | 'final';
}

export default function InvitationCard({
  guest,
  event,
  template,
  qrImage,
  qrCode,
  mode = 'final',
}: InvitationCardProps) {
  const isEditor = mode === 'editor';
  const guestName = 'name' in guest ? guest.name : String(guest);
  const eventName = 'name' in event ? event.name : String(event);

  const imgW = template?.width || 800;
  const imgH = template?.height || 1000;

  const qrSizePct = template?.fields?.qr_code?.sizePct ?? 20;
  const guestNamePos = template?.fields?.guest_name || { top: '45%', left: '50%' };
  const qrCodePos    = template?.fields?.qr_code    || { top: '70%', left: '50%' };

  return (
    <div
      className="relative w-full mx-auto overflow-hidden shadow-2xl"
      style={{
        paddingBottom: `${(imgH / imgW) * 100}%`,
        borderRadius: '1rem',
        maxWidth: isEditor ? '500px' : '100%',
      }}
    >
      <div className="absolute inset-0">

        {/* ── Background image ── */}
        {template?.background_image ? (
          <img
            src={template.background_image}
            alt={template.name || 'Invitation Template'}
            className="w-full h-full block"
            style={{ objectFit: 'fill' }}
            crossOrigin="anonymous"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center">
            {isEditor && (
              <>
                <Paintbrush size={40} className="text-slate-700 mb-2" />
                <span className="text-xs text-slate-600 font-medium">No template background</span>
              </>
            )}
          </div>
        )}

        {/* ── Guest Name ── */}
        <div
          className={`absolute transform -translate-x-1/2 -translate-y-1/2 whitespace-nowrap
            ${isEditor
              ? 'bg-white/80 text-slate-900 px-3 py-1.5 rounded-lg text-xs font-bold shadow-xl border border-white/60 flex items-center gap-1.5 cursor-move select-none'
              : ''
            }`}
          style={{
            top:        guestNamePos.top,
            left:       guestNamePos.left,
            fontFamily: template?.fields?.guest_name?.fontFamily || 'Inter, sans-serif',
            fontSize:   isEditor ? '0.75rem' : `${template?.fields?.guest_name?.fontSizePct ?? 4}%`,
            fontWeight: template?.fields?.guest_name?.fontWeight || '600',
            color:      isEditor ? undefined : (template?.fields?.guest_name?.color || '#ffffff'),
            textAlign:  template?.fields?.guest_name?.textAlign || 'center',
            maxWidth:   '65%',
          }}
        >
          {isEditor && <Move size={11} className="text-slate-500 flex-shrink-0" />}
          {guestName}
        </div>

        {/* ── QR Code ──
            FINAL mode : just the bare QR image — zero background, zero padding
            EDITOR mode: thin dashed outline so you can see & drag it, still no fill
        */}
        <div
          className={`absolute transform -translate-x-1/2 -translate-y-1/2
            ${isEditor ? 'cursor-move select-none' : ''}`}
          style={{
            top:        qrCodePos.top,
            left:       qrCodePos.left,
            width:      `${qrSizePct}%`,
            aspectRatio:'1 / 1',
            // ✅ No background, no padding, no border-radius — completely transparent
            background: 'transparent',
            padding:    0,
            // Editor only: dashed outline so the element is visible for dragging
            outline:    isEditor ? '2px dashed rgba(96,165,250,0.7)' : 'none',
            outlineOffset: isEditor ? '3px' : '0',
          }}
        >
          {qrImage ? (
            /*
             * ✅ The QR image itself carries a white background (it's a PNG).
             * We add a tiny border-radius and a soft shadow so it looks
             * like a polished design element, not a pasted sticker.
             * No extra wrapper div — no visible container box.
             */
            <img
              src={qrImage}
              alt="Guest QR Code"
              crossOrigin="anonymous"
              style={{
                width:        '100%',
                height:       '100%',
                objectFit:    'contain',
                borderRadius: '8px',           // subtle rounded corners
                boxShadow:    '0 2px 12px rgba(0,0,0,0.35)', // soft drop shadow
                display:      'block',
              }}
            />
          ) : isEditor ? (
            /* Placeholder shown only in the template editor */
            <div
              style={{
                width: '100%', height: '100%',
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Paintbrush size={16} className="text-white/60" />
            </div>
          ) : null}
        </div>

        {/* Editor label */}
        {isEditor && (
          <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-200 border border-slate-700/50">
            {eventName}
          </div>
        )}

      </div>
    </div>
  );
}