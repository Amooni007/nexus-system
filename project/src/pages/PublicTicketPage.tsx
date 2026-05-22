// src/pages/PublicTicketPage.tsx
// Professional dual-mode payment system:
// PRIMARY:  STK Push (automatic, instant)
// FALLBACK: Manual M-Pesa (till/paybill shown automatically on STK failure/timeout)
// Tickets only issued after verified payment.

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Ticket, CalendarDays, MapPin, CheckCircle2, AlertTriangle,
  ArrowRight, Loader2, Phone, User, ShieldCheck, Copy,
  Check, XCircle, Clock, RefreshCw, ChevronDown,
  Download, MessageCircle, QrCode as QrIcon, FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  getPublicEventInfo, getCategoryAvailability, createOrder, isValidKEPhone,
} from '../lib/TicketingLib';
import { initiateStkPush, pollUntilConfirmed, subscribeToOrderUpdates } from '../lib/mpesa';
import { downloadPaymentReceipt } from '../lib/receiptGenerator';
import { downloadTicketAsPNG } from '../lib/ticketRenderer';
import { generateQRDataURL } from '../lib/qr';
import { supabase } from '../lib/supabase';
import type { PublicEventInfo, TicketCategoryConfig, TicketOrder } from '../types/ticketing';

type Step = 'browse' | 'details' | 'payment' | 'stk_waiting' | 'manual_pending' | 'success' | 'error';
type StkPhase = 'sending' | 'waiting_pin' | 'timed_out' | 'cancelled' | 'failed';

const CAT: Record<string, { bg: string; border: string; badge: string; text: string; glow: string }> = {
  VVIP:    { bg: 'bg-gradient-to-br from-yellow-900/40 to-amber-900/20', border: 'border-yellow-500/60', badge: 'bg-yellow-400 text-yellow-950', text: 'text-yellow-400', glow: 'ring-yellow-500/40' },
  VIP:     { bg: 'bg-gradient-to-br from-slate-700/50 to-slate-600/20',  border: 'border-slate-400/50',  badge: 'bg-slate-300 text-slate-900',   text: 'text-slate-300',  glow: 'ring-slate-400/40' },
  Regular: { bg: 'bg-gradient-to-br from-blue-900/30 to-blue-800/10',    border: 'border-blue-500/40',   badge: 'bg-blue-500 text-white',         text: 'text-blue-400',   glow: 'ring-blue-500/40' },
};
function catStyle(name: string) {
  return CAT[name] || { bg: 'bg-gradient-to-br from-purple-900/30 to-purple-800/10', border: 'border-purple-500/40', badge: 'bg-purple-500 text-white', text: 'text-purple-400', glow: 'ring-purple-500/40' };
}

// ── Reusable copy button ───────────────────────────────────────────────────────
function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors flex-shrink-0">
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

// ── Manual payment instructions panel ─────────────────────────────────────────
function ManualPaymentPanel({ event, total, orderId, custName }: {
  event: PublicEventInfo; total: number; orderId: string; custName: string;
}) {
  const ref = orderId !== 'preview' && orderId !== 'new' ? orderId.slice(0, 8).toUpperCase() : 'NX-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  return (
    <div className="space-y-3">
      {event.host_till && (
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-700/40 border-b border-slate-700">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Pay via Till Number</p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Lipa na M-Pesa · Buy Goods</p>
                <p className="text-white font-mono font-bold text-2xl tracking-wider">{event.host_till}</p>
              </div>
              <CopyBtn text={event.host_till} label="Copy Till" />
            </div>
            <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-slate-300 text-sm">Amount to Send</span>
              <span className="text-emerald-400 font-bold text-xl">KES {total.toLocaleString()}</span>
            </div>
            <div className="text-xs text-slate-500 space-y-1 pt-1">
              <p className="font-medium text-slate-400">Steps:</p>
              <p>1. Open M-Pesa → Lipa na M-Pesa → Buy Goods</p>
              <p>2. Enter till: <strong className="text-white">{event.host_till}</strong></p>
              <p>3. Amount: <strong className="text-white">KES {total.toLocaleString()}</strong> · Enter PIN → OK</p>
            </div>
          </div>
        </div>
      )}

      {event.host_paybill && (
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-700/40 border-b border-slate-700">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Pay via Paybill</p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Business Number</p>
                <p className="text-white font-mono font-bold text-2xl tracking-wider">{event.host_paybill}</p>
              </div>
              <CopyBtn text={event.host_paybill} label="Copy" />
            </div>
            <div className="flex items-center justify-between bg-slate-900 rounded-xl px-4 py-3">
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Account Number</p>
                <p className="text-white font-mono font-bold text-lg">{custName.split(' ')[0].toUpperCase()}-{ref}</p>
              </div>
              <CopyBtn text={`${custName.split(' ')[0].toUpperCase()}-${ref}`} label="Copy" />
            </div>
            <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-slate-300 text-sm">Amount to Send</span>
              <span className="text-emerald-400 font-bold text-xl">KES {total.toLocaleString()}</span>
            </div>
            <div className="text-xs text-slate-500 space-y-1 pt-1">
              <p className="font-medium text-slate-400">Steps:</p>
              <p>1. Open M-Pesa → Lipa na M-Pesa → Pay Bill</p>
              <p>2. Business: <strong className="text-white">{event.host_paybill}</strong></p>
              <p>3. Account: <strong className="text-white">{custName.split(' ')[0].toUpperCase()}-{ref}</strong></p>
              <p>4. Amount: <strong className="text-white">KES {total.toLocaleString()}</strong> · PIN → OK</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PublicTicketPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [event,        setEvent]        = useState<PublicEventInfo | null>(null);
  const [availability, setAvailability] = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(true);
  const [step,         setStep]         = useState<Step>('browse');

  const [selectedCat, setSelectedCat] = useState<TicketCategoryConfig | null>(null);
  const [quantity,    setQuantity]     = useState(1);
  const [custName,    setCustName]     = useState('');
  const [custPhone,   setCustPhone]    = useState('');
  const [errors,      setErrors]       = useState<Record<string, string>>({});

  // STK Push tracking
  const [stkPhase,    setStkPhase]    = useState<StkPhase>('sending');
  const [stkMessage,  setStkMessage]  = useState('');
  const [pollSeconds, setPollSeconds] = useState(0);
  const [retrying,          setRetrying]          = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [retryCooldown,     setRetryCooldown]     = useState(0);
  const [showFallback,      setShowFallback]      = useState(false);
  const [paymentTimeline,   setPaymentTimeline]   = useState<string[]>([]);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const pollTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef    = useRef(0);
  const isMountedRef  = useRef(true);
  const realtimeUnsubRef = useRef<(() => void) | null>(null);

  // Manual / fallback fields
  const [txCode,    setTxCode]    = useState('');
  const [txErrors,  setTxErrors]  = useState<Record<string, string>>({});
  const [submitting,setSubmitting]= useState(false);

  const [order,     setOrder]     = useState<TicketOrder | null>(null);
  const [tickets,   setTickets]   = useState<any[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null); // ticketToken being downloaded
  const [qrDataURL, setQrDataURL] = useState('');
  const [errMsg,    setErrMsg]    = useState('');

  useEffect(() => {
    if (!eventId) return;
    Promise.all([getPublicEventInfo(eventId), getCategoryAvailability(eventId)])
      .then(([ev, av]) => { setEvent(ev); setAvailability(av); setLoading(false); });
  }, [eventId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (realtimeUnsubRef.current) realtimeUnsubRef.current();
    };
  }, []);

  // Recovery useEffect: if user refreshes mid-payment, restore the waiting screen
  useEffect(() => {
    if (!event || !eventId) return;
    const pendingId = sessionStorage.getItem('nexus_pending_order');
    if (!pendingId) return;

    supabase
      .from('ticket_orders')
      .select('id, payment_status, customer_name, customer_phone, ticket_category, quantity, total_amount, unit_price, payment_mode, mpesa_transaction_code, payment_confirmed_at, created_at, event_id')
      .eq('id', pendingId)
      .eq('event_id', eventId)
      .in('payment_status', ['pending', 'pending_verification', 'confirmed'])
      .maybeSingle()
      .then(async ({ data }) => {
        if (!isMountedRef.current) return;
        if (!data) { sessionStorage.removeItem('nexus_pending_order'); return; }
        setOrder(data as TicketOrder);
        if (data.payment_status === 'confirmed') {
          // Payment succeeded while browser was closed — restore success screen
          const { data: tix } = await supabase
            .from('tickets').select('ticket_token, customer_name, ticket_category, status')
            .eq('order_id', data.id).eq('status', 'unused');
          setTickets(tix || []);
          sessionStorage.removeItem('nexus_pending_order');
          setStep('success');
        } else {
          // Still pending — restore waiting screen
          setStep('stk_waiting');
          setStkPhase('timed_out');
          setStkMessage('You have an in-progress payment. Pay manually below or retry STK Push.');
          setShowFallback(true);
        }
      });
  }, [event, eventId]);

  function getRemaining(cat: TicketCategoryConfig) {
    return Math.max(0, cat.quantity - (availability[cat.name] || 0));
  }
  const total = selectedCat ? selectedCat.price * quantity : 0;

  function validateDetails() {
    const errs: Record<string, string> = {};
    if (!custName.trim() || custName.trim().length < 2) errs.name = 'Full name required';
    if (!isValidKEPhone(custPhone)) errs.phone = 'Enter a valid Kenyan number: 07xxxxxxxx or 01xxxxxxxx';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateTxCode() {
    const errs: Record<string, string> = {};
    const code = txCode.trim().toUpperCase();
    if (!code || code.length < 8) errs.txCode = 'Enter your M-Pesa transaction code (e.g. PGM1ABC234)';
    if (code && !/^[A-Z0-9]{8,12}$/.test(code)) errs.txCode = 'Invalid — 8 to 12 alphanumeric characters';
    setTxErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function addTimeline(msg: string) {
    setPaymentTimeline(prev => [...prev, msg]);
  }

  function startTimer() {
    secondsRef.current = 0; setPollSeconds(0);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => { secondsRef.current += 1; setPollSeconds(secondsRef.current); }, 1000);
  }
  function stopTimer() {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }

  // ── Core STK flow ─────────────────────────────────────────────────────────
  const runStkFlow = useCallback(async (existingOrderId?: string) => {
    if (!event || !selectedCat) return;
    if (processingPayment) return;
    setProcessingPayment(true);
    setPaymentTimeline([]);
    setStkPhase('sending');
    setStkMessage('Sending M-Pesa prompt to your phone…');
    setShowFallback(false);

    let orderId = existingOrderId;
    try {
      if (!orderId) {
        addTimeline('Order created');
        const created = await createOrder({
          event_id: eventId!, customer_name: custName.trim(),
          customer_phone: custPhone.trim(), ticket_category: selectedCat.name,
          quantity, unit_price: selectedCat.price, payment_mode: 'platform_mpesa',
        });
        setOrder(created);
        orderId = created.id;
        // Payment lock: prevents multi-tab duplicate orders
        sessionStorage.setItem('nexus_pending_order', created.id);
      }

      await initiateStkPush({ orderId: orderId!, phone: custPhone.trim(), amount: total, eventName: event.name });
      addTimeline('STK Push sent to phone');

      setStkPhase('waiting_pin');
      setStkMessage('Enter your M-Pesa PIN on your phone to confirm');
      startTimer();

      // Realtime subscription fires instantly when DB row changes.
      // pollUntilConfirmed runs in parallel as a fallback.
      // resolved guard prevents double state transitions.
      const finalStatus = await new Promise<'confirmed' | 'failed' | 'cancelled' | 'timeout'>((resolve) => {
        let resolved = false;
        const safeResolve = (s: 'confirmed' | 'failed' | 'cancelled' | 'timeout') => {
          if (resolved || !isMountedRef.current) return;
          resolved = true;
          if (realtimeUnsubRef.current) { realtimeUnsubRef.current(); realtimeUnsubRef.current = null; }
          resolve(s);
        };

        // Realtime: instant resolution on DB change
        const unsub = subscribeToOrderUpdates(orderId!, (status) => {
          if (status === 'pending') setStkMessage('Waiting for M-Pesa confirmation…');
          if (status === 'pending_verification') setStkMessage('Payment received — verifying…');
          if (['confirmed', 'failed', 'cancelled', 'expired'].includes(status)) {
            safeResolve(status === 'expired' ? 'timeout' : status as any);
          }
        });
        realtimeUnsubRef.current = unsub;

        // Polling fallback: also resolves if realtime misses the event
        pollUntilConfirmed(orderId!, () => {}).then(s => safeResolve(s));
      });

      stopTimer();

      if (finalStatus === 'confirmed') {
        addTimeline('Payment confirmed');
        addTimeline('Tickets generated');
        // Order reference QR — shown only as reference, not for gate entry
        const qr = await generateQRDataURL('NEXUS-ORDER:' + orderId);
        setQrDataURL(qr);
        const { data: generatedTickets } = await supabase
          .from('tickets').select('ticket_token, customer_name, ticket_category, status, delivery_status')
          .eq('order_id', orderId).eq('status', 'unused');
        setTickets(generatedTickets || []);
        sessionStorage.removeItem('nexus_pending_order');
        setProcessingPayment(false);
        setStep('success');
      } else if (finalStatus === 'cancelled') {
        sessionStorage.removeItem('nexus_pending_order');
        setProcessingPayment(false);
        setStkPhase('cancelled');
        setStkMessage('You cancelled the M-Pesa prompt.');
        setShowFallback(true);
        setTimeout(() => fallbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else if (finalStatus === 'timeout') {
        setStkPhase('timed_out');
        sessionStorage.removeItem('nexus_pending_order');
        setStkMessage('The prompt timed out — customer did not respond within 2 minutes.');
        setShowFallback(true);
      } else {
        sessionStorage.removeItem('nexus_pending_order');
        setProcessingPayment(false);
        setStkPhase('failed');
        setStkMessage('STK Push failed. Please try again or pay manually below.');
        setShowFallback(true);
      }
    } catch (err: unknown) {
      stopTimer();
      sessionStorage.removeItem('nexus_pending_order');
      setProcessingPayment(false);
      setStkPhase('failed');
      setStkMessage(err instanceof Error ? err.message : 'Failed to send M-Pesa prompt.');
      setShowFallback(true);
    }
  }, [event, selectedCat, eventId, custName, custPhone, quantity, total]);

  async function handlePay() {
    if (!event || !selectedCat) return;
    setStep('stk_waiting');
    await runStkFlow();
  }

  async function handleRetryStk() {
    if (!order || processingPayment || retryCooldown > 0) return;
    setRetrying(true);
    await runStkFlow(order.id);
    setRetrying(false);
    // 15-second cooldown after retry
    setRetryCooldown(15);
    const cd = setInterval(() => {
      setRetryCooldown(prev => {
        if (prev <= 1) { clearInterval(cd); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  // Polls DB directly for order status changes.
  // Used after manual fallback payment code is submitted.
  // Cancellable via the returned cancel function.
  function pollOrderStatus(
    orderId: string,
    onUpdate: (status: string) => void,
    intervalMs = 5000,
    maxWaitMs  = 180000
  ): Promise<'confirmed' | 'timeout'> & { cancel: () => void } {
    let cancelled = false;
    let iv: ReturnType<typeof setInterval>;

    const promise = new Promise<'confirmed' | 'timeout'>((resolve) => {
      const start = Date.now();
      iv = setInterval(async () => {
        if (cancelled) { clearInterval(iv); resolve('timeout'); return; }
        if (Date.now() - start > maxWaitMs) { clearInterval(iv); resolve('timeout'); return; }
        try {
          const { data } = await supabase
            .from('ticket_orders')
            .select('payment_status')
            .eq('id', orderId)
            .single();
          if (!isMountedRef.current) { clearInterval(iv); resolve('timeout'); return; }
          if (data) onUpdate(data.payment_status);
          if (data?.payment_status === 'confirmed') { clearInterval(iv); resolve('confirmed'); }
        } catch { /* keep polling on network error */ }
      }, intervalMs);
    }) as Promise<'confirmed' | 'timeout'> & { cancel: () => void };

    promise.cancel = () => { cancelled = true; clearInterval(iv); };
    return promise;
  }

  // Manual fallback submit (after STK fails — existing order)
  async function handleManualFallbackSubmit() {
    if (!order || !validateTxCode()) return;
    setSubmitting(true);
    try {
      const code = txCode.trim().toUpperCase();
      const { data: existing } = await supabase
        .from('ticket_orders').select('id')
        .eq('mpesa_transaction_code', code).neq('id', order.id).maybeSingle();
      if (existing) {
        setTxErrors({ txCode: 'This code has already been used. Each M-Pesa code can only be submitted once.' });
        return;
      }
      // SERVER-SIDE: submit_manual_payment RPC validates code uniqueness,
      // format, and order status before updating. Browser cannot bypass these checks.
      const { data: rpcData, error } = await supabase.rpc('submit_manual_payment', {
        p_order_id: order.id,
        p_tx_code:  code,
      });
      if (error) throw error;
      if (!rpcData?.success) throw new Error(rpcData?.error || 'Submission failed');
      const { data: updated } = await supabase.from('ticket_orders').select('*').eq('id', order.id).single();
      if (updated) setOrder(updated as TicketOrder);
      const qr = await generateQRDataURL('NEXUS-ORDER:' + order.id);
      setQrDataURL(qr);
      // Move to pending screen — do NOT show success yet
      // Polling will move to success once payment is verified
      setStep('manual_pending');
      // Background poll — resolves when admin/C2B confirms payment
      pollOrderStatus(order.id, (status) => {
        if (status === 'confirmed' && isMountedRef.current) {
          supabase.from('tickets').select('ticket_token, customer_name, ticket_category, status')
            .eq('order_id', order.id).eq('status', 'unused')
            .then(({ data }) => {
              setTickets(data || []);
              sessionStorage.removeItem('nexus_pending_order');
              setStep('success');
            });
        }
      });
    } catch (err: unknown) {
      setTxErrors({ txCode: err instanceof Error ? err.message : 'Submission failed. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  // Manual primary submit (host_manual events only)
  async function handleManualPrimary() {
    if (!event || !selectedCat || !validateTxCode()) return;
    setSubmitting(true);
    try {
      const created = await createOrder({
        event_id: eventId!, customer_name: custName.trim(), customer_phone: custPhone.trim(),
        ticket_category: selectedCat.name, quantity, unit_price: selectedCat.price,
        payment_mode: 'host_manual', mpesa_transaction_code: txCode.trim().toUpperCase(),
      });
      setOrder(created);
      const qr = await generateQRDataURL('NEXUS-ORDER:' + created.id);
      setQrDataURL(qr);
      setStep('success');
    } catch (err: unknown) {
      setTxErrors({ txCode: err instanceof Error ? err.message : 'Submission failed. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading / not found ────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="text-indigo-400 animate-spin mx-auto" size={40} />
        <p className="text-slate-400 text-sm">Loading ticket information…</p>
      </div>
    </div>
  );

  if (!event) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 px-4">
      <AlertTriangle className="text-red-400 mx-auto" size={52} />
      <h2 className="text-xl font-bold text-white">Tickets Not Available</h2>
      <p className="text-slate-400 text-sm text-center">This event does not exist or ticket sales are not enabled.</p>
    </div>
  );

  // Use new granular payment flags (fall back to payment_mode for old events)
  const isAutomatic    = event.allow_stk_push ?? (event.payment_mode === 'platform_mpesa');
  const hasManualOption = (event.allow_manual ?? false) && !!(event.host_till || event.host_paybill);

  // ── STK Waiting screen (with inline fallback) ──────────────────────────────
  if (step === 'stk_waiting') {
    const isWaiting = stkPhase === 'sending' || stkPhase === 'waiting_pin';
    const hasFailed = stkPhase === 'timed_out' || stkPhase === 'cancelled' || stkPhase === 'failed';

    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="bg-gradient-to-b from-indigo-950/60 to-slate-950 px-4 pt-8 pb-5 border-b border-slate-800/60">
          <div className="max-w-lg mx-auto">
            <p className="text-indigo-400 text-xs font-semibold uppercase tracking-widest mb-1">Completing Payment</p>
            <h1 className="text-xl font-bold text-white">{event.name}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {selectedCat?.name} · {quantity} ticket{quantity > 1 ? 's' : ''} ·{' '}
              <span className="text-emerald-400 font-semibold">KES {total.toLocaleString()}</span>
            </p>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6 space-y-5 pb-16">

          {/* STK status card */}
          <div className={`rounded-2xl border p-5 space-y-4 transition-all ${
            isWaiting ? 'bg-indigo-950/30 border-indigo-500/30' : 'bg-amber-950/20 border-amber-500/30'
          }`}>
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${isWaiting ? 'bg-indigo-500/10' : 'bg-amber-500/10'}`}>
                {stkPhase === 'sending'     && <Loader2 className="text-indigo-400 animate-spin" size={22} />}
                {stkPhase === 'waiting_pin' && <Phone className="text-indigo-300" size={22} />}
                {stkPhase === 'timed_out'   && <Clock className="text-amber-400" size={22} />}
                {stkPhase === 'cancelled'   && <XCircle className="text-amber-400" size={22} />}
                {stkPhase === 'failed'      && <AlertTriangle className="text-amber-400" size={22} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${isWaiting ? 'text-indigo-300' : 'text-amber-300'}`}>
                  {stkPhase === 'sending'     && 'Sending M-Pesa Prompt…'}
                  {stkPhase === 'waiting_pin' && 'Waiting for PIN Confirmation'}
                  {stkPhase === 'timed_out'   && 'Prompt Timed Out'}
                  {stkPhase === 'cancelled'   && 'Prompt Cancelled'}
                  {stkPhase === 'failed'      && 'STK Push Failed'}
                </p>
                <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{stkMessage}</p>
                {stkPhase === 'waiting_pin' && (
                  <p className="text-white text-sm font-semibold mt-1">📱 {custPhone}</p>
                )}
              </div>
              {isWaiting && pollSeconds > 0 && (
                <div className="flex-shrink-0 bg-slate-800 border border-slate-700 rounded-full px-2.5 py-1 text-xs text-slate-400 flex items-center gap-1">
                  <Clock size={10} />{pollSeconds}s
                </div>
              )}
            </div>

            {/* PIN steps shown after 5s */}
            {stkPhase === 'waiting_pin' && pollSeconds > 5 && (
              <div className="bg-slate-800/60 rounded-xl p-3 text-xs text-slate-400 space-y-1 border border-slate-700">
                <p className="text-slate-300 font-medium mb-1">On your phone:</p>
                <p>1. A popup from M-Pesa should appear</p>
                <p>2. Check the amount is <strong className="text-white">KES {total.toLocaleString()}</strong></p>
                <p>3. Enter your M-Pesa PIN and press OK</p>
              </div>
            )}

            {/* "Didn't receive?" link while waiting */}
            {isWaiting && hasManualOption && (
              <button onClick={() => setShowFallback(f => !f)}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                <ChevronDown size={12} className={showFallback ? 'rotate-180 transition-transform' : 'transition-transform'} />
                Didn't receive the prompt? Pay manually instead
              </button>
            )}

            {/* Retry + manual buttons when failed */}
            {hasFailed && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleRetryStk}
                  disabled={retrying || processingPayment || retryCooldown > 0}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors disabled:opacity-50">
                  {retrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {retrying ? 'Sending…' : retryCooldown > 0 ? `Wait ${retryCooldown}s` : 'Retry STK Push'}
                </button>
                {hasManualOption && (
                  <button onClick={() => setShowFallback(true)}
                    className="flex-1 text-sm px-3 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors font-medium">
                    Pay Manually
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Inline fallback panel */}
          {showFallback && hasManualOption && order && (
            <div ref={fallbackRef} className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-slate-800" />
                <p className="text-slate-500 text-xs font-medium px-2 whitespace-nowrap">PAY MANUALLY INSTEAD</p>
                <div className="flex-1 h-px bg-slate-800" />
              </div>

              <ManualPaymentPanel event={event} total={total} orderId={order.id} custName={custName} />

              {/* Transaction code entry */}
              <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-800/60 border-b border-slate-700">
                  <p className="text-sm font-semibold text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-xs flex items-center justify-center font-bold">2</span>
                    After paying — enter your M-Pesa code
                  </p>
                </div>
                <div className="p-4 space-y-3">
                  <input type="text" value={txCode}
                    onChange={e => setTxCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="e.g. PGM1ABC234" maxLength={12}
                    className={`w-full bg-slate-800 border rounded-xl px-4 py-3 text-white font-mono text-base placeholder-slate-600 focus:outline-none uppercase tracking-widest transition-colors ${txErrors.txCode ? 'border-red-500' : 'border-slate-600 focus:border-indigo-500'}`} />
                  {txErrors.txCode
                    ? <p className="text-red-400 text-xs">{txErrors.txCode}</p>
                    : <p className="text-slate-600 text-xs">From your M-Pesa SMS · Each code can only be used once</p>}
                  <button onClick={handleManualFallbackSubmit} disabled={submitting || txCode.length < 8}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors">
                    {submitting ? <><Loader2 size={15} className="animate-spin" />Submitting…</> : '✅ Submit Transaction Code'}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                <ShieldCheck size={13} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                Tickets are only issued after payment is verified. Codes are unique and cannot be reused.
              </div>
            </div>
          )}

          {hasFailed && !hasManualOption && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 text-center space-y-3">
              <p className="text-slate-400 text-sm">STK Push is the only payment method for this event.</p>
              <button onClick={() => { setStep('payment'); }}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                ← Go back and try again
              </button>
            </div>
          )}

          {/* Payment timeline */}
          {paymentTimeline.length > 0 && (
            <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-4 space-y-2">
              {paymentTimeline.map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs">
                  <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={10} className="text-white" />
                  </div>
                  <span className="text-slate-300">{item}</span>
                </div>
              ))}
              {(stkPhase === 'sending' || stkPhase === 'waiting_pin') && (
                <div className="flex items-center gap-2.5 text-xs">
                  <div className="w-4 h-4 rounded-full bg-indigo-500/30 border border-indigo-500/50 flex items-center justify-center flex-shrink-0">
                    <Loader2 size={8} className="text-indigo-400 animate-spin" />
                  </div>
                  <span className="text-slate-500">
                    {stkPhase === 'sending' ? 'Sending prompt…' : 'Awaiting PIN confirmation…'}
                  </span>
                </div>
              )}
            </div>
          )}

          {order && (
            <p className="text-center text-slate-600 text-xs">
              Order ref: <span className="font-mono text-slate-500">{order.id.slice(0,8).toUpperCase()}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  // ── Download receipt ──────────────────────────────────────────────────────
  async function handleDownloadReceipt() {
    if (!order || !event) return;
    setDownloading('receipt');
    try {
      await downloadPaymentReceipt({
        orderRef:        order.id.slice(0, 8).toUpperCase(),
        customerName:    order.customer_name,
        customerPhone:   order.customer_phone,
        ticketCategory:  order.ticket_category,
        quantity:        order.quantity,
        unitPrice:       order.unit_price,
        totalAmount:     order.total_amount,
        paymentMethod:   order.payment_mode === 'platform_mpesa' ? 'M-Pesa STK Push' : 'M-Pesa Manual',
        transactionCode: order.mpesa_transaction_code || null,
        paidAt:          order.payment_confirmed_at || order.created_at,
        eventName:       event.name,
        eventDate:       event.date,
        eventLocation:   event.location,
        ticketTokens:    tickets.map(t => t.ticket_token),
      });
    } catch (e) {
      console.error('Receipt download failed:', e);
    }
    setDownloading(null);
  }

  // ── Download individual ticket as PNG ─────────────────────────────────────
  async function handleDownloadTicket(ticket: any) {
    if (!event) return;
    setDownloading(ticket.ticket_token);
    try {
      await downloadTicketAsPNG({
        ticketToken:      ticket.ticket_token,
        customerName:     ticket.customer_name,
        ticketCategory:   ticket.ticket_category,
        eventName:        event.name,
        eventDate:        new Date(event.date).toLocaleDateString('en-KE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
        eventTime:        new Date(event.date).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
        eventLocation:    event.location,
        ticketId:         ticket.ticket_token,
        templateImageUrl: null,
        eventId:          order!.event_id,
      });
    } catch (e) {
      console.error('Ticket download failed:', e);
    }
    setDownloading(null);
  }

  // ── WhatsApp delivery ─────────────────────────────────────────────────────
  function handleWhatsAppDelivery() {
    if (!order || !event) return;
    const ref       = order.id.slice(0, 8).toUpperCase();
    const eventDate = new Date(event.date).toLocaleDateString('en-KE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const message   = encodeURIComponent(
      `🎟 *Your Ticket — ${event.name}*

` +
      `Hello ${order.customer_name}!

` +
      `Your payment has been confirmed.

` +
      `*Event:* ${event.name}
` +
      `*Date:* ${eventDate}
` +
      `*Venue:* ${event.location}
` +
      `*Category:* ${order.ticket_category}
` +
      `*Qty:* ${order.quantity} ticket${order.quantity > 1 ? 's' : ''}
` +
      `*Amount:* KES ${order.total_amount.toLocaleString()}

` +
      `*Order Ref:* ${ref}

` +
      `Show this message + your QR code at the gate for entry.

` +
      `_Powered by Nexus Event System_`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  }

  // ── Manual pending screen ──────────────────────────────────────────────────
  // Shown after manual payment code submitted — BEFORE verification completes.
  // Does NOT show tickets or WhatsApp buttons — payment not yet verified.
  if (step === 'manual_pending' && order) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-4">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
              <Loader2 className="text-amber-400 animate-spin" size={32} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Payment Submitted</h2>
              <p className="text-slate-400 text-sm mt-1 leading-relaxed">
                Your transaction code has been received. We are verifying your payment — this may take a few minutes.
              </p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Order Ref</span>
                <span className="text-white font-mono font-bold">{order.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount</span>
                <span className="text-emerald-400 font-bold">KES {order.total_amount.toLocaleString()}</span>
              </div>
              {order.mpesa_transaction_code && (
                <div className="flex justify-between">
                  <span className="text-slate-400">M-Pesa Code</span>
                  <span className="text-white font-mono">{order.mpesa_transaction_code}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-slate-700">
                <span className="text-slate-400">Status</span>
                <span className="text-amber-400 font-semibold text-xs px-2 py-0.5 rounded-full bg-amber-900/40">
                  ⏳ Awaiting Verification
                </span>
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-xs text-slate-400 space-y-1 text-left">
              <p className="text-slate-300 font-medium mb-1">What happens next:</p>
              <p>1. Your M-Pesa code is being verified automatically</p>
              <p>2. Once confirmed, your tickets will appear here</p>
              <p>3. You can also show your order ref at the gate</p>
            </div>
          </div>
          {qrDataURL && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 flex flex-col items-center gap-2">
              <p className="text-slate-400 text-xs font-medium">Order Reference QR</p>
              <div className="bg-white p-2 rounded-xl">
                <img src={qrDataURL} alt="Order QR" className="w-24 h-24" />
              </div>
              <p className="text-slate-500 text-xs">Show this to the organiser if needed</p>
            </div>
          )}
          <p className="text-center text-slate-600 text-xs">
            Keep this page open — it will update automatically when verified
          </p>
        </div>
      </div>
    );
  }

  if (step === 'success' && order) {
    const isPending = order.payment_status === 'pending_verification';
    const ref       = order.id.slice(0, 8).toUpperCase();

    return (
      <div className="min-h-screen bg-slate-950 text-white pb-16">
        {/* Header */}
        <div className={`px-4 pt-10 pb-6 text-center border-b ${isPending ? 'bg-gradient-to-b from-amber-950/40 to-slate-950 border-amber-800/30' : 'bg-gradient-to-b from-emerald-950/40 to-slate-950 border-emerald-800/30'}`}>
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${isPending ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
            <CheckCircle2 className={isPending ? 'text-amber-400' : 'text-emerald-400'} size={36} />
          </div>
          <h1 className="text-2xl font-bold text-white">{isPending ? 'Order Received!' : '🎟 Payment Confirmed!'}</h1>
          <p className="text-slate-400 text-sm mt-1 max-w-xs mx-auto">
            {isPending
              ? 'Your code is being verified. Tickets sent via WhatsApp once confirmed.'
              : 'Your tickets are ready. Download or share via WhatsApp below.'}
          </p>
        </div>

        <div className="max-w-md mx-auto px-4 pt-5 space-y-4">

          {/* Order summary card */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-800/60 border-b border-slate-700 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Order Summary</p>
              <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">{ref}</span>
            </div>
            <div className="p-4 space-y-2 text-sm">
              {[
                { label: 'Event',    value: event.name },
                { label: 'Name',     value: order.customer_name },
                { label: 'Category', value: order.ticket_category },
                { label: 'Qty',      value: `${order.quantity} ticket${order.quantity > 1 ? 's' : ''}` },
              ].map(r => (
                <div key={r.label} className="flex justify-between">
                  <span className="text-slate-400">{r.label}</span>
                  <span className="text-white font-medium">{r.value}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold pt-2 border-t border-slate-700/60">
                <span className="text-slate-300">Total Paid</span>
                <span className="text-emerald-400">KES {order.total_amount.toLocaleString()}</span>
              </div>
              {order.mpesa_transaction_code && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">M-Pesa Code</span>
                  <span className="text-slate-300 font-mono">{order.mpesa_transaction_code}</span>
                </div>
              )}
              <div className="flex justify-between pt-1">
                <span className="text-slate-400">Status</span>
                <span className={`font-semibold text-xs px-2 py-0.5 rounded-full ${isPending ? 'bg-amber-900/40 text-amber-300' : 'bg-emerald-900/40 text-emerald-300'}`}>
                  {isPending ? '⏳ Pending Verification' : '✓ Confirmed'}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons — only for confirmed orders */}
          {!isPending && (
            <>
              {/* WhatsApp share */}
              <button
                onClick={handleWhatsAppDelivery}
                className="w-full flex items-center justify-center gap-2.5 bg-[#25D366] hover:bg-[#20bc5a] text-white font-bold py-4 rounded-2xl transition-colors text-base">
                <MessageCircle size={20} />
                Share Ticket on WhatsApp
              </button>

              {/* Download receipt */}
              <button
                onClick={handleDownloadReceipt}
                disabled={downloading === 'receipt'}
                className="w-full flex items-center justify-center gap-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-semibold py-3.5 rounded-2xl transition-colors text-sm disabled:opacity-50">
                {downloading === 'receipt'
                  ? <Loader2 size={16} className="animate-spin" />
                  : <FileText size={16} />}
                {downloading === 'receipt' ? 'Generating...' : 'Download Payment Receipt (PDF)'}
              </button>

              {/* Individual ticket downloads */}
              {tickets.length > 0 && (
                <div className="space-y-2">
                  <p className="text-slate-400 text-xs font-medium px-1">Your Tickets</p>
                  {tickets.map((t, i) => (
                    <div key={t.ticket_token} className="bg-slate-900 border border-slate-700 rounded-2xl p-4 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                        <Ticket size={16} className="text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{t.customer_name}</p>
                        <p className="text-slate-500 text-xs">{t.ticket_category} · #{t.ticket_token.slice(0, 8).toUpperCase()}</p>
                      </div>
                      <button
                        onClick={() => handleDownloadTicket(t)}
                        disabled={downloading === t.ticket_token}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50 flex-shrink-0">
                        {downloading === t.ticket_token
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Download size={12} />}
                        {downloading === t.ticket_token ? '...' : 'PNG'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Pending — show instructions */}
          {isPending && (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-2xl p-4 space-y-2 text-sm">
              <p className="text-amber-300 font-semibold text-sm">What happens next?</p>
              <p className="text-slate-300">1. The organiser will verify your M-Pesa code</p>
              <p className="text-slate-300">2. Your ticket will be sent to your WhatsApp</p>
              <p className="text-slate-300">3. You can also show your order ref at the gate</p>
            </div>
          )}

          {/* Order ref QR */}
          {qrDataURL && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 flex flex-col items-center gap-2">
              <p className="text-slate-400 text-xs font-medium">Order Reference QR</p>
              <div className="bg-white p-2 rounded-xl">
                <img src={qrDataURL} alt="Order QR" className="w-28 h-28" />
              </div>
              <p className="text-slate-500 text-xs text-center">Show this to the organiser if needed</p>
            </div>
          )}

          <p className="text-center text-slate-600 text-xs pb-4">
            Order ref: <span className="font-mono text-slate-400 font-semibold">{ref}</span>
            <br/>Save this — you may need it at the gate
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (step === 'error') return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-red-950/40 border border-red-500/40 rounded-2xl p-6 text-center space-y-4">
        <XCircle className="mx-auto text-red-400" size={48} />
        <h2 className="text-xl font-bold text-white">Something went wrong</h2>
        <p className="text-slate-300 text-sm leading-relaxed">{errMsg}</p>
        <button onClick={() => { setStep('payment'); setErrors({}); }}
          className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2.5 px-8 rounded-xl transition-colors">
          Try Again
        </button>
      </div>
    </div>
  );

  // ── Main: Browse → Details → Payment ──────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="bg-gradient-to-b from-indigo-950/60 to-slate-950 px-4 pt-10 pb-8 border-b border-slate-800/60">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <Ticket className="text-indigo-400" size={18} />
            <span className="text-indigo-400 font-semibold text-xs uppercase tracking-widest">Get Tickets</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{event.name}</h1>
          {event.description && <p className="text-slate-400 text-sm mt-2">{event.description}</p>}
          <div className="flex flex-col gap-1.5 mt-3 text-sm text-slate-400">
            <span className="flex items-center gap-2"><CalendarDays size={14} className="text-slate-500" />{format(new Date(event.date), 'EEEE, dd MMMM yyyy · h:mm a')}</span>
            <span className="flex items-center gap-2"><MapPin size={14} className="text-slate-500" />{event.location}</span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5 pb-16">

        {/* BROWSE */}
        {step === 'browse' && (
          <>
            <h2 className="text-base font-semibold text-slate-200">Select Ticket Category</h2>
            <div className="space-y-3">
              {event.ticket_categories.map(cat => {
                const remaining = getRemaining(cat);
                const style = catStyle(cat.name);
                const soldOut = remaining === 0;
                const isSel = selectedCat?.name === cat.name;
                return (
                  <button key={cat.name} disabled={soldOut}
                    onClick={() => { setSelectedCat(cat); setQuantity(1); }}
                    className={['w-full rounded-2xl border-2 p-4 text-left transition-all duration-150', style.bg,
                      soldOut ? 'opacity-40 cursor-not-allowed' : 'hover:scale-[1.01] active:scale-[0.99] cursor-pointer',
                      isSel ? style.border + ' ring-2 ring-offset-2 ring-offset-slate-950 ' + style.glow : 'border-slate-700/60'].join(' ')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={'text-xs font-bold px-2 py-0.5 rounded-full ' + style.badge}>{cat.name}</span>
                          {cat.access_zone && <span className="text-slate-400 text-xs">{cat.access_zone}</span>}
                        </div>
                        {cat.description && <p className="text-slate-400 text-xs mt-1">{cat.description}</p>}
                        <p className={'text-xs mt-2 font-medium ' + (soldOut ? 'text-red-400' : remaining <= 10 ? 'text-amber-400' : 'text-slate-500')}>
                          {soldOut ? '🔴 Sold Out' : remaining <= 10 ? `🟡 Only ${remaining} left!` : `🟢 ${remaining} available`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={'text-xl font-bold ' + style.text}>KES {cat.price.toLocaleString()}</p>
                        {isSel && <CheckCircle2 className={'mt-1 ml-auto ' + style.text} size={18} />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedCat && (
              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-4">
                <div>
                  <p className="text-slate-300 text-sm font-medium mb-3">How many tickets?</p>
                  <div className="flex items-center gap-4">
                    <button onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-xl font-bold">−</button>
                    <span className="text-3xl font-bold w-10 text-center">{quantity}</span>
                    <button onClick={() => setQuantity(q => Math.min(getRemaining(selectedCat), Math.min(10, q + 1)))}
                      className="w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-xl font-bold">+</button>
                  </div>
                  <p className="text-slate-600 text-xs mt-2">Maximum 10 per order</p>
                </div>
                <div className="flex items-center justify-between border-t border-slate-700/60 pt-3">
                  <div>
                    <p className="text-slate-400 text-sm">{quantity} × KES {selectedCat.price.toLocaleString()}</p>
                    <p className="text-slate-500 text-xs">{selectedCat.name}</p>
                  </div>
                  <p className="text-2xl font-bold text-emerald-400">KES {total.toLocaleString()}</p>
                </div>
                <button onClick={() => setStep('details')}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors">
                  Continue <ArrowRight size={18} />
                </button>
              </div>
            )}
          </>
        )}

        {/* DETAILS */}
        {step === 'details' && (
          <div className="space-y-5">
            <button onClick={() => setStep('browse')} className="text-slate-400 hover:text-white text-sm flex items-center gap-1.5">← Back</button>
            <h2 className="text-base font-semibold text-slate-200">Your Details</h2>
            <div>
              <label className="text-slate-400 text-sm mb-1.5 block font-medium">Full Name *</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input type="text" value={custName} onChange={e => setCustName(e.target.value)} placeholder="e.g. Jane Njeri"
                  className={'w-full bg-slate-800 border rounded-xl pl-10 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none transition-colors ' + (errors.name ? 'border-red-500' : 'border-slate-600 focus:border-indigo-500')} />
              </div>
              {errors.name && <p className="text-red-400 text-xs mt-1.5">{errors.name}</p>}
            </div>
            <div>
              <label className="text-slate-400 text-sm mb-1.5 block font-medium">
                Phone Number * <span className="text-slate-600 font-normal">{isAutomatic ? '(M-Pesa prompt sent here)' : '(tickets delivered here)'}</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input type="tel" value={custPhone} onChange={e => setCustPhone(e.target.value)} placeholder="0712 345 678"
                  className={'w-full bg-slate-800 border rounded-xl pl-10 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none transition-colors ' + (errors.phone ? 'border-red-500' : 'border-slate-600 focus:border-indigo-500')} />
              </div>
              {errors.phone && <p className="text-red-400 text-xs mt-1.5">{errors.phone}</p>}
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-slate-400">Category</span><span className="text-white">{selectedCat?.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Quantity</span><span className="text-white">{quantity} ticket{quantity > 1 ? 's' : ''}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-700 pt-2">
                <span className="text-slate-300">Total</span>
                <span className="text-emerald-400 text-base">KES {total.toLocaleString()}</span>
              </div>
              {isAutomatic && (
                <p className="text-slate-500 text-xs pt-1">
                  💡 An M-Pesa prompt for <strong className="text-white">KES {total.toLocaleString()}</strong> will be sent to <strong className="text-white">{custPhone || 'your phone'}</strong>
                </p>
              )}
            </div>
            <button onClick={() => { if (validateDetails()) setStep('payment'); }}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors">
              Proceed to Payment <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* PAYMENT */}
        {step === 'payment' && (
          <div className="space-y-5">
            <button onClick={() => setStep('details')} className="text-slate-400 hover:text-white text-sm flex items-center gap-1.5">← Back</button>
            <h2 className="text-base font-semibold text-slate-200">Complete Payment</h2>

            {isAutomatic ? (
              <div className="space-y-4">
                {/* STK Push card */}
                <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-2xl flex-shrink-0">📱</div>
                    <div>
                      <p className="text-white font-semibold">M-Pesa STK Push</p>
                      <p className="text-slate-400 text-xs">Fastest — prompt sent directly to your phone</p>
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-slate-400">Sending prompt to</span><span className="text-white font-bold">{custPhone}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Amount</span><span className="text-emerald-400 font-bold text-base">KES {total.toLocaleString()}</span></div>
                  </div>
                  <div className="bg-indigo-900/20 border border-indigo-500/20 rounded-xl p-3 text-xs text-indigo-300 space-y-0.5">
                    <p>✓ A popup will appear on your phone</p>
                    <p>✓ Enter your M-Pesa PIN to confirm</p>
                    <p>✓ Tickets generated automatically after payment</p>
                    {hasManualOption && <p>✓ Manual payment fallback available if prompt fails</p>}
                  </div>
                </div>
                <button onClick={handlePay}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors text-base">
                  📲 Send M-Pesa Prompt — KES {total.toLocaleString()}
                </button>

                {/* Pre-emptive manual toggle */}
                {hasManualOption && (
                  <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
                    <button onClick={() => setShowFallback(f => !f)}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-400 hover:text-white transition-colors">
                      <span>Prefer to pay manually? Click here</span>
                      <ChevronDown size={14} className={showFallback ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    </button>
                    {showFallback && (
                      <div className="border-t border-slate-800 p-4">
                       <ManualPaymentPanel event={event} total={total} orderId="new" custName={custName} />
                        <div className="mt-3 space-y-2">
                          <input type="text" value={txCode}
                            onChange={e => setTxCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                            placeholder="Enter M-Pesa code e.g. PGM1ABC234" maxLength={12}
                            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white font-mono text-base placeholder-slate-600 focus:outline-none uppercase tracking-widest" />
                          {txErrors.txCode && <p className="text-red-400 text-xs">{txErrors.txCode}</p>}
                          <button onClick={handleManualPrimary} disabled={submitting || txCode.length < 8}
                            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors">
                            {submitting ? 'Submitting…' : '✅ Submit Order'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* host_manual primary */
              <div className="space-y-4">
                <ManualPaymentPanel event={event} total={total} orderId="new" custName={custName} />
                <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-800/60 border-b border-slate-700">
                    <p className="text-sm font-semibold text-white flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-600 text-xs flex items-center justify-center font-bold">2</span>
                      Enter Transaction Code
                    </p>
                  </div>
                  <div className="p-4 space-y-3">
                    <input type="text" value={txCode}
                      onChange={e => setTxCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      placeholder="e.g. PGM1ABC234" maxLength={12}
                      className={`w-full bg-slate-800 border rounded-xl px-4 py-3 text-white font-mono text-base placeholder-slate-600 focus:outline-none uppercase tracking-widest transition-colors ${txErrors.txCode ? 'border-red-500' : 'border-slate-600 focus:border-indigo-500'}`} />
                    {txErrors.txCode
                      ? <p className="text-red-400 text-xs">{txErrors.txCode}</p>
                      : <p className="text-slate-600 text-xs">From your M-Pesa SMS · Each code is unique and used once only</p>}
                    <button onClick={handleManualPrimary} disabled={submitting || txCode.length < 8}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors">
                      {submitting ? <><Loader2 size={15} className="animate-spin" />Submitting…</> : '✅ Submit Order'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <ShieldCheck size={13} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              Tickets are only issued after verified payment. Transaction codes are unique and cannot be reused.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}