// api/ai-pick.js — Vercel serverless function
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const { home, away, league, stage, homeForm, awayForm, homeGoals, awayGoals, h2hHome, h2hAway } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing match data' });
 
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
 
  const prompt = `You are a concise football analyst. Analyse this match and respond ONLY with a JSON object — no markdown, no explanation.
 
Match: ${home} vs ${away}
Competition: ${league} · ${stage}
Home form (last 5): ${homeForm}
Away form (last 5): ${awayForm}
Home avg goals/game: ${homeGoals}
Away avg goals/game: ${awayGoals}
H2H home wins: ${h2hHome} | Away wins: ${h2hAway}
 
Respond with exactly this JSON:
{"pick":"string (e.g. Home win / Away win / Draw / Over 2.5 / BTTS Yes / Under 2.5)","confidence":number between 50 and 92,"insight":"one punchy sentence max 12 words","verdictLevel":"high or mid or low"}
 
verdictLevel rules: high = confidence >= 70, mid = 60-69, low = 50-59`;
 
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      })
    });
 
    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic error:', response.status, errText);
      return res.status(500).json({ error: `Anthropic ${response.status}: ${errText}` });
    }
 
    const data = await response.json();
 
    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'Empty response from Claude' });
    }
 
    const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    return res.status(200).json(parsed);
 
  } catch (err) {
    console.error('AI pick error:', err);
    return res.status(500).json({ error: err.message });
  }
};
