'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);

export function displayNameFromUser(user) {
  if (!user) return 'Kasutaja';
  const meta = user.user_metadata || {};
  const named = meta.full_name || meta.name || meta.display_name;
  if (named && String(named).trim()) return String(named).trim();
  if (user.email) return user.email.split('@')[0];
  return 'Kasutaja';
}

export function avatarLetterFromUser(user) {
  const name = displayNameFromUser(user);
  return (name[0] || '?').toUpperCase();
}

export function isProUser(user) {
  const plan = String(user?.user_metadata?.plan || '').toLowerCase();
  return plan === 'pro' || plan === 'premium';
}

function mapAuthError(err) {
  const msg = String(err?.message || err || '');
  const low = msg.toLowerCase();
  if (
    low.includes('load failed') ||
    low.includes('failed to fetch') ||
    low.includes('network') ||
    low.includes('fetch')
  ) {
    return 'Ühendus Supabase’iga ebaõnnestus. Ava supabase.com → Investor app → kui projekt on Pause’is, vajuta Restore. Seejärel proovi uuesti.';
  }
  if (low.includes('already registered') || low.includes('already been registered')) {
    return 'See e-post on juba olemas — logi sisse.';
  }
  if (low.includes('invalid login')) {
    return 'Vale e-post või parool.';
  }
  if (low.includes('email not confirmed')) {
    return 'E-post pole kinnitatud. Vaata kirjakasti (ka spam) või lülita Supabases Confirm email välja.';
  }
  return msg || 'Sisselogimine ebaõnnestus';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(mapAuthError(error));
    return data;
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        data: {
          full_name: fullName || email.split('@')[0],
        },
      },
    });
    if (error) throw new Error(mapAuthError(error));
    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signUp,
      signOut,
      displayName: displayNameFromUser(user),
      avatarLetter: avatarLetterFromUser(user),
      isPro: isProUser(user),
    }),
    [user, loading, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
