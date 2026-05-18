type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'slate' | 'orange';

interface BadgeProps {
  label: string;
  variant: BadgeVariant;
}

const styles: Record<BadgeVariant, string> = {
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  red: 'bg-red-500/10 text-red-400 border-red-500/20',
  yellow: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

export default function Badge({ label, variant }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[variant]}`}>
      {label}
    </span>
  );
}

export function getStatusBadge(status: string) {
  const map: Record<string, { label: string; variant: BadgeVariant }> = {
    open: { label: 'Open', variant: 'green' },
    locked: { label: 'Locked', variant: 'orange' },
    active: { label: 'Active', variant: 'green' },
    inactive: { label: 'Inactive', variant: 'red' },
    unused: { label: 'Unused', variant: 'blue' },
    used: { label: 'Used', variant: 'slate' },
    super_admin: { label: 'Super Admin', variant: 'blue' },
    event_manager: { label: 'Event Manager', variant: 'green' },
    scanner: { label: 'Scanner', variant: 'yellow' },
    accepted: { label: 'Accepted', variant: 'green' },
    rejected_inactive: { label: 'Rejected', variant: 'red' },
    rejected_used: { label: 'Already Used', variant: 'orange' },
    invalid: { label: 'Invalid', variant: 'red' },
  };
  const config = map[status] || { label: status, variant: 'slate' as BadgeVariant };
  return <Badge label={config.label} variant={config.variant} />;
}
