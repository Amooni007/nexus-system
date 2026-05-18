import { supabase } from './supabase';

export async function logActivity(
  userId: string,
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('activity_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details || {},
    });
  } catch {
    // Silently fail for logging
  }
}
