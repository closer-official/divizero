import { useState, useEffect } from 'react';
import type { Prompts } from '../types';

export async function loadPrompts(): Promise<Prompts> {
  const files: Record<keyof Prompts, string> = {
    OS0: '/prompts/OS0_一次選別_v2.md',
    OS0_X: '/prompts/OS0_X_一次選別_v2.md',
    OS0_IG: '/prompts/OS0_Instagram_一次選別_v2.md',
    OS0_TH: '/prompts/OS0_Threads_一次選別_v2.md',
    OS1_X: '/prompts/OS1_X_接触スクリーニング_latest.md',
    OS1_IG: '/prompts/OS1_Instagram_接触スクリーニング_latest.md',
    OS1_TH: '/prompts/OS1_Threads_接触スクリーニング_latest.md',
    OS1_REFRESH_BATCH: '/prompts/OS1_最新仕様一括更新_latest.md',
    OS2: '/prompts/OS2_行動判定_latest.md',
    OS3: '/prompts/OS3_案件検証_latest.md',
    IG_OCR: '/prompts/IG読み取りOCR_latest.md',
    PHENOMENON_FUTURE: '/prompts/OS_現象未来_latest.md',
    LOG_OCR: '/prompts/OS_会話ログOCR_latest.md',
    S1_ACTION: '/prompts/OS_S1リアクション後行動判定_latest.md',
    S1_ACTION_BATCH: '/prompts/OS_S1行動判定_バッチ_latest.md',
    DM_JUDGE: '/prompts/OS_DM文面判定_latest.md',
    OS4_OTHER_ANALYSIS: '/prompts/legacy/OS4_他社投稿分析_latest.md',
    OS4_OWN_ANALYSIS: '/prompts/legacy/OS4_自社投稿分析_latest.md',
    OS4_POST_GEN: '/prompts/legacy/OS4_自社投稿生成_latest.md',
    OS01_ANALYSIS: '/prompts/os01_analysis.md',
    OS02_QUOTE: '/prompts/os02_quote.md',
    OS03_POST: '/prompts/os03_post.md',
    OS04_PDCA: '/prompts/os04_pdca.md',
    OS05_LENS: '/prompts/os05_lens.md',
    OS06_PERSONALITY: '/prompts/os06_personality.md',
    PERSONALITY_CONSTITUTION: '/prompts/01_personality_constitution.md',
    AESTHETIC_CONSTITUTION: '/prompts/02_aesthetic_constitution.md',
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
