import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Upload, CheckCircle, AlertTriangle, X, Paintbrush,
  Move, Save, Trash2, Plus, Image, Ruler,
  ArrowLeft, ChevronDown, ChevronUp, Sliders
} from 'lucide-react';
import type { InvitationTemplate } from '../types';

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => reject(new Error('Could not read image dimensions'));
    img.src = url;
  });
}

// Parse "45%" → 45
function pctToNum(val: string | undefined, fallback = 50): number {
  if (!val) return fallback;
  return parseFloat(val.replace('%', '')) || fallback;
}

export default function TemplatePage() {
  const [templates, setTemplates] = useState<InvitationTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<InvitationTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showTemplateList, setShowTemplateList] = useState(false); // mobile collapse
  const containerRef = useRef<HTMLDivElement>(null);

  // Position state (numbers 0–100)
  const [nameLeft, setNameLeft] = useState(50);
  const [nameTop, setNameTop]   = useState(45);
  const [qrLeft, setQrLeft]     = useState(50);
  const [qrTop, setQrTop]       = useState(70);

  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');

  // Style controls
  const [fontSizePct, setFontSizePct] = useState(4);
  const [fontColor, setFontColor]     = useState('#ffffff');
  const [fontWeight, setFontWeight]   = useState('600');
  const [qrSizePct, setQrSizePct]     = useState(20);

  // Upload form
  const [name, setName]           = useState('');
  const [file, setFile]           = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [fileDimensions, setFileDimensions] = useState<{ width: number; height: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => { fetchAllTemplates(); }, []);

  async function fetchAllTemplates() {
    setLoading(true);
    const { data } = await supabase.from('invitation_templates').select('*').order('created_at', { ascending: false });
    setTemplates(data || []);
    if (data && data.length > 0) selectTemplate(data[0]);
    setLoading(false);
  }

  function selectTemplate(t: InvitationTemplate) {
    setSelectedTemplate(t);
    setNameLeft(pctToNum(t.fields.guest_name?.left, 50));
    setNameTop(pctToNum(t.fields.guest_name?.top, 45));
    setQrLeft(pctToNum(t.fields.qr_code?.left, 50));
    setQrTop(pctToNum(t.fields.qr_code?.top, 70));
    setFontSizePct(t.fields.guest_name?.fontSizePct ?? 4);
    setFontColor(t.fields.guest_name?.color ?? '#ffffff');
    setFontWeight(t.fields.guest_name?.fontWeight ?? '600');
    setQrSizePct(t.fields.qr_code?.sizePct ?? 20);
    setShowTemplateList(false); // close mobile list on select
  }

  const getAspectRatio = (t: InvitationTemplate) => `${t.width || 800} × ${t.height || 1000}px`;
  const getOrientation = (t: InvitationTemplate) => {
    const w = t.width || 800, h = t.height || 1000;
    return w > h ? 'Landscape' : w < h ? 'Portrait' : 'Square';
  };

  // ── DRAG (pointer events — works on touch + mouse) ──────────────────────
  function handleDrag(e: React.PointerEvent, target: 'name' | 'qr') {
    if (!containerRef.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const container = containerRef.current;

    const onMove = (me: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = Math.max(2, Math.min(98, ((me.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(2, Math.min(98, ((me.clientY - rect.top) / rect.height) * 100));
      if (target === 'name') { setNameLeft(Math.round(x)); setNameTop(Math.round(y)); }
      else { setQrLeft(Math.round(x)); setQrTop(Math.round(y)); }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ── SAVE ────────────────────────────────────────────────────────────────
  async function savePositions() {
    if (!selectedTemplate) return;
    setIsSaving(true);
    setSaveMsg('');
    try {
      const { error } = await supabase.from('invitation_templates').update({
        fields: {
          guest_name: { top: `${nameTop}%`, left: `${nameLeft}%`, fontSizePct, color: fontColor, fontWeight },
          qr_code:    { top: `${qrTop}%`,  left: `${qrLeft}%`,  sizePct: qrSizePct, padding: true },
        },
      }).eq('id', selectedTemplate.id);

      if (error) throw error;
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 2000);
      fetchAllTemplates();
    } catch {
      setSaveMsg('Save failed.');
    } finally {
      setIsSaving(false);
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  async function deleteTemplate(templateId: string) {
    if (!window.confirm('Delete this template?')) return;
    await supabase.from('invitation_templates').delete().eq('id', templateId);
    const next = templates.filter(t => t.id !== templateId);
    setTemplates(next);
    next.length > 0 ? selectTemplate(next[0]) : setSelectedTemplate(null);
  }

  // ── FILE SELECT ──────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
    try { setFileDimensions(await getImageDimensions(f)); } catch { setFileDimensions(null); }
  }

  // ── UPLOAD ───────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name) { alert('Please provide a name and select a file!'); return; }
    setUploading(true);
    setUploadStatus('idle');
    setUploadMsg('Uploading...');
    try {
      const ext = file.name.split('.').pop();
      const path = `backgrounds/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('templates').upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('templates').getPublicUrl(path);
      const dims = fileDimensions || { width: 800, height: 1000 };
      const { error: dbErr } = await supabase.from('invitation_templates').insert({
        name, background_image: urlData.publicUrl, width: dims.width, height: dims.height, is_default: false,
        fields: { guest_name: { top: '45%', left: '50%', fontSizePct: 4, color: '#ffffff', fontWeight: '600' }, qr_code: { top: '70%', left: '50%', sizePct: 20, padding: true } },
      });
      if (dbErr) throw dbErr;
      setUploadStatus('success');
      setUploadMsg(`Uploaded! ${dims.width}×${dims.height}px`);
      setName(''); setFile(null); setFilePreview(''); setFileDimensions(null);
      setTimeout(() => { setIsModalOpen(false); setUploadMsg(''); setUploadStatus('idle'); fetchAllTemplates(); }, 1500);
    } catch (err: any) {
      setUploadStatus('error');
      setUploadMsg(err.message || 'Something went wrong.');
    } finally {
      setUploading(false);
    }
  }

  const canvasAspect = selectedTemplate ? (selectedTemplate.height || 1000) / (selectedTemplate.width || 800) : 1000 / 800;

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 py-6 lg:px-8 lg:py-8">

        {/* ── HEADER ── */}
        <div className="mb-6">
          {/* ✅ Back to Dashboard */}
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-4">
            <ArrowLeft size={14} /> Back to Dashboard
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold text-white">Invitation Templates</h1>
              <p className="text-slate-400 text-sm mt-0.5">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-lg">
              <Plus size={16} /> New Template
            </button>
          </div>
        </div>

        {/* ✅ MOBILE: template selector dropdown */}
        <div className="lg:hidden mb-4">
          <button
            onClick={() => setShowTemplateList(p => !p)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200"
          >
            <span className="flex items-center gap-2">
              <Image size={15} className="text-slate-500" />
              {selectedTemplate ? selectedTemplate.name : 'Select a template'}
            </span>
            {showTemplateList ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
          </button>

          {showTemplateList && (
            <div className="mt-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-800/60 last:border-0 transition-colors ${selectedTemplate?.id === t.id ? 'bg-blue-600/10' : 'hover:bg-slate-800/50'}`}
                >
                  <img src={t.background_image} alt={t.name} className="w-10 h-12 rounded object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{t.name}</p>
                    <p className="text-xs text-slate-500">{getAspectRatio(t)} · {getOrientation(t)}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteTemplate(t.id); }} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── DESKTOP sidebar template list ── */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sticky top-6">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Image size={16} className="text-slate-500" /> All Templates
              </h2>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-8">
                  <Paintbrush size={32} className="text-slate-700 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No templates yet</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {templates.map(t => (
                    <div key={t.id} onClick={() => selectTemplate(t)}
                      className={`p-3 rounded-xl cursor-pointer transition-all group ${selectedTemplate?.id === t.id ? 'bg-blue-600/10 border border-blue-500/30' : 'bg-slate-800/30 border border-transparent hover:bg-slate-800/50'}`}>
                      <div className="w-full h-20 rounded-lg overflow-hidden mb-2 bg-slate-800">
                        <img src={t.background_image} alt={t.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-200 truncate">{t.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><Ruler size={10} />{getAspectRatio(t)} · {getOrientation(t)}</p>
                        </div>
                        <button onClick={e => { e.stopPropagation(); deleteTemplate(t.id); }}
                          className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── CANVAS + CONTROLS ── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Controls panel */}
            {selectedTemplate && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                    <Sliders size={15} className="text-slate-500" /> Element Controls
                  </h3>
                  <div className="flex items-center gap-2">
                    {saveMsg && <span className={`text-xs ${saveMsg === 'Saved!' ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</span>}
                    <button onClick={savePositions} disabled={isSaving}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors">
                      <Save size={14} /> {isSaving ? 'Saving...' : 'Save All'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Font Size (%)</label>
                    <input type="range" min="1" max="100" step="0.5" value={fontSizePct} onChange={e => setFontSizePct(Number(e.target.value))} className="w-full accent-blue-500" />
                    <span className="text-xs text-slate-400">{fontSizePct}%</span>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Name Color</label>
                    <input type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} className="w-full h-8 rounded-lg cursor-pointer bg-transparent border border-slate-700" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Font Weight</label>
                    <select value={fontWeight} onChange={e => setFontWeight(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none">
                      <option value="400">Normal</option>
                      <option value="600">Semi Bold</option>
                      <option value="700">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">QR Size (%)</label>
                    <input type="range" min="5" max="40" step="1" value={qrSizePct} onChange={e => setQrSizePct(Number(e.target.value))} className="w-full accent-blue-500" />
                    <span className="text-xs text-slate-400">{qrSizePct}%</span>
                  </div>
                </div>

                {/* ✅ Mobile position sliders — precise control without drag */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800">
                  <div>
                    <p className="text-xs text-slate-400 font-medium mb-2 flex items-center gap-1.5"><Move size={12} /> Guest Name Position</p>
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-slate-500">Left: {nameLeft}%</label>
                        <input type="range" min="2" max="98" value={nameLeft} onChange={e => setNameLeft(Number(e.target.value))} className="w-full accent-blue-500" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Top: {nameTop}%</label>
                        <input type="range" min="2" max="98" value={nameTop} onChange={e => setNameTop(Number(e.target.value))} className="w-full accent-blue-500" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium mb-2 flex items-center gap-1.5"><Move size={12} /> QR Code Position</p>
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-slate-500">Left: {qrLeft}%</label>
                        <input type="range" min="2" max="98" value={qrLeft} onChange={e => setQrLeft(Number(e.target.value))} className="w-full accent-blue-500" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Top: {qrTop}%</label>
                        <input type="range" min="2" max="98" value={qrTop} onChange={e => setQrTop(Number(e.target.value))} className="w-full accent-blue-500" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── CANVAS ── */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 lg:p-6 flex flex-col items-center justify-center min-h-[300px]">
              {!selectedTemplate ? (
                <div className="text-center py-16">
                  <Paintbrush size={40} className="text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-400 font-medium">Select a template to edit</p>
                </div>
              ) : (
                <>
                  <div className="relative w-full mx-auto" style={{ maxWidth: '400px', paddingBottom: `${canvasAspect * 100}%` }}>
                    <div ref={containerRef} className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl border border-slate-700/50 touch-none">
                      {/* Background */}
                      <img src={selectedTemplate.background_image} alt={selectedTemplate.name} className="w-full h-full block pointer-events-none" style={{ objectFit: 'fill' }} />

                      {/* ✅ Draggable Guest Name — works on touch */}
                      <div
                        onPointerDown={e => handleDrag(e, 'name')}
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 bg-white/90 text-slate-900 px-2.5 py-1 rounded-lg shadow-xl border border-white/80 flex items-center gap-1 whitespace-nowrap cursor-move select-none touch-none"
                        style={{ top: `${nameTop}%`, left: `${nameLeft}%`, fontSize: `${fontSizePct}%`, fontWeight, color: fontColor }}
                      >
                        <Move size={10} className="text-slate-400 flex-shrink-0" />
                        <span style={{ color: fontColor, fontWeight }}>Guest Name</span>
                      </div>

                      {/* ✅ Draggable QR Code — works on touch */}
                      <div
                        onPointerDown={e => handleDrag(e, 'qr')}
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 bg-white p-1 rounded-xl shadow-xl border border-slate-200 cursor-move select-none touch-none flex items-center justify-center"
                        style={{ top: `${qrTop}%`, left: `${qrLeft}%`, width: `${qrSizePct}%`, aspectRatio: '1 / 1' }}
                      >
                        <div className="w-full h-full bg-slate-100 rounded grid grid-cols-3 gap-0.5 p-1">
                          {Array.from({ length: 9 }).map((_, i) => (
                            <div key={i} className={`aspect-square rounded-sm ${[0,2,6,8,4].includes(i) ? 'bg-slate-800' : 'bg-slate-300'}`} />
                          ))}
                        </div>
                      </div>

                      {/* Dimension badge */}
                      <div className="absolute bottom-2 right-2 bg-slate-900/80 backdrop-blur-md px-2 py-0.5 rounded-lg text-xs text-slate-400 border border-slate-700/50">
                        {selectedTemplate.width || 800} × {selectedTemplate.height || 1000}
                      </div>
                    </div>
                  </div>

                  <p className="text-slate-500 text-xs mt-4 text-center">
                    Drag elements on canvas · Or use sliders above for precision · Save when done
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── UPLOAD MODAL ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-slate-900 rounded-t-3xl sm:rounded-2xl p-6 sm:p-8 border border-slate-800 shadow-2xl relative max-h-[92vh] overflow-y-auto">
            {/* Mobile drag handle */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-slate-700 sm:hidden" />
            <button onClick={() => !uploading && setIsModalOpen(false)} className="absolute top-5 right-5 text-slate-500 hover:text-slate-300"><X size={20} /></button>
            <h2 className="text-xl font-bold text-white mb-1 mt-2 sm:mt-0">Upload Template</h2>
            <p className="text-slate-400 text-sm mb-6">Add a new invitation background</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="text-slate-300 text-xs font-medium block mb-2">Template Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Wedding Invitation 2025"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-blue-500/50 transition-colors" />
              </div>
              <div>
                <label className="text-slate-300 text-xs font-medium block mb-2">Background Image</label>
                <div className="relative border-2 border-dashed border-slate-700 hover:border-blue-500/30 rounded-xl overflow-hidden transition-colors">
                  <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer z-10" disabled={uploading} />
                  {filePreview ? (
                    <div className="relative">
                      <img src={filePreview} alt="Preview" className="w-full max-h-48 object-contain bg-slate-800" />
                      {fileDimensions && (
                        <div className="absolute bottom-2 right-2 bg-slate-900/90 px-2.5 py-1 rounded-lg text-xs text-slate-300 flex items-center gap-1.5 border border-slate-700">
                          <Ruler size={11} /> {fileDimensions.width} × {fileDimensions.height}px · {fileDimensions.width > fileDimensions.height ? 'Landscape' : fileDimensions.width < fileDimensions.height ? 'Portrait' : 'Square'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-8 flex flex-col items-center justify-center">
                      <Upload className="text-slate-500 mb-2" size={24} />
                      <p className="text-slate-400 text-xs">Click or tap to select a file</p>
                      <p className="text-slate-600 text-xs mt-1">PNG, JPG, WEBP supported</p>
                    </div>
                  )}
                </div>
              </div>

              {uploadMsg && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${uploadStatus === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : uploadStatus === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'}`}>
                  {uploadStatus === 'success' ? <CheckCircle size={16} /> : uploadStatus === 'error' ? <AlertTriangle size={16} /> : <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />}
                  {uploadMsg}
                </div>
              )}

              <button type="submit" disabled={uploading || !file || !name}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium py-3 rounded-xl transition-colors">
                {uploading ? 'Uploading...' : 'Save Template'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}