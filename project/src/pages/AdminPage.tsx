import { useEffect, useState } from 'react';
import { UserPlus, Power, ShieldCheck, Trash2, Copy, CheckCircle, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/layout/Layout';
import Header from '../components/layout/Header';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import { getStatusBadge } from '../components/common/Badge';
import FormField, { Input, Select } from '../components/common/FormField';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { logActivity } from '../lib/logger';
import { format } from 'date-fns';
import type { Profile } from '../types';

interface CreateStaffForm {
  full_name: string;
  email: string;
  role: 'event_manager' | 'scanner';
}

export default function AdminPage() {
  const { profile: currentUser, loading } = useAuth();

  const [staff, setStaff] = useState<Profile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<CreateStaffForm>({
    full_name: '',
    email: '',
    role: 'event_manager',
  });
  const [errors, setErrors] = useState<Partial<CreateStaffForm>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // PHASE 6 FIX: Store invite URL instead of plaintext password
  const [createdCredentials, setCreatedCredentials] = useState<{
    name: string; email: string; inviteUrl: string; emailSent: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // ✅ Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => { loadStaff(); }, []);

  if (!loading && (!currentUser || currentUser.role !== 'super_admin')) {
    return (
      <Layout>
        <div className="p-6 text-red-400 font-medium">Access Denied</div>
      </Layout>
    );
  }

  async function loadStaff() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('role', 'super_admin')
      .order('created_at', { ascending: false });
    setStaff(data || []);
  }

  function validate(): boolean {
    const errs: Partial<CreateStaffForm> = {};
    if (!formData.full_name.trim()) errs.full_name = 'Name is required';
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      errs.email = 'Valid email required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ✅ Create staff — no password input needed, auto-generated server-side
  async function handleCreateStaff() {
    if (!currentUser || currentUser.role !== 'super_admin') return;
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError('');

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.access_token) {
        setSubmitError('Session expired. Please log in again.');
        setSubmitting(false);
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${freshSession.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setSubmitError(data.error || 'Failed to create staff member');
      } else {
        await logActivity(currentUser.id, 'create_staff', 'profile', data.user_id, {
          email: formData.email, role: formData.role,
        });

        // PHASE 6 FIX: Show invite URL — never store or display plaintext password
        // The create-staff Edge Function returns temp_password for backward compat
        // but we deliberately do NOT display it. Instead show the login URL.
        setCreatedCredentials({
          name:      formData.full_name,
          email:     formData.email,
          inviteUrl: 'https://nexus-system.pages.dev/login',
          emailSent: data.email_sent,
        });

        setIsModalOpen(false);
        setFormData({ full_name: '', email: '', role: 'event_manager' });
        loadStaff();
      }
    } catch {
      setSubmitError('Network error. Please try again.');
    }

    setSubmitting(false);
  }

  async function toggleActive(member: Profile) {
    if (!currentUser || currentUser.role !== 'super_admin') return;
    // SERVER-SIDE: toggle_profile_active RPC validates super_admin role
    const { data: toggleData, error: toggleErr } = await supabase.rpc('toggle_profile_active', {
      p_target_id: member.id,
      p_staff_id:  currentUser!.id,
    });
    if (toggleErr) { alert('Failed to update staff status'); return; }
    if (!toggleData?.success) { alert(toggleData?.error || 'Failed to update'); return; }
    await logActivity(
      currentUser.id,
      member.is_active ? 'deactivate_staff' : 'activate_staff',
      'profile', member.id
    );
    loadStaff();
  }

  // ✅ Permanent delete via Edge Function
  async function handleDelete() {
    if (!deleteTarget || deleteConfirmText !== deleteTarget.full_name) return;
    setDeleting(true);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.access_token) return;

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${freshSession.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: deleteTarget.id }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        alert(`Delete failed: ${data.error}`);
      } else {
        await logActivity(currentUser!.id, 'delete_staff', 'profile', deleteTarget.id, {
          email: deleteTarget.email,
        });
        setDeleteTarget(null);
        setDeleteConfirmText('');
        loadStaff();
      }
    } catch {
      alert('Network error. Please try again.');
    }

    setDeleting(false);
  }

  // copyPassword removed — passwords no longer displayed in UI (Phase 6)

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header
        title="Admin Panel"
        subtitle="Manage staff accounts and system access"
        actions={
          <Button icon={<UserPlus size={16} />} onClick={() => setIsModalOpen(true)}>
            Add Staff
          </Button>
        }
      />

      <div className="bg-slate-900 rounded-2xl border border-slate-800/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/60 flex items-center gap-2">
          <ShieldCheck size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-200">Staff Members ({staff.length})</h2>
        </div>

        {staff.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <UserPlus size={32} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No staff members yet</p>
            <p className="text-slate-600 text-sm mt-1">Add staff to give them access to the system</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {staff.map((member) => (
              <div key={member.id} className="flex items-start sm:items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 hover:bg-slate-800/20 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-slate-300">
                    {member.full_name.charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-200 truncate">{member.full_name}</p>
                    {/* ✅ Show badge if staff must change password */}
                    {(member as any).must_change_password && (
                      <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                        <KeyRound size={10} />
                        Temp Password
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{member.email}</p>
                  <p className="text-xs text-slate-600">Added {format(new Date(member.created_at), 'MMM d, yyyy')}</p>
                </div>

                {/* MOBILE-01 FIX: Stack badge + actions vertically on mobile */}
                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 flex-shrink-0">
                  {getStatusBadge(member.role)}
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant={member.is_active ? 'danger' : 'success'}
                      size="sm"
                      icon={<Power size={13} />}
                      onClick={() => toggleActive(member)}
                    >
                      <span className="hidden sm:inline">{member.is_active ? 'Deactivate' : 'Activate'}</span>
                      <span className="sm:hidden">{member.is_active ? 'Off' : 'On'}</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={13} />}
                      onClick={() => { setDeleteTarget(member); setDeleteConfirmText(''); }}
                    >
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── CREATE STAFF MODAL ── */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setErrors({}); setSubmitError(''); }}
        title="Create Staff Member"
      >
        <div className="space-y-4">
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-400">
            A secure temporary password will be auto-generated and shown to you after creation.
          </div>

          <FormField label="Full Name" error={errors.full_name} required>
            <Input
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="Jane Smith"
            />
          </FormField>

          <FormField label="Email" error={errors.email} required>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="jane@example.com"
            />
          </FormField>

          <FormField label="Role" required>
            <Select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'event_manager' | 'scanner' })}
            >
              <option value="event_manager">Event Manager</option>
              <option value="scanner">Scanner Staff</option>
            </Select>
          </FormField>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleCreateStaff} loading={submitting}>Create Staff</Button>
          </div>
        </div>
      </Modal>

      {/* ── CREDENTIALS MODAL (shown after creation) ── */}
      <Modal
        isOpen={!!createdCredentials}
        onClose={() => setCreatedCredentials(null)}
        title="Staff Account Created"
      >
        {createdCredentials && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-400">
                Account created for <strong>{createdCredentials.name}</strong>.
                {createdCredentials.emailSent
                  ? ' Login details sent to their email.'
                  : ' Share the password below manually.'}
              </p>
            </div>

            <div className="bg-slate-800 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Email</p>
                <p className="text-sm text-slate-200 font-mono">{createdCredentials.email}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Login URL to share</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm text-blue-300 font-mono bg-slate-900 px-3 py-2 rounded-lg border border-slate-700 select-all">
                    {createdCredentials.inviteUrl}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(createdCredentials.inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/20 text-blue-400 text-xs rounded-lg transition-colors"
                  >
                    {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
              <p className="text-xs text-blue-400">
                📧 A login email has been sent to {createdCredentials.email}. They will be required to change their password on first login. Do not share passwords over chat or email.
              </p>
            </div>

            <Button className="w-full" onClick={() => setCreatedCredentials(null)}>Done</Button>
          </div>
        )}
      </Modal>

      {/* ── DELETE CONFIRMATION MODAL ── */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteConfirmText(''); }}
        title="Permanently Delete Staff Member"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-sm text-red-400">
                This will <strong>permanently delete</strong> <strong>{deleteTarget.full_name}</strong>'s account and remove all their access. This action cannot be undone.
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-400 mb-2">
                Type <strong className="text-slate-200">{deleteTarget.full_name}</strong> to confirm:
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteTarget.full_name}
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => { setDeleteTarget(null); setDeleteConfirmText(''); }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                icon={<Trash2 size={14} />}
                onClick={handleDelete}
                loading={deleting}
                disabled={deleteConfirmText !== deleteTarget.full_name}
              >
                Delete Permanently
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}