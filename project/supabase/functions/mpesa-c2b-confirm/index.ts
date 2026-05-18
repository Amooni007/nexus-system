// supabase/functions/mpesa-c2b-confirm/index.ts
//
// ── WHAT IS THIS? ─────────────────────────────────────────────────────────────
// This edge function receives automatic callbacks from Safaricom when a customer
// pays to your TILL NUMBER or PAYBILL manually (not via STK Push).
//
// HOW IT WORKS:
// 1. Customer opens M-Pesa → Lipa na M-Pesa → Buy Goods / Pay Bill
// 2. Customer enters: till/paybill, account reference (e.g. JANE-A1B2C3D4), amount
// 3. Customer enters PIN → payment goes through
// 4. Safaricom sends a POST to THIS URL with the transaction details
// 5. We match the transaction to an order using the BillRefNumber (account field)
// 6. We validate: amount, phone, not already confirmed
// 7. We confirm the order and generate tickets automatically
//
// HOW TO REGISTER THIS URL WITH SAFARICOM:
// Call the C2B Register URL API once:
// POST https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl
// Body: {
//   "ShortCode": "your_till_or_paybill",
//   "ResponseType": "Completed",
//   "ConfirmationURL": "https://project.supabase.co/functions/v1/mpesa-c2b-confirm",
//   "ValidationURL": "https://project.supabase.co/functions/v1/mpesa-c2b-confirm"
// }
// This only needs to be done ONCE per shortcode.
// See: supabase/functions/mpesa-c2b-register/index.ts for the registration function.
//
// CALLBACK PAYLOAD FROM SAFARICOM:
// {
//   "TransactionType":   "Pay Bill" | "Buy Goods",
//   "TransID":           "PGM1ABC234",         ← unique M-Pesa code
//   "TransTime":         "20250514120000",
//   "TransAmount":       "2000.00",             ← amount paid
//   "BusinessShortCode": "123456",              ← your till/paybill
//   "BillRefNumber":     "JANE-A1B2C3D4",      ← account field customer typed
//   "MSISDN":            "254712345678",        ← customer's phone
//   "FirstName":         "Jane",
//   "LastName":          "Njeri"
// }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function extractOrderPrefix(billRef: string): string | null {
  // Handles: JANE-A1B2C3D4, NX-A1B2C3D4, A1B2C3D4
  const parts = billRef.toUpperCase().split('-');
  const candidate = parts[parts.length - 1];
  if (/^[A-F0-9]{8}$/i.test(candidate)) return candidate.toLowerCase();
  return null;
}

serve(async (req) => {
  // Always return 200 to Safaricom — non-200 causes retries
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Success' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    console.error('C2B: Failed to parse body');
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), { status: 200 });
  }

  console.log('C2B callback received:', JSON.stringify(body));

  const {
    TransID:           transId,
    TransAmount:       transAmountStr,
    BusinessShortCode: shortCode,
    BillRefNumber:     billRefNumber,
    MSISDN:            msisdn,
    FirstName:         firstName,
    LastName:          lastName,
  } = body;

  const transAmount = parseFloat(transAmountStr || '0');

  // ── Log the raw C2B callback ───────────────────────────────────────────────
  await supabase.from('mpesa_payment_logs').insert({
    event_type:  'c2b_callback_received',
    raw_payload: body,
    result_code: '0',
    result_desc: `C2B from ${msisdn} — ref: ${billRefNumber} — KES ${transAmount}`,
    status:      'pending',
  }).catch(() => {});

  // ── Duplicate check: has this TransID been used before? ──────────────────
  const { data: existingByCode } = await supabase
    .from('ticket_orders')
    .select('id, payment_status')
    .eq('mpesa_transaction_code', transId)
    .maybeSingle();

  if (existingByCode) {
    console.log(`C2B: Duplicate TransID ${transId} — already used for order ${existingByCode.id}`);
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Already processed' }), { status: 200 });
  }

  // ── Find the order by BillRefNumber ──────────────────────────────────────
  const orderPrefix = extractOrderPrefix(billRefNumber || '');
  let order: Record<string, unknown> | null = null;

  if (orderPrefix) {
    // Primary match: extract order ID prefix from BillRefNumber
    const { data } = await supabase
      .from('ticket_orders')
      .select('*')
      .ilike('id', orderPrefix + '%')
      .in('payment_status', ['pending', 'pending_verification'])
      .maybeSingle();
    order = data;
  }

  if (!order) {
    // Secondary match: phone + amount + pending status (best-effort for name_only format)
    const formattedPhone = msisdn?.startsWith('254') ? msisdn : '254' + (msisdn || '').replace(/^0/, '');
    const { data } = await supabase
      .from('ticket_orders')
      .select('*')
      .eq('customer_phone', formattedPhone.replace('254', '0'))  // stored as 07xx
      .eq('total_amount', transAmount)
      .in('payment_status', ['pending', 'pending_verification'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    order = data;
  }

  if (!order) {
    // No matching order found — log for admin review
    console.warn(`C2B: No matching order for BillRef=${billRefNumber} Amount=${transAmount} Phone=${msisdn}`);
    await supabase.from('mpesa_payment_logs').insert({
      event_type:  'c2b_no_matching_order',
      raw_payload: { transId, billRefNumber, transAmount, msisdn, shortCode },
      status:      'suspicious',
    }).catch(() => {});
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), { status: 200 });
  }

  const orderId      = order.id as string;
  const orderAmount  = Number(order.total_amount);
  const amountMatch  = Math.abs(transAmount - orderAmount) <= 1; // ±1 KES tolerance

  // ── Amount mismatch — flag for admin ──────────────────────────────────────
  if (!amountMatch) {
    await supabase.from('ticket_orders').update({
      mpesa_transaction_code:  transId,
      payment_method:          'manual_till',
      manual_reference:        billRefNumber,
      submitted_amount:        transAmount,
      amount_mismatch:         true,
      is_flagged:              true,
      flag_reason:             `C2B underpayment: expected KES ${orderAmount}, received KES ${transAmount}`,
      verification_status:     'flagged',
      payment_status:          'pending_verification',
      updated_at:              new Date().toISOString(),
    }).eq('id', orderId);

    await supabase.from('mpesa_payment_logs').insert({
      order_id:    orderId,
      event_type:  'c2b_amount_mismatch',
      raw_payload: { expected: orderAmount, received: transAmount, transId },
      status:      'suspicious',
    }).catch(() => {});

    console.warn(`C2B: Amount mismatch for order ${orderId}: expected ${orderAmount}, got ${transAmount}`);
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), { status: 200 });
  }

  // ── All checks passed — confirm order and generate tickets ────────────────
  await supabase.from('ticket_orders').update({
    payment_status:          'confirmed',
    payment_method:          'manual_till',
    manual_reference:        billRefNumber,
    mpesa_transaction_code:  transId,
    submitted_amount:        transAmount,
    amount_mismatch:         false,
    is_flagged:              false,
    verification_status:     'verified',
    verified_at:             new Date().toISOString(),
    payment_confirmed_at:    new Date().toISOString(),
    updated_at:              new Date().toISOString(),
  }).eq('id', orderId);

  // Check if tickets already exist (idempotency)
  const { data: existingTickets } = await supabase
    .from('tickets').select('id').eq('order_id', orderId);

  if (!existingTickets || existingTickets.length === 0) {
    const ticketsToInsert = Array.from({ length: Number(order.quantity) }, () => ({
      order_id:        orderId,
      event_id:        order.event_id,
      customer_name:   order.customer_name,
      customer_phone:  order.customer_phone,
      ticket_category: order.ticket_category,
      status:          'unused',
      delivery_status: 'pending',
    }));

    const { error: ticketErr } = await supabase.from('tickets').insert(ticketsToInsert);
    if (ticketErr) {
      console.error('C2B: Failed to generate tickets:', ticketErr);
    } else {
      console.log(`C2B: Generated ${order.quantity} tickets for order ${orderId}`);
    }
  }

  await supabase.from('mpesa_payment_logs').insert({
    order_id:    orderId,
    event_type:  'c2b_payment_confirmed',
    raw_payload: { transId, transAmount, billRefNumber, msisdn, firstName, lastName },
    status:      'completed',
  }).catch(() => {});

  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Success' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});