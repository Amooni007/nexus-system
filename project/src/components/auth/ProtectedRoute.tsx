import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading, profileError, mustChangePassword, isRecoverySession } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner fullScreen />;

  // Recovery sessions must ONLY access /reset-password.
  // Block them from all protected routes to prevent session fixation.
  if (isRecoverySession) return <Navigate to="/reset-password" replace />;

  if (!user) return <Navigate to="/login" replace />;

  if (profileError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-center space-y-3 px-6 max-w-sm">
          <p className="text-slate-200 font-semibold">Unable to load your profile</p>
          <p className="text-slate-500 text-sm">
            There was a problem connecting to the database. Please refresh the page or try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  if (!profile) return <LoadingSpinner fullScreen />;
  if (!profile.is_active) return <Navigate to="/login" replace />;

  // ✅ If staff must change password, redirect to change-password page
  // Allow access to /change-password itself to avoid redirect loop
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}