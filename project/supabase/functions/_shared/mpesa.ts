// ─── Shared M-Pesa Daraja Service ────────────────────────────────────────────
// Used by all M-Pesa edge functions.
// Credentials come from Supabase secrets — NEVER from the frontend.

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  environment: 'sandbox' | 'production';
}

export function getMpesaConfig(): MpesaConfig {
  const env = Deno.env.get('MPESA_ENVIRONMENT') || 'sandbox';
  return {
    consumerKey:    Deno.env.get('MPESA_CONSUMER_KEY')!,
    consumerSecret: Deno.env.get('MPESA_CONSUMER_SECRET')!,
    shortcode:      Deno.env.get('MPESA_SHORTCODE')!,
    passkey:        Deno.env.get('MPESA_PASSKEY')!,
    callbackUrl:    Deno.env.get('MPESA_CALLBACK_URL')!,
    environment:    env as 'sandbox' | 'production',
  };
}

export function getBaseUrl(config: MpesaConfig): string {
  return config.environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// ── 1. Generate OAuth access token ───────────────────────────────────────────
export async function getAccessToken(config: MpesaConfig): Promise<string> {
  const base = getBaseUrl(config);
  const credentials = btoa(`${config.consumerKey}:${config.consumerSecret}`);

  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get M-Pesa token: ${err}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

// ── 2. Generate STK Push password (base64 of shortcode+passkey+timestamp) ────
export function generatePassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

// ── 3. Generate timestamp in YYYYMMDDHHmmss format ───────────────────────────
export function generateTimestamp(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

// ── 4. Format phone to 254XXXXXXXXX ──────────────────────────────────────────
export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0'))   return '254' + cleaned.slice(1);
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('+'))   return cleaned.slice(1);
  return '254' + cleaned;
}

// ── 5. Initiate STK Push ──────────────────────────────────────────────────────
export interface STKPushParams {
  phone: string;
  amount: number;
  orderId: string;
  eventName: string;
  config: MpesaConfig;
}

export interface STKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export async function initiateStkPush(params: STKPushParams): Promise<STKPushResponse> {
  const { phone, amount, orderId, eventName, config } = params;
  const base = getBaseUrl(config);
  const token = await getAccessToken(config);
  const timestamp = generateTimestamp();
  const password = generatePassword(config.shortcode, config.passkey, timestamp);
  const formattedPhone = formatPhone(phone);

  const body = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),   // M-Pesa requires integer
    PartyA: formattedPhone,
    PartyB: config.shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: config.callbackUrl,
    AccountReference: orderId.slice(0, 12).toUpperCase(),  // max 12 chars
    TransactionDesc: `Ticket: ${eventName}`.slice(0, 13),  // max 13 chars
  };

  const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'STK Push failed');
  }

  return data as STKPushResponse;
}

// ── 6. Query STK Push status ──────────────────────────────────────────────────
export async function queryStkStatus(
  checkoutRequestId: string,
  config: MpesaConfig
): Promise<Record<string, string>> {
  const base = getBaseUrl(config);
  const token = await getAccessToken(config);
  const timestamp = generateTimestamp();
  const password = generatePassword(config.shortcode, config.passkey, timestamp);

  const res = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  return res.json();
}

// ── CORS headers for all edge functions ──────────────────────────────────────
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function corsError(message: string, status = 400) {
  return corsResponse({ error: message }, status);
}