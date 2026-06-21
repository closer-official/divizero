import { useState, useEffect } from 'react';
import type { Prompts } from '../types';

export async function loadPrompts(): Promise<Prompts> {
  const files: Record<keyof Prompts, string> = {
    OS0: '/prompts/OS0_一次選別_latest.md',
    OS1_X: '/prompts/OS1_X_接触スクリーニング_latest.md',
    OS1_IG: '/prompts/OS1_Instagram_接触スクリーニング_latest.md',
    OS1_TH: '/prompts/OS1_Threads_接触スクリーニング_latest.md',
    OS2: '/prompts/OS2_行動判定_latest.md',
    OS3: '/prompts/OS3_案件検証_latest.md',
    IG_OCR: '/prompts/IG読み取りOCR_latest.md',
    DM: '/prompts/OS_DM文生成_latest.md',
    LOG_OCR: '/prompts/OS_会話ログOCR_latest.md',
    S1_ACTION: '/prompts/OS_S1リアクション後行動判定_latest.md',
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, path]) => {
      try {
        const text = await fetch(path).then(r => r.text());
        return [key, text] as [string, string];
      } catch {
        return [key, ''] as [string, string];
      }
    })
  );
  return Object.fromEntries(entries) as Prompts;
}

export function usePrompts() {
  const [prompts, setPrompts] = useState<Prompts>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrompts().then(p => {
      setPrompts(p);
      setLoading(false);
    });
  }, []);

  return { prompts, loading };
}
