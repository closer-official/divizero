const AI_MODE_KEY = 'os_ai_mode_v1'
const AI_TOKEN_KEY = 'os_ai_token_v1'

export type AiRunResult =
  | { ok: true; text: string }
  | { ok: false; code: string }

export function isAiModeEnabled(): boolean {
  return localStorage.getItem(AI_MODE_KEY) === 'on'
}

export function setAiModeEnabled(on: boolean): void {
  localStorage.setItem(AI_MODE_KEY, on ? 'on' : 'off')
}

export async function runAi(prompt: string): Promise<AiRunResult> {
  if (!isAiModeEnabled()) {
    return { ok: false, code: 'AI_MODE_OFF' }
  }

  const aiToken = localStorage.getItem(AI_TOKEN_KEY)
  if (!aiToken) {
    return { ok: false, code: 'NO_TOKEN' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)

  try {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OS-AI-Token': aiToken,
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    let data: { ok?: boolean; text?: string; code?: string } = {}
    try { data = await res.json() } catch { /* ignore */ }

    if (data.ok && data.text) {
      return { ok: true, text: data.text }
    }
    return { ok: false, code: data.code || `HTTP_${res.status}` }
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, code: 'TIMEOUT' }
    }
    return { ok: false, code: 'FETCH_ERROR' }
  }
}
