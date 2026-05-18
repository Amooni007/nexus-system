import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';

import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import GuestsPage from './pages/GuestsPage';
import GuestDetailPage from './pages/GuestDetailPage';
import QRCodesPage from './pages/QRCodesPage';
import ScannerPage from './pages/ScannerPage';
import ScanLogsPage from './pages/ScanLogsPage';
import AdminPage from './pages/AdminPage';
import InvitationPage from './pages/InvitationPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import TemplatePage from './pages/TemplatePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage'; // MED-01 FIX: corrected filename
import ResetPasswordPage from './pages/ResetPasswordPage';

// ── Ticketing Extension ───────────────────────────────────────────────────────
import PublicTicketPage from './pages/PublicTicketPage';
import TicketOrdersPage from './pages/TicketOrdersPage';
import TicketsListPage from './pages/TicketsListPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invitation/:guestId" element={<InvitationPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* ── Public ticket purchase (no auth required) ── */}
          <Route path="/event/:id/tickets" element={<PublicTicketPage />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/events"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <EventsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/events/:id"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <EventDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/guests"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <GuestsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/guests/:id"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <GuestDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/qrcodes"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <QRCodesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/scanner"
            element={
              <ProtectedRoute>
                <ScannerPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/logs"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <ScanLogsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['super_admin']}>
                <AdminPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/templates"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <TemplatePage />
              </ProtectedRoute>
            }
          />

          {/* ── Ticketing admin routes ── */}
          <Route
            path="/events/:id/orders"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <TicketOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events/:id/ticket-list"
            element={
              <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
                <TicketsListPage />
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}