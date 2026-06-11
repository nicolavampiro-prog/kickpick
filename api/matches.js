// api/matches.js — Vercel serverless function
// Fonte primaria: OddsAPI (partite + odds)
// Fonte secondaria: football-data.org (stats, H2H, form)

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

// football-data.org competition codes
const FD_COMPETITIONS = ['WC', 'CL', 'PL', 'SA', 'PD', 'BL1', 'FL1', 'EL'];

const cache = {};

// Normalizza nome squadra per matching
function norm(str) {
  return str.toLowerCase()
    .replace(/\bfc\b|\baf\b|\bsc\b|\bac\b|\bas\b|\bss\b|\bus\b|\bcd\b|\brc\b|\bud\b|\bsv\b|\bcf\b/g, '')
    .replace(/[^a-z0-9]/g, '').trim();
}

function teamsMatch(a, b) {
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na) ||
    (na.length > 4 && nb.length > 4 && (na.slice(0,5) === nb.slice(0,5)));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const FD_KEY   = process.env.FOOTBALL_DATA_KEY;

  if (!ODDS_KEY) return res.status(500).json({ error: 'ODDS_API_KEY not set' });

  const requestedDate = req.query.date || new Date().toISOString().split('T')[0];

  // Cache hit (2 ore)
  if (cache[requestedDate] && cache[requestedDate].ts > Date.now() - 7200000) {
    return res.status(200).json({ ...cache[requestedDate].data, cached: true });
  }

  const dayStart = new Date(requestedDate + 'T00:00:00Z').getTime();
  const dayEnd   = new Date(requestedDate + 'T23:59:59Z').getTime();

  // ── STEP 1: Fetch partite + odds da OddsAPI ─────────────────────────────────
  const allMatches = [];

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

        const bookmakers = event.bookmakers || [];
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

        let mktPick, mktPct, bestSide;
        if (pHome >= pDraw && pHome >= pAway) { mktPick = 'Home win'; mktPct = pHome; bestSide = 'home'; }
        else if (pAway >= pDraw)              { mktPick = 'Away win'; mktPct = pAway; bestSide = 'away'; }
        else                                  { mktPick = 'Draw';     mktPct = pDraw; bestSide = 'draw'; }

        const getOdd = (name) => {
          const prices = bookmakers.flatMap(bk =>
            bk.markets?.find(m => m.key === 'h2h')?.outcomes
              .filter(o => o.name === name).map(o => o.price) || []);
          return prices.length ? Math.max(...prices).toFixed(2) : '—';
        };
        const drawPrices = bookmakers.flatMap(bk =>
          bk.markets?.find(m => m.key === 'h2h')?.outcomes
            .filter(o => o.name === 'Draw').map(o => o.price) || []);

        allMatches.push({
          id: event.id,
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
            homeGoals: 1.5, awayGoals: 1.5,
            homeH2H: 5, awayH2H: 5,
            hasRealStats: false
          },
          predictions: {
            stats:  { pick: mktPct >= 60 ? mktPick : 'Even match', sub: `${mktPct}% implied` },
            market: { pick: mktPick, sub: `${mktPct}% implied` }
          },
          odds: {
            home: getOdd(event.home_team),
            draw: drawPrices.length ? Math.max(...drawPrices).toFixed(2) : '—',
            away: getOdd(event.away_team),
            best: bestSide
          },
          hasRealOdds: true,
          probHome: pHome,
          probDraw: pDraw,
          probAway: pAway
        });
      }
    } catch (err) {
      console.error(`OddsAPI ${sport.key}:`, err.message);
    }
  }

  // ── STEP 2: Arricchisci con stats da football-data.org ──────────────────────
  if (FD_KEY && allMatches.length > 0) {
    try {
      // Fetch tutte le partite del giorno da football-data.org
      const fdUrl = `https://api.football-data.org/v4/matches?dateFrom=${requestedDate}&dateTo=${requestedDate}`;
      const fdResp = await fetch(fdUrl, { headers: { 'X-Auth-Token': FD_KEY } });

      if (fdResp.ok) {
        const fdData = await fdResp.json();
        const fdMatches = fdData.matches || [];

        // Per ogni match di OddsAPI, cerca il corrispondente in football-data
        for (const match of allMatches) {
          const fdMatch = fdMatches.find(fd =>
            teamsMatch(fd.homeTeam.shortName || fd.homeTeam.name, match.home) &&
            teamsMatch(fd.awayTeam.shortName || fd.awayTeam.name, match.away)
          );

          if (!fdMatch) continue;

          // Aggiorna form se disponibile
          if (fdMatch.homeTeam.form) match.homeForm = fdMatch.homeTeam.form;
          if (fdMatch.awayTeam.form) match.awayForm = fdMatch.awayTeam.form;

          // Aggiorna status
          if (fdMatch.status) match.status = fdMatch.status;

          // Segna che ha stats reali (anche se solo forma)
          match.stats.hasRealStats = true;
        }

        // Fetch H2H per le prime 6 partite (risparmia rate limit)
        const topMatches = allMatches.filter(m => m.stats.hasRealStats).slice(0, 6);
        for (const match of topMatches) {
          const fdMatch = fdMatches.find(fd =>
            teamsMatch(fd.homeTeam.shortName || fd.homeTeam.name, match.home) &&
            teamsMatch(fd.awayTeam.shortName || fd.awayTeam.name, match.away)
          );
          if (!fdMatch) continue;

          try {
            const h2hUrl = `https://api.football-data.org/v4/matches/${fdMatch.id}/head2head?limit=10`;
            const h2hResp = await fetch(h2hUrl, { headers: { 'X-Auth-Token': FD_KEY } });
            if (!h2hResp.ok) continue;
            const h2hData = await h2hResp.json();
            const h2hMatches = h2hData.matches || [];

            if (h2hMatches.length > 0) {
              let homeWins = 0, awayWins = 0, homeGoals = 0, awayGoals = 0;
              for (const hm of h2hMatches) {
                if (hm.score?.fullTime?.home != null) {
                  homeGoals += hm.score.fullTime.home;
                  awayGoals += hm.score.fullTime.away;
                  if (hm.score.fullTime.home > hm.score.fullTime.away) homeWins++;
                  else if (hm.score.fullTime.away > hm.score.fullTime.home) awayWins++;
                }
              }
              const n = h2hMatches.length;
              match.stats = {
                homePoss:  Math.round(match.probHome),
                awayPoss:  Math.round(match.probAway),
                homeGoals: +(homeGoals / n).toFixed(1),
                awayGoals: +(awayGoals / n).toFixed(1),
                homeH2H:   homeWins,
                awayH2H:   awayWins,
                hasRealStats: true
              };
            }
          } catch (e) {
            console.error('H2H fetch error:', e.message);
          }
        }
      }
    } catch (err) {
      console.error('football-data.org error:', err.message);
    }
  }

  // Ordina per orario
  allMatches.sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const payload = { date: requestedDate, matches: allMatches, total: allMatches.length };
  cache[requestedDate] = { ts: Date.now(), data: payload };

  return res.status(200).json(payload);
};
