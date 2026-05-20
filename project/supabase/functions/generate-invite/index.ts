// supabase/functions/generate-invite/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  // 32 random bytes → hex string (64 chars, 256 bits entropy)
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_active || !['super_admin', 'event_manager'].includes(profile.role)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { guestId, expiryDays = 30 } = await req.json();
  if (!guestId) {
    return new Response(JSON.stringify({ error: 'guestId required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: guest } = await supabase
    .from('guests')
    .select('id, event_id, status')
    .eq('id', guestId)
    .maybeSingle();

  if (!guest) {
    return new Response(JSON.stringify({ error: 'Guest not found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Revoke existing active tokens for this guest
  await supabase
    .from('invitation_tokens')
    .update({ revoked: true })
    .eq('guest_id', guestId)
    .eq('revoked', false);

  const plainToken  = generateToken();
  const tokenHash   = await sha256Hex(plainToken);
  const expiresAt   = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertErr } = await supabase
    .from('invitation_tokens')
    .insert({
      token_hash: tokenHash,
      guest_id:   guestId,
      event_id:   guest.event_id,
      expires_at: expiresAt,
    });

  if (insertErr) {
    return new Response(JSON.stringify({ error: 'Failed to create token: ' + insertErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    token:      plainToken,
    expires_at: expiresAt,
    invite_url: `https://nexus-system.pages.dev/invite/${plainToken}`,
  }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});