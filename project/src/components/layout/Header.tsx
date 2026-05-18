import { useAuth } from '../../contexts/AuthContext';
import { getStatusBadge } from '../common/Badge';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  const { profile } = useAuth();

  return (
    // ✅ On mobile: stack title and actions vertically. On sm+: side by side
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6 lg:mb-8">
      <div className="min-w-0">
        <h1 className="text-xl lg:text-2xl font-bold text-slate-100 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {profile && getStatusBadge(profile.role)}
        {actions}
      </div>
    </div>
  );
}