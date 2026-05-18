// src/components/ticketing/CategoryTemplateUploader.tsx
import { useState } from 'react';
import { Upload, X, CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import TicketTemplateDesigner from './TicketTemplateDesigner';
import type { TicketCategoryConfig } from '../../types/ticketing';

interface Props {
  eventId: string;
  categories: TicketCategoryConfig[];
  onUpdate: (updated: TicketCategoryConfig[]) => void;
}

const ROW_STYLES: Record<string, string> = {
  VVIP:    'from-yellow-900/50 to-amber-900/20 border-yellow-500/40',
  VIP:     'from-slate-700/50 to-slate-600/20 border-slate-400/40',
  Regular: 'from-blue-900/40 to-blue-800/20 border-blue-500/40',
};
const BADGE_STYLE: Record<string, string> = {
  VVIP:    'bg-yellow-400 text-yellow-950',
  VIP:     'bg-slate-300 text-slate-900',
  Regular: 'bg-blue-500 text-white',
};

export default function CategoryTemplateUploader({ eventId, categories, onUpdate }: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error,     setError]     = useState('');
  const [designing, setDesigning] = useState<TicketCategoryConfig | null>(null);

  async function handleUpload(cat: TicketCategoryConfig, file: File) {
    if (!file.type.startsWith('image/')) { setError('Only image files are supported'); return; }
    if (file.size > 10 * 1024 * 1024)    { setError('Image must be under 10MB'); return; }
    setUploading(cat.name); setError('');
    try {
      const ext  = file.name.split('.').pop();
      const path = `ticket-templates/${eventId}/${cat.name.toLowerCase()}-template.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('ticket-templates').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('ticket-templates').getPublicUrl(path);
      const updated = categories.map(c =>
        c.name === cat.name ? { ...c, template_image_url: urlData.publicUrl + '?t=' + Date.now() } : c
      );
      onUpdate(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally { setUploading(null); }
  }

  function removeTemplate(cat: TicketCategoryConfig) {
    onUpdate(categories.map(c => c.name === cat.name ? { ...c, template_image_url: undefined } : c));
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-slate-300 text-sm font-medium">Ticket Templates</p>
          <p className="text-slate-500 text-xs">Upload background · Design layout</p>
        </div>

        {error && <p className="text-red-400 text-xs bg-red-900/20 border border-red-500/30 rounded-xl px-3 py-2">⚠ {error}</p>}

        <div className="space-y-2">
          {categories.map(cat => {
            const rowStyle   = ROW_STYLES[cat.name]  || 'from-purple-900/50 to-purple-800/20 border-purple-500/40';
            const badgeStyle = BADGE_STYLE[cat.name] || 'bg-purple-500 text-white';
            const hasTemplate = !!(cat as any).template_image_url;
            const isUploading = uploading === cat.name;

            return (
              <div key={cat.name} className={`bg-gradient-to-r ${rowStyle} border rounded-2xl p-3 flex items-center gap-3 flex-wrap`}>
                <span className={'text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ' + badgeStyle}>{cat.name}</span>

                <div className="flex-1 min-w-0">
                  {hasTemplate
                    ? <div className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400"/><span className="text-emerald-300 text-xs truncate">Background uploaded</span></div>
                    : <span className="text-slate-400 text-xs">No template — uses default design</span>}
                </div>

                {hasTemplate && (cat as any).template_image_url && (
                  <img src={(cat as any).template_image_url} alt={cat.name}
                    className="w-16 h-10 object-cover rounded-lg border border-slate-600 flex-shrink-0" />
                )}

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {hasTemplate && (
                    <button type="button" onClick={() => setDesigning(cat)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors">
                      <Pencil size={11} /> Edit Layout
                    </button>
                  )}
                  {hasTemplate && (
                    <button type="button" onClick={() => removeTemplate(cat)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                      <X size={13} />
                    </button>
                  )}
                  <label className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl cursor-pointer transition-colors font-medium ${isUploading ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}>
                    {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                    {isUploading ? 'Uploading…' : hasTemplate ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" disabled={isUploading}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(cat, f); }} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-slate-600 text-xs space-y-0.5">
          <p>📐 Recommended: <strong className="text-slate-500">800×400px</strong> PNG landscape</p>
          <p>🎨 After uploading, click <strong className="text-indigo-400">Edit Layout</strong> to position QR, name, and ticket elements visually</p>
        </div>
      </div>

      {designing && (
        <TicketTemplateDesigner
          eventId={eventId}
          category={designing}
          onClose={() => setDesigning(null)}
          onSaved={() => setDesigning(null)}
        />
      )}
    </>
  );
}