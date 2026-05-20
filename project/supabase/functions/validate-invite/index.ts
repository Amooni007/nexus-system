// supabase/functions/validate-invite/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url   = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token || token.length < 20) {
    return new Response(JSON.stringify({ valid: false, reason: 'invalid_token' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const tokenHash = await sha256Hex(token);

  const { data: invToken, error } = await supabase
    .from('invitation_tokens')
    .select('id, guest_id, event_id, expires_at, used_at, revoked')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !invToken) {
    return new Response(JSON.stringify({ valid: false, reason: 'not_found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (invToken.revoked) {
    return new Response(JSON.stringify({ valid: false, reason: 'revoked' }), {
      status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (new Date(invToken.expires_at) < new Date()) {
    return new Response(JSON.stringify({ valid: false, reason: 'expired' }), {
      status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: guest } = await supabase
    .from('guests')
    .select('id, name, status, event_id')
    .eq('id', invToken.guest_id)
    .maybeSingle();

  if (!guest || guest.status === 'inactive') {
    return new Response(JSON.stringify({ valid: false, reason: 'guest_inactive' }), {
      status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, name, date, location, description, template_id')
    .eq('id', invToken.event_id)
    .maybeSingle();

  if (!event) {
    return new Response(JSON.stringify({ valid: false, reason: 'event_not_found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: qrCode } = await supabase
    .from('qr_codes')
    .select('id, code, status, used_at')
    .eq('guest_id', invToken.guest_id)
    .maybeSingle();

  let template = null;
  if (event.template_id) {
    const { data: tmpl } = await supabase
      .from('invitation_templates')
      .select('id, name, image_url, fields')
      .eq('id', event.template_id)
      .maybeSingle();
    template = tmpl;
  }

  // Mark as first-viewed (non-blocking)
  if (!invToken.used_at) {
    supabase
      .from('invitation_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invToken.id)
      .then(() => {});
  }

  return new Response(JSON.stringify({
    valid: true,
    guest: {
      name:   guest.name,
      status: guest.status,
    },
    event: {
      name:        event.name,
      date:        event.date,
      location:    event.location,
      description: event.description,
    },
    qr: qrCode ? {
      code:    qrCode.code,
      status:  qrCode.status,
      used_at: qrCode.used_at,
    } : null,
    template,
  }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});