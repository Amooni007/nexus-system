import { useState, useEffect, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { QrCode, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import Button from '../components/common/Button';
import { Input } from '../components/common/FormField';

export default function SetupPage() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    fetch(`${supabaseUrl}/functions/v1/setup-admin`)
      .then((r) => r.json())
      .then((d) => setSetupRequired(d.setup_required))
      .catch(() => setSetupRequired(false));
  }, [supabaseUrl]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/setup-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Setup failed');
      } else {
        setSuccess(true);
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSubmitting(false);
  }

  if (setupRequired === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
      </div>
    );
  }

  if (setupRequired === false && !success) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <QrCode size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Nexus</h1>
            <p className="text-xs text-slate-500">Event Access System</p>
          </div>
        </div>

        {success ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-100">Setup Complete!</h2>
            <p className="text-slate-500">Super admin account has been created. You can now sign in.</p>
            <Button onClick={() => window.location.href = '/login'} className="w-full mt-4" size="lg">
              Go to Login
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-slate-100 mb-2">Initial Setup</h2>
              <p className="text-slate-500">Create your Super Admin account to get started.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">Full Name</label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Your full name"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">Email Address</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="admin@example.com"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Min. 8 characters"
                    required
                    minLength={8}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <Button type="submit" loading={submitting} className="w-full" size="lg">
                Create Super Admin
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
