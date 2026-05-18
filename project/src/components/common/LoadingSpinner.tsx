interface LoadingSpinnerProps {
  fullScreen?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function LoadingSpinner({ fullScreen, size = 'md' }: LoadingSpinnerProps) {
  const sizes = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' };

  const spinner = (
    <div className={`${sizes[size]} animate-spin rounded-full border-2 border-slate-200 border-t-blue-500`} />
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950">
        {spinner}
      </div>
    );
  }

  return spinner;
}
