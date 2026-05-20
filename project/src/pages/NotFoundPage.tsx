// src/pages/NotFoundPage.tsx
// PHASE 5 / PHASE 7 — Proper 404 page
// Previously unknown routes silently redirected to /dashboard.
// This exposed dashboard existence to unauthenticated users and
// hid broken link bugs from developers.

import { Link } from 'react-router-dom';
import { QrCode, ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mb-6">
        <QrCode size={22} className="text-slate-500" />
      </div>
      <h1 className="text-6xl font-bold text-slate-700 mb-3">404</h1>
      <h2 className="text-xl font-semibold text-slate-300 mb-2">Page Not Found</h2>
      <p className="text-slate-500 text-sm max-w-xs mb-8 leading-relaxed">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
      >
        <ArrowLeft size={15} /> Go to Dashboard
      </Link>
    </div>
  );
}