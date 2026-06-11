// api/odds.js — Vercel serverless function
// Fetcha odds reali da OddsAPI per le partite di oggi
// e restituisce le probabilità implicite per ogni match

const SPORTS = [
  'soccer_uefa_champs_league',
  'soccer_epl',
  'soccer_italy_serie_a',
  'soccer_spain_la_liga',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_fifa_world_cup',
];

// Cache in memoria per 1 ora
const cache = { ts: 0, data: null };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cache hit (1 ora)
  if (cache.data && cache.ts > Date.now() - 3600000) {
    return res.status(200).json({ ...cache.data, cached: true });
  }

  const KEY = process.env.ODDS_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ODDS_API_KEY not set' });

  const allOdds = [];

  for (const sport of SPORTS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const resp = await fetch(url);

      if (!resp.ok) {
        console.error(`OddsAPI ${sport}: ${resp.status}`);
        continue;
      }

      const events = await resp.json();
      if (!Array.isArray(events)) continue;

      for (const event of events) {
        const bookmakers = event.bookmakers || [];
        if (!bookmakers.length) continue;

        // Media probabilità implicite su tutti i bookmaker
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

        // Best odds (più alta probabilità = pick consigliato)
        let pick, pct;
        if (pHome >= pDraw && pHome >= pAway) { pick = 'Home win'; pct = pHome; }
        else if (pAway >= pDraw)              { pick = 'Away win'; pct = pAway; }
        else                                  { pick = 'Draw';     pct = pDraw; }

        // Trova le migliori quote singole
        const bestHome = Math.max(...bookmakers.flatMap(bk =>
          bk.markets?.find(m => m.key === 'h2h')?.outcomes
            .filter(o => o.name === event.home_team)
            .map(o => o.price) || []
        )).toFixed(2);

        const bestDraw = Math.max(...bookmakers.flatMap(bk =>
          bk.markets?.find(m => m.key === 'h2h')?.outcomes
            .filter(o => o.name === 'Draw')
            .map(o => o.price) || []
        )).toFixed(2);

        const bestAway = Math.max(...bookmakers.flatMap(bk =>
          bk.markets?.find(m => m.key === 'h2h')?.outcomes
            .filter(o => o.name === event.away_team)
            .map(o => o.price) || []
        )).toFixed(2);

        const bestSide = pHome >= pDraw && pHome >= pAway ? 'home'
          : pAway >= pDraw ? 'away' : 'draw';

        allOdds.push({
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime: event.commence_time,
          pick,
          consensus: `${pct}% implied`,
          probHome: pHome,
          probDraw: pDraw,
          probAway: pAway,
          odds: {
            home: bestHome,
            draw: bestDraw,
            away: bestAway,
            best: bestSide
          }
        });
      }
    } catch (err) {
      console.error(`Error fetching odds for ${sport}:`, err.message);
    }
  }

  const payload = { odds: allOdds, total: allOdds.length, fetchedAt: new Date().toISOString() };
  cache.ts = Date.now();
  cache.data = payload;

  return res.status(200).json(payload);
};
