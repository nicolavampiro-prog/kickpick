// api/refresh.js — Vercel cron endpoint
// Triggered daily at 07:00 UTC by vercel.json cron config.
// Calls both data pipelines to warm the KV cache before users arrive.
//
// Vercel cron docs: vercel.com/docs/cron-jobs

export default async function handler(req, res) {
  // Vercel cron passes Authorization header — verify it
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  try {
    const [matchRes, tipsterRes] = await Promise.all([
      fetch(`${base}/api/matches`),
      fetch(`${base}/api/tipsters`),
    ]);

    const matchData   = await matchRes.json();
    const tipsterData = await tipsterRes.json();

    console.log(`[refresh] ${matchData.matches?.length || 0} matches, ${tipsterData.tipsters?.length || 0} tipster entries cached`);

    return res.status(200).json({
      ok: true,
      matches: matchData.matches?.length || 0,
      tipsters: tipsterData.tipsters?.length || 0,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[refresh] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
