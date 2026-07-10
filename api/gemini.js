import crypto from 'crypto'

const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
])

function computeAiToken(adminPass) {
  return crypto.createHash('sha256').update(adminPass + '::os_ai_v1').digest('hex')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OS-AI-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' })

  const adminPass = process.env.ADMIN_PASSWORD
  const apiKey = process.env.GEMINI_API_KEY
  const modelEnv = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

  if (!apiKey) {
    return res.status(503).json({ ok: false, code: 'NO_API_KEY' })
  }

  const tokenHeader = req.headers['x-os-ai-token'] || ''
  if (!adminPass || !tokenHeader || tokenHeader !== computeAiToken(adminPass)) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
  }

  const { prompt, model: requestedModel } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD' })
  }

  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : modelEnv
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55000)

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (geminiRes.status === 429) {
      return res.status(429).json({ ok: false, code: 'UPSTREAM_429' })
    }
    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '')
      console.error('[gemini] upstream error', geminiRes.status, errText)
      return res.status(502).json({ ok: false, code: 'UPSTREAM_ERROR', status: geminiRes.status })
    }

    const data = await geminiRes.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      return res.status(502).json({ ok: false, code: 'EMPTY_RESPONSE' })
    }

    return res.status(200).json({ ok: true, text, model })
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, code: 'TIMEOUT' })
    }
    console.error('[gemini] fetch error', err)
    return res.status(502).json({ ok: false, code: 'FETCH_ERROR' })
  }
}
