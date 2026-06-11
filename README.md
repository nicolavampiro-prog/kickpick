# KickPick — AI Football Predictions

A static-first football tipster platform: live stats + Claude AI analysis + tipster consensus.
Deployable on Vercel in under 10 minutes. AdSense-ready.

---

## Architecture

```
kickpick/
├── index.html              ← Homepage (today's matches)
├── pages/
│   ├── tomorrow.html       ← Tomorrow's fixtures
│   ├── leagues.html        ← Browse by competition
│   ├── how-it-works.html   ← Methodology (SEO page)
│   ├── methodology.html    ← (stub — add content)
│   ├── accuracy.html       ← (stub — add track record)
│   ├── disclaimer.html     ← Required for AdSense
│   ├── privacy.html        ← Required for AdSense
│   └── terms.html          ← Required for AdSense
├── css/
│   └── style.css           ← All styles (single shared file)
├── js/
│   ├── shared.js           ← Nav, footer, card renderer
│   └── matches.js          ← Mock data (swap for live API calls)
├── api/
│   ├── matches.js          ← Serverless: API-Football + Claude AI
│   ├── tipsters.js         ← Serverless: OddsAPI consensus
│   └── refresh.js          ← Cron: daily 07:00 UTC cache warm
└── vercel.json             ← Deployment + cron config
```

---

## Quick deploy

### 1. Fork and connect to Vercel

```bash
git clone https://github.com/yourusername/kickpick.git
cd kickpick
vercel
```

### 2. Set environment variables (Vercel dashboard → Settings → Environment Variables)

| Variable | Where to get it |
|---|---|
| `API_FOOTBALL_KEY` | apifootball.com — free tier (100 calls/day) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ODDS_API_KEY` | the-odds-api.com — free tier (500 req/month) |
| `CRON_SECRET` | Any random string — paste in both Vercel and vercel.json |

### 3. Enable Vercel KV (for caching)

```
Vercel dashboard → Storage → Create KV Database → link to project
```

This gives you a free Redis-compatible store. Both API functions cache their results here for 12 hours so live API calls happen once daily, not per visitor.

### 4. Connect AdSense

Your publisher ID is: **ca-pub-3317133080155321**

Once approved by Google:
1. Uncomment the AdSense script tag in `index.html` (and other pages)
2. Replace the `<div class="ad-slot ...">` placeholders with proper `<ins>` tags
3. Or use the `adsenseSlot()` helper in `shared.js`

Ad slots are placed at:
- Leaderboard (728×90) — below hero on every page  
- Sidebar rectangle (300×250) — right column on desktop  
- Inline (between match cards 3 and 4) — high viewability position

---

## Live data integration

### Swapping mock data for real API

In `index.html`, replace the call to `getMatches()` with a fetch:

```js
// Replace this:
renderMatches('all');

// With this:
fetch('/api/matches')
  .then(r => r.json())
  .then(data => {
    window._matches = data.matches;   // store globally
    renderMatches('all');
  });
```

Then in `shared.js`, update `renderMatchCard()` to map from the API-Football 
response shape to the card format. The key fields are:

```
fix.teams.home.name
fix.teams.away.name
fix.fixture.date          → kickoff time
fix.league.name           → league
fix._aiPick.pick          → AI prediction (added by /api/matches.js)
fix._tipsterPick.pick     → Tipster pick (added by /api/tipsters.js after merging)
fix.odds[0].bookmakers    → raw odds
```

### Merging tipster data with matches

In `/api/matches.js`, after fetching both data sources, merge by team name:

```js
const tipsterMap = tipsterData.reduce((acc, t) => {
  const key = `${t.homeTeam}::${t.awayTeam}`;
  acc[key] = t;
  return acc;
}, {});

enriched.forEach(fix => {
  const key = `${fix.teams.home.name}::${fix.teams.away.name}`;
  fix._tipsterPick = tipsterMap[key] || null;
});
```

---

## SEO notes

- Each page has a unique `<title>` and `<meta name="description">`
- Homepage has WebSite structured data (JSON-LD)
- Consider adding BreadcrumbList and SportsEvent schema to match cards for rich results
- Add `sitemap.xml` for faster Google indexing
- The "how it works" and "methodology" pages are important for E-E-A-T signals (AdSense approval likes them)

---

## AdSense approval checklist

- [ ] Disclaimer page live (responsible gambling warning)
- [ ] Privacy policy live  
- [ ] Terms of use live
- [ ] At least 10–15 pages of original content
- [ ] No copyrighted logos or images
- [ ] Site is indexed by Google (submit sitemap)
- [ ] Domain is at least a few weeks old
- [ ] No broken links

---

## Cost estimate (monthly)

| Service | Free tier | Paid |
|---|---|---|
| Vercel hosting | Free | — |
| API-Football | 100 calls/day free | €9.99/mo for 7,500/day |
| Anthropic Claude | ~$0.003 per match | ~$1–3/mo for 6 matches/day |
| OddsAPI | 500 req/month free | $9.99/mo for more |
| Vercel KV | 30k reads/month free | — |
| **Total MVP** | **~$0** | **~$15/mo at scale** |
