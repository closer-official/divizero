import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { initFirebase } from '../firebase';
import type { AppData } from '../types';

const EMPTY_DATA = (): AppData => ({
  screenings: [],
  targets: [],
  pipeline: [],
  closed: [],
  excluded: [],
  trash: [],
  logs: [],
});

export function useData() {
  const [data, setData] = useState<AppData>(EMPTY_DATA());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  // Track in-flight Firestore writes so onSnapshot reverts don't overwrite local state
  const pendingWrites = useRef(0);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    initFirebase()
      .then(firestoreDb => {
        setDb(firestoreDb);
        const docRef = doc(firestoreDb, 'workspace', 'main');
        unsub = onSnapshot(
          docRef,
          snap => {
            // Skip if a local write is still in-flight to prevent server revert from
            // overwriting optimistically-committed local state
            if (pendingWrites.current > 0) {
              setLoading(false);
              return;
            }
            if (snap.exists()) {
              try {
                const parsed = JSON.parse(snap.data().payload ?? '{}') as AppData;
                setData({ ...EMPTY_DATA(), ...parsed });
              } catch {
                setData(EMPTY_DATA());
              }
            } else {
              const empty = EMPTY_DATA();
              setData(empty);
              setDoc(docRef, { payload: JSON.stringify(empty) }).catch(console.error);
            }
            setLoading(false);
          },
          err => {
            console.error('Firestore error', err);
            setData(EMPTY_DATA());
            setLoading(false);
            setError('Firestore接続エラー: ' + err.message);
          }
        );
      })
      .catch(err => {
        console.error('Firebase init error', err);
        // Fall back to localStorage if Firebase is unavailable
        const stored = localStorage.getItem('os_data_v1');
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as AppData;
            setData({ ...EMPTY_DATA(), ...parsed });
          } catch {
            setData(EMPTY_DATA());
          }
        } else {
          setData(EMPTY_DATA());
        }
        setLoading(false);
        setError('Firebase未接続 (ローカルモード): ' + String(err));
      });

    return () => {
      if (unsub) unsub();
    };
  }, []);

  const saveData = useCallback((updater: (prev: AppData) => AppData) => {
    setData(prev => {
      const next = updater(prev);
      if (db) {
        const docRef = doc(db, 'workspace', 'main');
        pendingWrites.current++;
        setDoc(docRef, { payload: JSON.stringify(next) })
          .then(() => {
            pendingWrites.current--;
          })
          .catch(e => {
            pendingWrites.current--;
            console.error('Firestore write error', e);
            // Fallback: save to localStorage so data survives page reload
            localStorage.setItem('os_data_v1', JSON.stringify(next));
          });
      } else {
        // No Firestore → save to localStorage
        localStorage.setItem('os_data_v1', JSON.stringify(next));
      }
      return next;
    });
  }, [db]);

  return { data, loading, error, saveData };
}
