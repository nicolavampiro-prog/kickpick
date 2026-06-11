// api/matches.js — Vercel serverless function
// Una sola chiamata per sport con h2h,totals,btts
// Se i mercati aggiuntivi non sono disponibili, usa solo h2h
 
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
 
function extractMarkets(bk) {
  const o25  = { prob: impliedProb(bk,'totals','Over 2.5'),  odd: bestOdd(bk,'totals','Over 2.5')  };
  const u25  = { prob: impliedProb(bk,'totals','Under 2.5'), odd: bestOdd(bk,'totals','Under 2.5') };
  const o15  = { prob: impliedProb(bk,'totals','Over 1.5'),  odd: bestOdd(bk,'totals','Over 1.5')  };
  const u15  = { prob: impliedProb(bk,'totals','Under 1.5'), odd: bestOdd(bk,'totals','Under 1.5') };
  const byes = { prob: impliedProb(bk,'btts','Yes'),         odd: bestOdd(bk,'btts','Yes')         };
  const bno  = { prob: impliedProb(bk,'btts','No'),          odd: bestOdd(bk,'btts','No')          };
 
  // Restituisce null se nessun dato disponibile
  if (!o25.prob && !u25.prob && !byes.prob) return null;
 
  return { over25: o25, under25: u25, over15: o15, under15: u15, bttsYes: byes, bttsNo: bno };
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
 
  for (const sport of SPORTS) {
    try {
      // Prova prima con tutti e tre i mercati
      let events = null;
      let usedAllMarkets = false;
 
      try {
        const urlAll = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=h2h,totals,btts&oddsFormat=decimal`;
        const respAll = await fetch(urlAll);
        if (respAll.ok) {
          const data = await respAll.json();
          if (Array.isArray(data) && data.length > 0) {
            events = data;
            usedAllMarkets = true;
          }
        }
      } catch(e) { /* fallback */ }
 
      // Fallback: solo h2h
      if (!events) {
        const urlH2h = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
        const respH2h = await fetch(urlH2h);
        if (!respH2h.ok) continue;
        const data = await respH2h.json();
        if (!Array.isArray(data)) continue;
        events = data;
      }
 
      for (const event of events) {
        const eventTime = new Date(event.commence_time).getTime();
        if (eventTime < dayStart || eventTime > dayEnd) continue;
 
        const bk = event.bookmakers || [];
 
        // 1X2
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
            home: bestOdd(bk,'h2h',event.home_team) || '—',
            draw: drawPrices.length ? Math.max(...drawPrices).toFixed(2) : '—',
            away: bestOdd(bk,'h2h',event.away_team) || '—',
            best: bestSide
          },
          markets: usedAllMarkets ? extractMarkets(bk) : null,
          hasRealOdds: true,
          probHome: pHome,
          probDraw: pDraw,
          probAway: pAway
        });
      }
    } catch(err) {
      console.error(`${sport.key}:`, err.message);
    }
  }
 
  // ── STEP 2: football-data.org — form + H2H ────────────────────────────────
  if (FD_KEY && allMatches.length > 0) {
    try {
      const fdResp = await fetch(
        `https://api.football-data.org/v4/matches?dateFrom=${requestedDate}&dateTo=${requestedDate}`,
        { headers: { 'X-Auth-Token': FD_KEY } }
      );
      if (fdResp.ok) {
        const fdMatches = (await fdResp.json()).matches || [];
 
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
 
        const withFd = allMatches.filter(m => m._fdId).slice(0, 6);
        await Promise.allSettled(withFd.map(async match => {
          try {
            const r = await fetch(
              `https://api.football-data.org/v4/matches/${match._fdId}/head2head?limit=10`,
              { headers: { 'X-Auth-Token': FD_KEY } }
            );
            if (!r.ok) return;
            const h2h = (await r.json()).matches || [];
            if (!h2h.length) return;
            let hw=0, aw=0, hg=0, ag=0;
            for (const hm of h2h) {
              if (hm.score?.fullTime?.home == null) continue;
              hg += hm.score.fullTime.home; ag += hm.score.fullTime.away;
              if (hm.score.fullTime.home > hm.score.fullTime.away) hw++;
              else if (hm.score.fullTime.away > hm.score.fullTime.home) aw++;
            }
            const n = h2h.length;
            match.stats = {
              homePoss: match.probHome, awayPoss: match.probAway,
              homeGoals: +(hg/n).toFixed(1), awayGoals: +(ag/n).toFixed(1),
              homeH2H: hw, awayH2H: aw, hasRealStats: true
            };
          } catch(e) {}
        }));
      }
    } catch(err) {
      console.error('football-data:', err.message);
    }
  }
 
  allMatches.sort((a,b) => a.kickoff.localeCompare(b.kickoff));
  allMatches.forEach(m => { delete m.sportKey; delete m._fdId; });
 
  const payload = { date: requestedDate, matches: allMatches, total: allMatches.length };
  cache[requestedDate] = { ts: Date.now(), data: payload };
  return res.status(200).json(payload);
};
