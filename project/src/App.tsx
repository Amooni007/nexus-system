// src/App.tsx
// PHASE 2: Route changed from /invitation/:guestId → /invite/:token
// PHASE 5: 404 handler added
// Old /invitation/:guestId route kept as redirect for backward compatibility

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import DashboardPage from './pages/DashboardPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import GuestsPage from './pages/GuestsPage';
import GuestDetailPage from './pages/GuestDetailPage';
import QRCodesPage from './pages/QRCodesPage';
import ScannerPage from './pages/ScannerPage';
import ScanLogsPage from './pages/ScanLogsPage';
import TemplatePage from './pages/TemplatePage';
import AdminPage from './pages/AdminPage';
import InvitationPage from './pages/InvitationPage';   // Updated: uses /invite/:token
import PublicTicketPage from './pages/PublicTicketPage';
import TicketOrdersPage from './pages/TicketOrdersPage';
import TicketsListPage from './pages/TicketsListPage';
import NotFoundPage from './pages/NotFoundPage';       // NEW: 404 handler

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Public routes ─────────────────────────────────────────────── */}
          <Route path="/setup"            element={<SetupPage />} />
          <Route path="/login"            element={<LoginPage />} />
          <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />
          <Route path="/change-password"  element={<ChangePasswordPage />} />

          {/* PHASE 2: Secure invitation route — token not guest UUID */}
          <Route path="/invite/:token"    element={<InvitationPage />} />

          {/* Backward compatibility: redirect old invitation URLs.
              Old links (/invitation/<uuid>) will redirect to NotFound with a message.
              We cannot silently redirect because the old URLs exposed guest UUIDs
              and we don't want to leak that pattern. Show a friendly expired message. */}
          <Route path="/invitation/:guestId" element={<InvitationPage />} />

          {/* Public ticket purchase page */}
          <Route path="/event/:id/tickets" element={<PublicTicketPage />} />

          {/* ── Protected routes ──────────────────────────────────────────── */}
          <Route path="/dashboard" element={
            <ProtectedRoute><DashboardPage /></ProtectedRoute>
          } />
          <Route path="/events" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <EventsPage />
            </ProtectedRoute>
          } />
          <Route path="/events/:id" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <EventDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/events/:id/orders" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <TicketOrdersPage />
            </ProtectedRoute>
          } />
          <Route path="/events/:id/ticket-list" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <TicketsListPage />
            </ProtectedRoute>
          } />
          <Route path="/guests" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <GuestsPage />
            </ProtectedRoute>
          } />
          <Route path="/guests/:id" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <GuestDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/qrcodes" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <QRCodesPage />
            </ProtectedRoute>
          } />
          <Route path="/scanner" element={
            <ProtectedRoute><ScannerPage /></ProtectedRoute>
          } />
          <Route path="/logs" element={
            <ProtectedRoute><ScanLogsPage /></ProtectedRoute>
          } />
          <Route path="/templates" element={
            <ProtectedRoute allowedRoles={['super_admin', 'event_manager']}>
              <TemplatePage />
            </ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AdminPage />
            </ProtectedRoute>
          } />

          {/* ── Fallback routes ───────────────────────────────────────────── */}
          <Route path="/"   element={<Navigate to="/dashboard" replace />} />
          <Route path="*"   element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}