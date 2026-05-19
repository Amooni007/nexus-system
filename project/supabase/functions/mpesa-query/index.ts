// supabase/functions/mpesa-query/index.ts
// Fixed version — processes payment confirmation directly if callback was missed

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  getMpesaConfig, queryStkStatus, getCorsHeaders, corsResponse, corsError,
} from '../_shared/mpesa.ts';

serve(async (req) => {
  const corsH = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsH });

  try {
    const { orderId } = await req.json();
    if (!orderId) return corsError('orderId is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: order } = await supabase
      .from('ticket_orders')
      .select('id, payment_status, mpesa_checkout_request_id, total_amount, ticket_category, quantity, customer_name, customer_phone, event_id')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) return corsError('Order not found', 404);

    // Already resolved
    if (['confirmed', 'failed', 'cancelled'].includes(order.payment_status)) {
      return corsResponse({ status: order.payment_status, resolved: true, orderId: order.id });
    }

    if (!order.mpesa_checkout_request_id) {
      return corsResponse({ status: order.payment_status, resolved: false });
    }

    const config = getMpesaConfig();
    let queryResult: Record<string, string> = {};

    try {
      queryResult = await queryStkStatus(order.mpesa_checkout_request_id, config);
    } catch (queryErr) {
      console.error('Safaricom query failed:', queryErr);
      return corsResponse({ status: order.payment_status, resolved: false });
    }

    const resultCode = String(queryResult.ResultCode ?? queryResult.resultCode ?? '');

    // Log the query
    await supabase.from('mpesa_payment_logs').insert({
      order_id: orderId,
      checkout_request_id: order.mpesa_checkout_request_id,
      event_type: 'stk_query',
      raw_payload: queryResult,
      result_code: resultCode,
      result_desc: queryResult.ResultDesc,
      status: resultCode === '0' ? 'success' : 'pending',
    });

    // KEY FIX: Safaricom confirms payment but callback never arrived
    // Process confirmation directly here as fallback
    if (resultCode === '0' && order.payment_status === 'pending') {
      console.log('Callback missed — confirming order via query fallback');

      await supabase.from('ticket_orders').update({
        payment_status: 'confirmed',
        payment_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);

      // Generate one ticket per quantity — each gets unique UUID token from DB
      const ticketsToInsert = Array.from({ length: order.quantity }, () => ({
        order_id: order.id,
        event_id: order.event_id,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        ticket_category: order.ticket_category,
        status: 'unused',
        delivery_status: 'pending',
      }));

      const { error: ticketErr } = await supabase.from('tickets').insert(ticketsToInsert);

      if (ticketErr) {
        console.error('Ticket generation failed:', ticketErr);
      }

      await supabase.from('mpesa_payment_logs').insert({
        order_id: order.id,
        checkout_request_id: order.mpesa_checkout_request_id,
        event_type: 'tickets_generated_via_query_fallback',
        raw_payload: { ticketCount: order.quantity, reason: 'callback_not_received' },
        status: 'completed',
      });

      return corsResponse({ status: 'confirmed', resolved: true, orderId: order.id });
    }

    // User cancelled
    if (resultCode === '1032') {
      await supabase.from('ticket_orders').update({
        payment_status: 'cancelled',
        flag_reason: 'Customer cancelled STK Push',
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      return corsResponse({ status: 'cancelled', resolved: true });
    }

    // Timeout
    if (resultCode === '1037') {
      await supabase.from('ticket_orders').update({
        payment_status: 'failed',
        flag_reason: 'STK Push timed out',
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      return corsResponse({ status: 'failed', resolved: true });
    }

    return corsResponse({ status: order.payment_status, resolved: false });

  } catch (err: unknown) {
    console.error('Query error:', err);
    return corsError(err instanceof Error ? err.message : 'Query failed', 500);
  }
});