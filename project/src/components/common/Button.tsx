import { Loader2 } from 'lucide-react';
import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white border-transparent',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
  danger: 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border-red-600/20',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-transparent',
  success: 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border-emerald-600/20',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-medium rounded-xl border
        transition-all duration-150 cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
