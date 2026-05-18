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

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!mountedRef.current) return;
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      if (initialSession?.user) await fetchProfile(initialSession.user.id);
      if (mountedRef.current) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'INITIAL_SESSION') return;
      if (!mountedRef.current) return;

      // PASSWORD_RECOVERY: user clicked a reset link.
      // Set the session so ResetPasswordPage can call updateUser(),
      // but do NOT fetch profile or set loading=false — this would
      // trigger LoginPage/ProtectedRoute redirects before the reset form shows.
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true);
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
        return; // skip profile fetch — ResetPasswordPage handles this session
      }

      // Clear recovery flag on any other auth event
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