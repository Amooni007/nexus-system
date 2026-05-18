// ─── Ticketing Extension Types ────────────────────────────────────────────────

export type TicketCategory = 'VVIP' | 'VIP' | 'Regular' | string;
export type TicketStatus = 'unused' | 'used' | 'cancelled';
export type OrderStatus = 'pending' | 'pending_verification' | 'confirmed' | 'failed' | 'cancelled';
export type PaymentMode = 'platform_mpesa' | 'host_manual';
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface TicketCategoryConfig {
  id?: string;
  name: TicketCategory;
  price: number;
  quantity: number;
  sold?: number;
  access_zone?: string;
  color?: string;
  template_style?: 'gold' | 'silver' | 'standard' | 'custom';
  template_image_url?: string;  // uploaded background image URL
  description?: string;
}

export interface TicketOrder {
  id: string;
  event_id: string;
  customer_name: string;
  customer_phone: string;
  ticket_category: TicketCategory;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_mode: PaymentMode;
  mpesa_checkout_request_id?: string | null;
  mpesa_transaction_code?: string | null;
  // Security fields
  submitted_amount?: number | null;        // what customer claimed to pay
  amount_mismatch?: boolean;               // flag if submitted != expected
  proof_image_url?: string | null;         // optional receipt screenshot
  submitted_at?: string | null;            // when customer submitted code
  payment_status: OrderStatus;
  payment_confirmed_at?: string | null;
  confirmed_by?: string | null;            // admin user id who confirmed
  is_flagged?: boolean;
  flag_reason?: string | null;
  created_at: string;
  updated_at: string;
  // Relations
  tickets?: Ticket[];
}

export interface Ticket {
  id: string;
  order_id: string;
  event_id: string;
  customer_name: string;
  customer_phone: string;
  ticket_category: TicketCategory;
  ticket_token: string;
  status: TicketStatus;
  delivery_status: DeliveryStatus;
  scanned_at?: string | null;
  scanned_by?: string | null;
  created_at: string;
  updated_at: string;
  order?: TicketOrder;
}

export interface TicketScanResult {
  valid: boolean;
  status: 'accepted' | 'already_used' | 'invalid' | 'wrong_event' | 'cancelled';
  ticket?: Ticket;
  customer_name?: string;
  ticket_category?: string;
  scanned_at?: string;
  color: 'green' | 'yellow' | 'red';
}

export interface CreateOrderPayload {
  event_id: string;
  customer_name: string;
  customer_phone: string;
  ticket_category: TicketCategory;
  quantity: number;
  unit_price: number;
  payment_mode: PaymentMode;
  mpesa_transaction_code?: string;
  submitted_amount?: number;     // amount customer says they paid
  proof_image_url?: string;      // optional uploaded receipt
}

export interface PublicEventInfo {
  id: string;
  name: string;
  date: string;
  location: string;
  description: string;
  is_paid: boolean;
  payment_mode: PaymentMode;
  allow_stk_push: boolean;
  allow_manual: boolean;
  host_paybill?: string | null;
  host_till?: string | null;
  business_name?: string | null;
  payment_timeout: number;
  account_format: 'name_ref' | 'ref_only' | 'name_only';
  ticket_categories: TicketCategoryConfig[];
  status: string;
}