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
  // FIX-C: createOrder now calls a SECURITY DEFINER RPC instead of
  // directly inserting into ticket_orders from the browser.
  //
  // The RPC validates server-side:
  //   - Event exists and is active
  //   - Category and price (from DB, not client payload)
  //   - Inventory availability (atomic count inside the transaction)
  //   - Transaction code uniqueness (replay prevention)
  //   - Quantity limits (1–10)
  //
  // The browser can no longer:
  //   - Pass a forged unit_price or total_amount
  //   - Bypass inventory checks by racing the availability query
  //   - Replay a used transaction code
  const { data, error } = await supabase.rpc('create_ticket_order', {
    p_event_id:         payload.event_id,
    p_customer_name:    payload.customer_name.trim(),
    p_customer_phone:   payload.customer_phone.trim(),
    p_ticket_category:  payload.ticket_category,
    p_quantity:         payload.quantity,
    p_payment_mode:     payload.payment_mode,
    p_tx_code:          payload.mpesa_transaction_code?.trim().toUpperCase() || null,
    p_submitted_amount: payload.submitted_amount || null,
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create order');

  // Fetch the full order record for the caller
  const { data: order, error: fetchErr } = await supabase
    .from('ticket_orders')
    .select('*')
    .eq('id', data.order_id)
    .single();

  if (fetchErr || !order) throw new Error('Order created but failed to fetch details');
  return order as TicketOrder;
}

export async function confirmOrderAndGenerateTickets(
  orderId: string,
  confirmedByUserId: string
): Promise<Ticket[]> {
  // SERVER-SIDE: confirm_order RPC runs as SECURITY DEFINER with row locking
  // Validates role, prevents double-confirmation, generates tickets atomically
  const { data, error } = await supabase.rpc('confirm_order', {
    p_order_id: orderId,
    p_staff_id: confirmedByUserId,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to confirm order');
  const { data: tickets } = await supabase.from('tickets').select('*').eq('order_id', orderId);
  return (tickets || []) as Ticket[];
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
  const { data: session } = await supabase.auth.getSession();
  const staffId = session.session?.user?.id;
  if (!staffId) throw new Error('Not authenticated');
  const { data, error } = await supabase.rpc('flag_order', {
    p_order_id: orderId, p_staff_id: staffId, p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function cancelOrder(orderId: string) {
  const { data: session } = await supabase.auth.getSession();
  const staffId = session.session?.user?.id;
  if (!staffId) throw new Error('Not authenticated');
  const { data, error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId, p_staff_id: staffId,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Failed to cancel order');
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
  const { data: session } = await supabase.auth.getSession();
  const staffId = session.session?.user?.id;
  if (!staffId) throw new Error('Not authenticated');
  const { data, error } = await supabase.rpc('mark_ticket_delivered', {
    p_ticket_id: ticketId, p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
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