// supabase/functions/mpesa-c2b-register/index.ts
//
// ONE-TIME SETUP: Call this once to register your C2B confirmation URL
// with Safaricom so they send callbacks for manual till/paybill payments.
//
// HOW TO CALL:
// curl -X POST https://project.supabase.co/functions/v1/mpesa-c2b-register \
//   -H "Authorization: Bearer YOUR_ANON_KEY" \
//   -H "Content-Type: application/json" \
//   -d '{"shortCode": "174379"}'
//
// You only need to do this ONCE per shortcode, not on every deploy.
// The registration persists on Safaricom's side.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getMpesaConfig, getAccessToken, getBaseUrl, corsHeaders, corsResponse, corsError } from '../_shared/mpesa.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { shortCode } = await req.json().catch(() => ({}));
    const config  = getMpesaConfig();
    const base    = getBaseUrl(config);
    const token   = await getAccessToken(config);
    const sc      = shortCode || config.shortcode;

    const confirmUrl  = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-c2b-confirm`;
    const validateUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-c2b-confirm`;

    const res = await fetch(`${base}/mpesa/c2b/v1/registerurl`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ShortCode:       sc,
        ResponseType:    'Completed',
        ConfirmationURL: confirmUrl,
        ValidationURL:   validateUrl,
      }),
    });

    const data = await res.json();
    return corsResponse({ success: true, shortCode: sc, confirmUrl, result: data });
  } catch (err: unknown) {
    return corsError(err instanceof Error ? err.message : 'Registration failed', 500);
  }
});