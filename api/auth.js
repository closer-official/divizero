import crypto from 'crypto';

function computeAiToken(adminPass) {
  return crypto.createHash('sha256').update(adminPass + '::os_ai_v1').digest('hex');
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'パスワードを入力してください' });

  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminPass && password === adminPass) {
    const aiToken = computeAiToken(adminPass);
    return res.status(200).json({ success: true, role: 'admin', aiToken });
  }

  const viewerPass = process.env.VIEWER_PASSWORD;
  if (viewerPass && password === viewerPass) {
    return res.status(200).json({ success: true, role: 'viewer' });
  }

  if (!adminPass && !viewerPass && password === 'dev') {
    return res.status(200).json({ success: true, role: 'admin' });
  }

  return res.status(401).json({ success: false, error: 'パスワードが違います' });
}
