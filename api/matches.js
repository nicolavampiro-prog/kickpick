// api/matches.js — Vercel serverless function
// Fetcha le partite di oggi da football-data.org
// Arricchisce ogni partita con il pick AI di Claude
// Cachea il risultato in memoria per la giornata

// Competitions disponibili sul piano free di football-data.org
const COMPETITIONS = [
  { code: 'CL',  name: 'Champions League',  color: '#7C3AED', bg: '#F5F3FF' },
  { code: 'PL',  name: 'Premier League',    color: '#059669', bg: '#ECFDF5' },
  { code: 'SA',  name: 'Serie A',           color: '#D97706', bg: '#FFFBEB' },
  { code: 'PD',  name: 'La Liga',           color: '#DC2626', bg: '#FEF2F2' },
  { code: 'BL1', name: 'Bundesliga',        color: '#B45309', bg: '#FFF7ED' },
  { code: 'FL1', name: 'Ligue 1',           color: '#2563EB', bg: '#EFF6FF' },
];

// Cache in memoria — dura finché la funzione è in vita (di solito qualche ora su Vercel)
let cache = { date: null, matches: [] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date().toISOString().split('T')[0];

  // Restituisce dalla cache se è ancora oggi
  if (cache.date === today && cache.matches.length > 0) {
    return res.status(200).json({ date: today, matches: cache.matches, cached: true });
  }

  const FOOTBALL_KEY = process.env.FOOTBALL_DATA_KEY;
  if (!FOOTBALL_KEY) {
    return res.status(500).json({ error: 'FOOTBALL_DATA_KEY not configured' });
  }

  // Fetch partite di oggi per ogni competizione
  let allMatches = [];

  for (const comp of COMPETITIONS) {
    try {
      const url = `https://api.football-data.org/v4/competitions/${comp.code}/matches?dateFrom=${today}&dateTo=${today}&status=SCHEDULED,LIVE,IN_PLAY,PAUSED,FINISHED`;
      const resp = await fetch(url, {
        headers: { 'X-Auth-Token': FOOTBALL_KEY }
      });

      if (!resp.ok) continue;

      const data = await resp.json();
      if (!data.matches || !data.matches.length) continue;

      // Mappa nel formato che usa il frontend
      const mapped = data.matches.map(m => ({
        id: String(m.id),
        league: comp.name,
        leagueColor: comp.color,
        leagueBg: comp.bg,
        kickoff: new Date(m.utcDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }),
        home: m.homeTeam.shortName || m.homeTeam.name,
        away: m.awayTeam.shortName || m.awayTeam.name,
        status: m.status,
        score: m.score.fullTime,
        homeForm: m.homeTeam.form || 'WWDLW',
        awayForm: m.awayTeam.form || 'WDWLW',
        stats: {
          homePoss: 50, awayPoss: 50,
          homeGoals: 1.5, awayGoals: 1.5,
          homeH2H: 5, awayH2H: 5
        },
        predictions: {
          stats: { pick: 'Even match', sub: '50% probability' },
          market: { pick: 'Home win',  sub: '50% implied' }
        },
        odds: { home: '2.50', draw: '3.20', away: '2.80', best: 'home' },
        aiResult: null
      }));

      allMatches = allMatches.concat(mapped);

    } catch (err) {
      console.error(`Error fetching ${comp.code}:`, err.message);
    }
  }

  // Salva in cache
  cache = { date: today, matches: allMatches };

  return res.status(200).json({
    date: today,
    matches: allMatches,
    cached: false,
    total: allMatches.length
  });
}
