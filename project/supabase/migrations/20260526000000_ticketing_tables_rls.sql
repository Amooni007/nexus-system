-- ============================================================
-- NEXUS — TICKETING TABLES WITH RLS
-- File: supabase/migrations/20260526000000_ticketing_tables_rls.sql
--
-- This migration adds all ticketing-related tables that were
-- previously created directly in the SQL Editor without source control.
-- Safe to run on existing databases — uses IF NOT EXISTS throughout.
-- ============================================================

-- ── 1. ticket_orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_name           TEXT NOT NULL,
  customer_phone          TEXT NOT NULL,
  ticket_category         TEXT NOT NULL,
  quantity                INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 10),
  unit_price              NUMERIC NOT NULL,
  total_amount            NUMERIC NOT NULL,
  payment_mode            TEXT NOT NULL CHECK (payment_mode IN ('platform_mpesa', 'host_manual')),
  payment_status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','pending_verification','confirmed','failed','cancelled','expired')),
  mpesa_transaction_code  TEXT UNIQUE,
  mpesa_checkout_request_id TEXT,
  stk_idempotency_key     TEXT UNIQUE,
  submitted_amount        NUMERIC,
  amount_mismatch         BOOLEAN DEFAULT false,
  is_flagged              BOOLEAN DEFAULT false,
  flag_reason             TEXT,
  submitted_at            TIMESTAMPTZ,
  payment_confirmed_at    TIMESTAMPTZ,
  confirmed_by            UUID REFERENCES profiles(id),
  verification_status     TEXT,
  verification_attempts   INTEGER DEFAULT 0,
  payment_timeout_at      TIMESTAMPTZ,
  payment_method          TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_orders_event_id
  ON ticket_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_payment_status
  ON ticket_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_checkout_id
  ON ticket_orders(mpesa_checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_tx_code
  ON ticket_orders(mpesa_transaction_code);

ALTER TABLE ticket_orders ENABLE ROW LEVEL SECURITY;

-- Anon can INSERT (public ticket purchase page)
DROP POLICY IF EXISTS "Public can create orders" ON ticket_orders;
CREATE POLICY "Public can create orders"
  ON ticket_orders FOR INSERT
  TO anon
  WITH CHECK (true);

-- Anon cannot SELECT, UPDATE, or DELETE orders
-- Authenticated staff can SELECT all orders
DROP POLICY IF EXISTS "Staff can read orders" ON ticket_orders;
CREATE POLICY "Staff can read orders"
  ON ticket_orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  );

-- Staff can update orders (flag/unflag only — sensitive fields via RPCs)
DROP POLICY IF EXISTS "Staff can update order flags only" ON ticket_orders;
CREATE POLICY "Staff can update order flags only"
  ON ticket_orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  );

-- ── 2. tickets ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES ticket_orders(id) ON DELETE CASCADE,
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_token     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  customer_name    TEXT NOT NULL,
  customer_phone   TEXT,
  ticket_category  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused', 'used', 'cancelled')),
  delivery_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent')),
  scanned_at       TIMESTAMPTZ,
  scanned_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_event_id
  ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id
  ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_token
  ON tickets(ticket_token);
CREATE INDEX IF NOT EXISTS idx_tickets_status
  ON tickets(status);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Anon cannot read tickets
-- Staff can read tickets for their events
DROP POLICY IF EXISTS "Staff can read tickets" ON tickets;
CREATE POLICY "Staff can read tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  );

-- Staff can update ticket delivery status
DROP POLICY IF EXISTS "Staff can update ticket delivery status" ON tickets;
CREATE POLICY "Staff can update ticket delivery status"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  );

-- ── 3. mpesa_payment_logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mpesa_payment_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID REFERENCES ticket_orders(id) ON DELETE SET NULL,
  event_type            TEXT NOT NULL,
  checkout_request_id   TEXT,
  merchant_request_id   TEXT,
  result_code           TEXT,
  result_desc           TEXT,
  amount                NUMERIC,
  phone                 TEXT,
  transaction_code      TEXT,
  status                TEXT,
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpesa_logs_order_id
  ON mpesa_payment_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_logs_checkout_id
  ON mpesa_payment_logs(checkout_request_id);

ALTER TABLE mpesa_payment_logs ENABLE ROW LEVEL SECURITY;

-- Only authenticated staff can read payment logs
DROP POLICY IF EXISTS "Staff can read payment logs" ON mpesa_payment_logs;
CREATE POLICY "Staff can read payment logs"
  ON mpesa_payment_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  );

-- Edge functions insert via service role (bypasses RLS) — no insert policy needed for anon/auth

-- ── 4. ticket_template_layouts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_template_layouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  layout_config JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, category_name)
);

CREATE INDEX IF NOT EXISTS idx_ticket_template_layouts_event
  ON ticket_template_layouts(event_id);

ALTER TABLE ticket_template_layouts ENABLE ROW LEVEL SECURITY;

-- Staff can read layouts (needed for ticket rendering)
DROP POLICY IF EXISTS "Staff can read ticket layouts" ON ticket_template_layouts;
CREATE POLICY "Staff can read ticket layouts"
  ON ticket_template_layouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  );

-- Anon can also read layouts (needed for public ticket download rendering)
DROP POLICY IF EXISTS "Anon can read ticket layouts" ON ticket_template_layouts;
CREATE POLICY "Anon can read ticket layouts"
  ON ticket_template_layouts FOR SELECT
  TO anon
  USING (true);

-- Staff can insert/update layouts
DROP POLICY IF EXISTS "Staff can manage ticket layouts" ON ticket_template_layouts;
CREATE POLICY "Staff can manage ticket layouts"
  ON ticket_template_layouts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  );

-- ── 5. invitation_tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invitation_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  guest_id    UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  used_at     TIMESTAMPTZ,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_tokens_hash
  ON invitation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_guest
  ON invitation_tokens(guest_id);

ALTER TABLE invitation_tokens ENABLE ROW LEVEL SECURITY;

-- Only staff can manage tokens (Edge functions use service role)
DROP POLICY IF EXISTS "Staff can manage invitation tokens" ON invitation_tokens;
CREATE POLICY "Staff can manage invitation tokens"
  ON invitation_tokens FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'event_manager')
        AND p.is_active = true
    )
  );

-- ── 6. staff_invite_tokens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_invite_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('event_manager', 'scanner')),
  full_name   TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES profiles(id),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  used_at     TIMESTAMPTZ,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_tokens_hash
  ON staff_invite_tokens(token_hash);

ALTER TABLE staff_invite_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage staff tokens" ON staff_invite_tokens;
CREATE POLICY "Super admins manage staff tokens"
  ON staff_invite_tokens FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
        AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
        AND p.is_active = true
    )
  );

-- ── 7. Add must_change_password to profiles if missing ───────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- ── 8. Add paid event columns to events if missing ───────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_paid          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS payment_mode     TEXT;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS allow_stk_push   BOOLEAN DEFAULT true;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS allow_manual     BOOLEAN DEFAULT true;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS host_paybill     TEXT;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS host_till        TEXT;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS business_name    TEXT;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS payment_timeout  INTEGER DEFAULT 120;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS account_format   TEXT;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ticket_categories JSONB DEFAULT '[]'::jsonb;

-- Add anon SELECT policy for paid events (needed for public ticket page)
DROP POLICY IF EXISTS "Anon can read paid public events" ON events;
CREATE POLICY "Anon can read paid public events"
  ON events FOR SELECT
  TO anon
  USING (
    is_paid = true
    AND status != 'archived'
  );

-- ── 9. Realtime replication for ticket_orders ─────────────────────────────────
-- Required for Supabase Realtime subscriptions in PublicTicketPage.
-- Enables instant payment confirmation updates instead of polling only.
ALTER TABLE ticket_orders REPLICA IDENTITY FULL;

-- ── 10. Verification ──────────────────────────────────────────────────────────
SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN (
  'ticket_orders', 'tickets', 'mpesa_payment_logs',
  'ticket_template_layouts', 'invitation_tokens', 'staff_invite_tokens'
)
ORDER BY tablename;