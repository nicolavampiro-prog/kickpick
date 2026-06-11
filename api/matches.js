// api/matches.js — Vercel serverless function
// Usa OddsAPI come fonte unica per partite + odds
// Nessun problema di matching — tutto viene dallo stesso servizio
 
const SPORTS = [
  { key: 'soccer_fifa_world_cup',         name: 'World Cup',        color: '#B91C1C', bg: '#FFF1F2' },
  { key: 'soccer_uefa_champs_league',     name: 'Champions League', color: '#7C3AED', bg: '#F5F3FF' },
  { key: 'soccer_epl',                    name: 'Premier League',   color: '#059669', bg: '#ECFDF5' },
  { key: 'soccer_italy_serie_a',          name: 'Serie A',          color: '#D97706', bg: '#FFFBEB' },
  { key: 'soccer_spain_la_liga',          name: 'La Liga',          color: '#DC2626', bg: '#FEF2F2' },
  { key: 'soccer_germany_bundesliga',     name: 'Bundesliga',       color: '#B45309', bg: '#FFF7ED' },
  { key: 'soccer_france_ligue_one',       name: 'Ligue 1',          color: '#2563EB', bg: '#EFF6FF' },
  { key: 'soccer_uefa_europa_league',     name: 'Europa League',    color: '#F97316', bg: '#FFF7ED' },
];
 
// Cache per data — evita chiamate ripetute
const cache = {};
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const KEY = process.env.ODDS_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ODDS_API_KEY not set' });
 
  // Data dalla query string, default oggi
  const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
 
  // Cache hit (2 ore)
  if (cache[requestedDate] && cache[requestedDate].ts > Date.now() - 7200000) {
    return res.status(200).json({ ...cache[requestedDate].data, cached: true });
  }
 
  // Range temporale per filtrare per data
  const dayStart = new Date(requestedDate + 'T00:00:00Z').getTime();
  const dayEnd   = new Date(requestedDate + 'T23:59:59Z').getTime();
 
  const allMatches = [];
 
  for (const sport of SPORTS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const resp = await fetch(url);
 
      if (!resp.ok) {
        console.error(`OddsAPI ${sport.key}: ${resp.status}`);
        continue;
      }
 
      const events = await resp.json();
      if (!Array.isArray(events)) continue;
 
      for (const event of events) {
        // Filtra per data richiesta
        const eventTime = new Date(event.commence_time).getTime();
        if (eventTime < dayStart || eventTime > dayEnd) continue;
 
        const bookmakers = event.bookmakers || [];
 
        // Calcola probabilità implicite medie
        let sumHome = 0, sumDraw = 0, sumAway = 0, count = 0;
        for (const bk of bookmakers) {
          const h2h = bk.markets?.find(m => m.key === 'h2h');
          if (!h2h) continue;
          const home = h2h.outcomes.find(o => o.name === event.home_team);
          const away = h2h.outcomes.find(o => o.name === event.away_team);
          const draw = h2h.outcomes.find(o => o.name === 'Draw');
          if (!home || !away) continue;
          sumHome += 1 / home.price;
          sumAway += 1 / away.price;
          if (draw) sumDraw += 1 / draw.price;
          count++;
        }
 
        if (!count) continue;
 
        const total = sumHome + sumDraw + sumAway;
        const pHome = Math.round(sumHome / total * 100);
        const pDraw = Math.round(sumDraw / total * 100);
        const pAway = Math.round(sumAway / total * 100);
 
        // Market pick
        let mktPick, mktPct, bestSide;
        if (pHome >= pDraw && pHome >= pAway) { mktPick = 'Home win'; mktPct = pHome; bestSide = 'home'; }
        else if (pAway >= pDraw)              { mktPick = 'Away win'; mktPct = pAway; bestSide = 'away'; }
        else                                  { mktPick = 'Draw';     mktPct = pDraw; bestSide = 'draw'; }
 
        // Migliori quote
        const getOdd = (teamName) => {
          const prices = bookmakers.flatMap(bk =>
            bk.markets?.find(m => m.key === 'h2h')?.outcomes
              .filter(o => o.name === teamName)
              .map(o => o.price) || []
          );
          return prices.length ? Math.max(...prices).toFixed(2) : '—';
        };
 
        const bestHome = getOdd(event.home_team);
        const bestDraw = (() => {
          const prices = bookmakers.flatMap(bk =>
            bk.markets?.find(m => m.key === 'h2h')?.outcomes
              .filter(o => o.name === 'Draw')
              .map(o => o.price) || []
          );
          return prices.length ? Math.max(...prices).toFixed(2) : '—';
        })();
        const bestAway = getOdd(event.away_team);
 
        // Kickoff in ora italiana
        const kickoff = new Date(event.commence_time).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
        });
 
        // Form placeholder — da migliorare con API dedicata
        const formPlaceholder = 'WWDLW';
 
        allMatches.push({
          id: event.id,
          league: sport.name,
          leagueColor: sport.color,
          leagueBg: sport.bg,
          kickoff,
          home: event.home_team,
          away: event.away_team,
          status: 'SCHEDULED',
          homeForm: formPlaceholder,
          awayForm: formPlaceholder,
          stats: {
            homePoss: 50, awayPoss: 50,
            homeGoals: 1.5, awayGoals: 1.5,
            homeH2H: 5, awayH2H: 5
          },
          predictions: {
            stats:  { pick: mktPct >= 60 ? mktPick : 'Even match', sub: `${mktPct}% implied` },
            market: { pick: mktPick, sub: `${mktPct}% implied` }
          },
          odds: {
            home: bestHome,
            draw: bestDraw,
            away: bestAway,
            best: bestSide
          },
          hasRealOdds: true,
          probHome: pHome,
          probDraw: pDraw,
          probAway: pAway
        });
      }
 
    } catch (err) {
      console.error(`Error fetching ${sport.key}:`, err.message);
    }
  }
 
  // Ordina per orario
  allMatches.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
 
  const payload = {
    date: requestedDate,
    matches: allMatches,
    total: allMatches.length
  };
 
  cache[requestedDate] = { ts: Date.now(), data: payload };
 
  return res.status(200).json(payload);
};
