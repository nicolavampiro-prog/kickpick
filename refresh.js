// api/refresh.js — Vercel cron endpoint
// Si attiva ogni mattina alle 07:00 UTC via vercel.json
// Pre-carica le partite di oggi e domani nella cache

module.exports = async function handler(req, res) {
  // Verifica il secret per sicurezza
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://kickpick.eu';

  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const results = {};

  try {
    // Fetch oggi
    const r1 = await fetch(`${base}/api/matches?date=${today}`);
    const d1 = await r1.json();
    results.today = { date: today, total: d1.total || 0 };

    // Fetch domani
    const r2 = await fetch(`${base}/api/matches?date=${tomorrow}`);
    const d2 = await r2.json();
    results.tomorrow = { date: tomorrow, total: d2.total || 0 };

    console.log(`[cron] Today: ${results.today.total} matches, Tomorrow: ${results.tomorrow.total} matches`);

    return res.status(200).json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      ...results
    });
  } catch(err) {
    console.error('[cron] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
