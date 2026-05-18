// src/components/ticketing/PaymentSettingsPanel.tsx
// Complete payment configuration for event managers.
// Handles: STK Push toggle, Manual toggle, till/paybill, business name,
// account format, payment timeout.
// Used inside both EventsPage (create modal) and EventDetailPage (edit).

import { useState } from 'react';
import {
  Smartphone, CreditCard, Building2, Clock, Hash,
  Info, AlertTriangle, CheckCircle2, ToggleLeft, ToggleRight,
} from 'lucide-react';

export interface PaymentConfig {
  payment_mode:     'platform_mpesa' | 'host_manual';
  allow_stk_push:   boolean;
  allow_manual:     boolean;
  host_till:        string;
  host_paybill:     string;
  business_name:    string;
  payment_timeout:  number;    // minutes
  account_format:   'name_ref' | 'ref_only' | 'name_only';
}

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  payment_mode:    'platform_mpesa',
  allow_stk_push:  true,
  allow_manual:    false,
  host_till:       '',
  host_paybill:    '',
  business_name:   '',
  payment_timeout: 2,
  account_format:  'name_ref',
};

interface Props {
  config: PaymentConfig;
  onChange: (config: PaymentConfig) => void;
  errors?: Record<string, string>;
}

export default function PaymentSettingsPanel({ config, onChange, errors = {} }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  function update(partial: Partial<PaymentConfig>) {
    const next = { ...config, ...partial };
    // Keep payment_mode in sync with the toggles for backward compat
    next.payment_mode = next.allow_stk_push ? 'platform_mpesa' : 'host_manual';
    onChange(next);
  }

  const hasManualDetails = !!(config.host_till || config.host_paybill);
  const isValid = !config.allow_manual || hasManualDetails;

  return (
    <div className="space-y-4">

      {/* ── STK Push toggle ────────────────────────────────────────────────── */}
      <div className={`border rounded-2xl overflow-hidden transition-all ${
        config.allow_stk_push
          ? 'border-indigo-500/40 bg-indigo-950/20'
          : 'border-slate-700 bg-slate-900/40'
      }`}>
        <button
          type="button"
          onClick={() => update({ allow_stk_push: !config.allow_stk_push })}
          className="w-full flex items-center justify-between px-4 py-3 text-left">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
              config.allow_stk_push ? 'bg-indigo-500/20' : 'bg-slate-800'
            }`}>
              <Smartphone size={16} className={config.allow_stk_push ? 'text-indigo-400' : 'text-slate-500'} />
            </div>
            <div>
              <p className={`text-sm font-semibold ${config.allow_stk_push ? 'text-indigo-300' : 'text-slate-400'}`}>
                M-Pesa STK Push
              </p>
              <p className="text-xs text-slate-500">Auto prompt sent to customer's phone — fastest option</p>
            </div>
          </div>
          {config.allow_stk_push
            ? <ToggleRight size={26} className="text-indigo-400 flex-shrink-0" />
            : <ToggleLeft  size={26} className="text-slate-600 flex-shrink-0" />}
        </button>

        {config.allow_stk_push && (
          <div className="px-4 pb-3 border-t border-indigo-800/30">
            <div className="flex items-start gap-2 mt-3 text-xs text-indigo-300/70 bg-indigo-950/30 rounded-xl p-2.5">
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              STK Push uses your Daraja API credentials configured in Supabase secrets.
              The M-Pesa prompt is sent automatically — no customer action beyond entering their PIN.
            </div>
          </div>
        )}
      </div>

      {/* ── Manual payment toggle ──────────────────────────────────────────── */}
      <div className={`border rounded-2xl overflow-hidden transition-all ${
        config.allow_manual
          ? 'border-emerald-500/40 bg-emerald-950/20'
          : 'border-slate-700 bg-slate-900/40'
      }`}>
        <button
          type="button"
          onClick={() => update({ allow_manual: !config.allow_manual })}
          className="w-full flex items-center justify-between px-4 py-3 text-left">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
              config.allow_manual ? 'bg-emerald-500/20' : 'bg-slate-800'
            }`}>
              <CreditCard size={16} className={config.allow_manual ? 'text-emerald-400' : 'text-slate-500'} />
            </div>
            <div>
              <p className={`text-sm font-semibold ${config.allow_manual ? 'text-emerald-300' : 'text-slate-400'}`}>
                Manual M-Pesa (Till / Paybill)
              </p>
              <p className="text-xs text-slate-500">
                {config.allow_stk_push ? 'Shown as fallback if STK Push fails' : 'Customer pays to till/paybill and enters code'}
              </p>
            </div>
          </div>
          {config.allow_manual
            ? <ToggleRight size={26} className="text-emerald-400 flex-shrink-0" />
            : <ToggleLeft  size={26} className="text-slate-600 flex-shrink-0" />}
        </button>

        {config.allow_manual && (
          <div className="px-4 pb-4 pt-3 border-t border-emerald-800/30 space-y-3">
            {/* Till number */}
            <div>
              <label className="text-slate-400 text-xs font-medium mb-1.5 block">
                Till Number <span className="text-slate-600">(Buy Goods)</span>
              </label>
              <input
                type="text"
                value={config.host_till}
                onChange={e => update({ host_till: e.target.value.replace(/\D/g, '') })}
                placeholder="e.g. 123456"
                maxLength={10}
                className={`w-full bg-slate-900 border rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 font-mono focus:outline-none transition-colors ${
                  errors.host_till ? 'border-red-500' : 'border-slate-700 focus:border-emerald-500'
                }`}
              />
              {errors.host_till && <p className="text-red-400 text-xs mt-1">{errors.host_till}</p>}
            </div>

            {/* Paybill number */}
            <div>
              <label className="text-slate-400 text-xs font-medium mb-1.5 block">
                Paybill Number <span className="text-slate-600">(optional — if you have both, both are shown)</span>
              </label>
              <input
                type="text"
                value={config.host_paybill}
                onChange={e => update({ host_paybill: e.target.value.replace(/\D/g, '') })}
                placeholder="e.g. 400200"
                maxLength={10}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Business name */}
            <div>
              <label className="text-slate-400 text-xs font-medium mb-1.5 block">
                Business / Event Name <span className="text-slate-600">(shown on payment instructions)</span>
              </label>
              <input
                type="text"
                value={config.business_name}
                onChange={e => update({ business_name: e.target.value })}
                placeholder="e.g. Nexus Events Ltd"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Account reference format */}
            <div>
              <label className="text-slate-400 text-xs font-medium mb-1.5 block flex items-center gap-1.5">
                Account Reference Format
                <span className="text-slate-600 font-normal">— what customer types as account number</span>
              </label>
              <div className="space-y-1.5">
                {[
                  {
                    value: 'name_ref' as const,
                    label: 'Name + Reference',
                    example: 'JANE-A1B2C3D4',
                    desc: 'Customer first name + order ID — best for matching',
                  },
                  {
                    value: 'ref_only' as const,
                    label: 'Reference Only',
                    example: 'NX-A1B2C3D4',
                    desc: 'Order ID only — cleaner but no name',
                  },
                  {
                    value: 'name_only' as const,
                    label: 'Name Only',
                    example: 'JANE NJERI',
                    desc: 'Customer name only — hardest to match automatically',
                  },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update({ account_format: opt.value })}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all ${
                      config.account_format === opt.value
                        ? 'border-emerald-500/50 bg-emerald-900/20 text-emerald-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{opt.label}</span>
                      <span className="font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded">{opt.example}</span>
                    </div>
                    <p className="text-slate-500 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Validation warning */}
            {!hasManualDetails && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-500/30 rounded-xl p-3">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Enter at least a Till Number or Paybill Number for manual payments.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Must enable at least one ─────────────────────────────────────────── */}
      {!config.allow_stk_push && !config.allow_manual && (
        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-xl p-3">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          Enable at least one payment method.
        </div>
      )}

      {/* ── Mode summary ─────────────────────────────────────────────────────── */}
      {(config.allow_stk_push || config.allow_manual) && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs space-y-1.5">
          <p className="text-slate-400 font-medium mb-2">Customer payment experience:</p>
          {config.allow_stk_push && config.allow_manual && (
            <>
              <p className="text-slate-300 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" />Primary: M-Pesa STK Push (automatic prompt)</p>
              <p className="text-slate-300 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-amber-400" />Fallback: Manual till/paybill (shown if STK fails)</p>
            </>
          )}
          {config.allow_stk_push && !config.allow_manual && (
            <p className="text-slate-300 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-indigo-400" />STK Push only — no manual fallback</p>
          )}
          {!config.allow_stk_push && config.allow_manual && (
            <p className="text-slate-300 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" />Manual only — customer pays to till/paybill and enters code</p>
          )}
        </div>
      )}

      {/* ── Advanced settings ────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowAdvanced(a => !a)}
        className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors">
        {showAdvanced ? '▲' : '▼'} Advanced settings
      </button>

      {showAdvanced && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
          <div>
            <label className="text-slate-400 text-xs font-medium mb-1.5 block flex items-center gap-1.5">
              <Clock size={12} /> STK Push Timeout
              <span className="text-slate-600 font-normal">(minutes before fallback is shown)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="5"
                value={config.payment_timeout}
                onChange={e => update({ payment_timeout: Number(e.target.value) })}
                className="flex-1 accent-indigo-500"
              />
              <span className="text-white text-sm font-mono w-12 text-right">
                {config.payment_timeout} min{config.payment_timeout > 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-slate-600 text-xs mt-1">
              Safaricom's maximum is 2 minutes. Setting higher just extends how long we poll.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper: build account reference for a given customer/order ────────────────
export function buildAccountReference(
  format: PaymentConfig['account_format'],
  customerName: string,
  orderId: string
): string {
  const ref    = orderId.slice(0, 8).toUpperCase();
  const fname  = customerName.trim().split(' ')[0].toUpperCase().slice(0, 10);

  switch (format) {
    case 'name_ref':  return `${fname}-${ref}`;
    case 'ref_only':  return `NX-${ref}`;
    case 'name_only': return fname;
    default:          return `NX-${ref}`;
  }
}

// ── Helper: extract order ID from account reference ───────────────────────────
// Used by C2B callback to find the order from BillRefNumber
export function extractOrderPrefix(billRefNumber: string): string | null {
  // Handles formats: JANE-A1B2C3D4, NX-A1B2C3D4, A1B2C3D4
  const parts = billRefNumber.toUpperCase().split('-');
  const candidate = parts[parts.length - 1]; // last segment
  if (/^[A-F0-9]{8}$/i.test(candidate)) return candidate.toLowerCase();
  return null;
}