import { supabase } from './supabase';
import { generateQRDataURL } from './qr';
import type {
  CreateOrderPayload, TicketOrder, Ticket,
  TicketScanResult, PublicEventInfo, TicketCategoryConfig,
} from '../types/ticketing';

// ─── Public: fetch event info (works for open OR locked events for ticket page)
export async function getPublicEventInfo(eventId: string): Promise<PublicEventInfo | null> {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, date, location, description, is_paid, payment_mode, allow_stk_push, allow_manual, host_paybill, host_till, business_name, payment_timeout, account_format, ticket_categories, status')
    .eq('id', eventId)
    .eq('is_paid', true)          // must be a paid event
    .neq('status', 'archived')    // not archived — but open OR locked both work
    .maybeSingle();

  if (error || !data) return null;
  return {
    ...data,
    ticket_categories: (data.ticket_categories as TicketCategoryConfig[]) || [],
  };
}

// ─── Public: get sold ticket counts per category ──────────────────────────────
export async function getCategoryAvailability(eventId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('tickets')
    .select('ticket_category')
    .eq('event_id', eventId)
    .neq('status', 'cancelled');

  const counts: Record<string, number> = {};
  (data || []).forEach((t: { ticket_category: string }) => {
    counts[t.ticket_category] = (counts[t.ticket_category] || 0) + 1;
  });
  return counts;
}

// ─── Public: create an order with full security validation ────────────────────
export async function createOrder(payload: CreateOrderPayload): Promise<TicketOrder> {
  // 1. Fetch and validate event
  const { data: event, error: evErr } = await supabase
    .from('events')
    .select('id, is_paid, payment_mode, ticket_categories, status')
    .eq('id', payload.event_id)
    .eq('is_paid', true)
    .neq('status', 'archived')
    .maybeSingle();

  if (evErr || !event) throw new Error('Event not found or ticket sales are not active');

  // 2. Validate ticket category exists and price matches
  const categories: TicketCategoryConfig[] = event.ticket_categories || [];
  const cat = categories.find(c => c.name === payload.ticket_category);
  if (!cat) throw new Error('Invalid ticket category');
  if (cat.price !== payload.unit_price) {
    throw new Error('Price mismatch — please refresh the page and try again');
  }

  // 3. Check availability
  const sold = await getCategoryAvailability(payload.event_id);
  const soldCount = sold[payload.ticket_category] || 0;
  if (soldCount + payload.quantity > cat.quantity) {
    const remaining = cat.quantity - soldCount;
    throw new Error(
      remaining <= 0
        ? `${payload.ticket_category} tickets are sold out`
        : `Only ${remaining} ${payload.ticket_category} ticket${remaining === 1 ? '' : 's'} remaining`
    );
  }

  // 4. Transaction code security (manual mode)
  let amountMismatch = false;
  if (payload.mpesa_transaction_code) {
    const code = payload.mpesa_transaction_code.trim().toUpperCase();

    // 4a. Uniqueness — reject duplicate codes immediately
    const { data: existing } = await supabase
      .from('ticket_orders')
      .select('id')
      .eq('mpesa_transaction_code', code)
      .maybeSingle();
    if (existing) {
      throw new Error(
        'This M-Pesa transaction code has already been submitted. ' +
        'Each transaction code can only be used once. ' +
        'If you believe this is an error, contact the organiser.'
      );
    }

    // 4b. Amount validation — flag mismatches but don't block submission
    const expectedTotal = cat.price * payload.quantity;
    if (payload.submitted_amount !== undefined && payload.submitted_amount !== null) {
      if (payload.submitted_amount < expectedTotal) {
        amountMismatch = true; // will be flagged for admin review
      }
    }
  }

  const expectedTotal = cat.price * payload.quantity;

  const orderData: Record<string, unknown> = {
    event_id: payload.event_id,
    customer_name: payload.customer_name.trim(),
    customer_phone: payload.customer_phone.trim(),
    ticket_category: payload.ticket_category,
    quantity: payload.quantity,
    unit_price: payload.unit_price,
    total_amount: expectedTotal,
    payment_mode: payload.payment_mode,
    mpesa_transaction_code: payload.mpesa_transaction_code?.trim().toUpperCase() || null,
    submitted_amount: payload.submitted_amount || null,
    amount_mismatch: amountMismatch,
    proof_image_url: payload.proof_image_url || null,
    submitted_at: new Date().toISOString(),
    payment_status: payload.payment_mode === 'host_manual' ? 'pending_verification' : 'pending',
    // Auto-flag if amount is wrong
    is_flagged: amountMismatch,
    flag_reason: amountMismatch
      ? `Amount mismatch: expected KES ${expectedTotal.toLocaleString()}, customer submitted KES ${payload.submitted_amount?.toLocaleString()}`
      : null,
  };

  const { data: order, error } = await supabase
    .from('ticket_orders')
    .insert(orderData)
    .select()
    .single();

  if (error) throw new Error('Failed to create order: ' + error.message);
  return order as TicketOrder;
}

// ─── Admin: confirm order and generate tickets ────────────────────────────────
export async function confirmOrderAndGenerateTickets(
  orderId: string,
  confirmedByUserId: string
): Promise<Ticket[]> {
  const { data: order, error: oErr } = await supabase
    .from('ticket_orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (oErr || !order) throw new Error('Order not found');
  if (order.payment_status === 'confirmed') throw new Error('Order already confirmed');
  if (order.payment_status === 'cancelled') throw new Error('Cannot confirm a cancelled order');

  // Mark confirmed with audit trail
  const { error: updErr } = await supabase
    .from('ticket_orders')
    .update({
      payment_status: 'confirmed',
      payment_confirmed_at: new Date().toISOString(),
      confirmed_by: confirmedByUserId,
      is_flagged: false,        // admin reviewed and approved
    })
    .eq('id', orderId);

  if (updErr) throw updErr;

  // Generate one ticket per quantity, each with its own UUID token
  const ticketsToInsert = Array.from({ length: order.quantity }, () => ({
    order_id: orderId,
    event_id: order.event_id,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    ticket_category: order.ticket_category,
    status: 'unused',
    delivery_status: 'pending',
  }));

  const { data: tickets, error: tErr } = await supabase
    .from('tickets')
    .insert(ticketsToInsert)
    .select();

  if (tErr) throw tErr;
  return tickets as Ticket[];
}

// ─── QR Validation ────────────────────────────────────────────────────────────
export async function validateTicketQR(
  token: string,
  scannedEventId: string,
  scannedById: string
): Promise<TicketScanResult> {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*, order:ticket_orders(payment_status)')
    .eq('ticket_token', token)
    .maybeSingle();

  if (error || !ticket) return { valid: false, status: 'invalid', color: 'red' };
  if (ticket.event_id !== scannedEventId) return { valid: false, status: 'wrong_event', color: 'red' };

  const order = Array.isArray(ticket.order) ? ticket.order[0] : ticket.order;
  if (!order || order.payment_status !== 'confirmed') return { valid: false, status: 'invalid', color: 'red' };
  if (ticket.status === 'cancelled') return { valid: false, status: 'cancelled', color: 'red' };

  if (ticket.status === 'used') {
    return {
      valid: false, status: 'already_used', color: 'yellow',
      customer_name: ticket.customer_name,
      ticket_category: ticket.ticket_category,
      scanned_at: ticket.scanned_at,
    };
  }

  const now = new Date().toISOString();
  await supabase
    .from('tickets')
    .update({ status: 'used', scanned_at: now, scanned_by: scannedById })
    .eq('id', ticket.id);

  return {
    valid: true, status: 'accepted', color: 'green',
    customer_name: ticket.customer_name,
    ticket_category: ticket.ticket_category,
    scanned_at: now,
    ticket: { ...ticket, status: 'used', scanned_at: now },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export async function generateTicketQRDataURL(ticketToken: string): Promise<string> {
  return generateQRDataURL(`NEXUS-TICKET:${ticketToken}`);
}

export async function flagOrder(orderId: string, reason: string) {
  return supabase.from('ticket_orders').update({ is_flagged: true, flag_reason: reason }).eq('id', orderId);
}

export async function cancelOrder(orderId: string) {
  await supabase.from('ticket_orders').update({ payment_status: 'cancelled' }).eq('id', orderId);
  await supabase.from('tickets').update({ status: 'cancelled' }).eq('order_id', orderId);
}

export async function getEventOrders(eventId: string) {
  const { data, error } = await supabase
    .from('ticket_orders')
    .select('*, tickets(*)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as TicketOrder[];
}

export async function getEventTickets(eventId: string) {
  const { data, error } = await supabase
    .from('tickets')
    .select('*, order:ticket_orders(customer_phone, payment_status, mpesa_transaction_code)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Ticket[];
}

export async function markTicketDelivered(ticketId: string) {
  return supabase.from('tickets').update({ delivery_status: 'sent' }).eq('id', ticketId);
}

export function formatKEPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '254' + cleaned.slice(1);
  if (cleaned.startsWith('254')) return cleaned;
  return '254' + cleaned;
}

export function buildWhatsAppTicketMessage(params: {
  customerName: string; eventName: string; eventDate: string;
  eventLocation: string; ticketCategory: string; ticketToken: string;
}): string {
  return encodeURIComponent(
    `🎟️ *Your Ticket — ${params.eventName}*\n\n` +
    `Hello ${params.customerName}!\n\n` +
    `*Category:* ${params.ticketCategory}\n` +
    `*Date:* ${params.eventDate}\n` +
    `*Venue:* ${params.eventLocation}\n\n` +
    `*Ticket ID:* ${params.ticketToken.slice(0, 8).toUpperCase()}\n\n` +
    `Present your QR code at the gate for entry.\n\n` +
    `_Powered by Nexus Event System_`
  );
}
export function isValidKEPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return (
    /^(07|01)\d{8}$/.test(cleaned) ||
    /^254(7|1)\d{8}$/.test(cleaned)
  );
}