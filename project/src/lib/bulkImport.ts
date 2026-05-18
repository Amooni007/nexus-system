import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { generateQRToken } from './qr';
import type { BulkGuestImport, CSVRow } from '../types';

interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  duplicates: number;
}

export async function parseCSVFile(file: File): Promise<CSVRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // ✅ FIX: Force all cells to be read as strings so numbers don't break .trim()
        const json = XLSX.utils.sheet_to_json(sheet, { raw: false }) as CSVRow[];
        resolve(json);
      } catch (error) {
        reject(new Error('Failed to parse CSV file. Please check the format.'));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function validateGuestRow(row: CSVRow, rowIndex: number): { valid: boolean; guest?: BulkGuestImport; error?: string } {
  // ✅ FIX: Convert to string first before trimming — handles numbers from Excel
  const name = String(row.Name || row.name || '').trim();
  const phone = String(row.Phone || row.phone || '').trim();
  
  if (!name) {
    return { valid: false, error: `Row ${rowIndex + 2}: Name is required` };
  }
  
  if (!phone) {
    return { valid: false, error: `Row ${rowIndex + 2}: Phone is required` };
  }
  
  // Basic phone validation (at least 8 digits)
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length < 8) {
    return { valid: false, error: `Row ${rowIndex + 2}: Invalid phone number (minimum 8 digits)` };
  }
  
  // ✅ FIX: Convert email to string too
  const email = String(row.Email || row.email || '').trim();
  
  // Validate email if provided
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: `Row ${rowIndex + 2}: Invalid email format` };
  }
  
  return {
    valid: true,
    guest: {
      name,
      phone: digitsOnly,
      email: email || undefined,
      event_id: '', // Will be set by the caller
    }
  };
}

export async function importGuestsBulk(
  guests: BulkGuestImport[], 
  eventId: string, 
  createdBy: string
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    imported: 0,
    errors: [],
    duplicates: 0
  };
  
  try {
    // Check for duplicate phone numbers in the event
    const { data: existingGuests } = await supabase
      .from('guests')
      .select('phone')
      .eq('event_id', eventId);
    
    const existingPhones = new Set((existingGuests || []).map(g => g.phone));
    
    // Filter out duplicates
    const newGuests = guests.filter(g => {
      if (existingPhones.has(g.phone)) {
        result.duplicates++;
        return false;
      }
      return true;
    });
    
    if (newGuests.length === 0) {
      result.errors.push('All guests already exist in this event');
      return result;
    }
    
    // Insert guests
    const guestData = newGuests.map(g => ({
      ...g,
      event_id: eventId,
      created_by: createdBy,
      status: 'active'
    }));
    
    const { data: insertedGuests, error: insertError } = await supabase
      .from('guests')
      .insert(guestData)
      .select('id');
    
    if (insertError) {
      result.errors.push(`Database error: ${insertError.message}`);
      return result;
    }
    
    // Generate QR codes for all new guests
    const qrCodes = (insertedGuests || []).map(guest => ({
      guest_id: guest.id,
      event_id: eventId,
      code: generateQRToken(),
      status: 'unused'
    }));
    
    const { error: qrError } = await supabase
      .from('qr_codes')
      .insert(qrCodes);
    
    if (qrError) {
      result.errors.push(`QR generation error: ${qrError.message}`);
      // Still count the guests as imported even if QR generation fails
    }
    
    result.imported = newGuests.length;
    result.success = true;
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    result.errors.push(`Unexpected error: ${message}`);
  }

  return result;
}