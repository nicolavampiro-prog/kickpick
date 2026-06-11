// shared.js — nav, footer, and utilities injected into every page

// ── Inject nav ────────────────────────────────────────────────────────────────
function injectNav(activePage) {
  const pages = [
    { href: '/index.html',       label: 'Today',      id: 'today' },
    { href: '/pages/tomorrow.html', label: 'Tomorrow', id: 'tomorrow' },
    { href: '/pages/leagues.html',  label: 'Leagues',  id: 'leagues' },
    { href: '/pages/how-it-works.html', label: 'How it works', id: 'how' },
  ];

  const links = pages.map(p =>
    `<li><a href="${p.href}" class="${p.id === activePage ? 'active' : ''}">${p.label}</a></li>`
  ).join('');

  document.getElementById('site-nav').innerHTML = `
    <nav class="site-nav">
      <div class="container nav-inner">
        <a href="/index.html" class="nav-logo">
          ⚽ Kick<span class="logo-accent">Pick</span>
        </a>
        <ul class="nav-links" id="nav-links-list">
          ${links}
          <li><a href="/pages/how-it-works.html" class="nav-cta">How it works</a></li>
        </ul>
        <button class="nav-burger" id="nav-burger" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
  `;

  // Mobile burger toggle
  document.getElementById('nav-burger').addEventListener('click', () => {
    document.getElementById('nav-links-list').classList.toggle('open');
  });
}

// ── Inject footer ─────────────────────────────────────────────────────────────
function injectFooter() {
  document.getElementById('site-footer').innerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <div class="nav-logo" style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;">
              ⚽ Kick<span class="logo-accent">Pick</span>
            </div>
            <p>AI-powered football predictions combining live stats, machine learning, and tipster consensus. Updated daily for European fixtures.</p>
            <div class="gambling-warning">
              ⚠ For entertainment only. Please gamble responsibly. 18+
              BeGambleAware.org · GamStop.co.uk
            </div>
          </div>
          <div class="footer-col">
            <h4>Predictions</h4>
            <ul>
              <li><a href="/index.html">Today's matches</a></li>
              <li><a href="/pages/tomorrow.html">Tomorrow</a></li>
              <li><a href="/pages/leagues.html">By league</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Info</h4>
            <ul>
              <li><a href="/pages/how-it-works.html">How it works</a></li>
              <li><a href="/pages/methodology.html">Methodology</a></li>
              <li><a href="/pages/accuracy.html">Track record</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <ul>
              <li><a href="/pages/disclaimer.html">Disclaimer</a></li>
              <li><a href="/pages/privacy.html">Privacy</a></li>
              <li><a href="/pages/terms.html">Terms</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>© ${new Date().getFullYear()} KickPick. Data: API-Football · AI: Claude API · Odds: various bookmakers.</p>
          <p>Not affiliated with any betting operator.</p>
        </div>
      </div>
    </footer>
  `;
}

// ── Today's date formatted ────────────────────────────────────────────────────
function formatToday() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ── Render a form bar (W/D/L string like "WWDLW") ─────────────────────────────
function renderForm(str) {
  return str.split('').map(c => {
    const cls = c === 'W' ? 'form-w' : c === 'D' ? 'form-d' : 'form-l';
    return `<span class="form-pip ${cls}">${c}</span>`;
  }).join('');
}

// ── Render a single match card ────────────────────────────────────────────────
function renderMatchCard(match) {
  const leagueColors = {
    'Champions League': '#38bdf8',
    'Premier League':   '#22c55e',
    'Serie A':          '#f5a623',
    'La Liga':          '#ef4444',
    'Bundesliga':       '#a78bfa',
    'Ligue 1':          '#fb923c',
  };
  const pip = leagueColors[match.league] || '#8ba0bc';

  const homeHomePct = Math.round(
    match.stats.homeGoals / (match.stats.homeGoals + match.stats.awayGoals) * 100
  );

  return `
  <article class="match-card ${match.featured ? 'featured' : ''}" data-league="${match.league}">
    <div class="card-league-bar">
      <span class="league-label">
        <span class="league-pip" style="background:${pip}"></span>
        ${match.league} · ${match.stage || 'Matchday'}
      </span>
      <span class="kickoff-time">⏱ ${match.kickoff}</span>
    </div>
    <div class="card-body">
      <div class="teams-row">
        <div class="team home">
          <span class="team-name">${match.home}</span>
          <div class="team-form">${renderForm(match.homeForm)}</div>
        </div>
        <div class="vs-center">
          <span class="vs-label">vs</span>
          <span class="vs-score">—</span>
        </div>
        <div class="team away">
          <span class="team-name">${match.away}</span>
          <div class="team-form">${renderForm(match.awayForm)}</div>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-item">
          <div class="stat-name">Avg goals</div>
          <div class="stat-vals">
            <span class="stat-val-home">${match.stats.homeGoals}</span>
            <div class="stat-bar"><div class="stat-bar-fill" style="width:${homeHomePct}%"></div></div>
            <span class="stat-val-away">${match.stats.awayGoals}</span>
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-name">Possession</div>
          <div class="stat-vals">
            <span class="stat-val-home">${match.stats.homePoss}%</span>
            <div class="stat-bar"><div class="stat-bar-fill" style="width:${match.stats.homePoss}%"></div></div>
            <span class="stat-val-away">${100 - match.stats.homePoss}%</span>
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-name">H2H wins</div>
          <div class="stat-vals">
            <span class="stat-val-home">${match.stats.h2hHome}</span>
            <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.round(match.stats.h2hHome/(match.stats.h2hHome+match.stats.h2hAway)*100)}%"></div></div>
            <span class="stat-val-away">${match.stats.h2hAway}</span>
          </div>
        </div>
      </div>

      <div class="pred-strip">
        <div class="pred-col col-stats">
          <div class="pred-source">📊 Stats model</div>
          <div class="pred-pick">${match.predictions.stats.pick}</div>
          <div class="pred-sub">${match.predictions.stats.sub}</div>
        </div>
        <div class="pred-col col-ai">
          <div class="pred-source">🤖 AI pick</div>
          <div class="pred-pick">${match.predictions.ai.pick}</div>
          <div class="pred-sub">${match.predictions.ai.sub}</div>
        </div>
        <div class="pred-col col-tipster">
          <div class="pred-source">👥 Tipsters</div>
          <div class="pred-pick">${match.predictions.tipsters.pick}</div>
          <div class="pred-sub">${match.predictions.tipsters.sub}</div>
        </div>
      </div>

      <div class="odds-row">
        <div class="odd-btn ${match.odds.bestSide === 'home' ? 'best' : ''}">
          <span class="odd-label">Home win</span>
          <span class="odd-value">${match.odds.home}</span>
        </div>
        <div class="odd-btn ${match.odds.bestSide === 'draw' ? 'best' : ''}">
          <span class="odd-label">Draw</span>
          <span class="odd-value">${match.odds.draw}</span>
        </div>
        <div class="odd-btn ${match.odds.bestSide === 'away' ? 'best' : ''}">
          <span class="odd-label">Away win</span>
          <span class="odd-value">${match.odds.away}</span>
        </div>
      </div>
    </div>
  </article>
  `;
}

// ── AdSense slot helper ───────────────────────────────────────────────────────
// Replace data-ad-slot values with your real AdSense slot IDs
// Publisher ID: ca-pub-3317133080155321
function adsenseSlot(slotId, size = 'leaderboard') {
  return `
  <ins class="adsbygoogle ad-slot ad-slot-${size}"
       style="display:block"
       data-ad-client="ca-pub-3317133080155321"
       data-ad-slot="${slotId}"
       data-ad-format="auto"
       data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>
  `;
}
