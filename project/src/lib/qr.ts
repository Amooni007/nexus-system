import QRCode from 'qrcode';


export function generateQRToken(): string {
  // Generate a unique 8-character alphanumeric token
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export async function generateQRDataURL(code: string): Promise<string> {
  try {
    const url = await QRCode.toDataURL(code, {
      width: 300,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'H',
    });
    return url;
  } catch {
    throw new Error('Failed to generate QR code');
  }
}

export async function generateQRCanvas(code: string, canvas: HTMLCanvasElement): Promise<void> {
  await QRCode.toCanvas(canvas, code, {
    width: 200,
    margin: 2,
    color: {
      dark: '#1e293b',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'H',
  });
}
