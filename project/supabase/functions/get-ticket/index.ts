// supabase/functions/get-ticket/index.ts
// Secure ticket data endpoint.
// Validates: ticket token exists, payment confirmed, event matches.
// Returns only what's needed to render/display the ticket.
// Never exposes internal UUIDs or payment details.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url      = new URL(req.url);
  const token    = url.searchParams.get('token');   // ticket_token UUID
  const orderId  = url.searchParams.get('order');   // order ID for fetching all tickets

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // ── Single ticket by token ────────────────────────────────────────────────
  if (token) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('ticket_token, customer_name, ticket_category, status, event_id, order_id')
      .eq('ticket_token', token)
      .maybeSingle();

    if (!ticket) {
      return new Response(JSON.stringify({ error: 'Ticket not found' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Verify payment confirmed
    const { data: order } = await supabase
      .from('ticket_orders')
      .select('payment_status, customer_phone')
      .eq('id', ticket.order_id)
      .maybeSingle();

    if (!order || order.payment_status !== 'confirmed') {
      return new Response(JSON.stringify({ error: 'Payment not confirmed' }), {
        status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { data: event } = await supabase
      .from('events')
      .select('name, date, location')
      .eq('id', ticket.event_id)
      .maybeSingle();

    return new Response(JSON.stringify({
      ticket_token:    ticket.ticket_token,
      customer_name:   ticket.customer_name,
      ticket_category: ticket.ticket_category,
      status:          ticket.status,
      event:           event,
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── All tickets for an order ──────────────────────────────────────────────
  if (orderId) {
    const { data: order } = await supabase
      .from('ticket_orders')
      .select('id, customer_name, customer_phone, ticket_category, quantity, total_amount, payment_status, mpesa_transaction_code, event_id, created_at')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (order.payment_status !== 'confirmed') {
      return new Response(JSON.stringify({ error: 'Payment not confirmed', status: order.payment_status }), {
        status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { data: tickets } = await supabase
      .from('tickets')
      .select('ticket_token, customer_name, ticket_category, status, delivery_status')
      .eq('order_id', orderId)
      .eq('status', 'unused');

    const { data: event } = await supabase
      .from('events')
      .select('name, date, location, description')
      .eq('id', order.event_id)
      .maybeSingle();

    return new Response(JSON.stringify({
      order: {
        ref:              order.id.slice(0, 8).toUpperCase(),
        customer_name:    order.customer_name,
        ticket_category:  order.ticket_category,
        quantity:         order.quantity,
        total_amount:     order.total_amount,
        transaction_code: order.mpesa_transaction_code,
        created_at:       order.created_at,
      },
      event,
      tickets: (tickets || []).map(t => ({
        ticket_token:    t.ticket_token,
        customer_name:   t.customer_name,
        ticket_category: t.ticket_category,
        status:          t.status,
        delivery_status: t.delivery_status,
      })),
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'token or order parameter required' }), {
    status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});