import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import type { InvitationTemplate } from '../types';

// ✅ NEW: accepts optional template to set PDF dimensions to match the image
export async function downloadInvitationAsPDF(
  elementId: string,
  filename: string,
  template?: InvitationTemplate | null
): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) throw new Error('Element not found');

  const canvas = await html2canvas(element, {
    scale: 3,          // high res
    useCORS: true,
    backgroundColor: null, // transparent — let template show
    logging: false,
    allowTaint: false,
  });

  const imgData = canvas.toDataURL('image/png');

  // ✅ Determine PDF orientation and size from template dimensions
  const templateW = template?.width || canvas.width;
  const templateH = template?.height || canvas.height;
  const isLandscape = templateW > templateH;

  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    // ✅ Use exact aspect ratio instead of forcing A4
    format: isLandscape
      ? [297, (297 * templateH) / templateW]   // landscape: fix width to 297mm
      : [210, (210 * templateH) / templateW],  // portrait: fix width to 210mm
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  // Fill the entire page
  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`${filename}.pdf`);
}