// src/pages/ForgotPasswordPage.tsx
import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, Mail, ArrowLeft, AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function ForgotPasswordPage() {
  const [email,       setEmail]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sent,        setSent]        = useState(false);
  const [error,       setError]       = useState('');
  const [resendTimer, setResendTimer] = useState(0);

  // Countdown timer for resend button
  function startResendTimer() {
    setResendTimer(60);
    const interval = setInterval(() => {
      setResendTimer(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email address'); return; }
    setError(''); setLoading(true);

    // Always use current origin — works on localhost, ngrok, and production
    const redirectTo = window.location.origin + '/reset-password';

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    setLoading(false);

    if (authError) {
      // Don't reveal whether email exists — show generic success anyway (security best practice)
      // But do show real config errors
      if (authError.message.includes('rate') || authError.message.includes('limit')) {
        setError('Too many requests. Please wait a few minutes before trying again.');
        return;
      }
    }

    // Always show success (prevents email enumeration)
    setSent(true);
    startResendTimer();
  }

  async function handleResend() {
    if (resendTimer > 0) return;
    setLoading(true);

    // Always use current origin — works on localhost, ngrok, and production
    const redirectTo = window.location.origin + '/reset-password';

    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setLoading(false);
    startResendTimer();
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col lg:flex-row">
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 min-h-screen lg:min-h-0">
        <div className="w-full max-w-md">

          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <QrCode size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100">Nexus</h1>
              <p className="text-xs text-slate-500">Event Access System</p>
            </div>
          </div>

          {!sent ? (
            <>
              {/* Header */}
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-100 mb-2">Forgot password?</h2>
                <p className="text-slate-500 leading-relaxed">
                  Enter your email address and we'll send you a link to reset your password.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-300">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(''); }}
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                      autoFocus
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-all"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
                >
                  {loading ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : 'Send Reset Link'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link to="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                  <ArrowLeft size={14} /> Back to sign in
                </Link>
              </div>
            </>
          ) : (
            /* Success state */
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 size={32} className="text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-100 mb-2">Check your email</h2>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    We sent a password reset link to
                  </p>
                  <p className="text-white font-semibold mt-1">{email}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2 text-sm text-slate-400">
                <p className="flex items-start gap-2"><span className="text-slate-500 mt-0.5">1.</span> Open the email from Nexus / Supabase</p>
                <p className="flex items-start gap-2"><span className="text-slate-500 mt-0.5">2.</span> Click the <strong className="text-slate-200">"Reset Password"</strong> button</p>
                <p className="flex items-start gap-2"><span className="text-slate-500 mt-0.5">3.</span> Enter your new password</p>
                <p className="flex items-start gap-2"><span className="text-slate-500 mt-0.5">4.</span> The link expires in <strong className="text-slate-200">1 hour</strong></p>
              </div>

              <div className="space-y-3">
                <p className="text-center text-xs text-slate-500">Didn't receive the email? Check your spam folder.</p>
                <button
                  onClick={handleResend}
                  disabled={resendTimer > 0 || loading}
                  className="w-full flex items-center justify-center gap-2 border border-slate-700 hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 hover:text-white font-medium py-2.5 px-4 rounded-xl transition-colors text-sm"
                >
                  {loading
                    ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                    : resendTimer > 0
                      ? <><RefreshCw size={14} /> Resend in {resendTimer}s</>
                      : <><RefreshCw size={14} /> Resend email</>}
                </button>
              </div>

              <div className="text-center">
                <Link to="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                  <ArrowLeft size={14} /> Back to sign in
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="hidden lg:flex flex-1 bg-slate-900 border-l border-slate-800/60 items-center justify-center p-16">
        <div className="max-w-sm text-center">
          <div className="w-24 h-24 rounded-3xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-8">
            <QrCode size={40} className="text-blue-400" />
          </div>
          <h3 className="text-2xl font-bold text-slate-100 mb-3">Secure Access</h3>
          <p className="text-slate-500 leading-relaxed">
            Reset links expire after 1 hour for your security. Contact your administrator if you continue to have issues.
          </p>
        </div>
      </div>
    </div>
  );
}