// ─── Frontend M-Pesa Client ───────────────────────────────────────────────────
// This file ONLY calls Supabase Edge Functions.
// Daraja credentials NEVER touch this file or the browser.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

async function callEdgeFunction(fnName: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${fnName} failed`);
  return data;
}

// ── Initiate STK Push ─────────────────────────────────────────────────────────
export async function initiateStkPush(params: {
  orderId: string;
  phone: string;
  amount: number;
  eventName: string;
}): Promise<{ checkoutRequestId: string; message: string; alreadySent?: boolean }> {
  return callEdgeFunction('mpesa-stk-push', params);
}

// ── Poll payment status ───────────────────────────────────────────────────────
export async function queryPaymentStatus(orderId: string): Promise<{
  status: string;
  resolved: boolean;
}> {
  return callEdgeFunction('mpesa-query', { orderId });
}

// ── Poll with timeout — auto-stops after maxWaitMs ───────────────────────────
export async function pollUntilConfirmed(
  orderId: string,
  onUpdate: (status: string) => void,
  intervalMs = 8000,   // 8 seconds — avoids Safaricom rate limit (5 req/min)
  maxWaitMs = 120000   // 2 minutes max
): Promise<'confirmed' | 'failed' | 'cancelled' | 'timeout'> {
  const start = Date.now();

  return new Promise(resolve => {
    const interval = setInterval(async () => {
      if (Date.now() - start > maxWaitMs) {
        clearInterval(interval);
        resolve('timeout');
        return;
      }

      try {
        const result = await queryPaymentStatus(orderId);
        onUpdate(result.status);

        if (result.resolved) {
          clearInterval(interval);
          resolve(result.status as 'confirmed' | 'failed' | 'cancelled');
        }
      } catch {
        // Network error — keep polling
      }
    }, intervalMs);
  });
}