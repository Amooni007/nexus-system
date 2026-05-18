import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { TicketCategoryConfig } from '../../types/ticketing';

interface Props {
  categories: TicketCategoryConfig[];
  onChange: (cats: TicketCategoryConfig[]) => void;
}

const PRESETS: TicketCategoryConfig[] = [
  { name: 'VVIP', price: 5000, quantity: 50, access_zone: 'Front Stage', template_style: 'gold', description: 'Premium front access + perks' },
  { name: 'VIP', price: 2500, quantity: 100, access_zone: 'VIP Section', template_style: 'silver', description: 'Priority access' },
  { name: 'Regular', price: 1000, quantity: 500, access_zone: 'General Area', template_style: 'standard', description: 'Standard entry' },
];

const STYLE_OPTIONS = ['gold', 'silver', 'standard', 'custom'];

export default function TicketCategoryManager({ categories, onChange }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  function addPreset(preset: TicketCategoryConfig) {
    if (categories.find(c => c.name === preset.name)) return;
    onChange([...categories, { ...preset }]);
  }

  function addCustom() {
    onChange([...categories, {
      name: `Category ${categories.length + 1}`,
      price: 0,
      quantity: 100,
      access_zone: '',
      template_style: 'standard',
      description: '',
    }]);
  }

  function update(index: number, field: keyof TicketCategoryConfig, value: unknown) {
    const updated = [...categories];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  function remove(index: number) {
    onChange(categories.filter((_, i) => i !== index));
  }

  const usedPresetNames = categories.map(c => c.name);

  return (
    <div className="space-y-4">
      {/* Quick add presets */}
      <div>
        <p className="text-slate-400 text-xs mb-2 font-medium">Quick Add</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => addPreset(p)}
              disabled={usedPresetNames.includes(p.name)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors
                ${usedPresetNames.includes(p.name)
                  ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                  : p.name === 'VVIP'
                    ? 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-900/30'
                    : p.name === 'VIP'
                      ? 'border-slate-400/50 text-slate-300 hover:bg-slate-700/50'
                      : 'border-blue-500/50 text-blue-400 hover:bg-blue-900/30'}`}
            >
              + {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={addCustom}
            className="text-xs px-3 py-1.5 rounded-lg border border-purple-500/50 text-purple-400 hover:bg-purple-900/30 font-medium transition-colors"
          >
            + Custom
          </button>
        </div>
      </div>

      {/* Category list */}
      {categories.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-4 border border-dashed border-slate-700 rounded-xl">
          Add ticket categories above to enable paid ticketing.
        </p>
      )}

      <div className="space-y-2">
        {categories.map((cat, i) => {
          const isOpen = expanded === i;
          return (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                <div className="flex-1">
                  <span className="font-semibold text-white text-sm">{cat.name}</span>
                  <span className="text-slate-400 text-xs ml-2">
                    KES {(cat.price || 0).toLocaleString()} · {cat.quantity} tickets
                  </span>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); remove(i); }}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </div>

              {isOpen && (
                <div className="border-t border-slate-700 px-4 py-3 grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">Category Name</label>
                    <input
                      type="text"
                      value={cat.name}
                      onChange={e => update(i, 'name', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Price (KES)</label>
                    <input
                      type="number"
                      min="0"
                      value={cat.price}
                      onChange={e => update(i, 'price', parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Max Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={cat.quantity}
                      onChange={e => update(i, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Access Zone</label>
                    <input
                      type="text"
                      value={cat.access_zone || ''}
                      onChange={e => update(i, 'access_zone', e.target.value)}
                      placeholder="e.g. Front Stage"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Template Style</label>
                    <select
                      value={cat.template_style || 'standard'}
                      onChange={e => update(i, 'template_style', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      {STYLE_OPTIONS.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">Description (optional)</label>
                    <input
                      type="text"
                      value={cat.description || ''}
                      onChange={e => update(i, 'description', e.target.value)}
                      placeholder="e.g. Priority access + welcome drink"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}