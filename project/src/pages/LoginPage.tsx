import { useState, FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { QrCode, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/common/Button';
import { Input } from '../components/common/FormField';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function LoginPage() {
  const { signIn, user, profile, loading, isRecoverySession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (loading) return <LoadingSpinner fullScreen />;
  // Don't redirect to dashboard if this is a password recovery session —
  // the user needs to stay and complete the reset on /reset-password
  if (!loading && user && profile && !isRecoverySession) return <Navigate to="/dashboard" replace />;
  if (!loading && isRecoverySession) return <Navigate to="/reset-password" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const { error } = await signIn(email, password);
    if (error) {
      setError('Invalid email or password. Please try again.');
    }
    setIsLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col lg:flex-row">
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 min-h-screen lg:min-h-0">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <QrCode size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100">Nexus</h1>
                <p className="text-xs text-slate-500">Event Access System</p>
              </div>
            </div>
            <h2 className="text-3xl font-bold text-slate-100 mb-2">Welcome back</h2>
            <p className="text-slate-500">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Email address</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
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

            {/* Forgot password link */}
            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            {error && (
              <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              loading={isLoading}
              className="w-full"
              size="lg"
            >
              Sign In
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-600">
            Access is restricted to authorized staff only
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-slate-900 border-l border-slate-800/60 items-center justify-center p-16">
        <div className="max-w-sm text-center">
          <div className="w-24 h-24 rounded-3xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-8">
            <QrCode size={40} className="text-blue-400" />
          </div>
          <h3 className="text-2xl font-bold text-slate-100 mb-3">
            Seamless Event Access
          </h3>
          <p className="text-slate-500 leading-relaxed">
            Manage events, generate personalized invitations, and validate guest entry with QR code scanning.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              { label: 'Events', value: 'Managed' },
              { label: 'Guests', value: 'Invited' },
              { label: 'Access', value: 'Secured' },
            ].map((stat) => (
              <div key={stat.label} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/30">
                <p className="text-sm font-semibold text-slate-200">{stat.value}</p>
                <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}