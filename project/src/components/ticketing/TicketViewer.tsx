// src/components/ticketing/TicketViewer.tsx
// Renders a professional ticket on canvas inside a modal.
// Shows Download PNG and Send WhatsApp buttons.

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Send, X } from 'lucide-react';
import { renderTicketToCanvas, downloadTicketAsPNG } from '../../lib/ticketRenderer';
import type { TicketRenderParams } from '../../lib/ticketRenderer';

interface Props {
  params: TicketRenderParams;
  onSendWhatsApp?: () => void;
  onClose?: () => void;
}

export default function TicketViewer({ params, onSendWhatsApp, onClose }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (!canvasRef.current) return;
    setRendering(true);
    setError('');
    renderTicketToCanvas(canvasRef.current, params)
      .then(() => setRendering(false))
      .catch(err => { setError('Render failed: ' + err.message); setRendering(false); });
  }, [params]);

  async function handleDownload() {
    await downloadTicketAsPNG(params, `nexus-ticket-${params.ticketId}.png`);
  }

  return (
    <div className="space-y-4">
      {/* Canvas preview */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 min-h-[200px] flex items-center justify-center">
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10 rounded-2xl">
            <div className="text-center space-y-2">
              <Loader2 className="text-indigo-400 animate-spin mx-auto" size={32} />
              <p className="text-slate-400 text-xs">Rendering ticket…</p>
            </div>
          </div>
        )}
        {error && (
          <div className="text-red-400 text-xs text-center p-4">{error}</div>
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-auto rounded-2xl"
          style={{ display: rendering || error ? 'none' : 'block' }}
        />
      </div>

      {/* Actions */}
      {!rendering && !error && (
        <div className="flex gap-2">
          <button onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
            <Download size={15} /> Download PNG
          </button>
          {onSendWhatsApp && (
            <button onClick={onSendWhatsApp}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
              <Send size={15} /> WhatsApp
            </button>
          )}
          {onClose && (
            <button onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm transition-colors">
              <X size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}