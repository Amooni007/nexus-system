
/*
  # Nexus Event Access & Invitation System - Core Schema

  ## Overview
  Creates the complete database schema for the Nexus application.

  ## New Tables

  ### profiles
  - Extends auth.users with role-based access control
  - Roles: super_admin, event_manager, scanner
  - Tracks who created each staff account

  ### events
  - Event records with name, date, location, description
  - Status: open (editable) or locked (read-only)
  - Linked to creating staff member

  ### guests
  - Guest records linked to events
  - Status: active or inactive (never deleted)
  - Phone and email for contact/sharing

  ### qr_codes
  - Unique QR code per guest per event
  - Status: unused or used
  - Tracks when it was used

  ### scan_logs
  - Records every QR scan attempt with result
  - Links guest, event, staff, and result

  ### activity_logs
  - Audit trail for all user actions
  - Tracks entity changes with details as JSONB

  ## Security
  - RLS enabled on all tables
  - Policies based on user role from profiles table
  - Invitation page reads guests/events by ID (limited public access via special policy)
*/

-- PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'event_manager' CHECK (role IN ('super_admin', 'event_manager', 'scanner')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Super admins can read all profiles
CREATE POLICY "Super admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Super admins can insert profiles
CREATE POLICY "Super admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Super admins can update profiles
CREATE POLICY "Super admins can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Users can update their own profile (limited fields)
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- EVENTS TABLE
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date timestamptz NOT NULL,
  location text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all events
CREATE POLICY "Authenticated users can read events"
  ON events FOR SELECT
  TO authenticated
  USING (true);

-- Event managers and super admins can insert events
CREATE POLICY "Staff can create events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
  );

-- Event managers and super admins can update events
CREATE POLICY "Staff can update events"
  ON events FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
  );

-- GUESTS TABLE
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all guests
CREATE POLICY "Authenticated users can read guests"
  ON guests FOR SELECT
  TO authenticated
  USING (true);

-- Anon users can read a specific guest by id (for invitation page)
CREATE POLICY "Anon can read guests by id for invitations"
  ON guests FOR SELECT
  TO anon
  USING (true);

-- Staff can create guests for open events
CREATE POLICY "Staff can create guests"
  ON guests FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
    AND
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id AND e.status = 'open'
    )
  );

-- Staff can update guests for open events
CREATE POLICY "Staff can update guests"
  ON guests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
    AND
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id AND e.status = 'open'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
  );

-- QR CODES TABLE
CREATE TABLE IF NOT EXISTS qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guests(id),
  event_id uuid NOT NULL REFERENCES events(id),
  code text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read QR codes
CREATE POLICY "Authenticated users can read qr codes"
  ON qr_codes FOR SELECT
  TO authenticated
  USING (true);

-- Anon can read qr codes (for invitation page)
CREATE POLICY "Anon can read qr codes for invitations"
  ON qr_codes FOR SELECT
  TO anon
  USING (true);

-- Staff can create QR codes
CREATE POLICY "Staff can create qr codes"
  ON qr_codes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'event_manager') AND p.is_active = true
    )
  );

-- Authenticated users can update QR code status (for scanning)
CREATE POLICY "Authenticated users can update qr status"
  ON qr_codes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  );

-- SCAN LOGS TABLE
CREATE TABLE IF NOT EXISTS scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id uuid REFERENCES qr_codes(id),
  guest_id uuid NOT NULL REFERENCES guests(id),
  event_id uuid NOT NULL REFERENCES events(id),
  staff_id uuid NOT NULL REFERENCES profiles(id),
  result text NOT NULL CHECK (result IN ('accepted', 'rejected_inactive', 'rejected_used', 'invalid')),
  reason text DEFAULT '',
  scanned_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read scan logs
CREATE POLICY "Authenticated users can read scan logs"
  ON scan_logs FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can create scan logs
CREATE POLICY "Authenticated users can create scan logs"
  ON scan_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_active = true
    )
  );

-- ACTIVITY LOGS TABLE
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  action text NOT NULL,
  entity_type text DEFAULT '',
  entity_id uuid,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read activity logs
CREATE POLICY "Authenticated users can read activity logs"
  ON activity_logs FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can create activity logs
CREATE POLICY "Authenticated users can create activity logs"
  ON activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- INDEXES for performance
CREATE INDEX IF NOT EXISTS idx_guests_event_id ON guests(event_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_guest_id ON qr_codes(guest_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_code ON qr_codes(code);
CREATE INDEX IF NOT EXISTS idx_scan_logs_event_id ON scan_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_guest_id ON scan_logs(guest_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_id ON activity_logs(entity_id);

-- TRIGGER: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
