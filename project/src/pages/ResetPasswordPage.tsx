// src/pages/ResetPasswordPage.tsx
// Secure password reset — only accessible via a valid recovery link.
// The session is ONLY used to call updateUser(). After success, the session
// is fully cleared — user must log in fresh with their new password.

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  QrCode, Eye, EyeOff, AlertCircle, CheckCircle2,
  Loader2, Lock, ShieldCheck,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface StrengthResult {
  score: number;
  label: string;
  color: string;
  barColor: string;
  checks: { label: string; passed: boolean }[];
}

function checkStrength(password: string): StrengthResult {
  const checks = [
    { label: 'At least 8 characters',     passed: password.length >= 8 },
    { label: 'Contains uppercase letter',  passed: /[A-Z]/.test(password) },
    { label: 'Contains lowercase letter',  passed: /[a-z]/.test(password) },
    { label: 'Contains number',            passed: /\d/.test(password) },
    { label: 'Contains special character', passed: /[^A-Za-z0-9]/.test(password) },
  ];
  const score  = checks.filter(c => c.passed).length;
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['text-red-400', 'text-orange-400', 'text-amber-400', 'text-emerald-400', 'text-emerald-400'];
  const bars   = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-500'];
  return { score, label: labels[score], color: colors[score], barColor: bars[score], checks };
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { isRecoverySession } = useAuth();

  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [success,         setSuccess]         = useState(false);
  const [error,           setError]           = useState('');
  const [invalidLink,     setInvalidLink]     = useState(false);
  const [countdown,       setCountdown]       = useState(5);

  // Track whether we've confirmed a valid recovery session
  // Use ref so the setTimeout closure always reads the current value
  const sessionConfirmedRef = useRef(false);

  const strength = checkStrength(password);

  useEffect(() => {
    // If AuthContext already detected the recovery URL hash, we're good immediately
    if (isRecoverySession) {
      sessionConfirmedRef.current = true;
      return;
    }

    // Listen for the PASSWORD_RECOVERY event as a secondary confirmation
    // (fires when Supabase exchanges the URL token for a session)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionConfirmedRef.current = true;
      }
    });

    // If neither AuthContext nor onAuthStateChange confirms recovery within
    // 6 seconds, the link is expired or invalid
    const timeout = setTimeout(() => {
      if (!sessionConfirmedRef.current) {
        setInvalidLink(true);
      }
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [isRecoverySession]);

  // Auto-redirect countdown after success
  useEffect(() => {
    if (!success) return;
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); navigate('/login'); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [success, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (strength.score < 2) { setError('Please choose a stronger password.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      if (updateError.message.toLowerCase().includes('same password')) {
        setError('New password must be different from your current password.');
      } else if (
        updateError.message.toLowerCase().includes('expired') ||
        updateError.message.toLowerCase().includes('invalid')
      ) {
        setInvalidLink(true);
      } else {
        setError(updateError.message || 'Failed to update password. Please try again.');
      }
      return;
    }

    // SUCCESS: explicitly sign out everywhere.
    // AuthContext handles USER_UPDATED event and clears the session,
    // but we also call signOut here as a belt-and-suspenders measure.
    // User must now log in fresh with their new password.
    await supabase.auth.signOut({ scope: 'global' });
    setSuccess(true);
  }

  // ── Invalid / expired link ─────────────────────────────────────────────────
  if (invalidLink) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <AlertCircle size={32} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Link Expired or Invalid</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              This password reset link has expired or has already been used.
              Reset links are valid for 1 hour.
            </p>
          </div>
          <Link to="/forgot-password"
            className="inline-flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
            Request a New Reset Link
          </Link>
          <Link to="/login" className="block text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 size={40} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Password Updated!</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Your password has been changed. You have been signed out of all
              sessions — please sign in with your new password.
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
            <p className="text-slate-400 text-sm">Redirecting to login in</p>
            <p className="text-4xl font-bold text-blue-400 mt-1">{countdown}</p>
          </div>
          <button onClick={() => navigate('/login')}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  // ── Waiting for recovery session ───────────────────────────────────────────
  // Show form immediately if isRecoverySession is already true (from URL hash detection).
  // Only show spinner if we're waiting for the onAuthStateChange event.
  if (!isRecoverySession && !sessionConfirmedRef.current) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="text-blue-400 animate-spin mx-auto" size={40} />
          <p className="text-slate-400 text-sm">Verifying reset link…</p>
          <p className="text-slate-600 text-xs">This may take a few seconds</p>
        </div>
      </div>
    );
  }

  // ── Password reset form ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col lg:flex-row">
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 min-h-screen lg:min-h-0">
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

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-100 mb-2">Set new password</h2>
            <p className="text-slate-500">Choose a strong password for your account.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* New password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="Enter new password"
                  required autoFocus
                  className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-12 py-3 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {password && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Password strength</span>
                    <span className={'text-xs font-semibold ' + strength.color}>{strength.label}</span>
                  </div>
                  <div className="flex gap-1">
                    {[0,1,2,3,4].map(i => (
                      <div key={i} className={'h-1.5 flex-1 rounded-full transition-all duration-300 ' +
                        (i < strength.score ? strength.barColor : 'bg-slate-700')} />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-1 mt-1">
                    {strength.checks.map(c => (
                      <div key={c.label} className="flex items-center gap-2 text-xs">
                        <div className={'w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ' +
                          (c.passed ? 'bg-emerald-500' : 'bg-slate-700')}>
                          {c.passed && <CheckCircle2 size={9} className="text-white" />}
                        </div>
                        <span className={c.passed ? 'text-slate-300' : 'text-slate-600'}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                  placeholder="Repeat new password"
                  required
                  className={'w-full bg-slate-800/80 border rounded-xl pl-10 pr-12 py-3 text-slate-100 placeholder-slate-500 text-sm focus:outline-none transition-all ' +
                    (confirmPassword && password !== confirmPassword
                      ? 'border-red-500/60 focus:border-red-500'
                      : confirmPassword && password === confirmPassword
                        ? 'border-emerald-500/60 focus:border-emerald-500'
                        : 'border-slate-700 focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30')}
                />
                <button type="button" onClick={() => setShowConfirm(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                {confirmPassword && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2">
                    {password === confirmPassword
                      ? <CheckCircle2 size={15} className="text-emerald-400" />
                      : <AlertCircle size={15} className="text-red-400" />}
                  </div>
                )}
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-red-400 text-xs">Passwords do not match</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <ShieldCheck size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
              You will be signed out of all sessions after changing your password. Sign in again with your new password.
            </div>

            <button
              type="submit"
              disabled={loading || strength.score < 2 || password !== confirmPassword}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm">
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Updating password…</>
                : 'Update Password'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/login" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-slate-900 border-l border-slate-800/60 items-center justify-center p-16">
        <div className="max-w-sm text-center">
          <div className="w-24 h-24 rounded-3xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-8">
            <ShieldCheck size={40} className="text-blue-400" />
          </div>
          <h3 className="text-2xl font-bold text-slate-100 mb-3">Secure Password Reset</h3>
          <p className="text-slate-500 leading-relaxed">
            You will be signed out of all sessions after resetting.
            Sign in again with your new password.
          </p>
        </div>
      </div>
    </div>
  );
}