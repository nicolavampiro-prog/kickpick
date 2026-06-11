// api/tipsters.js — Vercel serverless function
// Scrapes or calls tipster data sources and merges with match data.
//
// Three approaches (pick one based on terms of service / stability):
//   A) Scrape Forebet HTML (brittle but free)
//   B) Call Betegy API (paid, structured)
//   C) Use OddsAPI market consensus as a proxy (robust, free tier available)
//
// This scaffold implements Approach C (OddsAPI) as the most reliable MVP option.
// OddsAPI free tier: 500 requests/month — plenty for daily cron usage.

import { kv } from '@vercel/kv';

const ODDS_API_KEY = process.env.ODDS_API_KEY; // from the-odds-api.com

// Sports keys for OddsAPI
const SPORTS = [
  'soccer_uefa_champs_league',
  'soccer_epl',
  'soccer_italy_serie_a',
  'soccer_spain_la_liga',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `tipsters:${today}`;

  // Check cache
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json(cached);
  } catch (_) {}

  const allOdds = [];

  for (const sport of SPORTS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (Array.isArray(data)) allOdds.push(...data);
    } catch (_) {
      // Skip failed sport — continue with others
    }
  }

  // Convert market odds to implied probabilities (consensus signal)
  const tipsterData = allOdds.map(event => {
    const bookmakers = event.bookmakers || [];
    if (!bookmakers.length) return null;

    // Average implied probabilities across all bookmakers
    let sumHome = 0, sumDraw = 0, sumAway = 0, count = 0;
    bookmakers.forEach(bk => {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h) return;
      const outcomes = h2h.outcomes;
      const home = outcomes.find(o => o.name === event.home_team);
      const away = outcomes.find(o => o.name === event.away_team);
      const draw = outcomes.find(o => o.name === 'Draw');
      if (home && away) {
        sumHome += 1 / home.price;
        sumAway += 1 / away.price;
        if (draw) sumDraw += 1 / draw.price;
        count++;
      }
    });

    if (!count) return null;

    const total = sumHome + sumDraw + sumAway;
    const pHome = Math.round(sumHome / total * 100);
    const pDraw = Math.round(sumDraw / total * 100);
    const pAway = Math.round(sumAway / total * 100);

    const bestSide = pHome >= pDraw && pHome >= pAway ? 'home'
                   : pAway >= pDraw ? 'away' : 'draw';
    const bestPct  = Math.max(pHome, pDraw, pAway);
    const pickLabel = bestSide === 'home' ? 'Home win'
                    : bestSide === 'draw' ? 'Draw' : 'Away win';

    return {
      homeTeam:   event.home_team,
      awayTeam:   event.away_team,
      commenceTime: event.commence_time,
      tipsterPick: pickLabel,
      consensus:  `${bestPct}% consensus`,
      probHome:   pHome,
      probDraw:   pDraw,
      probAway:   pAway,
    };
  }).filter(Boolean);

  const payload = { date: today, tipsters: tipsterData };

  try {
    await kv.set(cacheKey, payload, { ex: 43200 });
  } catch (_) {}

  return res.status(200).json(payload);
}
