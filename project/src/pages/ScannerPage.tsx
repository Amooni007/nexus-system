import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  ScanLine, CheckCircle2, XCircle, AlertTriangle,
  Camera, CameraOff, Ticket, User,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { validateTicketQR } from '../lib/TicketingLib';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import Button from '../components/common/Button';
import { format } from 'date-fns';

type ScanState = 'idle' | 'scanning' | 'processing' | 'accepted' | 'rejected' | 'invalid' | 'error';
type ScanType = 'guest' | 'ticket' | 'unknown';

interface ScanResult {
  state: ScanState;
  type: ScanType;
  title: string;
  message: string;
  guestName?: string;
  eventName?: string;
  ticketCategory?: string;
  scannedAt?: string;
}

interface Toast {
  id: number;
  state: 'accepted' | 'rejected' | 'invalid';
  title: string;
  message: string;
  guestName?: string;
  ticketCategory?: string;
  type: ScanType;
}

// ── Sound feedback ────────────────────────────────────────────────────────────
// LOW-02 FIX: Reuse a single AudioContext instead of creating one per scan.
// Browsers limit concurrent AudioContext instances (typically 6).
// After several scans the old code would silently stop making sounds.
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _audioCtx;
}

function playBeep(type: 'accepted' | 'rejected' | 'invalid') {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'accepted') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'rejected') {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(300, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } else {
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    }
  } catch { /* silent */ }
}

function vibrate(type: 'accepted' | 'rejected' | 'invalid') {
  if (!navigator.vibrate) return;
  if (type === 'accepted') navigator.vibrate([100]);
  else if (type === 'rejected') navigator.vibrate([100, 80, 100]);
  else navigator.vibrate([300]);
}

// ── Toast component ───────────────────────────────────────────────────────────
let toastCounter = 0;

function ScanToast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const styles = {
    accepted: { bg: 'bg-emerald-950 border-emerald-500/40', icon: <CheckCircle2 size={22} className="text-emerald-400 flex-shrink-0" />, title: 'text-emerald-300', bar: 'bg-emerald-500' },
    rejected:  { bg: 'bg-amber-950 border-amber-500/40',   icon: <AlertTriangle size={22} className="text-amber-400 flex-shrink-0" />,  title: 'text-amber-300',   bar: 'bg-amber-500' },
    invalid:   { bg: 'bg-red-950 border-red-500/40',       icon: <XCircle size={22} className="text-red-400 flex-shrink-0" />,          title: 'text-red-300',     bar: 'bg-red-500' },
  };
  const s = styles[toast.state];
  // Category badge colors for ticket scans
  const catBadge = toast.ticketCategory
    ? toast.ticketCategory === 'VVIP'    ? 'bg-yellow-400 text-yellow-950'
    : toast.ticketCategory === 'VIP'     ? 'bg-slate-300 text-slate-900'
    : 'bg-blue-500 text-white'
    : null;

  return (
    <div className={`relative w-full rounded-2xl border shadow-2xl overflow-hidden ${s.bg} animate-slide-in`}>
      <div className={`absolute top-0 left-0 h-1 ${s.bar} animate-shrink-bar`} />
      <div className="flex items-start gap-3 p-4 pt-5">
        {s.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`font-semibold text-sm ${s.title}`}>{toast.title}</p>
            {toast.type === 'ticket' && (
              <span className="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                <Ticket size={9} /> Ticket
              </span>
            )}
          </div>
          {toast.guestName && <p className="text-white font-medium text-base mt-0.5 truncate">{toast.guestName}</p>}
          {toast.ticketCategory && catBadge && (
            <div className="flex items-center gap-2 mt-1">
              <span className={'text-xs font-bold px-2 py-0.5 rounded-full ' + catBadge}>
                {toast.ticketCategory}
              </span>
              <span className="text-slate-400 text-xs">ticket</span>
            </div>
          )}
          <p className="text-slate-400 text-xs mt-0.5">{toast.message}</p>
        </div>
        <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 flex-shrink-0"><XCircle size={16} /></button>
      </div>
    </div>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-80 z-50 flex flex-col gap-3 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ScanToast toast={t} onDismiss={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export default function ScannerPage() {
  const { profile } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastScanRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const cameraActiveRef = useRef(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState<ScanResult>({ state: 'idle', type: 'unknown', title: '', message: '' });
  const [scanHistory, setScanHistory] = useState<Array<{
    name: string; result: string; time: Date; type: ScanType; category?: string;
  }>>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // For ticket scanning — require event selection
  const [events, setEvents] = useState<Array<{ id: string; name: string }>>([]);
  // UX-05 FIX: Persist selected event across page refreshes using sessionStorage.
  // Gate staff select an event at the start of their shift — losing it on refresh
  // was disruptive and forced re-selection before every scanning session.
  const [selectedEventId, setSelectedEventId] = useState<string>(() => {
    return sessionStorage.getItem('scanner_event_id') || '';
  });

  useEffect(() => {
    supabase.from('events').select('id, name').eq('status', 'open').order('date', { ascending: false })
      .then(({ data }) => setEvents(data || []));
  }, []);

  function addToast(state: Toast['state'], title: string, message: string, guestName?: string, ticketCategory?: string, type: ScanType = 'unknown') {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, state, title, message, guestName, ticketCategory, type }]);
    playBeep(state);
    vibrate(state);
  }

  function dismissToast(id: number) { setToasts(prev => prev.filter(t => t.id !== id)); }

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    cameraActiveRef.current = false;
    setCameraActive(false);
  }, []);

  const scheduleNextFrame = useCallback((fn: FrameRequestCallback) => {
    if (cameraActiveRef.current) animFrameRef.current = requestAnimationFrame(fn);
  }, []);

  async function startCamera() {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      cameraActiveRef.current = true;
      setCameraActive(true);
      setResult({ state: 'scanning', type: 'unknown', title: 'Ready to Scan', message: 'Point camera at a QR code' });
    } catch {
      setCameraError('Camera access denied. Please allow camera permissions and try again.');
    }
  }

  // ── Core QR processing — handles BOTH guest QR and ticket QR ─────────────
  const processQRCode = useCallback(async (code: string) => {
    const now = Date.now();
    if (code === lastScanRef.current && now - lastScanTimeRef.current < 3000) return;
    if (isProcessingRef.current) return;

    lastScanRef.current = code;
    lastScanTimeRef.current = now;
    isProcessingRef.current = true;
    setResult({ state: 'processing', type: 'unknown', title: 'Processing…', message: 'Validating QR code' });

    // ── TICKET QR: format is "NEXUS-TICKET:{uuid}" ────────────────────────
    if (code.startsWith('NEXUS-TICKET:')) {
      const token = code.replace('NEXUS-TICKET:', '').trim();

      if (!selectedEventId) {
        setResult({
          state: 'invalid', type: 'ticket',
          title: 'Select Event First',
          message: 'Choose an event above before scanning ticket QRs',
        });
        addToast('invalid', '❌ No Event Selected', 'Pick an event above first', undefined, undefined, 'ticket');
        isProcessingRef.current = false;
        return;
      }

      const scanResult = await validateTicketQR(token, selectedEventId, profile!.id);

      let state: ScanState;
      let title: string;
      let message: string;
      let toastState: Toast['state'];

      if (scanResult.status === 'accepted') {
        state = 'accepted';
        title = '✅ Ticket Accepted';
        message = 'Entry granted — ticket marked as used';
        toastState = 'accepted';
      } else if (scanResult.status === 'already_used') {
        state = 'rejected';
        title = '⚠️ Already Used';
        message = scanResult.scanned_at
          ? 'Already scanned at ' + format(new Date(scanResult.scanned_at), 'h:mm a, MMM d')
          : 'This ticket has already been used';
        toastState = 'rejected';
      } else if (scanResult.status === 'wrong_event') {
        state = 'invalid';
        title = '❌ Wrong Event';
        message = 'This ticket is for a different event';
        toastState = 'invalid';
      } else {
        state = 'invalid';
        title = '❌ Invalid Ticket';
        message = 'Ticket not found, cancelled, or payment not confirmed';
        toastState = 'invalid';
      }

      setResult({
        state, type: 'ticket', title, message,
        guestName: scanResult.customer_name,
        ticketCategory: scanResult.ticket_category,
      });

      addToast(toastState, title, message, scanResult.customer_name, scanResult.ticket_category, 'ticket');

      setScanHistory(prev => [{
        name: scanResult.customer_name || 'Unknown',
        result: scanResult.status,
        time: new Date(),
        type: 'ticket',
        category: scanResult.ticket_category,
      }, ...prev.slice(0, 29)]);

      // BROKEN-02 FIX: Write ticket scan to scan_logs for full audit trail.
      // Previously ticket QR scans were NOT logged — only guest invitation scans were.
      // guest_id and event_id are nullable (second migration made them nullable)
      // so we can log ticket scans without a guest_id reference.
      await supabase.from('scan_logs').insert({
        staff_id:   profile!.id,
        event_id:   selectedEventId,
        guest_id:   null,           // ticket scans have no guest_id
        qr_code_id: null,           // ticket QRs are not in qr_codes table
        result:     scanResult.status === 'accepted'    ? 'accepted'
                  : scanResult.status === 'already_used' ? 'rejected_used'
                  : 'invalid',
        reason: message,
      }).catch(err => console.warn('scan_log insert failed:', err));
      // Non-blocking — scan result is already recorded, log failure is not fatal

      isProcessingRef.current = false;
      return;
    }

    // ── GUEST INVITATION QR (existing system) ─────────────────────────────
    const { data: qrCode } = await supabase
      .from('qr_codes')
      .select('*, guest:guests(name, status), event:events(name)')
      .eq('code', code)
      .maybeSingle();

    if (!qrCode) {
      setResult({ state: 'invalid', type: 'unknown', title: 'Invalid QR Code', message: 'This QR code is not recognised.' });
      addToast('invalid', '❌ Invalid QR Code', 'Not recognised in the system', undefined, undefined, 'unknown');
      await supabase.from('scan_logs').insert({
        staff_id: profile!.id, result: 'invalid',
        reason: 'QR code not found', qr_code_id: null, guest_id: null, event_id: null,
      });
      isProcessingRef.current = false;
      return;
    }

    const guest = (qrCode as any).guest;
    const event = (qrCode as any).event;
    let scanResult: ScanResult;
    let dbResult: string;

    if (guest?.status === 'inactive') {
      scanResult = { state: 'rejected', type: 'guest', title: 'Access Denied', message: 'This guest is inactive.', guestName: guest.name, eventName: event?.name };
      dbResult = 'rejected_inactive';
      addToast('rejected', '⚠️ Access Denied', 'Guest is inactive', guest.name, undefined, 'guest');
    } else if (qrCode.status === 'used') {
      scanResult = {
        state: 'rejected', type: 'guest', title: 'Already Used',
        message: 'QR already scanned' + (qrCode.used_at ? ' on ' + format(new Date(qrCode.used_at), 'MMM d at h:mm a') : '') + '.',
        guestName: guest?.name, eventName: event?.name,
      };
      dbResult = 'rejected_used';
      addToast('rejected', '⚠️ Already Used', 'This QR was already scanned', guest?.name, undefined, 'guest');
    } else {
      await supabase.from('qr_codes').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', qrCode.id);
      scanResult = { state: 'accepted', type: 'guest', title: 'Access Granted', message: 'Welcome! Entry recorded.', guestName: guest?.name, eventName: event?.name };
      dbResult = 'accepted';
      addToast('accepted', '✅ Access Granted', 'Entry recorded', guest?.name, undefined, 'guest');
    }

    await supabase.from('scan_logs').insert({
      qr_code_id: qrCode.id, guest_id: qrCode.guest_id,
      event_id: qrCode.event_id, staff_id: profile!.id,
      result: dbResult, reason: scanResult.message,
    });

    setResult(scanResult);
    setScanHistory(prev => [{ name: guest?.name || 'Unknown', result: dbResult, time: new Date(), type: 'guest' }, ...prev.slice(0, 29)]);
    isProcessingRef.current = false;
  }, [profile, selectedEventId]);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) { scheduleNextFrame(scanFrame); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const detected = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    if (detected && !isProcessingRef.current) processQRCode(detected.data);
    scheduleNextFrame(scanFrame);
  }, [processQRCode, scheduleNextFrame]);

  useEffect(() => {
    if (cameraActive) animFrameRef.current = requestAnimationFrame(scanFrame);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [cameraActive, scanFrame]);

  useEffect(() => {
    if (['accepted', 'rejected', 'invalid'].includes(result.state)) {
      const t = setTimeout(() => setResult({ state: 'scanning', type: 'unknown', title: 'Ready to Scan', message: 'Point camera at a QR code' }), 2500);
      return () => clearTimeout(t);
    }
  }, [result.state]);

  useEffect(() => { return () => stopCamera(); }, [stopCamera]);

  const stateConfig: Record<ScanState, { color: string; bgColor: string; borderColor: string; icon: React.ReactNode }> = {
    idle:       { color: 'text-slate-400',   bgColor: 'bg-slate-800/50',   borderColor: 'border-slate-700',      icon: <ScanLine size={32} /> },
    scanning:   { color: 'text-blue-400',    bgColor: 'bg-blue-500/10',    borderColor: 'border-blue-500/30',    icon: <ScanLine size={32} className="animate-pulse" /> },
    processing: { color: 'text-amber-400',   bgColor: 'bg-amber-500/10',   borderColor: 'border-amber-500/30',   icon: <ScanLine size={32} className="animate-spin" /> },
    accepted:   { color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30', icon: <CheckCircle2 size={32} /> },
    rejected:   { color: 'text-amber-400',   bgColor: 'bg-amber-500/10',   borderColor: 'border-amber-500/30',   icon: <AlertTriangle size={32} /> },
    invalid:    { color: 'text-red-400',     bgColor: 'bg-red-500/10',     borderColor: 'border-red-500/30',     icon: <XCircle size={32} /> },
    error:      { color: 'text-red-400',     bgColor: 'bg-red-500/10',     borderColor: 'border-red-500/30',     icon: <XCircle size={32} /> },
  };
  const config = stateConfig[result.state];

  return (
    <Layout>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <Header title="QR Scanner" subtitle="Scans both invitation QRs and paid ticket QRs" />

      {/* Event selector — required for ticket QR validation */}
      <div className="mb-4 bg-slate-900 border border-slate-700 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Ticket size={15} className="text-indigo-400" />
          <p className="text-sm font-medium text-slate-200">Select Event <span className="text-slate-500 font-normal">(required for ticket QR scanning)</span></p>
        </div>
        <select value={selectedEventId} onChange={e => {
            setSelectedEventId(e.target.value);
            if (e.target.value) {
              sessionStorage.setItem('scanner_event_id', e.target.value);
            } else {
              sessionStorage.removeItem('scanner_event_id');
            }
          }}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
          <option value="">— Invitation QR only (no ticket validation) —</option>
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {selectedEventId && (
          <p className="text-indigo-400 text-xs mt-1.5 flex items-center gap-1">
            <CheckCircle2 size={11} /> Ticket QR validation active for selected event
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <div className="space-y-5">
          {/* Camera */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
            <div className="relative aspect-[4/3] sm:aspect-video bg-slate-950">
              <video ref={videoRef} className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'}`} muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <CameraOff size={40} className="text-slate-700" />
                  <p className="text-slate-500 text-sm">Camera not active</p>
                  {cameraError && <p className="text-red-400 text-xs text-center max-w-xs px-4">{cameraError}</p>}
                </div>
              )}
              {cameraActive && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-56 h-56 relative">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl-sm" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr-sm" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl-sm" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br-sm" />
                    {result.state === 'scanning' && <div className="absolute inset-x-0 h-0.5 bg-blue-400/60 top-1/2 animate-pulse" />}
                    {result.state === 'accepted' && <div className="absolute inset-0 bg-emerald-400/10 rounded" />}
                    {(result.state === 'rejected' || result.state === 'invalid') && <div className="absolute inset-0 bg-red-400/10 rounded" />}
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 flex gap-3">
              {!cameraActive
                ? <Button onClick={startCamera} icon={<Camera size={15} />} className="flex-1">Start Camera</Button>
                : <Button variant="danger" onClick={stopCamera} icon={<CameraOff size={15} />} className="flex-1">Stop Camera</Button>}
            </div>
          </div>

          {/* Status panel */}
          <div className={`rounded-2xl border p-6 transition-all duration-300 ${config.bgColor} ${config.borderColor}`}>
            <div className="flex items-start gap-4">
              <span className={config.color}>{config.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className={`font-semibold text-lg ${config.color}`}>{result.title || 'Scanner Ready'}</p>
                  {result.type === 'ticket' && (
                    <span className="text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                      <Ticket size={9} /> Ticket
                    </span>
                  )}
                  {result.type === 'guest' && (
                    <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                      <User size={9} /> Guest
                    </span>
                  )}
                </div>
                <p className="text-slate-400 text-sm mt-0.5">{result.message || 'Start camera to begin scanning'}</p>
                {result.guestName && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-slate-300">
                      <span className="text-slate-500">Name: </span>
                      <span className="font-semibold text-white">{result.guestName}</span>
                    </p>
                    {result.ticketCategory && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-sm">Category:</span>
                        <span className={'text-sm font-bold px-2.5 py-0.5 rounded-full ' + (
                          result.ticketCategory === 'VVIP'    ? 'bg-yellow-400 text-yellow-950' :
                          result.ticketCategory === 'VIP'     ? 'bg-slate-300 text-slate-900' :
                          'bg-blue-500 text-white'
                        )}>
                          {result.ticketCategory}
                        </span>
                      </div>
                    )}
                    {result.ticketCategory === 'VVIP' && result.state === 'accepted' && (
                      <p className="text-yellow-400 text-xs font-semibold animate-pulse">⭐ VVIP — PREMIUM ACCESS GRANTED</p>
                    )}
                    {result.ticketCategory === 'VIP' && result.state === 'accepted' && (
                      <p className="text-slate-300 text-xs font-semibold">✨ VIP — Priority Access Granted</p>
                    )}
                    {result.ticket && (result.ticket as any).ticket_token && (
                      <p className="text-xs text-slate-500 font-mono">
                        ID: {((result.ticket as any).ticket_token as string).slice(0,8).toUpperCase()}
                      </p>
                    )}
                    {(result as any).scanned_at && (
                      <p className="text-xs text-slate-500">
                        Scanned: {format(new Date((result as any).scanned_at), 'h:mm:ss a')}
                      </p>
                    )}
                    {result.eventName && (
                      <p className="text-sm text-slate-300">
                        <span className="text-slate-500">Event: </span>
                        <span className="font-medium">{result.eventName}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scan history */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Recent Scans</h2>
            <span className="text-xs text-slate-500">This session</span>
          </div>
          <div className="divide-y divide-slate-800/60 max-h-[500px] overflow-y-auto">
            {scanHistory.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-slate-600">
                <ScanLine size={32} className="mb-2" />
                <p className="text-sm">No scans yet this session</p>
              </div>
            ) : scanHistory.map((scan, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  scan.result === 'accepted' ? 'bg-emerald-400' :
                  scan.result === 'invalid' || scan.result === 'wrong_event' ? 'bg-red-400' : 'bg-amber-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-slate-200 truncate">{scan.name}</p>
                    {scan.type === 'ticket' && <Ticket size={10} className="text-indigo-400 flex-shrink-0" />}
                    {scan.type === 'guest' && <User size={10} className="text-slate-500 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-slate-500">
                    {format(scan.time, 'h:mm:ss a')}
                    {scan.category && <span className="ml-1.5 text-indigo-400">{scan.category}</span>}
                  </p>
                </div>
                <span className={`text-xs font-bold ${
                  scan.result === 'accepted' ? 'text-emerald-400' :
                  scan.result === 'already_used' || scan.result === 'rejected_used' ? 'text-amber-400' :
                  scan.result === 'rejected_inactive' ? 'text-orange-400' : 'text-red-400'
                }`}>
                  {scan.result === 'accepted' ? 'IN' :
                   scan.result === 'already_used' || scan.result === 'rejected_used' ? 'USED' :
                   scan.result === 'rejected_inactive' ? 'INACTIVE' :
                   scan.result === 'wrong_event' ? 'WRONG EVENT' : 'INVALID'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-in { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes shrink-bar { from { width: 100%; } to { width: 0%; } }
        .animate-slide-in { animation: slide-in 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .animate-shrink-bar { animation: shrink-bar 5s linear forwards; }
      `}</style>
    </Layout>
  );
}