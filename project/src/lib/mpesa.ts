import { supabase } from './supabase';
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
  intervalMs = 5000,   // 5 seconds — within Safaricom rate limits
  maxWaitMs = 180000   // 3 minutes max
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

// ── Realtime subscription ─────────────────────────────────────────────────────
// Subscribes to ticket_orders row changes via Supabase Realtime.
// Resolves immediately when payment_status changes to a terminal state.
// Much faster than polling — fires the instant the DB row changes.
// Requires: ALTER TABLE ticket_orders REPLICA IDENTITY FULL;
//           + replication enabled in Supabase Dashboard → Database → Replication
export function subscribeToOrderUpdates(
  orderId: string,
  onUpdate: (status: string) => void,
  timeoutMs = 180000
): () => void {
  let resolved = false;

  const channel = supabase
    .channel(`order-${orderId}-${Date.now()}`)
    .on(
      'postgres_changes' as any,
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'ticket_orders',
        filter: `id=eq.${orderId}`,
      },
      (payload: any) => {
        const status = payload.new?.payment_status;
        if (!status || resolved) return;
        onUpdate(status);
        if (['confirmed', 'failed', 'cancelled', 'expired'].includes(status)) {
          resolved = true;
          supabase.removeChannel(channel);
        }
      }
    )
    .subscribe((status, err) => {
      // WebSocket connection status callback
      if (status === 'SUBSCRIBED') {
        // Successfully connected — realtime is active
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // WebSocket failed — log but don't crash.
        // The polling fallback (pollUntilConfirmed) will still resolve the payment.
        console.warn('[Nexus] Realtime subscription failed:', status, err?.message);
        // Don't call onUpdate here — let polling handle it
      }
    });

  const timer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      supabase.removeChannel(channel);
      onUpdate('timeout');
    }
  }, timeoutMs);

  return () => {
    clearTimeout(timer);
    resolved = true;
    supabase.removeChannel(channel);
  };
}