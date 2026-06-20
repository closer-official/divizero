export function copyText(text: string, onToast?: (msg: string) => void): void {
  navigator.clipboard.writeText(text).then(() => {
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
