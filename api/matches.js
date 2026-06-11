// api/matches.js — Vercel serverless function
// Step 1: OddsAPI h2h → partite base
// Step 2: OddsAPI totals + btts → mercati aggiuntivi (separati, non bloccanti)
// Step 3: football-data.org → form + H2H stats
 
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
 
const cache = {};
 
function norm(str) {
  return str.toLowerCase()
    .replace(/\bfc\b|\baf\b|\bsc\b|\bac\b|\bas\b|\bss\b|\bus\b|\bcd\b|\brc\b|\bud\b|\bsv\b|\bcf\b/g, '')
    .replace(/[^a-z0-9]/g, '').trim();
}
 
function teamsMatch(a, b) {
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na) ||
    (na.length > 4 && nb.length > 4 && na.slice(0,5) === nb.slice(0,5));
}
 
function bestOdd(bookmakers, marketKey, outcomeName) {
  const prices = bookmakers.flatMap(bk =>
    bk.markets?.find(m => m.key === marketKey)?.outcomes
      .filter(o => o.name === outcomeName).map(o => o.price) || []);
  return prices.length ? Math.max(...prices).toFixed(2) : null;
}
 
function impliedProb(bookmakers, marketKey, outcomeName) {
  const prices = bookmakers.flatMap(bk =>
    bk.markets?.find(m => m.key === marketKey)?.outcomes
      .filter(o => o.name === outcomeName).map(o => o.price) || []);
  if (!prices.length) return null;
  const avg = prices.reduce((a,b) => a+b, 0) / prices.length;
  return Math.round((1/avg) * 100);
}
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const ODDS_KEY = process.env.ODDS_API_KEY;
  const FD_KEY   = process.env.FOOTBALL_DATA_KEY;
  if (!ODDS_KEY) return res.status(500).json({ error: 'ODDS_API_KEY not set' });
 
  const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
 
  if (cache[requestedDate] && cache[requestedDate].ts > Date.now() - 7200000) {
    return res.status(200).json({ ...cache[requestedDate].data, cached: true });
  }
 
  const dayStart = new Date(requestedDate + 'T00:00:00Z').getTime();
  const dayEnd   = new Date(requestedDate + 'T23:59:59Z').getTime();
 
  const allMatches = [];
 
  // ── STEP 1: h2h — partite base ────────────────────────────────────────────
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
        let sumHome=0, sumDraw=0, sumAway=0, count=0;
 
        for (const b of bk) {
          const h2h = b.markets?.find(m => m.key === 'h2h');
          if (!h2h) continue;
          const home = h2h.outcomes.find(o => o.name === event.home_team);
          const away = h2h.outcomes.find(o => o.name === event.away_team);
          const draw = h2h.outcomes.find(o => o.name === 'Draw');
          if (!home || !away) continue;
          sumHome += 1/home.price;
          sumAway += 1/away.price;
          if (draw) sumDraw += 1/draw.price;
          count++;
        }
        if (!count) continue;
 
        const total = sumHome + sumDraw + sumAway;
        const pHome = Math.round(sumHome/total*100);
        const pDraw = Math.round(sumDraw/total*100);
        const pAway = Math.round(sumAway/total*100);
 
        let mktPick, mktPct, bestSide;
        if (pHome >= pDraw && pHome >= pAway) { mktPick='Home win'; mktPct=pHome; bestSide='home'; }
        else if (pAway >= pDraw)              { mktPick='Away win'; mktPct=pAway; bestSide='away'; }
        else                                  { mktPick='Draw';     mktPct=pDraw; bestSide='draw'; }
 
        const drawPrices = bk.flatMap(b =>
          b.markets?.find(m => m.key==='h2h')?.outcomes
            .filter(o => o.name==='Draw').map(o => o.price) || []);
 
        allMatches.push({
          id: event.id,
          sportKey: sport.key,
          league: sport.name,
          leagueColor: sport.color,
          leagueBg: sport.bg,
          commenceTime: event.commence_time,
          kickoff: new Date(event.commence_time).toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
          }),
          home: event.home_team,
          away: event.away_team,
          status: 'SCHEDULED',
          homeForm: 'WWDLW',
          awayForm: 'WWDLW',
          stats: { homePoss:50, awayPoss:50, homeGoals:1.5, awayGoals:1.5, homeH2H:5, awayH2H:5, hasRealStats:false },
          predictions: {
            stats:  { pick: mktPct >= 60 ? mktPick : 'Even match', sub: `${mktPct}% implied` },
            market: { pick: mktPick, sub: `${mktPct}% implied` }
          },
          odds: {
            home: bestOdd(bk, 'h2h', event.home_team) || '—',
            draw: drawPrices.length ? Math.max(...drawPrices).toFixed(2) : '—',
            away: bestOdd(bk, 'h2h', event.away_team) || '—',
            best: bestSide
          },
          markets: null, // popolato nel Step 2
          hasRealOdds: true,
          probHome: pHome,
          probDraw: pDraw,
          probAway: pAway
        });
      }
    } catch(err) {
      console.error(`h2h ${sport.key}:`, err.message);
    }
  }
 
  if (!allMatches.length) {
    return res.status(200).json({ date: requestedDate, matches: [], total: 0 });
  }
 
  // ── STEP 2: totals + btts — mercati aggiuntivi (non bloccanti) ────────────
  const sportKeys = [...new Set(allMatches.map(m => m.sportKey))];
 
  await Promise.allSettled(sportKeys.map(async sportKey => {
    try {
      // totals
      const totalsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=totals&oddsFormat=decimal`;
      const totalsResp = await fetch(totalsUrl);
      if (!totalsResp.ok) return;
      const totalsEvents = await totalsResp.json();
      if (!Array.isArray(totalsEvents)) return;
 
      // btts
      const bttsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=btts&oddsFormat=decimal`;
      const bttsResp = await fetch(bttsUrl);
      const bttsEvents = bttsResp.ok ? await bttsResp.json() : [];
 
      // Crea mappe per lookup rapido
      const totalsMap = {};
      if (Array.isArray(totalsEvents)) {
        for (const e of totalsEvents) totalsMap[e.id] = e.bookmakers || [];
      }
      const bttsMap = {};
      if (Array.isArray(bttsEvents)) {
        for (const e of bttsEvents) bttsMap[e.id] = e.bookmakers || [];
      }
 
      // Arricchisci le partite corrispondenti
      for (const match of allMatches) {
        if (match.sportKey !== sportKey) continue;
        const tBk = totalsMap[match.id] || [];
        const bBk = bttsMap[match.id]   || [];
 
        if (!tBk.length && !bBk.length) continue;
 
        match.markets = {
          over25:  { prob: impliedProb(tBk,'totals','Over 2.5'),  odd: bestOdd(tBk,'totals','Over 2.5')  },
          under25: { prob: impliedProb(tBk,'totals','Under 2.5'), odd: bestOdd(tBk,'totals','Under 2.5') },
          over15:  { prob: impliedProb(tBk,'totals','Over 1.5'),  odd: bestOdd(tBk,'totals','Over 1.5')  },
          under15: { prob: impliedProb(tBk,'totals','Under 1.5'), odd: bestOdd(tBk,'totals','Under 1.5') },
          bttsYes: { prob: impliedProb(bBk,'btts','Yes'),         odd: bestOdd(bBk,'btts','Yes')         },
          bttsNo:  { prob: impliedProb(bBk,'btts','No'),          odd: bestOdd(bBk,'btts','No')          },
        };
      }
    } catch(err) {
      console.error(`totals/btts ${sportKey}:`, err.message);
    }
  }));
 
  // ── STEP 3: football-data.org — form + H2H (non bloccante) ───────────────
  if (FD_KEY) {
    try {
      const fdResp = await fetch(
        `https://api.football-data.org/v4/matches?dateFrom=${requestedDate}&dateTo=${requestedDate}`,
        { headers: { 'X-Auth-Token': FD_KEY } }
      );
      if (fdResp.ok) {
        const fdData  = await fdResp.json();
        const fdMatches = fdData.matches || [];
 
        for (const match of allMatches) {
          const fd = fdMatches.find(f =>
            teamsMatch(f.homeTeam.shortName || f.homeTeam.name, match.home) &&
            teamsMatch(f.awayTeam.shortName || f.awayTeam.name, match.away)
          );
          if (!fd) continue;
          if (fd.homeTeam.form) match.homeForm = fd.homeTeam.form;
          if (fd.awayTeam.form) match.awayForm = fd.awayTeam.form;
          if (fd.status) match.status = fd.status;
          match.stats.hasRealStats = true;
          match._fdId = fd.id;
        }
 
        // H2H per le prime 6 con match trovato
        const withFd = allMatches.filter(m => m._fdId).slice(0, 6);
        await Promise.allSettled(withFd.map(async match => {
          try {
            const h2hResp = await fetch(
              `https://api.football-data.org/v4/matches/${match._fdId}/head2head?limit=10`,
              { headers: { 'X-Auth-Token': FD_KEY } }
            );
            if (!h2hResp.ok) return;
            const h2hData = await h2hResp.json();
            const h2h = h2hData.matches || [];
            if (!h2h.length) return;
 
            let hw=0, aw=0, hg=0, ag=0;
            for (const hm of h2h) {
              if (hm.score?.fullTime?.home == null) continue;
              hg += hm.score.fullTime.home;
              ag += hm.score.fullTime.away;
              if (hm.score.fullTime.home > hm.score.fullTime.away) hw++;
              else if (hm.score.fullTime.away > hm.score.fullTime.home) aw++;
            }
            const n = h2h.length;
            match.stats = {
              homePoss: match.probHome, awayPoss: match.probAway,
              homeGoals: +(hg/n).toFixed(1), awayGoals: +(ag/n).toFixed(1),
              homeH2H: hw, awayH2H: aw, hasRealStats: true
            };
          } catch(e) { /* skip */ }
        }));
      }
    } catch(err) {
      console.error('football-data:', err.message);
    }
  }
 
  // Ordina per orario e rimuovi campi interni
  allMatches.sort((a,b) => a.kickoff.localeCompare(b.kickoff));
  allMatches.forEach(m => { delete m.sportKey; delete m._fdId; delete m.commenceTime; });
 
  const payload = { date: requestedDate, matches: allMatches, total: allMatches.length };
  cache[requestedDate] = { ts: Date.now(), data: payload };
  return res.status(200).json(payload);
};
