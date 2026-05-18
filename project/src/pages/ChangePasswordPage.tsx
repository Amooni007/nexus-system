import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/common/Button';
import { Input } from '../components/common/FormField';

export default function ChangePasswordPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [newPassword, setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);

  // Password strength checks
  const checks = {
    length:   newPassword.length >= 8,
    upper:    /[A-Z]/.test(newPassword),
    lower:    /[a-z]/.test(newPassword),
    digit:    /[0-9]/.test(newPassword),
    special:  /[@#$!%^&*]/.test(newPassword),
  };
  const allPassed = Object.values(checks).every(Boolean);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!allPassed) { setError('Password does not meet all requirements.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);

    try {
      // 1. Update password in Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) { setError(updateError.message); setLoading(false); return; }

      // 2. Clear the must_change_password flag
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', profile!.id);

      if (profileError) { setError(profileError.message); setLoading(false); return; }

      // 3. Refresh profile so AuthContext has updated flag
      await refreshProfile();

      setSuccess(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch {
      setError('Something went wrong. Please try again.');
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <KeyRound size={26} className="text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Change Your Password</h1>
          <p className="text-slate-400 text-sm">
            Hi <strong className="text-slate-200">{profile?.full_name}</strong> — you're using a temporary password.
            Please set a new one to continue.
          </p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-center">
            <CheckCircle size={32} className="text-emerald-400" />
            <p className="text-emerald-400 font-semibold">Password updated!</p>
            <p className="text-slate-400 text-sm">Redirecting to dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 bg-slate-900 border border-slate-800 rounded-2xl p-6">

            {/* New Password */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">New Password</label>
              <div className="relative">
                <Input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="pr-12"
                />
                <button type="button" onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Strength indicators */}
            {newPassword && (
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: 'At least 8 characters', ok: checks.length },
                  { label: 'Uppercase letter',       ok: checks.upper  },
                  { label: 'Lowercase letter',       ok: checks.lower  },
                  { label: 'Number',                 ok: checks.digit  },
                  { label: 'Special character',      ok: checks.special },
                ].map((c) => (
                  <div key={c.label} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ${c.ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-500 bg-slate-800'}`}>
                    <CheckCircle size={11} className={c.ok ? 'text-emerald-400' : 'text-slate-600'} />
                    {c.label}
                  </div>
                ))}
              </div>
            )}

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Confirm Password</label>
              <div className="relative">
                <Input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="pr-12"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={11} /> Passwords do not match
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading} disabled={!allPassed}>
              Set New Password
            </Button>

            <button type="button" onClick={signOut}
              className="w-full text-xs text-slate-500 hover:text-slate-400 transition-colors py-1">
              Sign out and log in with a different account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}