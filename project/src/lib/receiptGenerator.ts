// src/lib/receiptGenerator.ts
// Generates a professional downloadable payment receipt as PDF.
// Runs entirely client-side using jsPDF — no backend needed.
// The receipt contains: order summary, event details, transaction ref,
// payment confirmation, and QR reference — safe to share.

import jsPDF from 'jspdf';

export interface ReceiptData {
  // Order
  orderRef:        string;   // first 8 chars of order ID, uppercase
  customerName:    string;
  customerPhone:   string;
  ticketCategory:  string;
  quantity:        number;
  unitPrice:       number;
  totalAmount:     number;
  paymentMethod:   'M-Pesa STK Push' | 'M-Pesa Manual' | 'Manual Payment';
  transactionCode: string | null;
  paidAt:          string;   // ISO date string
  // Event
  eventName:       string;
  eventDate:       string;   // ISO date string
  eventLocation:   string;
  // Tickets
  ticketTokens:    string[]; // short refs (first 8 chars of each token)
}

export async function downloadPaymentReceipt(data: ReceiptData): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW  = 210;
  const margin = 16;
  const colR   = pageW - margin;
  let   y      = 0;

  // ── Helper functions ───────────────────────────────────────────────────────
  function header(text: string, size = 11) {
    doc.setFontSize(size);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(text, margin, y);
  }

  function row(label: string, value: string, highlight = false) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(label, margin + 2, y);
    doc.setFont('helvetica', highlight ? 'bold' : 'normal');
    doc.setTextColor(highlight ? 16 : 30, highlight ? 185 : 41, highlight ? 129 : 59);
    doc.text(value, colR, y, { align: 'right' });
    y += 6;
  }

  function divider(thick = false) {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(thick ? 0.5 : 0.2);
    doc.line(margin, y, colR, y);
    y += 5;
  }

  function sectionTitle(text: string) {
    y += 2;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y - 3, colR - margin, 8, 1, 1, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(text.toUpperCase(), margin + 3, y + 2);
    y += 10;
  }

  // ── HEADER ─────────────────────────────────────────────────────────────────
  y = 20;
  // Logo area
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(margin, y - 6, 14, 14, 2, 2, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('NX', margin + 2.5, y + 3);

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('NEXUS', margin + 17, y + 1);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Event Access & Ticketing', margin + 17, y + 6);

  // Receipt title on right
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('PAYMENT RECEIPT', colR, y + 1, { align: 'right' });
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Ref: ${data.orderRef}`, colR, y + 6, { align: 'right' });

  y += 20;
  divider(true);

  // ── CONFIRMATION BANNER ────────────────────────────────────────────────────
  doc.setFillColor(220, 252, 231);
  doc.roundedRect(margin, y, colR - margin, 10, 1.5, 1.5, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(22, 101, 52);
  doc.text('✓  PAYMENT CONFIRMED', margin + 4, y + 6.5);
  const paidDate = new Date(data.paidAt);
  const paidStr  = paidDate.toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' }) +
                   ' at ' + paidDate.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(22, 101, 52);
  doc.text(paidStr, colR - 2, y + 6.5, { align: 'right' });
  y += 17;

  // ── EVENT DETAILS ──────────────────────────────────────────────────────────
  sectionTitle('Event Details');
  row('Event',    data.eventName);
  row('Date',     new Date(data.eventDate).toLocaleDateString('en-KE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  row('Venue',    data.eventLocation);
  y += 2;

  // ── ORDER SUMMARY ──────────────────────────────────────────────────────────
  sectionTitle('Order Summary');
  row('Customer Name',    data.customerName);
  row('Phone Number',     data.customerPhone);
  row('Ticket Category',  data.ticketCategory);
  row('Quantity',         `${data.quantity} ticket${data.quantity > 1 ? 's' : ''}`);
  row('Unit Price',       `KES ${data.unitPrice.toLocaleString()}`);
  y += 1;
  divider();
  row('TOTAL PAID', `KES ${data.totalAmount.toLocaleString()}`, true);
  y += 2;

  // ── PAYMENT DETAILS ────────────────────────────────────────────────────────
  sectionTitle('Payment Details');
  row('Payment Method', data.paymentMethod);
  if (data.transactionCode) {
    row('M-Pesa Code', data.transactionCode);
  }
  row('Order Reference', data.orderRef);
  y += 2;

  // ── TICKET REFERENCES ──────────────────────────────────────────────────────
  if (data.ticketTokens.length > 0) {
    sectionTitle('Ticket References');
    data.ticketTokens.forEach((token, i) => {
      row(`Ticket ${i + 1}`, token.slice(0, 8).toUpperCase().replace(/(.{4})/g, '$1-').slice(0, -1));
    });
    y += 2;
  }

  // ── FOOTER ─────────────────────────────────────────────────────────────────
  y = Math.max(y + 10, 255);
  divider();
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('This receipt is computer generated and valid without signature.', margin, y + 4);
  doc.text('Powered by Nexus Event Access & Ticketing System', margin, y + 8);
  doc.text(`Generated: ${new Date().toLocaleString('en-KE')}`, colR, y + 4, { align: 'right' });

  // ── DOWNLOAD ───────────────────────────────────────────────────────────────
  const filename = `nexus-receipt-${data.orderRef}-${data.eventName.replace(/\s+/g, '-').toLowerCase()}.pdf`;
  doc.save(filename);
}