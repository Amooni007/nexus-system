// src/pages/ScannerPage.tsx — PHASE 3 SECURITY FIX
//
// PROBLEM (F-03):
// The current scanner does client-side QR validation:
//   1. Fetch qr_code from DB
//   2. Browser decides if it's valid/used/inactive
//   3. If valid, browser sends UPDATE to mark as used
// This is a TOCTOU (time-of-check to time-of-use) race condition.
// Two scanners at different gates can simultaneously scan the same QR
// and BOTH get "accepted" before either update completes.
//
// Additionally, the browser directly UPDATEs qr_codes.status = 'used'.
// A malicious authenticated user could call this REST endpoint manually
// to mark any QR code as used (denial of service) or reset used codes.
//
// FIX:
// Browser calls supabase.rpc('process_guest_qr_scan', ...) or
// supabase.rpc('process_ticket_qr_scan', ...).
// The RPC runs as SECURITY DEFINER with FOR UPDATE row locking.
// The database decides — the browser only displays the result.
//
// The RPC functions are defined in the RLS hardening migration.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Camera, CheckCircle2, XCircle, AlertTriangle, Clock,
  Ticket, QrCode as QrIcon, ChevronDown, RefreshCw,
} from 'lucide-react';
import jsQR from 'jsqr';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/layout/Layout';
import LoadingSpinner from '../components/common/LoadingSpinner';

type ScanState = 'idle' | 'scanning' | 'processing' | 'accepted' | 'rejected' | 'invalid' | 'error';

interface ScanResult {
  state:          ScanState;
  type:           'guest' | 'ticket' | 'unknown';
  title:          string;
  message:        string;
  guestName?:     string;
  ticketCategory?: string;
  eventName?:     string;
  scannedAt?:     string;
}

interface Toast {
  id:             number;
  state:          'accepted' | 'rejected' | 'invalid';
  title:          string;
  message:        string;
  guestName?:     string;
  ticketCategory?: string;
  type:           'guest' | 'ticket' | 'unknown';
}

interface ScanHistoryItem {
  name:     string;
  result:   string;
  time:     Date;
  type:     'guest' | 'ticket';
  category?: string;
}

// ── Audio ────────────────────────────────────────────────────────────────────
// LOW-02 FIX: Single AudioContext instance reused across scans
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
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = type === 'accepted' ? 880 : type === 'rejected' ? 440 : 220;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

function vibrate(type: 'accepted' | 'rejected' | 'invalid') {
  if (!navigator.vibrate) return;
  if (type === 'accepted') navigator.vibrate([100]);
  else if (type === 'rejected') navigator.vibrate([100, 50, 100]);
  else navigator.vibrate([300]);
}

export default function ScannerPage() {
  const { profile } = useAuth();
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const cameraActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const lastScanRef = useRef('');
  const lastScanTimeRef = useRef(0);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError,  setCameraError]  = useState('');
  const [result,       setResult]       = useState<ScanResult>({ state: 'idle', type: 'unknown', title: 'Ready', message: 'Start camera to scan' });
  const [toasts,       setToasts]       = useState<Toast[]>([]);
  const [scanHistory,  setScanHistory]  = useState<ScanHistoryItem[]>([]);
  const [events,       setEvents]       = useState<{ id: string; name: string }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(() =>
    sessionStorage.getItem('scanner_event_id') || ''
  );
  const [showHistory, setShowHistory] = useState(false);
  const toastIdRef = useRef(0);

  useEffect(() => {
    supabase.from('events').select('id, name').neq('status', 'archived').order('date', { ascending: false })
      .then(({ data }) => setEvents(data || []));
  }, []);

  useEffect(() => {
    return () => {
      cameraActiveRef.current = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  function addToast(
    state: Toast['state'], title: string, message: string,
    guestName?: string, ticketCategory?: string, type: Toast['type'] = 'unknown'
  ) {
    const id = ++toastIdRef.current;
    setToasts(prev => [{ id, state, title, message, guestName, ticketCategory, type }, ...prev.slice(0, 4)]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  const scheduleNextFrame = useCallback((fn: () => void) => {
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

  // ── PHASE 3 FIX: Server-side QR processing via RPC ───────────────────────
  // The browser NO LONGER decides if a QR is valid.
  // All validation happens atomically in the database via SECURITY DEFINER RPCs.
  const processQRCode = useCallback(async (code: string) => {
    const now = Date.now();
    if (code === lastScanRef.current && now - lastScanTimeRef.current < 3000) return;
    if (isProcessingRef.current) return;

    lastScanRef.current = code;
    lastScanTimeRef.current = now;
    isProcessingRef.current = true;
    setResult({ state: 'processing', type: 'unknown', title: 'Processing…', message: 'Validating QR code' });

    // ── TICKET QR: format is "NEXUS-TICKET:{uuid}" ─────────────────────────
    if (code.startsWith('NEXUS-TICKET:')) {
      const tokenStr = code.replace('NEXUS-TICKET:', '').trim();

      if (!selectedEventId) {
        setResult({ state: 'invalid', type: 'ticket', title: 'Select Event First', message: 'Choose an event before scanning' });
        addToast('invalid', '❌ No Event Selected', 'Pick an event above first', undefined, undefined, 'ticket');
        isProcessingRef.current = false;
        return;
      }

      // Parse UUID — reject malformed tokens before sending to DB
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(tokenStr)) {
        setResult({ state: 'invalid', type: 'ticket', title: '❌ Invalid Ticket', message: 'Malformed ticket token' });
        addToast('invalid', '❌ Invalid Ticket', 'Malformed token', undefined, undefined, 'ticket');
        isProcessingRef.current = false;
        return;
      }

      // PHASE 3 FIX: Call atomic RPC — database decides, not browser
      const { data: scanResult, error } = await supabase.rpc('process_ticket_qr_scan', {
        p_token:    tokenStr,
        p_event_id: selectedEventId,
        p_staff_id: profile!.id,
      });

      if (error || !scanResult) {
        setResult({ state: 'error', type: 'ticket', title: 'Scan Error', message: 'Failed to validate ticket. Try again.' });
        addToast('invalid', '❌ Scan Error', 'Validation failed', undefined, undefined, 'ticket');
        isProcessingRef.current = false;
        return;
      }

      const sr = scanResult as any;
      let state: ScanState;
      let title: string;
      let toastState: Toast['state'];

      if (sr.status === 'accepted') {
        state = 'accepted'; title = '✅ ' + (sr.ticket_category || 'TICKET') + ' ACCEPTED'; toastState = 'accepted';
        playBeep('accepted'); vibrate('accepted');
      } else if (sr.status === 'already_used') {
        state = 'rejected'; title = '⚠️ Already Used'; toastState = 'rejected';
        playBeep('rejected'); vibrate('rejected');
      } else if (sr.status === 'wrong_event') {
        state = 'invalid'; title = '❌ Wrong Event'; toastState = 'invalid';
        playBeep('invalid'); vibrate('invalid');
      } else {
        state = 'invalid'; title = '❌ Invalid Ticket'; toastState = 'invalid';
        playBeep('invalid'); vibrate('invalid');
      }

      setResult({ state, type: 'ticket', title, message: sr.message, guestName: sr.customer_name, ticketCategory: sr.ticket_category });
      addToast(toastState, title, sr.message, sr.customer_name, sr.ticket_category, 'ticket');
      setScanHistory(prev => [{ name: sr.customer_name || 'Unknown', result: sr.status, time: new Date(), type: 'ticket', category: sr.ticket_category }, ...prev.slice(0, 29)]);

      isProcessingRef.current = false;
      return;
    }

    // ── GUEST INVITATION QR ────────────────────────────────────────────────
    // PHASE 3 FIX: Call atomic RPC — database does the check-and-update atomically
    // using FOR UPDATE row locking. No more TOCTOU race condition.
    const { data: scanResult, error } = await supabase.rpc('process_guest_qr_scan', {
      p_qr_code:  code,
      p_staff_id: profile!.id,
      p_event_id: selectedEventId || null,
    });

    if (error || !scanResult) {
      setResult({ state: 'error', type: 'guest', title: 'Scan Error', message: 'Failed to validate QR. Try again.' });
      addToast('invalid', '❌ Scan Error', 'Validation failed', undefined, undefined, 'guest');
      isProcessingRef.current = false;
      return;
    }

    const sr = scanResult as any;
    let state: ScanState;
    let title: string;
    let toastState: Toast['state'];

    if (sr.status === 'accepted') {
      state = 'accepted'; title = '✅ Access Granted'; toastState = 'accepted';
      playBeep('accepted'); vibrate('accepted');
    } else if (sr.status === 'rejected_used') {
      state = 'rejected'; title = '⚠️ Already Used'; toastState = 'rejected';
      playBeep('rejected'); vibrate('rejected');
    } else if (sr.status === 'rejected_inactive') {
      state = 'rejected'; title = '⚠️ Access Denied'; toastState = 'rejected';
      playBeep('rejected'); vibrate('rejected');
    } else {
      state = 'invalid'; title = '❌ Invalid QR Code'; toastState = 'invalid';
      playBeep('invalid'); vibrate('invalid');
    }

    setResult({ state, type: 'guest', title, message: sr.message, guestName: sr.guest_name, eventName: sr.event_name });
    addToast(toastState, title, sr.message, sr.guest_name, undefined, 'guest');
    setScanHistory(prev => [{ name: sr.guest_name || 'Unknown', result: sr.status, time: new Date(), type: 'guest' }, ...prev.slice(0, 29)]);

    isProcessingRef.current = false;
  }, [profile, selectedEventId]);

  const scanFrame = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) { scheduleNextFrame(scanFrame); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const detected  = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    if (detected && !isProcessingRef.current) processQRCode(detected.data);
    scheduleNextFrame(scanFrame);
  }, [processQRCode, scheduleNextFrame]);

  useEffect(() => {
    if (cameraActive) animFrameRef.current = requestAnimationFrame(scanFrame);
  }, [cameraActive, scanFrame]);

  const stateConfig = {
    idle:       { bg: 'bg-slate-900 border-slate-700',         textColor: 'text-slate-400' },
    scanning:   { bg: 'bg-slate-900 border-blue-500/30',       textColor: 'text-blue-400'  },
    processing: { bg: 'bg-slate-900 border-indigo-500/30',     textColor: 'text-indigo-400' },
    accepted:   { bg: 'bg-emerald-950 border-emerald-500/50',  textColor: 'text-emerald-300' },
    rejected:   { bg: 'bg-amber-950 border-amber-500/50',      textColor: 'text-amber-300'  },
    invalid:    { bg: 'bg-red-950 border-red-500/50',          textColor: 'text-red-300'    },
    error:      { bg: 'bg-red-950 border-red-500/50',          textColor: 'text-red-300'    },
  };

  const sc = stateConfig[result.state] || stateConfig.idle;
  const catBadge = result.ticketCategory === 'VVIP' ? 'bg-yellow-400 text-yellow-950'
                 : result.ticketCategory === 'VIP'  ? 'bg-slate-300 text-slate-900'
                 : result.ticketCategory ? 'bg-blue-500 text-white' : null;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20}/></Link>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><QrIcon size={20} className="text-indigo-400"/>QR Scanner</h1>
        </div>

        {/* Event selector */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
          <label className="text-slate-400 text-xs font-medium mb-2 block uppercase tracking-wider">Scanning for Event</label>
          <select
            value={selectedEventId}
            onChange={e => {
              setSelectedEventId(e.target.value);
              if (e.target.value) sessionStorage.setItem('scanner_event_id', e.target.value);
              else sessionStorage.removeItem('scanner_event_id');
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500">
            <option value="">— Select event —</option>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </div>

        {/* Camera */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="relative aspect-video bg-slate-950">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <Camera size={40} className="text-slate-600" />
                {cameraError
                  ? <p className="text-red-400 text-sm text-center px-4">{cameraError}</p>
                  : <button onClick={startCamera} className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors text-sm"><Camera size={16}/>Start Camera</button>}
                {cameraError && <button onClick={startCamera} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm"><RefreshCw size={14}/>Retry</button>}
              </div>
            )}
            {result.state === 'processing' && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            )}
          </div>

          {/* Result panel */}
          <div className={`border-t transition-all ${sc.bg}`}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {result.state === 'accepted'   && <CheckCircle2 size={20} className="text-emerald-400"/>}
                  {result.state === 'rejected'   && <AlertTriangle size={20} className="text-amber-400"/>}
                  {result.state === 'invalid'    && <XCircle size={20} className="text-red-400"/>}
                  {result.state === 'error'      && <XCircle size={20} className="text-red-400"/>}
                  {result.state === 'processing' && <LoadingSpinner size="sm"/>}
                  {(result.state === 'idle' || result.state === 'scanning') && <QrIcon size={20} className="text-slate-500"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${sc.textColor}`}>{result.title}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{result.message}</p>
                  {result.guestName && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-white font-semibold text-sm">{result.guestName}</p>
                      {result.ticketCategory && catBadge && (
                        <span className={'text-xs font-bold px-2.5 py-0.5 rounded-full ' + catBadge}>
                          {result.ticketCategory}
                        </span>
                      )}
                      {result.ticketCategory === 'VVIP' && result.state === 'accepted' && (
                        <p className="text-yellow-400 text-xs font-semibold animate-pulse">⭐ VVIP — Premium Access</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Toast notifications */}
        <div className="fixed top-4 right-4 space-y-2 z-50 max-w-xs w-full pointer-events-none">
          {toasts.map(toast => {
            const styles = {
              accepted: { bg: 'bg-emerald-950 border-emerald-500/40', title: 'text-emerald-300', bar: 'bg-emerald-500' },
              rejected:  { bg: 'bg-amber-950 border-amber-500/40',   title: 'text-amber-300',   bar: 'bg-amber-500' },
              invalid:   { bg: 'bg-red-950 border-red-500/40',       title: 'text-red-300',     bar: 'bg-red-500' },
            };
            const s = styles[toast.state];
            const cb = toast.ticketCategory === 'VVIP' ? 'bg-yellow-400 text-yellow-950' : toast.ticketCategory === 'VIP' ? 'bg-slate-300 text-slate-900' : toast.ticketCategory ? 'bg-blue-500 text-white' : null;
            return (
              <div key={toast.id} className={`${s.bg} border rounded-2xl overflow-hidden shadow-xl pointer-events-auto`}>
                <div className="p-3">
                  <div className="flex items-start gap-2">
                    {toast.state === 'accepted' && <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5"/>}
                    {toast.state === 'rejected'  && <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5"/>}
                    {toast.state === 'invalid'   && <XCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5"/>}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${s.title}`}>{toast.title}</p>
                      {toast.guestName && <p className="text-white text-xs font-medium truncate">{toast.guestName}</p>}
                      {toast.ticketCategory && cb && (
                        <span className={'text-xs font-bold px-1.5 py-0.5 rounded-full ' + cb}>{toast.ticketCategory}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`h-0.5 ${s.bar} animate-[shrink_4s_linear_forwards]`} />
              </div>
            );
          })}
        </div>

        {/* Scan history */}
        {scanHistory.length > 0 && (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
            <button onClick={() => setShowHistory(h => !h)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:text-white transition-colors">
              <span className="font-medium flex items-center gap-2"><Clock size={14}/>Scan History ({scanHistory.length})</span>
              <ChevronDown size={14} className={showHistory ? 'rotate-180 transition-transform' : 'transition-transform'}/>
            </button>
            {showHistory && (
              <div className="border-t border-slate-800 divide-y divide-slate-800 max-h-48 overflow-y-auto">
                {scanHistory.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.result === 'accepted' ? 'bg-emerald-400' : item.result.startsWith('rejected') ? 'bg-amber-400' : 'bg-red-400'}`}/>
                    <span className="text-slate-300 flex-1 truncate">{item.name}</span>
                    {item.category && <span className="text-slate-500">{item.category}</span>}
                    <span className="text-slate-500">{format(item.time, 'HH:mm:ss')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}