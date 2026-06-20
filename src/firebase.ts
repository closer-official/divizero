import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Firebase config is fetched dynamically from /api/config at runtime
// to avoid embedding secrets in client bundle
let _db: ReturnType<typeof getFirestore> | null = null;

export async function initFirebase() {
  if (_db) return _db;

  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('config fetch failed');
    const firebaseConfig = await res.json();
    const app = initializeApp(firebaseConfig);
    _db = getFirestore(app);
    return _db;
  } catch (e) {
    // Fallback to env vars if available (local dev with .env)
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    if (firebaseConfig.apiKey && firebaseConfig.projectId) {
      const app = initializeApp(firebaseConfig);
      _db = getFirestore(app);
      return _db;
    }
    throw e;
  }
}

export function getDb() {
  if (!_db) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return _db;
}
