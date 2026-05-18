export type UserRole = 'super_admin' | 'event_manager' | 'scanner';
export type EventStatus = 'open' | 'locked';
export type GuestStatus = 'active' | 'inactive';
export type QRStatus = 'unused' | 'used';
export type ScanResult = 'accepted' | 'rejected_inactive' | 'rejected_used' | 'invalid';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
  description: string;
  status: EventStatus;
  template_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  creator?: Profile;
  guest_count?: number;
}

export interface Guest {
  id: string;
  event_id: string;
  name: string;
  phone: string;
  email: string;
  status: GuestStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  event?: Event;
  qr_code?: QRCode;
}

export interface QRCode {
  id: string;
  guest_id: string;
  event_id: string;
  code: string;
  status: QRStatus;
  created_at: string;
  used_at: string | null;
}

export interface ScanLog {
  id: string;
  qr_code_id: string | null;
  guest_id: string;
  event_id: string;
  staff_id: string;
  result: ScanResult;
  reason: string;
  scanned_at: string;
  guest?: Guest;
  event?: Event;
  staff?: Profile;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  user?: Profile;
}

export interface TemplatePosition {
  top: string;
  left: string;
  fontFamily?: string;
  // ✅ NEW: font size as % of template width (scales at all sizes)
  fontSizePct?: number;
  fontWeight?: string;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
}

export interface QRCodeConfig extends TemplatePosition {
  // ✅ NEW: QR size as % of template width (scales at all sizes)
  sizePct?: number;
  padding?: boolean;
}

export interface TemplateFields {
  guest_name: TemplatePosition;
  qr_code: QRCodeConfig;
}

export interface InvitationTemplate {
  id: string;
  name: string;
  background_image: string;
  // ✅ NEW: actual pixel dimensions of the uploaded image
  width?: number;
  height?: number;
  is_default: boolean;
  fields: TemplateFields;
  created_at: string;
  updated_at: string;
}

export interface CreateStaffPayload {
  full_name: string;
  email: string;
  password: string;
  role: Exclude<UserRole, 'super_admin'>;
}

export interface CreateEventPayload {
  name: string;
  date: string;
  location: string;
  description: string;
}

export interface CreateGuestPayload {
  event_id: string;
  name: string;
  phone: string;
  email: string;
}

export interface BulkGuestImport {
  name: string;
  phone: string;
  email?: string;
  event_id: string;
}

export interface CSVRow {
  Name?: string;
  name?: string;
  Phone?: string | number;
  phone?: string | number;
  Email?: string;
  email?: string;
}