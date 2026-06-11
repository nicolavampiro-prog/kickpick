// matches.js — fixture data layer
// In production: replace fetchMatches() with a real API-Football call
// via a Vercel serverless function (see /api/matches.js)

const MOCK_MATCHES = [
  {
    id: 'm1',
    league: 'Champions League',
    stage: 'Semi-finals',
    kickoff: '20:45',
    home: 'Arsenal',
    away: 'PSG',
    featured: true,
    homeForm: 'WWWDW',
    awayForm: 'WWWWL',
    stats: {
      homeGoals: 2.4, awayGoals: 2.1,
      homePoss: 58, h2hHome: 4, h2hAway: 3
    },
    predictions: {
      stats:    { pick: '1 or X',     sub: '44% home win' },
      ai:       { pick: 'Over 2.5',   sub: '71% confidence' },
      tipsters: { pick: 'Home win',   sub: '58% consensus' }
    },
    odds: { home: '2.10', draw: '3.50', away: '3.30', bestSide: 'home' }
  },
  {
    id: 'm2',
    league: 'Premier League',
    stage: 'Matchday 38',
    kickoff: '21:00',
    home: 'Manchester City',
    away: 'Liverpool',
    featured: false,
    homeForm: 'WWLWW',
    awayForm: 'WWWWD',
    stats: {
      homeGoals: 2.2, awayGoals: 2.0,
      homePoss: 62, h2hHome: 7, h2hAway: 5
    },
    predictions: {
      stats:    { pick: 'Home win',   sub: '51% home win' },
      ai:       { pick: 'BTTS Yes',   sub: '69% confidence' },
      tipsters: { pick: 'BTTS Yes',   sub: '73% consensus' }
    },
    odds: { home: '1.95', draw: '3.60', away: '3.90', bestSide: 'home' }
  },
  {
    id: 'm3',
    league: 'Serie A',
    stage: 'Matchday 35',
    kickoff: '18:00',
    home: 'Inter Milan',
    away: 'Juventus',
    featured: false,
    homeForm: 'WDWWW',
    awayForm: 'LWDWW',
    stats: {
      homeGoals: 1.9, awayGoals: 1.4,
      homePoss: 55, h2hHome: 6, h2hAway: 8
    },
    predictions: {
      stats:    { pick: 'Draw',       sub: '36% draw prob.' },
      ai:       { pick: 'Under 2.5',  sub: '62% confidence' },
      tipsters: { pick: 'Draw',       sub: '49% consensus' }
    },
    odds: { home: '2.30', draw: '3.10', away: '3.20', bestSide: 'draw' }
  },
  {
    id: 'm4',
    league: 'La Liga',
    stage: 'Matchday 35',
    kickoff: '21:00',
    home: 'Barcelona',
    away: 'Atletico Madrid',
    featured: false,
    homeForm: 'WWWWW',
    awayForm: 'WLWWW',
    stats: {
      homeGoals: 2.6, awayGoals: 1.7,
      homePoss: 64, h2hHome: 9, h2hAway: 6
    },
    predictions: {
      stats:    { pick: 'Home win',   sub: '55% home win' },
      ai:       { pick: '1 & O 1.5',  sub: '74% confidence' },
      tipsters: { pick: 'Home win',   sub: '68% consensus' }
    },
    odds: { home: '1.75', draw: '3.70', away: '4.80', bestSide: 'home' }
  },
  {
    id: 'm5',
    league: 'Bundesliga',
    stage: 'Matchday 33',
    kickoff: '15:30',
    home: 'Borussia Dortmund',
    away: 'RB Leipzig',
    featured: false,
    homeForm: 'WDWLW',
    awayForm: 'WWWDL',
    stats: {
      homeGoals: 2.1, awayGoals: 2.0,
      homePoss: 51, h2hHome: 5, h2hAway: 6
    },
    predictions: {
      stats:    { pick: 'Over 2.5',   sub: '61% o2.5 prob.' },
      ai:       { pick: 'Over 2.5',   sub: '66% confidence' },
      tipsters: { pick: 'Away win',   sub: '52% consensus' }
    },
    odds: { home: '2.60', draw: '3.30', away: '2.70', bestSide: 'away' }
  },
  {
    id: 'm6',
    league: 'Ligue 1',
    stage: 'Matchday 32',
    kickoff: '20:00',
    home: 'Marseille',
    away: 'Monaco',
    featured: false,
    homeForm: 'WDWWL',
    awayForm: 'WWWDW',
    stats: {
      homeGoals: 1.8, awayGoals: 2.0,
      homePoss: 49, h2hHome: 5, h2hAway: 7
    },
    predictions: {
      stats:    { pick: 'Away win',   sub: '42% away win' },
      ai:       { pick: 'Away win',   sub: '60% confidence' },
      tipsters: { pick: 'Away win',   sub: '61% consensus' }
    },
    odds: { home: '2.80', draw: '3.20', away: '2.50', bestSide: 'away' }
  }
];

// Top AI picks for sidebar (matches where all 3 signals agree)
const BEST_BETS = [
  { match: 'Barcelona vs Atletico',  pick: 'Home win',  odd: '1.75' },
  { match: 'Marseille vs Monaco',    pick: 'Away win',  odd: '2.50' },
  { match: 'Dortmund vs Leipzig',    pick: 'Over 2.5',  odd: '1.85' },
  { match: 'Man City vs Liverpool',  pick: 'BTTS Yes',  odd: '1.70' },
];

// In production this would be:
// async function fetchMatches(date) {
//   const res = await fetch(`/api/matches?date=${date}`);
//   return res.json();
// }

function getMatches() { return MOCK_MATCHES; }
function getBestBets() { return BEST_BETS; }
