/*
  # Make scan_logs guest_id and event_id nullable

  ## Changes
  - Allow guest_id and event_id to be NULL in scan_logs
  - This supports logging invalid QR scan attempts where no guest/event is linked

  ## Why
  When an invalid QR code is scanned (not found in system), there is no guest_id or event_id
  to reference, so these columns must be nullable to record the attempt.
*/

ALTER TABLE scan_logs ALTER COLUMN guest_id DROP NOT NULL;
ALTER TABLE scan_logs ALTER COLUMN event_id DROP NOT NULL;
