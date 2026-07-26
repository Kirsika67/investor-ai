'use client';

import { useState } from 'react';
import { useAuth } from '../lib/AuthProvider';

export default function AuthGate({ children }) {
  const { user, loading, signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin'); // signin | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');

  if (loading) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <p className="auth-muted">Laen sessiooni…</p>
        </div>
      </div>
    );
  }

  if (user) return children;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp(email.trim(), password, fullName.trim());
        if (result.session) {
          // Auto-logged in (email confirm disabled)
        } else {
          setInfo('Konto loodud. Kui e-posti kinnitus on sisse lülitatud, kinnita link ja logi siis sisse.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err.message || 'Sisselogimine ebaõnnestus');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-brand">Investor AI</div>
        <h1>{mode === 'signin' ? 'Logi sisse' : 'Loo konto'}</h1>
        <p className="auth-lead">
          Iga kasutaja näeb ainult oma vestlusi, jälgimisnimekirja ja portfelli.
        </p>

        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'signup' && (
            <label>
              Nimi
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Sinu nimi"
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            E-post
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sina@email.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Parool
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Vähemalt 6 märki"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>

          {error && <div className="auth-error">{error}</div>}
          {info && <div className="auth-info">{info}</div>}

          <button type="submit" disabled={busy}>
            {busy ? 'Palun oota…' : mode === 'signin' ? 'Logi sisse' : 'Loo konto'}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
            setError('');
            setInfo('');
          }}
        >
          {mode === 'signin' ? 'Pole kontot? Loo uus' : 'On juba konto? Logi sisse'}
        </button>
      </div>
    </div>
  );
}
