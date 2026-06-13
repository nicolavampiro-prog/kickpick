xed3 · JS
// api/matches.js — Vercel serverless function
// OddsAPI: h2h (partite + odds 1X2)
// football-data.org: form + H2H per competizione
// Poisson model: Over/Under + BTTS calcolati da gol H2H o stima da odds
 
const SPORTS = [
  { key: 'soccer_fifa_world_cup',         name: 'World Cup',        color: '#B91C1C', bg: '#FFF1F2', fdCode: 'WC'  },
  { key: 'soccer_uefa_champs_league',     name: 'Champions League', color: '#7C3AED', bg: '#F5F3FF', fdCode: 'CL'  },
  { key: 'soccer_epl',                    name: 'Premier League',   color: '#059669', bg: '#ECFDF5', fdCode: 'PL'  },
  { key: 'soccer_italy_serie_a',          name: 'Serie A',          color: '#D97706', bg: '#FFFBEB', fdCode: 'SA'  },
  { key: 'soccer_spain_la_liga',          name: 'La Liga',          color: '#DC2626', bg: '#FEF2F2', fdCode: 'PD'  },
  { key: 'soccer_germany_bundesliga',     name: 'Bundesliga',       color: '#B45309', bg: '#FFF7ED', fdCode: 'BL1' },
  { key: 'soccer_france_ligue_one',       name: 'Ligue 1',          color: '#2563EB', bg: '#EFF6FF', fdCode: 'FL1' },
  { key: 'soccer_uefa_europa_league',     name: 'Europa League',    color: '#F97316', bg: '#FFF7ED', fdCode: 'EL'  },
];
 
const cache = {};
 
// ── Poisson ───────────────────────────────────────────────────────────────────
function poisson(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}
function poissonCDF(lambda, k) {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poisson(lambda, i);
  return s;
}
function calcGoalMarkets(hg, ag) {
  const lambda = hg + ag;
  const pO15 = Math.round((1 - poissonCDF(lambda, 1)) * 100);
  const pO25 = Math.round((1 - poissonCDF(lambda, 2)) * 100);
  const pO35 = Math.round((1 - poissonCDF(lambda, 3)) * 100);
  const pBY  = Math.round((1 - poisson(hg, 0)) * (1 - poisson(ag, 0)) * 100);
  const toOdd = p => p > 0 ? (1 / (p / 100)).toFixed(2) : '—';
  return {
    over25:  { prob: pO25,     odd: toOdd(pO25),     source: 'model' },
    under25: { prob: 100-pO25, odd: toOdd(100-pO25), source: 'model' },
    over15:  { prob: pO15,     odd: toOdd(pO15),     source: 'model' },
    under15: { prob: 100-pO15, odd: toOdd(100-pO15), source: 'model' },
    over35:  { prob: pO35,     odd: toOdd(pO35),     source: 'model' },
    under35: { prob: 100-pO35, odd: toOdd(100-pO35), source: 'model' },
    bttsYes: { prob: pBY,      odd: toOdd(pBY),      source: 'model' },
    bttsNo:  { prob: 100-pBY,  odd: toOdd(100-pBY),  source: 'model' },
  };
}
 
// Stima gol attesi dalla forza relativa delle squadre (proxy quando H2H non disponibile)
// Media europea: ~2.5 gol/partita totali, distribuiti in base alla prob di vittoria
function estimateGoals(probHome, probAway) {
  const totalExpected = 2.5;
  const homeStrength = probHome / (probHome + probAway);
  const awayStrength = probAway / (probHome + probAway);
  const hg = +(totalExpected * homeStrength * 0.9).toFixed(1); // leggero malus casa per neutralità
  const ag = +(totalExpected * awayStrength * 0.9).toFixed(1);
  return { hg: Math.max(hg, 0.3), ag: Math.max(ag, 0.3) };
}
 
// ── Name matching ─────────────────────────────────────────────────────────────
function norm(str) {
  return (str || '').toLowerCase()
    .replace(/\b(fc|afc|sc|ac|as|ss|us|cd|rc|ud|sv|cf|bsc|vfb|tsv|tsg|rb|fk|sk)\b/g, '')
    .replace(/[^a-z0-9]/g, '').trim();
}
function teamsMatch(a, b) {
  if (!a || !b) return false;
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na) ||
    (na.length > 4 && nb.length > 4 && na.slice(0, 5) === nb.slice(0, 5));
}
 
// Quota media tra i bookmaker (più rappresentativa del mercato reale)
function avgOdd(bookmakers, outcomeName) {
  const prices = bookmakers.flatMap(bk =>
    bk.markets?.find(m => m.key === 'h2h')?.outcomes
      .filter(o => o.name === outcomeName).map(o => o.price) || []);
  if (!prices.length) return '—';
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  return avg.toFixed(2);
}
 
// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const ODDS_KEY = process.env.ODDS_API_KEY;
  const FD_KEY   = process.env.FOOTBALL_DATA_KEY;
  if (!ODDS_KEY) return res.status(500).json({ error: 'ODDS_API_KEY not set' });
 
  const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
 
  const forceRefresh = req.query.nocache === '1';
  if (!forceRefresh && cache[requestedDate] && cache[requestedDate].ts > Date.now() - 7200000) {
    return res.status(200).json({ ...cache[requestedDate].data, cached: true });
  }
 
  // Filtro data in timezone italiano (UTC+2 estate)
  const tzOffset = '+02:00';
  const dayStart = new Date(requestedDate + 'T00:00:00' + tzOffset).getTime();
  const dayEnd   = new Date(requestedDate + 'T23:59:59' + tzOffset).getTime();
 
  const allMatches = [];
 
  // ── STEP 1: OddsAPI h2h ───────────────────────────────────────────────────
  for (const sport of SPORTS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const events = await resp.json();
      if (!Array.isArray(events)) continue;
 
      for (const event of events) {
        const eventTime = new Date(event.commence_time).getTime();
        if (eventTime < dayStart || eventTime > dayEnd) continue;
 
        const bk = event.bookmakers || [];
        let sumHome = 0, sumDraw = 0, sumAway = 0, count = 0;
 
        for (const b of bk) {
          const h2h = b.markets?.find(m => m.key === 'h2h');
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
 
        let mktPick, mktPct, bestSide;
        if (pHome >= pDraw && pHome >= pAway) { mktPick = 'Home win'; mktPct = pHome; bestSide = 'home'; }
        else if (pAway >= pDraw)              { mktPick = 'Away win'; mktPct = pAway; bestSide = 'away'; }
        else                                  { mktPick = 'Draw';     mktPct = pDraw; bestSide = 'draw'; }
 
        // Quote derivate dalla probabilità implicita (sempre coerenti con le %)
        const homeOdd = pHome > 0 ? (1 / (pHome / 100)).toFixed(2) : '—';
        const drawOdd = pDraw > 0 ? (1 / (pDraw / 100)).toFixed(2) : '—';
        const awayOdd = pAway > 0 ? (1 / (pAway / 100)).toFixed(2) : '—';
 
        // Stima gol da odds (sarà aggiornato con H2H reale se disponibile)
        const { hg: hgEst, ag: agEst } = estimateGoals(pHome, pAway);
 
        allMatches.push({
          id: event.id,
          sportKey: sport.key,
          fdCode: sport.fdCode,
          league: sport.name,
          leagueColor: sport.color,
          leagueBg: sport.bg,
          kickoff: new Date(event.commence_time).toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
          }),
          home: event.home_team,
          away: event.away_team,
          status: 'SCHEDULED',
          homeForm: 'WWDLW',
          awayForm: 'WWDLW',
          stats: {
            homePoss: pHome,
            awayPoss: pAway,
            homeGoals: hgEst,
            awayGoals: agEst,
            homeH2H: 5,
            awayH2H: 5,
            hasRealStats: false
          },
          predictions: {
            stats:  { pick: mktPct >= 60 ? mktPick : 'Even match', sub: `${mktPct}% implied` },
            market: { pick: mktPick, sub: `${mktPct}% implied` }
          },
          odds: {
            home: homeOdd,
            draw: drawOdd,
            away: awayOdd,
            best: bestSide
          },
          // Mercati Poisson calcolati già dalla stima odds
          markets: calcGoalMarkets(hgEst, agEst),
          hasRealOdds: true,
          probHome: pHome,
          probDraw: pDraw,
          probAway: pAway
        });
      }
    } catch (err) {
      console.error(`${sport.key}:`, err.message);
    }
  }
 
  if (!allMatches.length) {
    return res.status(200).json({ date: requestedDate, matches: [], total: 0 });
  }
 
  // ── STEP 2: football-data.org per competizione — form + H2H ──────────────
  if (FD_KEY) {
    const byCode = {};
    for (const m of allMatches) {
      if (!byCode[m.fdCode]) byCode[m.fdCode] = [];
      byCode[m.fdCode].push(m);
    }
 
    await Promise.allSettled(Object.entries(byCode).map(async ([fdCode, matches]) => {
      try {
        const url = `https://api.football-data.org/v4/competitions/${fdCode}/matches?dateFrom=${requestedDate}&dateTo=${requestedDate}`;
        const resp = await fetch(url, { headers: { 'X-Auth-Token': FD_KEY } });
        if (!resp.ok) return;
 
        const fdMatches = (await resp.json()).matches || [];
        if (!fdMatches.length) return;
 
        for (const match of matches) {
          const fd = fdMatches.find(f =>
            teamsMatch(f.homeTeam.shortName || f.homeTeam.name, match.home) &&
            teamsMatch(f.awayTeam.shortName || f.awayTeam.name, match.away)
          );
          if (!fd) continue;
          if (fd.homeTeam.form) match.homeForm = fd.homeTeam.form;
          if (fd.awayTeam.form) match.awayForm = fd.awayTeam.form;
          if (fd.status) match.status = fd.status;
          match._fdId = fd.id;
        }
 
        // H2H per le prime 5 partite trovate
        const withFd = matches.filter(m => m._fdId).slice(0, 5);
        await Promise.allSettled(withFd.map(async match => {
          try {
            const r = await fetch(
              `https://api.football-data.org/v4/matches/${match._fdId}/head2head?limit=10`,
              { headers: { 'X-Auth-Token': FD_KEY } }
            );
            if (!r.ok) return;
            const h2h = (await r.json()).matches || [];
            if (h2h.length < 3) return; // Almeno 3 precedenti per essere significativo
 
            let hw = 0, aw = 0, hg = 0, ag = 0;
            for (const hm of h2h) {
              if (hm.score?.fullTime?.home == null) continue;
              hg += hm.score.fullTime.home;
              ag += hm.score.fullTime.away;
              if (hm.score.fullTime.home > hm.score.fullTime.away) hw++;
              else if (hm.score.fullTime.away > hm.score.fullTime.home) aw++;
            }
            const n = h2h.length;
            const hgAvg = +(hg / n).toFixed(1);
            const agAvg = +(ag / n).toFixed(1);
 
            // Aggiorna stats con dati H2H reali
            match.stats = {
              homePoss:  match.probHome,
              awayPoss:  match.probAway,
              homeGoals: hgAvg,
              awayGoals: agAvg,
              homeH2H:   hw,
              awayH2H:   aw,
              hasRealStats: true
            };
 
            // Ricalcola mercati Poisson con gol reali
            match.markets = calcGoalMarkets(hgAvg, agAvg);
 
          } catch (e) { /* skip */ }
        }));
 
      } catch (err) {
        console.error(`FD ${fdCode}:`, err.message);
      }
    }));
  }
 
  allMatches.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  allMatches.forEach(m => { delete m.sportKey; delete m.fdCode; delete m._fdId; });
 
  const payload = { date: requestedDate, matches: allMatches, total: allMatches.length };
  cache[requestedDate] = { ts: Date.now(), data: payload };
  return res.status(200).json(payload);
};
