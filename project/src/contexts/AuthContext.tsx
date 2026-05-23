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
  isRecoverySession: boolean;
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
  const isRecoveryRef = useRef(false); // ref copy so event handlers can read current value

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

        if (data && data.is_active === false) {
          await supabase.auth.signOut();
          setProfile(null);
          setUser(null);
          setSession(null);
          setMustChangePassword(false);
          return;
        }

        setProfile(data);
        setMustChangePassword(data?.must_change_password === true);
      }
    } catch {
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

    // Detect recovery OR invite session from URL hash BEFORE getSession()
    // Both types must not establish a full session until password is set.
    const hashParams = new URLSearchParams(
      window.location.hash.replace('#', '?')
    );
    const urlType = hashParams.get('type');
    const isSpecialSession = urlType === 'recovery' || urlType === 'invite';

    if (isSpecialSession) {
      // Mark immediately — don't fetch profile or set full session.
      // onAuthStateChange will fire PASSWORD_RECOVERY or SIGNED_IN shortly
      // and provide the session needed for updateUser() to work.
      isRecoveryRef.current = true;
      setIsRecoverySession(true);
      setLoading(false);
    } else {
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
        // Password reset link clicked — session for updateUser() only
        isRecoveryRef.current = true;
        setIsRecoverySession(true);
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' && isRecoveryRef.current) {
        // Invite link clicked — session established, fetch profile so
        // ChangePasswordPage can read profile.id and profile.full_name
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) fetchProfile(newSession.user.id);
        setLoading(false);
        return;
      }

      if (event === 'USER_UPDATED') {
        // Password changed via updateUser().
        // For recovery: clear session — user must log in fresh.
        // For invite: ChangePasswordPage handles signOut manually, don't clear here.
        if (mountedRef.current && isRecoveryRef.current && urlType === 'recovery') {
          isRecoveryRef.current = false;
          setIsRecoverySession(false);
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      // Normal events: SIGNED_IN (normal login), SIGNED_OUT, TOKEN_REFRESHED
      isRecoveryRef.current = false;
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
    isRecoveryRef.current = false;
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