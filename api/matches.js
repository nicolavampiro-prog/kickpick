// api/matches.js — Vercel serverless function
// OddsAPI: h2h (partite + odds 1X2)
// football-data.org: form + H2H stats
// Poisson model: Over/Under 1.5 / 2.5 / 3.5 + BTTS calcolati da gol H2H

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

// ── Poisson helpers ───────────────────────────────────────────────────────────

// P(X = k) con media lambda
function poisson(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) result *= lambda / i;
  return result;
}

// P(X <= k)
function poissonCDF(lambda, k) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poisson(lambda, i);
  return sum;
}

// Calcola tutti i mercati goals da media gol attesa home + away
function calcGoalMarkets(homeGoals, awayGoals) {
  const lambda = homeGoals + awayGoals; // media totale gol per partita

  const pOver15  = Math.round((1 - poissonCDF(lambda, 1)) * 100);
  const pUnder15 = 100 - pOver15;
  const pOver25  = Math.round((1 - poissonCDF(lambda, 2)) * 100);
  const pUnder25 = 100 - pOver25;
  const pOver35  = Math.round((1 - poissonCDF(lambda, 3)) * 100);
  const pUnder35 = 100 - pOver35;

  // BTTS: P(home scores >= 1) * P(away scores >= 1)
  const pHomeSc = Math.round((1 - poisson(homeGoals, 0)) * 100);
  const pAwaySc = Math.round((1 - poisson(awayGoals, 0)) * 100);
  const pBttsYes = Math.round((pHomeSc / 100) * (pAwaySc / 100) * 100);
  const pBttsNo  = 100 - pBttsYes;

  // Converti probabilità in quota indicativa (senza margine bookmaker)
  const toOdd = (pct) => pct > 0 ? (1 / (pct / 100)).toFixed(2) : '—';

  return {
    over25:  { prob: pOver25,  odd: toOdd(pOver25),  source: 'model' },
    under25: { prob: pUnder25, odd: toOdd(pUnder25), source: 'model' },
    over15:  { prob: pOver15,  odd: toOdd(pOver15),  source: 'model' },
    under15: { prob: pUnder15, odd: toOdd(pUnder15), source: 'model' },
    over35:  { prob: pOver35,  odd: toOdd(pOver35),  source: 'model' },
    under35: { prob: pUnder35, odd: toOdd(pUnder35), source: 'model' },
    bttsYes: { prob: pBttsYes, odd: toOdd(pBttsYes), source: 'model' },
    bttsNo:  { prob: pBttsNo,  odd: toOdd(pBttsNo),  source: 'model' },
  };
}

// ── Name matching helpers ─────────────────────────────────────────────────────
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

function bestOdd(bookmakers, outcomeName) {
  const prices = bookmakers.flatMap(bk =>
    bk.markets?.find(m => m.key === 'h2h')?.outcomes
      .filter(o => o.name === outcomeName).map(o => o.price) || []);
  return prices.length ? Math.max(...prices).toFixed(2) : '—';
}

// Controlla se una data è in ora legale italiana (ultima dom. marzo → ultima dom. ottobre)
function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.min(jan, jul) === date.getTimezoneOffset();
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

  if (cache[requestedDate] && cache[requestedDate].ts > Date.now() - 7200000) {
    return res.status(200).json({ ...cache[requestedDate].data, cached: true });
  }

  // Timezone italiano (UTC+2 estate, UTC+1 inverno)
  const tzOffset = isDST(new Date(requestedDate)) ? '+02:00' : '+01:00';
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

        // Calcola mercati gol con media di default (1.2 + 1.2 = partita normale)
        // Verrà aggiornato con dati H2H reali nello Step 2
        const defaultMarkets = calcGoalMarkets(1.2, 1.2);

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
          stats: {
            homePoss: 50, awayPoss: 50,
            homeGoals: 1.2, awayGoals: 1.2,
            homeH2H: 5, awayH2H: 5,
            hasRealStats: false
          },
          predictions: {
            stats:  { pick: mktPct >= 60 ? mktPick : 'Even match', sub: `${mktPct}% implied` },
            market: { pick: mktPick, sub: `${mktPct}% implied` }
          },
          odds: {
            home: bestOdd(bk, event.home_team),
            draw: drawPrices.length ? Math.max(...drawPrices).toFixed(2) : '—',
            away: bestOdd(bk, event.away_team),
            best: bestSide
          },
          markets: defaultMarkets,
          hasRealOdds: true,
          probHome: pHome, probDraw: pDraw, probAway: pAway
        });
      }
    } catch(err) {
      console.error(`${sport.key}:`, err.message);
    }
  }

  if (!allMatches.length) {
    return res.status(200).json({ date: requestedDate, matches: [], total: 0 });
  }

  // ── STEP 2: football-data.org — form + H2H → aggiorna mercati Poisson ─────
  if (FD_KEY) {
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

        // H2H per le prime 6 partite con match trovato
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
              hg += hm.score.fullTime.home;
              ag += hm.score.fullTime.away;
              if (hm.score.fullTime.home > hm.score.fullTime.away) hw++;
              else if (hm.score.fullTime.away > hm.score.fullTime.home) aw++;
            }
            const n = h2h.length;
            const homeGoalsAvg = +(hg/n).toFixed(1);
            const awayGoalsAvg = +(ag/n).toFixed(1);

            // Aggiorna stats con dati reali
            match.stats = {
              homePoss:  match.probHome,
              awayPoss:  match.probAway,
              homeGoals: homeGoalsAvg,
              awayGoals: awayGoalsAvg,
              homeH2H:   hw,
              awayH2H:   aw,
              hasRealStats: true
            };

            // Ricalcola mercati Poisson con gol H2H reali
            match.markets = calcGoalMarkets(homeGoalsAvg, awayGoalsAvg);

          } catch(e) { /* skip */ }
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
