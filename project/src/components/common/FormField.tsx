import React from 'react';

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export default function FormField({ label, error, required, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-300">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`
        w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border text-slate-100
        placeholder-slate-500 text-sm transition-colors outline-none
        focus:ring-2 focus:ring-blue-500/30
        ${error ? 'border-red-500/50 focus:border-red-500' : 'border-slate-700 focus:border-blue-500/50'}
        ${className}
      `}
    />
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ error, children, className = '', ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={`
        w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border text-slate-100
        text-sm transition-colors outline-none
        focus:ring-2 focus:ring-blue-500/30
        ${error ? 'border-red-500/50 focus:border-red-500' : 'border-slate-700 focus:border-blue-500/50'}
        ${className}
      `}
    >
      {children}
    </select>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, className = '', ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      className={`
        w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border text-slate-100
        placeholder-slate-500 text-sm transition-colors outline-none resize-none
        focus:ring-2 focus:ring-blue-500/30
        ${error ? 'border-red-500/50 focus:border-red-500' : 'border-slate-700 focus:border-blue-500/50'}
        ${className}
      `}
    />
  );
}
