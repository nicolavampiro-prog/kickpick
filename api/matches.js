// api/matches.js — Vercel serverless function
// Accetta ?date=YYYY-MM-DD (default: oggi)
// Supporta today, tomorrow, e +2 giorni

const COMPETITIONS = [
  { code: 'WC',  name: 'World Cup',        color: '#B91C1C', bg: '#FFF1F2' },
  { code: 'CL',  name: 'Champions League', color: '#7C3AED', bg: '#F5F3FF' },
  { code: 'EC',  name: 'Euro Championship',color: '#1D4ED8', bg: '#EFF6FF' },
  { code: 'PL',  name: 'Premier League',   color: '#059669', bg: '#ECFDF5' },
  { code: 'SA',  name: 'Serie A',          color: '#D97706', bg: '#FFFBEB' },
  { code: 'PD',  name: 'La Liga',          color: '#DC2626', bg: '#FEF2F2' },
  { code: 'BL1', name: 'Bundesliga',       color: '#B45309', bg: '#FFF7ED' },
  { code: 'FL1', name: 'Ligue 1',          color: '#2563EB', bg: '#EFF6FF' },
  { code: 'DED', name: 'Eredivisie',       color: '#EA580C', bg: '#FFF7ED' },
  { code: 'PPL', name: 'Primeira Liga',    color: '#15803D', bg: '#F0FDF4' },
];

// Cache semplice in memoria per data
const cache = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Data dalla query string, default oggi
  const date = req.query.date || new Date().toISOString().split('T')[0];

  // Valida formato data
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  // Cache hit
  if (cache[date] && cache[date].ts > Date.now() - 3600000) {
    return res.status(200).json({ ...cache[date].data, cached: true });
  }

  const FOOTBALL_KEY = process.env.FOOTBALL_DATA_KEY;
  if (!FOOTBALL_KEY) {
    return res.status(500).json({ error: 'FOOTBALL_DATA_KEY not configured' });
  }

  let allMatches = [];

  for (const comp of COMPETITIONS) {
    try {
      const url = `https://api.football-data.org/v4/competitions/${comp.code}/matches?dateFrom=${date}&dateTo=${date}`;
      const resp = await fetch(url, {
        headers: { 'X-Auth-Token': FOOTBALL_KEY }
      });

      if (!resp.ok) {
        console.error(`${comp.code} returned ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      if (!data.matches?.length) continue;

      const mapped = data.matches.map(m => ({
        id: String(m.id),
        league: comp.name,
        leagueColor: comp.color,
        leagueBg: comp.bg,
        kickoff: new Date(m.utcDate).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
        }),
        home: m.homeTeam.shortName || m.homeTeam.name,
        away: m.awayTeam.shortName || m.awayTeam.name,
        status: m.status,
        homeForm: m.homeTeam.form || 'WWDLW',
        awayForm: m.awayTeam.form || 'WDWLW',
        stats: {
          homePoss: 50, awayPoss: 50,
          homeGoals: 1.5, awayGoals: 1.5,
          homeH2H: 5, awayH2H: 5
        },
        predictions: {
          stats:  { pick: 'Even match', sub: '50% probability' },
          market: { pick: 'Home win',   sub: '50% implied' }
        },
        odds: { home: '2.50', draw: '3.20', away: '2.80', best: 'home' },
        aiResult: null
      }));

      allMatches = allMatches.concat(mapped);

    } catch (err) {
      console.error(`Error fetching ${comp.code}:`, err.message);
    }
  }

  const payload = { date, matches: allMatches, total: allMatches.length };
  cache[date] = { ts: Date.now(), data: payload };

  return res.status(200).json(payload);
}
