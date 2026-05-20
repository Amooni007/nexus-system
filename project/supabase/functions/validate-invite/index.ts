// supabase/functions/validate-invite/index.ts
//
// PHASE 2 — SECURE INVITATION TOKEN VALIDATION
//
// PROBLEM (F-02):
// Current URL: /invitation/:guest_uuid
// The guest UUID is:
//   1. Exposed in the URL (logged, shared, stored in browser history)
//   2. The same ID used in all DB queries — predictable if sequential
//   3. The invitation page queries ALL guest fields including phone/email
//   4. The anon policy "USING (true)" exposes ALL guests to anyone with the URL pattern
//
// FIX:
// New URL: /invite/:high_entropy_token
// - Token is 32 random bytes, base64url encoded (256 bits entropy)
// - Only the SHA-256 hash of the token is stored in DB
// - This Edge Function validates the token hash and returns ONLY safe fields:
//   guest name, event name, event date, event location, QR image data URL
// - NO guest ID, NO phone, NO email, NO payment data is returned
// - Token can be set to expire or be revoked
// - One-time-view flag supported (optional)
//
// MIGRATION REQUIRED: Run 20260522000000_rls_hardening.sql first
// to create the invitation_tokens table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';
import { encodeBase64Url } from 'https://deno.land/std@0.168.0/encoding/base64url.ts';

const ALLOWED_ORIGINS = [
  'https://nexus-system.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data    = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Extract token from URL: /functions/v1/validate-invite?token=xxx
  const url   = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token || token.length < 20) {
    return new Response(JSON.stringify({ valid: false, reason: 'invalid_token' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Service role client — reads invitation_tokens, guests, events, qr_codes
  // without going through RLS (anon cannot read these tables)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Hash the token to look it up
  const tokenHash = await sha256Hex(token);

  const { data: invToken, error } = await supabase
    .from('invitation_tokens')
    .select('id, guest_id, event_id, expires_at, used_at, revoked')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !invToken) {
    return new Response(JSON.stringify({ valid: false, reason: 'not_found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Check revoked
  if (invToken.revoked) {
    return new Response(JSON.stringify({ valid: false, reason: 'revoked' }), {
      status: 410, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Check expiry
  if (new Date(invToken.expires_at) < new Date()) {
    return new Response(JSON.stringify({ valid: false, reason: 'expired' }), {
      status: 410, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Fetch guest — only safe fields (no phone, no email)
  const { data: guest } = await supabase
    .from('guests')
    .select('id, name, status, event_id')
    .eq('id', invToken.guest_id)
    .maybeSingle();

  if (!guest || guest.status === 'inactive') {
    return new Response(JSON.stringify({ valid: false, reason: 'guest_inactive' }), {
      status: 410, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Fetch event — only safe public fields
  const { data: event } = await supabase
    .from('events')
    .select('id, name, date, location, description, template_id')
    .eq('id', invToken.event_id)
    .maybeSingle();

  if (!event) {
    return new Response(JSON.stringify({ valid: false, reason: 'event_not_found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Fetch QR code (the code value, not the ID)
  const { data: qrCode } = await supabase
    .from('qr_codes')
    .select('id, code, status, used_at')
    .eq('guest_id', invToken.guest_id)
    .maybeSingle();

  // Fetch template if event has one
  let template = null;
  if (event.template_id) {
    const { data: tmpl } = await supabase
      .from('invitation_templates')
      .select('id, name, image_url, fields')
      .eq('id', event.template_id)
      .maybeSingle();
    template = tmpl;
  }

  // Mark token as first-viewed (non-blocking)
  if (!invToken.used_at) {
    supabase
      .from('invitation_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invToken.id)
      .then(() => {});
  }

  // Return ONLY safe invitation fields — no guest ID, no phone, no email
  return new Response(JSON.stringify({
    valid: true,
    guest: {
      name:   guest.name,
      status: guest.status,
      // Deliberately omit: id, phone, email, created_by, event_id
    },
    event: {
      name:        event.name,
      date:        event.date,
      location:    event.location,
      description: event.description,
      // Deliberately omit: id, created_by, status, is_paid, ticket_categories
    },
    qr: qrCode ? {
      code:   qrCode.code,  // The QR content — not the DB id
      status: qrCode.status,
      used_at: qrCode.used_at,
    } : null,
    template,
  }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});