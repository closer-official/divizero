const GEMINI_URL = 'https://gemini.google.com/app';

function openGemini(): void {
  window.open(GEMINI_URL, 'gemini');
}

function shouldOpenGeminiOnCopy(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  const isNarrow = window.matchMedia('(max-width: 639px)').matches
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
  return !isNarrow && !isCoarsePointer
}

export function copyText(
  text: string,
  onToast?: (msg: string) => void,
  options?: { openGemini?: boolean },
): Promise<void> {
  // Start the clipboard write while the click still has user activation, then
  // open/reuse a dedicated Gemini tab. Automatic paste is intentionally left
  // to the user because browsers do not allow websites to paste into another
  // site's input field.
  const copyPromise = navigator.clipboard.writeText(text);
  const shouldOpenGemini = options?.openGemini ?? shouldOpenGeminiOnCopy()
  if (shouldOpenGemini) openGemini();

  return copyPromise.then(() => {
    if (onToast) onToast('コピーしました！');
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (onToast) onToast('コピーしました！');
  });
}
