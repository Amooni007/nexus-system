// supabase/functions/mpesa-callback/index.ts
// FIXES:
//  MED-09  — Always returns 200 to Safaricom, even on parse/internal errors
//  HIGH-03 — Checks for existing tickets before generating (duplicate guard)
//  SEC-05  — Safaricom IP whitelist validation (production safety)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── SEC-05: Safaricom production IP ranges ────────────────────────────────────
// Source: Safaricom Daraja API documentation
// In sandbox mode we skip this check (Daraja sends from different IPs in sandbox)
const SAFARICOM_IPS = [
  '196.201.214.0/24',
  '196.201.216.0/24',
];

function ipInRange(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits))) - 1);
  const ipNum   = ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct), 0) >>> 0;
  const rangeNum = range.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct), 0) >>> 0;
  return (ipNum & mask) >>> 0 === (rangeNum & mask) >>> 0;
}

function isValidSafaricomIP(ip: string | null): boolean {
  const env = Deno.env.get('MPESA_ENVIRONMENT') || 'sandbox';
  // Skip IP validation in sandbox — Safaricom sandbox uses different IPs
  if (env !== 'production') return true;
  if (!ip) return false;
  return SAFARICOM_IPS.some(cidr => ipInRange(ip, cidr));
}

serve(async (req) => {
  // MED-09 FIX: ALWAYS return 200 to Safaricom — even on errors.
  // Safaricom retries on non-200, which can cause duplicate processing.
  // All errors are logged internally; Safaricom always gets OK.

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 }); // MED-09: 200 not 405
  }

  // SEC-05: Validate Safaricom IP in production
  const clientIP = req.headers.get('x-real-ip') ||
                   req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   null;

  if (!isValidSafaricomIP(clientIP)) {
    // Log the suspicious request but still return 200 (don't reveal rejection)
    await supabase.from('mpesa_payment_logs').insert({
      event_type:   'callback_ip_rejected',
      raw_payload:  { ip: clientIP, reason: 'IP not in Safaricom range' },
      status:       'suspicious',
    }).catch(() => {}); // best-effort log
    console.warn(`Callback rejected from IP: ${clientIP}`);
    return new Response('OK', { status: 200 }); // MED-09: always 200
  }

  let rawBody: string;
  let callback: Record<string, unknown>;

  try {
    rawBody = await req.text();
    callback = JSON.parse(rawBody);
  } catch (parseErr) {
    // MED-09 FIX: was returning 400 — now logs and returns 200
    console.error('Failed to parse callback body:', parseErr);
    await supabase.from('mpesa_payment_logs').insert({
      event_type:  'callback_parse_error',
      raw_payload: { error: String(parseErr) },
      status:      'failed',
    }).catch(() => {});
    return new Response('OK', { status: 200 }); // ← was 400, now 200
  }

  console.log('M-Pesa callback received');

  const stkCallback = (callback?.Body as any)?.stkCallback;
  if (!stkCallback) {
    console.error('Invalid callback structure');
    return new Response('OK', { status: 200 });
  }

  const {
    MerchantRequestID,
    CheckoutRequestID,
    ResultCode,
    ResultDesc,
    CallbackMetadata,
  } = stkCallback;

  const isSuccess = ResultCode === 0;

  // Log the raw callback
  await supabase.from('mpesa_payment_logs').insert({
    checkout_request_id: CheckoutRequestID,
    merchant_request_id: MerchantRequestID,
    event_type:          isSuccess ? 'stk_callback_success' : 'stk_callback_failed',
    raw_payload:         callback,
    result_code:         String(ResultCode),
    result_desc:         ResultDesc,
    status:              isSuccess ? 'success' : 'failed',
  }).catch(err => console.error('Log insert failed:', err));

  // Find the order
  const { data: order } = await supabase
    .from('ticket_orders')
    .select('*')
    .eq('mpesa_checkout_request_id', CheckoutRequestID)
    .maybeSingle();

  if (!order) {
    console.error('No order found for CheckoutRequestID:', CheckoutRequestID);
    return new Response('OK', { status: 200 });
  }

  // Handle failed / cancelled payment
  if (!isSuccess) {
    const isCancelled = ResultCode === 1032;
    await supabase.from('ticket_orders').update({
      payment_status: isCancelled ? 'cancelled' : 'failed',
      flag_reason:    ResultDesc,
      updated_at:     new Date().toISOString(),
    }).eq('id', order.id);
    return new Response('OK', { status: 200 });
  }

  // Extract metadata
  const items = (CallbackMetadata?.Item || []) as Array<{ Name: string; Value: unknown }>;
  const getMeta = (name: string) => items.find(i => i.Name === name)?.Value;

  const mpesaReceiptNumber = getMeta('MpesaReceiptNumber') as string;
  const paidAmount         = Number(getMeta('Amount') || 0);

  // Duplicate receipt protection
  const { data: existingReceipt } = await supabase
    .from('ticket_orders')
    .select('id')
    .eq('mpesa_transaction_code', mpesaReceiptNumber)
    .neq('id', order.id)
    .maybeSingle();

  if (existingReceipt) {
    console.error('Duplicate M-Pesa receipt:', mpesaReceiptNumber);
    await supabase.from('mpesa_payment_logs').insert({
      order_id:             order.id,
      checkout_request_id:  CheckoutRequestID,
      event_type:           'duplicate_receipt_detected',
      raw_payload:          { mpesaReceiptNumber, existingOrderId: existingReceipt.id },
      status:               'suspicious',
    }).catch(() => {});
    return new Response('OK', { status: 200 });
  }

  // Amount mismatch — flag for admin review, don't auto-confirm
  const expectedAmount  = Number(order.total_amount);
  const amountMismatch  = paidAmount < expectedAmount;

  if (amountMismatch) {
    await supabase.from('ticket_orders').update({
      payment_status:  'pending_verification',
      mpesa_transaction_code: mpesaReceiptNumber,
      submitted_amount: paidAmount,
      amount_mismatch:  true,
      is_flagged:       true,
      flag_reason:      `Underpayment: expected KES ${expectedAmount}, received KES ${paidAmount}`,
      updated_at:       new Date().toISOString(),
    }).eq('id', order.id);
    return new Response('OK', { status: 200 });
  }

  // HIGH-03 FIX: Check if order already confirmed / tickets already exist
  // This handles the case where mpesa-query fallback already confirmed the order
  if (order.payment_status === 'confirmed') {
    console.log(`Order ${order.id} already confirmed — skipping duplicate confirmation`);
    return new Response('OK', { status: 200 });
  }

  const { data: existingTickets } = await supabase
    .from('tickets')
    .select('id')
    .eq('order_id', order.id);

  if (existingTickets && existingTickets.length > 0) {
    console.log(`Tickets already exist for order ${order.id} — only updating receipt number`);
    await supabase.from('ticket_orders').update({
      payment_status:         'confirmed',
      mpesa_transaction_code: mpesaReceiptNumber,
      submitted_amount:       paidAmount,
      amount_mismatch:        false,
      payment_confirmed_at:   new Date().toISOString(),
      updated_at:             new Date().toISOString(),
    }).eq('id', order.id);
    return new Response('OK', { status: 200 });
  }

  // All clear — confirm order and generate tickets
  await supabase.from('ticket_orders').update({
    payment_status:         'confirmed',
    mpesa_transaction_code: mpesaReceiptNumber,
    submitted_amount:       paidAmount,
    amount_mismatch:        false,
    payment_confirmed_at:   new Date().toISOString(),
    updated_at:             new Date().toISOString(),
  }).eq('id', order.id);

  const ticketsToInsert = Array.from({ length: order.quantity }, () => ({
    order_id:        order.id,
    event_id:        order.event_id,
    customer_name:   order.customer_name,
    customer_phone:  order.customer_phone,
    ticket_category: order.ticket_category,
    status:          'unused',
    delivery_status: 'pending',
  }));

  const { data: tickets, error: ticketErr } = await supabase
    .from('tickets')
    .insert(ticketsToInsert)
    .select();

  if (ticketErr) {
    console.error('Failed to generate tickets:', ticketErr);
    // Payment is confirmed — tickets must be generated manually by admin
    // We still return 200 so Safaricom doesn't retry the callback
  } else {
    console.log(`Generated ${tickets?.length} ticket(s) for order ${order.id}`);
    await supabase.from('mpesa_payment_logs').insert({
      order_id:             order.id,
      checkout_request_id:  CheckoutRequestID,
      event_type:           'tickets_generated',
      raw_payload:          { ticketCount: tickets?.length, mpesaReceiptNumber, paidAmount },
      status:               'completed',
    }).catch(() => {});
  }

  return new Response('OK', { status: 200 });
});