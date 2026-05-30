-- ============================================================
-- NEXUS — COMPLETE PRODUCTION MIGRATION
-- File: supabase/migrations/20260528000000_complete_production_schema.sql
--
-- This migration ensures a brand-new Supabase project can deploy
-- successfully without any manual SQL Editor fixes.
--
-- Covers everything NOT in previous migrations:
--   1. invitation_templates table (was created via SQL Editor only)
--   2. Safe public_events view (was created via SQL Editor only)
--   3. get_category_availability RPC (was created via SQL Editor only)
--   4. Security fixes migration contents (20260527000000 not yet in folder)
--   5. scan_logs result CHECK update (ticket scans add 'wrong_event' result)
--   6. events status column — add 'archived' to CHECK constraint
--   7. guests — remove anon read policy (security fix)
--   8. qr_codes — remove anon read policy (security fix)
--   9. All updated_at triggers for ticketing tables
--  10. Indexes missing from current migrations
-- ============================================================

-- ── 1. invitation_templates ───────────────────────────────────────────────────
-- This table was created directly in SQL Editor and has NO migration coverage.
CREATE TABLE IF NOT EXISTS invitation_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  image_url        TEXT,
  background_image TEXT,   -- alias kept for legacy queries
  background_width  INTEGER DEFAULT 800,
  background_height INTEGER DEFAULT 400,
  width            INTEGER DEFAULT 800,
  height           INTEGER DEFAULT 400,
  fields           JSONB NOT NULL DEFAULT '[]',
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_templates_created_by
  ON invitation_templates(created_by);

ALTER TABLE invitation_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read invitation templates" ON invitation_templates;
CREATE POLICY "Staff can read invitation templates"
  ON invitation_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  );

DROP POLICY IF EXISTS "Anon can read invitation templates" ON invitation_templates;
CREATE POLICY "Anon can read invitation templates"
  ON invitation_templates FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Staff can manage invitation templates" ON invitation_templates;
CREATE POLICY "Staff can manage invitation templates"
  ON invitation_templates FOR ALL
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

-- Link events to invitation templates
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES invitation_templates(id);

-- ── 2. Safe public events view ────────────────────────────────────────────────
-- Excludes created_by, template_id, updated_at, created_at from anon access.
-- Prevents staff UUID leakage which enabled the F-01 RPC bypass attack.
CREATE OR REPLACE VIEW public.public_events AS
  SELECT
    id,
    name,
    date,
    location,
    description,
    status,
    is_paid,
    payment_mode,
    allow_stk_push,
    allow_manual,
    host_paybill,
    host_till,
    business_name,
    payment_timeout,
    account_format,
    ticket_categories
  FROM public.events
  WHERE is_paid = true
    AND status != 'archived';

GRANT SELECT ON public.public_events TO anon;
GRANT SELECT ON public.public_events TO authenticated;

-- Remove the old anon policy on the base events table (view replaces it)
DROP POLICY IF EXISTS "Anon can read paid public events" ON events;

-- ── 3. get_category_availability RPC ─────────────────────────────────────────
-- SECURITY DEFINER function so anon can get ticket counts
-- without direct access to the tickets table.
CREATE OR REPLACE FUNCTION get_category_availability(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_counts JSONB;
BEGIN
  SELECT jsonb_object_agg(ticket_category, cnt) INTO v_counts
  FROM (
    SELECT ticket_category, COUNT(*) AS cnt
    FROM tickets
    WHERE event_id = p_event_id
      AND status != 'cancelled'
    GROUP BY ticket_category
  ) sub;
  RETURN COALESCE(v_counts, '{}'::jsonb);
END;
$func$;

GRANT EXECUTE ON FUNCTION get_category_availability(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_category_availability(UUID) TO authenticated;

-- ── 4. All RPCs using auth.uid() (security fix — was using p_staff_id) ────────

CREATE OR REPLACE FUNCTION confirm_order(p_order_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller UUID := auth.uid();
  v_profile profiles%ROWTYPE;
  v_order ticket_orders%ROWTYPE;
  v_count INT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id=v_caller AND is_active=true;
  IF NOT FOUND OR v_profile.role NOT IN ('super_admin','event_manager') THEN
    RETURN jsonb_build_object('success',false,'error','Unauthorized: insufficient role');
  END IF;
  SELECT * INTO v_order FROM ticket_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Order not found'); END IF;
  IF v_order.payment_status='confirmed' THEN RETURN jsonb_build_object('success',false,'error','Order already confirmed'); END IF;
  IF v_order.payment_status='cancelled' THEN RETURN jsonb_build_object('success',false,'error','Cannot confirm a cancelled order'); END IF;
  SELECT COUNT(*) INTO v_count FROM tickets WHERE order_id=p_order_id;
  IF v_count=0 THEN
    INSERT INTO tickets(order_id,event_id,customer_name,customer_phone,ticket_category,status,delivery_status)
    SELECT v_order.id,v_order.event_id,v_order.customer_name,v_order.customer_phone,v_order.ticket_category,'unused','pending'
    FROM generate_series(1,v_order.quantity);
  END IF;
  UPDATE ticket_orders SET payment_status='confirmed',payment_confirmed_at=now(),confirmed_by=v_caller,is_flagged=false,updated_at=now() WHERE id=p_order_id;
  SELECT COUNT(*) INTO v_count FROM tickets WHERE order_id=p_order_id;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'ticket_count',v_count);
END;
$func$;

CREATE OR REPLACE FUNCTION cancel_order(p_order_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid(); v_profile profiles%ROWTYPE; v_order ticket_orders%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id=v_caller AND is_active=true;
  IF NOT FOUND OR v_profile.role NOT IN ('super_admin','event_manager') THEN RETURN jsonb_build_object('success',false,'error','Unauthorized'); END IF;
  SELECT * INTO v_order FROM ticket_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Order not found'); END IF;
  IF v_order.payment_status='confirmed' AND v_profile.role!='super_admin' THEN RETURN jsonb_build_object('success',false,'error','Only super admin can cancel confirmed orders'); END IF;
  IF v_order.payment_status='cancelled' THEN RETURN jsonb_build_object('success',false,'error','Order already cancelled'); END IF;
  UPDATE ticket_orders SET payment_status='cancelled',updated_at=now() WHERE id=p_order_id;
  UPDATE tickets SET status='cancelled' WHERE order_id=p_order_id;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id);
END;
$func$;

CREATE OR REPLACE FUNCTION flag_order(p_order_id UUID, p_staff_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND role IN('super_admin','event_manager') AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Unauthorized'); END IF;
  UPDATE ticket_orders SET is_flagged=true,flag_reason=p_reason,updated_at=now() WHERE id=p_order_id;
  RETURN jsonb_build_object('success',true);
END;
$func$;

CREATE OR REPLACE FUNCTION mark_ticket_delivered(p_ticket_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Unauthorized'); END IF;
  UPDATE tickets SET delivery_status='sent' WHERE id=p_ticket_id;
  RETURN jsonb_build_object('success',true);
END;
$func$;

CREATE OR REPLACE FUNCTION update_guest_status(p_guest_id UUID, p_status TEXT, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF p_status NOT IN('active','inactive') THEN RETURN jsonb_build_object('success',false,'error','Invalid status'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND role IN('super_admin','event_manager') AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Unauthorized'); END IF;
  UPDATE guests SET status=p_status WHERE id=p_guest_id;
  RETURN jsonb_build_object('success',true);
END;
$func$;

CREATE OR REPLACE FUNCTION delete_event(p_event_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND role='super_admin' AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Only super admins can delete events'); END IF;
  IF NOT EXISTS(SELECT 1 FROM events WHERE id=p_event_id) THEN RETURN jsonb_build_object('success',false,'error','Event not found'); END IF;
  DELETE FROM scan_logs WHERE event_id=p_event_id;
  DELETE FROM mpesa_payment_logs WHERE order_id IN(SELECT id FROM ticket_orders WHERE event_id=p_event_id);
  DELETE FROM tickets WHERE event_id=p_event_id;
  DELETE FROM ticket_orders WHERE event_id=p_event_id;
  DELETE FROM qr_codes WHERE event_id=p_event_id;
  DELETE FROM invitation_tokens WHERE event_id=p_event_id;
  DELETE FROM ticket_template_layouts WHERE event_id=p_event_id;
  DELETE FROM guests WHERE event_id=p_event_id;
  DELETE FROM events WHERE id=p_event_id;
  RETURN jsonb_build_object('success',true,'event_id',p_event_id);
END;
$func$;

CREATE OR REPLACE FUNCTION delete_guest(p_guest_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND role IN('super_admin','event_manager') AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Unauthorized'); END IF;
  DELETE FROM scan_logs WHERE guest_id=p_guest_id;
  DELETE FROM qr_codes WHERE guest_id=p_guest_id;
  DELETE FROM invitation_tokens WHERE guest_id=p_guest_id;
  DELETE FROM guests WHERE id=p_guest_id;
  RETURN jsonb_build_object('success',true);
END;
$func$;

CREATE OR REPLACE FUNCTION delete_guests_bulk(p_guest_ids UUID[], p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND role IN('super_admin','event_manager') AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Unauthorized'); END IF;
  DELETE FROM scan_logs WHERE guest_id=ANY(p_guest_ids);
  DELETE FROM qr_codes WHERE guest_id=ANY(p_guest_ids);
  DELETE FROM invitation_tokens WHERE guest_id=ANY(p_guest_ids);
  DELETE FROM guests WHERE id=ANY(p_guest_ids);
  RETURN jsonb_build_object('success',true,'deleted_count',array_length(p_guest_ids,1));
END;
$func$;

CREATE OR REPLACE FUNCTION toggle_profile_active(p_target_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_caller UUID:=auth.uid(); v_target profiles%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND role='super_admin' AND is_active=true) THEN RETURN jsonb_build_object('success',false,'error','Only super admins can change staff status'); END IF;
  SELECT * INTO v_target FROM profiles WHERE id=p_target_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Staff member not found'); END IF;
  IF p_target_id=v_caller THEN RETURN jsonb_build_object('success',false,'error','Cannot deactivate your own account'); END IF;
  UPDATE profiles SET is_active=NOT v_target.is_active WHERE id=p_target_id;
  RETURN jsonb_build_object('success',true,'is_active',NOT v_target.is_active);
END;
$func$;

CREATE OR REPLACE FUNCTION process_ticket_qr_scan(p_token TEXT, p_event_id UUID, p_staff_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller UUID:=auth.uid();
  v_ticket_token UUID;
  v_ticket tickets%ROWTYPE;
  v_order ticket_orders%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('status','error','message','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND is_active=true) THEN RETURN jsonb_build_object('status','error','message','Unauthorized'); END IF;
  BEGIN v_ticket_token:=replace(p_token,'NEXUS-TICKET:','')::UUID;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('status','invalid','message','Invalid ticket token'); END;
  SELECT * INTO v_ticket FROM tickets WHERE ticket_token=v_ticket_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','message','Ticket not found'); END IF;
  IF v_ticket.event_id!=p_event_id THEN RETURN jsonb_build_object('status','wrong_event','message','Ticket is for a different event'); END IF;
  SELECT * INTO v_order FROM ticket_orders WHERE id=v_ticket.order_id;
  IF v_order.payment_status!='confirmed' THEN RETURN jsonb_build_object('status','invalid','message','Payment not confirmed'); END IF;
  IF v_ticket.status='cancelled' THEN RETURN jsonb_build_object('status','invalid','message','Ticket has been cancelled'); END IF;
  IF v_ticket.status='used' THEN RETURN jsonb_build_object('status','already_used','message','Ticket already scanned','scanned_at',v_ticket.scanned_at,'customer_name',v_ticket.customer_name,'ticket_category',v_ticket.ticket_category); END IF;
  UPDATE tickets SET status='used',scanned_at=now(),scanned_by=v_caller WHERE id=v_ticket.id;
  INSERT INTO scan_logs(staff_id,event_id,guest_id,qr_code_id,result,reason) VALUES(v_caller,p_event_id,NULL,NULL,'accepted','Ticket entry granted');
  RETURN jsonb_build_object('status','accepted','message','Entry granted','customer_name',v_ticket.customer_name,'ticket_category',v_ticket.ticket_category,'scanned_at',now());
END;
$func$;

CREATE OR REPLACE FUNCTION process_guest_qr_scan(p_qr_code TEXT, p_staff_id UUID, p_event_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller UUID:=auth.uid();
  v_qr qr_codes%ROWTYPE;
  v_guest guests%ROWTYPE;
  v_event events%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('status','error','message','Not authenticated'); END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=v_caller AND is_active=true) THEN RETURN jsonb_build_object('status','error','message','Unauthorized'); END IF;
  SELECT * INTO v_qr FROM qr_codes WHERE code=p_qr_code FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO scan_logs(staff_id,event_id,guest_id,qr_code_id,result,reason) VALUES(v_caller,p_event_id,NULL,NULL,'invalid','QR code not found');
    RETURN jsonb_build_object('status','invalid','message','QR code not recognised');
  END IF;
  IF p_event_id IS NOT NULL AND v_qr.event_id!=p_event_id THEN
    INSERT INTO scan_logs(staff_id,event_id,guest_id,qr_code_id,result,reason) VALUES(v_caller,p_event_id,v_qr.guest_id,v_qr.id,'invalid','QR belongs to different event');
    RETURN jsonb_build_object('status','wrong_event','message','This invitation is for a different event');
  END IF;
  SELECT * INTO v_guest FROM guests WHERE id=v_qr.guest_id;
  SELECT * INTO v_event FROM events WHERE id=v_qr.event_id;
  IF v_guest.status='inactive' THEN
    INSERT INTO scan_logs(qr_code_id,guest_id,event_id,staff_id,result,reason) VALUES(v_qr.id,v_qr.guest_id,v_qr.event_id,v_caller,'rejected_inactive','Guest is inactive');
    RETURN jsonb_build_object('status','rejected_inactive','message','Guest is inactive','guest_name',v_guest.name);
  END IF;
  IF v_qr.status='used' THEN
    INSERT INTO scan_logs(qr_code_id,guest_id,event_id,staff_id,result,reason) VALUES(v_qr.id,v_qr.guest_id,v_qr.event_id,v_caller,'rejected_used','QR already scanned');
    RETURN jsonb_build_object('status','rejected_used','message','QR already scanned','used_at',v_qr.used_at,'guest_name',v_guest.name,'event_name',v_event.name);
  END IF;
  UPDATE qr_codes SET status='used',used_at=now() WHERE id=v_qr.id;
  INSERT INTO scan_logs(qr_code_id,guest_id,event_id,staff_id,result,reason) VALUES(v_qr.id,v_qr.guest_id,v_qr.event_id,v_caller,'accepted','Entry granted');
  RETURN jsonb_build_object('status','accepted','message','Entry granted','guest_name',v_guest.name,'event_name',v_event.name);
END;
$func$;

-- Grant execute on all RPCs
GRANT EXECUTE ON FUNCTION confirm_order(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_order(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION flag_order(UUID,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_ticket_delivered(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_guest_status(UUID,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_event(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_guest(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_guests_bulk(UUID[],UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_profile_active(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_ticket_qr_scan(TEXT,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_guest_qr_scan(TEXT,UUID,UUID) TO authenticated;

-- ── 5. Remove insecure anon policies from original migration ──────────────────
-- The original migration gave anon read access to guests and qr_codes.
-- These expose guest PII and QR codes to unauthenticated users.
DROP POLICY IF EXISTS "Anon can read guests by id for invitations" ON guests;
DROP POLICY IF EXISTS "Anon can read qr codes for invitations" ON qr_codes;

-- ── 6. Fix scan_logs result CHECK to include 'wrong_event' ───────────────────
-- The original CHECK only allowed: accepted, rejected_inactive, rejected_used, invalid
-- The scanner now also produces 'wrong_event' — add it to the constraint
ALTER TABLE scan_logs DROP CONSTRAINT IF EXISTS scan_logs_result_check;
ALTER TABLE scan_logs ADD CONSTRAINT scan_logs_result_check
  CHECK (result IN ('accepted','rejected_inactive','rejected_used','invalid','wrong_event'));

-- ── 7. updated_at triggers for ticketing tables ───────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ticket_orders_updated_at') THEN
    CREATE TRIGGER ticket_orders_updated_at BEFORE UPDATE ON ticket_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='invitation_templates_updated_at') THEN
    CREATE TRIGGER invitation_templates_updated_at BEFORE UPDATE ON invitation_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ticket_template_layouts_updated_at') THEN
    CREATE TRIGGER ticket_template_layouts_updated_at BEFORE UPDATE ON ticket_template_layouts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ── 8. Verification query ─────────────────────────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN(
  'profiles','events','guests','qr_codes','scan_logs','activity_logs',
  'ticket_orders','tickets','mpesa_payment_logs','ticket_template_layouts',
  'invitation_templates','invitation_tokens','staff_invite_tokens'
)
ORDER BY tablename;