// supabase/functions/mpesa-stk-push/index.ts
// Called by the frontend when customer clicks "Pay with M-Pesa"
// Returns CheckoutRequestID which frontend polls for status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  getMpesaConfig, initiateStkPush, getCorsHeaders, corsResponse, corsError,
} from '../_shared/mpesa.ts';

serve(async (req) => {
  // Handle CORS preflight
  const corsH = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsH });

  try {
    const { orderId, phone, amount, eventName } = await req.json();

    // ── Validate inputs ───────────────────────────────────────────────────────
    if (!orderId || !phone || !amount || !eventName) {
      return corsError('Missing required fields: orderId, phone, amount, eventName');
    }
    if (amount <= 0) return corsError('Amount must be greater than 0');
    if (amount > 150000) return corsError('Amount exceeds M-Pesa limit of KES 150,000');

    // ── Supabase client (service role — can bypass RLS) ───────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Verify order exists and is in correct state ───────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from('ticket_orders')
      .select('id, payment_status, total_amount, event_id, mpesa_checkout_request_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) return corsError('Order not found', 404);

    // IDEMPOTENCY: if this order already has a checkout request in-flight,
    // return the existing one instead of initiating a duplicate STK Push.
    // Prevents double-prompts from rapid retries or double-clicks.
    if (order.mpesa_checkout_request_id && order.payment_status === 'pending') {
      return corsResponse({
        checkoutRequestId: order.mpesa_checkout_request_id,
        message: 'STK Push already initiated for this order',
        alreadySent: true,
      });
    }

    if (order.payment_status === 'confirmed') return corsError('Order already paid');
    if (order.payment_status === 'cancelled') return corsError('Order has been cancelled');

    // ── Prevent duplicate STK Push (already has a pending checkout) ───────────
    if (order.mpesa_checkout_request_id && order.payment_status === 'pending') {
      return corsResponse({
        checkoutRequestId: order.mpesa_checkout_request_id,
        message: 'STK Push already sent — awaiting customer confirmation',
        alreadySent: true,
      });
    }

    // ── Validate amount matches order (prevent underpayment attempts) ─────────
    if (Math.abs(Number(order.total_amount) - Number(amount)) > 1) {
      // Log suspicious attempt
      await supabase.from('mpesa_payment_logs').insert({
        order_id: orderId,
        event_type: 'stk_amount_mismatch',
        raw_payload: { requested: amount, expected: order.total_amount },
        status: 'suspicious',
      });
      return corsError(`Amount mismatch: expected KES ${order.total_amount}`);
    }

    // ── Initiate STK Push ─────────────────────────────────────────────────────
    const config = getMpesaConfig();
    const stkResponse = await initiateStkPush({ phone, amount, orderId, eventName, config });

    // ── Update order with CheckoutRequestID ───────────────────────────────────
    await supabase.from('ticket_orders').update({
      mpesa_checkout_request_id: stkResponse.CheckoutRequestID,
      payment_status: 'pending',
      submitted_at: new Date().toISOString(),
    }).eq('id', orderId);

    // ── Log the STK Push attempt ──────────────────────────────────────────────
    await supabase.from('mpesa_payment_logs').insert({
      order_id: orderId,
      event_type: 'stk_push_initiated',
      checkout_request_id: stkResponse.CheckoutRequestID,
      merchant_request_id: stkResponse.MerchantRequestID,
      raw_payload: stkResponse,
      status: 'initiated',
    });

    return corsResponse({
      success: true,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      message: stkResponse.CustomerMessage,
    });

  } catch (err: unknown) {
    console.error('STK Push error:', err);
    return corsError(err instanceof Error ? err.message : 'STK Push failed', 500);
  }
});