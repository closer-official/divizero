module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'パスワードを入力してください' });

  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminPass && password === adminPass) {
    return res.status(200).json({ success: true, role: 'admin' });
  }

  const viewerPass = process.env.VIEWER_PASSWORD;
  if (viewerPass && password === viewerPass) {
    return res.status(200).json({ success: true, role: 'viewer' });
  }

  // 環境変数が未設定の場合はローカル開発用にadminを許可
  if (!adminPass && !viewerPass && password === 'dev') {
    return res.status(200).json({ success: true, role: 'admin' });
  }

  return res.status(401).json({ success: false, error: 'パスワードが違います' });
};
