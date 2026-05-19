import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  profileError: boolean;
  mustChangePassword: boolean;
  isRecoverySession: boolean; // true when opened via password reset link
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]               = useState<User | null>(null);
  const [profile, setProfile]         = useState<Profile | null>(null);
  const [session, setSession]         = useState<Session | null>(null);
  const [loading, setLoading]         = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isRecoverySession, setIsRecoverySession] = useState(false);
  const mountedRef  = useRef(true);
  const fetchingRef = useRef(false);

  async function fetchProfile(userId: string): Promise<void> {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      if (!mountedRef.current) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!mountedRef.current) return;

      if (error) {
        setProfileError(true);
        setProfile(null);
      } else {
        setProfileError(false);

        // Block inactive users
        if (data && data.is_active === false) {
          await supabase.auth.signOut();
          setProfile(null);
          setUser(null);
          setSession(null);
          setMustChangePassword(false);
          return;
        }

        setProfile(data);
        // ✅ Read must_change_password flag from profile
        setMustChangePassword(data?.must_change_password === true);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setProfileError(true);
      setProfile(null);
    } finally {
      fetchingRef.current = false;
    }
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  useEffect(() => {
    mountedRef.current = true;

    // ── SECURITY FIX: Detect recovery session from URL hash BEFORE getSession ──
    // When a user clicks a password reset link, Supabase appends:
    //   #access_token=...&type=recovery
    // to the URL. We must detect this FIRST before calling getSession(),
    // because getSession() would otherwise establish a full authenticated
    // session, letting the user bypass the password reset form entirely.
    const hashParams = new URLSearchParams(
      window.location.hash.replace('#', '?')
    );
    const isRecoveryFromUrl = hashParams.get('type') === 'recovery';

    if (isRecoveryFromUrl) {
      // Mark as recovery immediately — don't fetch profile or set full session.
      // The onAuthStateChange PASSWORD_RECOVERY event will fire shortly after
      // and provide the session needed for supabase.auth.updateUser() to work.
      setIsRecoverySession(true);
      setLoading(false);
      // Don't call getSession() — fall through to onAuthStateChange only
    } else {
      // Normal startup: check for existing session and load profile
      supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
        if (!mountedRef.current) return;
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession?.user) await fetchProfile(initialSession.user.id);
        if (mountedRef.current) setLoading(false);
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'INITIAL_SESSION') return;
      if (!mountedRef.current) return;

      if (event === 'PASSWORD_RECOVERY') {
        // Recovery token exchanged — session exists for updateUser() only.
        // Do NOT fetch profile or allow navigation to protected routes.
        setIsRecoverySession(true);
        setSession(newSession);
        setUser(newSession?.user ?? null);
        // Profile deliberately not fetched — user has not logged in normally
        setLoading(false);
        return;
      }

      if (event === 'USER_UPDATED') {
        // Password was just changed via updateUser().
        // Sign out completely so user must log in fresh with new password.
        // This prevents the recovery session from becoming a full session.
        if (mountedRef.current) {
          setIsRecoverySession(false);
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      // All other events (SIGNED_IN from normal login, SIGNED_OUT, TOKEN_REFRESHED)
      setIsRecoverySession(false);
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
        setProfileError(false);
        setMustChangePassword(false);
        setLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) await fetchProfile(data.user.id);
    return { error };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setSession(null);
    setProfileError(false);
    setMustChangePassword(false);
    setIsRecoverySession(false);
  }

  return (
    <AuthContext.Provider value={{
      user, profile, session, loading, profileError,
      mustChangePassword,
      isRecoverySession,
      signIn, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}