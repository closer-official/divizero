import { useState, useEffect } from 'react';

export type Role = 'admin' | 'viewer' | null;

const AUTH_KEY = 'os_auth_v1';
const AI_TOKEN_KEY = 'os_ai_token_v1';

export function useAuth() {
  const [role, setRole] = useState<Role>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      try {
        const { role: r } = JSON.parse(stored);
        if (r === 'admin' || r === 'viewer') {
          setRole(r);
          setChecking(false);
          return;
        }
      } catch {
        // ignore parse error
      }
    }
    // Probe the auth API
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '__probe__' }),
    })
      .then(res => {
        if (res.status === 404 || res.status === 405) {
          // No auth API → auto-skip
          setRole('admin');
          setChecking(false);
        } else {
          // API exists → show login
          setShowLogin(true);
          setChecking(false);
        }
      })
      .catch(() => {
        // Network error / local dev → skip auth
        setRole('admin');
        setChecking(false);
      });
  }, []);

  async function login(password: string): Promise<{success: boolean; error?: string}> {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 404) {
        setRole('admin');
        setShowLogin(false);
        return { success: true };
      }
      let data: {success?: boolean; role?: string; error?: string; aiToken?: string} = {};
      try { data = await res.json(); } catch { /* ignore */ }
      if (data.success && data.role) {
        const r = data.role as Role;
        localStorage.setItem(AUTH_KEY, JSON.stringify({ role: r }));
        if (data.aiToken) {
          localStorage.setItem(AI_TOKEN_KEY, data.aiToken);
        }
        setRole(r);
        setShowLogin(false);
        return { success: true };
      }
      return { success: false, error: data.error || 'パスワードが違います' };
    } catch {
      return { success: false, error: 'サーバーに接続できませんでした' };
    }
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AI_TOKEN_KEY);
    setRole(null);
    setShowLogin(true);
  }

  return { role, showLogin, checking, login, logout };
}
