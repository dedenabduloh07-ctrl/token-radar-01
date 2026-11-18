// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filters, a per-protocol detail view with the model's own inputs and the
// protocol's farm plan, and the model itself. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with impliedOf, the same arithmetic
// lib/model.ts runs, and regenerates every farm plan with farmSteps, the same derivation main.ts
// writes to board.json — so the screenshots, the code and the board agree by construction.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA) {
    app.textContent = 'No radar data: data.js did not load beside this page.';
    return;
  }
  var WATCHLIST = {};
  DATA.watchlist.forEach(function (slug) { WATCHLIST[slug] = true; });
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }

  // The model in one function: TVL times the market-calibrated multiple, adjusted by seven-day
  // growth and by how long the protocol has run with no token recorded.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
  }
  function growthOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    return { pct: growth, mult: 1 + (growth / 100) * model.growth_weight };
  }
  function maturityOf(row, model) {
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'about $5 to $15 of gas';
    if (c === 'solana' || c.indexOf('hyperliquid') >= 0 || c.indexOf('sui') >= 0 || c === 'aptos') return 'under $0.10 of gas';
    if (c === 'binance' || c.indexOf('bnb') >= 0) return 'under $0.50 of gas';
    if (c === 'bitcoin') return 'a few dollars of network fees';
    if (c === 'tron') return 'under $1 of energy fees';
    return 'under $1 of gas';
  }
  function weeklyGasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'about $5 of gas a week';
    if (c === 'bitcoin') return 'a few dollars of fees a week';
    return 'about $1 of gas a week';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('uncollateralized') >= 0) return 'Lend $' + capital + ' of USDC through ' + name + ' on ' + chain + ' and keep the loan position open.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('leveraged farm') >= 0) return 'Open a leveraged farm with $' + capital + ' on ' + name + ' on ' + chain + ' at the lowest leverage it offers, and watch the health factor.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' managed liquidity position on ' + chain + ' and keep it in range.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.';
    if (c.indexOf('dex') >= 0 || c.indexOf('exchange') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' yield vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' basis strategy on ' + chain + ' and hold the position through one funding cycle.';
    if (c.indexOf('interest rate') >= 0) return 'Deposit $' + capital + ' on ' + name + ' on ' + chain + ' and open one fixed-rate position.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset through " + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Deposit $' + capital + ' worth of BTC through ' + name + ' on ' + chain + ' and hold the receipt token.';
    if (c.indexOf('stablecoin') >= 0 || c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('payment') >= 0) return 'Fund $' + capital + ' and make one real payment through ' + name + ' on ' + chain + '.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' and vote in one governance round on ' + name + '.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' farm on ' + chain + ' and keep the position staked.';
    if (c.indexOf('card') >= 0) return 'Load $' + capital + ' onto the ' + name + ' card and spend it in one real purchase.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ', swap once, and deposit into one of its native apps.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: "Return each week and make one real action in " + p.name + " — a deposit, a borrow, a swap or a vote — so the wallet's history is continuous, not a single day.", cost: weeklyGasFor(chain), time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Check whether ' + p.name + ' runs a points program on its own site or docs, and claim only from a link the protocol itself publishes — never from a DM, an ad or a search result.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and plan the unwind before you need it: know the withdrawal steps and any lock or cooldown.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('watchlist')) state.watchlistOnly = params.get('watchlist') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl > 0) params.set('minTvl', String(state.minTvl));
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.watchlistOnly && !WATCHLIST[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    var f = DATA.funnel;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Which protocol without a token is worth farming next?' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, ranked by what a launch would be worth at the market\u2019s own multiple. Implied value is a model, not a promise.' }),
        top ? el('p', { class: 'pick' }, 'Top of the board: ', el('b', { text: top.name }), ' — ' + fmtUsd(top.implied_value_usd) + ' implied on ' + fmtUsd(top.tvl_usd) + ' of TVL. ',
          el('button', { class: 'button', type: 'button', text: 'See its farm plan', onclick: function () { openDetail(top.slug); } })) : null
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols scanned' }), el('b', { text: String(f.scanned) })),
        el('div', { class: 'fact' }, el('span', { text: 'Record no token' }), el('b', { text: String(f.pre_token) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search the board', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlOptions = [[0, 'Any TVL'], [50000000, '$50M+ (watchlist floor)'], [100000000, '$100M+'], [500000000, '$500M+'], [1000000000, '$1B+']];
    var tvlSelect = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      tvlOptions.map(function (o) { return el('option', { value: String(o[0]), text: o[1], selected: state.minTvl === o[0] ? 'selected' : null }); })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchlistOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Minimum TVL' }), tvlSelect),
      el('label', { class: 'check', for: 'watchlist' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or TVL to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var onWatchlist = !!WATCHLIST[r.slug];
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: onWatchlist ? 'chip' : 'chip early', text: onWatchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Set' })
          )),
          tbody,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan. "No token" means the snapshot records none.' })
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? r.mcap_usd / r.tvl_usd : null;
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : fmtMult(ratio) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their median multiple calibrates it.' })
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var f = DATA.funnel;
    var multRows = DATA.category_multiples.map(function (c) {
      return el('tr', null, el('td', { text: c.category }), el('td', { class: 'num', text: String(c.live_count) }), el('td', { class: 'num', text: fmtMult(c.median_multiple) }));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot\u2019s own figures. No protocol name is special-cased, and no row is hand-picked. The base multiple is not assumed: it is the median of the live-token set in this same snapshot.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple.toFixed(4) + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('div', { class: 'model-grid' },
        el('div', null,
          el('h3', { text: 'The calibration' }),
          el('p', { text: 'The market multiple comes from ' + cal.live_count + ' live-token protocols in this snapshot (a token recorded, outside CEX, with a market cap and a TVL). Their market-cap-to-TVL ratios run from ' + fmtMult(cal.min_multiple) + ' to ' + fmtMult(cal.max_multiple) + ', with quartiles ' + fmtMult(cal.q1_multiple) + ' and ' + fmtMult(cal.q3_multiple) + '. The median, ' + fmtMult(cal.median_multiple) + ', is the middle of the market — one mispriced protocol cannot move it.' }),
          el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' })
        ),
        el('div', null,
          el('h3', { text: 'Category medians (context only)' }),
          el('table', { class: 'multiples' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live' }), el('th', { scope: 'col', text: 'Median' }))),
            el('tbody', null, multRows)
          ),
          el('p', { text: 'Shown where at least 3 live-token protocols exist. The ranking uses the one market median, so no category is favoured by assumption.' })
        ),
        el('div', null,
          el('h3', { text: 'What was left out, and why' }),
          el('ul', null,
            el('li', { text: f.records_token + ' protocols record a token already, so they cannot be launches; the largest ' + DATA.live_size + ' are shown apart.' }),
            el('li', { text: f.excluded_below_floor + ' pre-token protocols below the floor are wrapped, staked or bridged products: ' + f.excluded_below_floor_by_category + ' by category (bridge, liquid staking, restaking, exchange), ' + f.excluded_below_floor_versioned + ' versioned pools, ' + f.excluded_below_floor_wrapped_word + ' wrapped or staked names, each counted once.' }),
            el('li', { text: f.above_floor_not_watchlist + ' pre-token protocols at or above the floor are not on the watchlist: the house rule leaves out products of another protocol, and the board does not re-add them.' })
          ),
          el('p', { text: 'A protocol on this board records no token in the snapshot. That is DefiLlama\u2019s record, not proof: one may still have a token its record does not carry.' })
        )
      ),
      el('p', { class: 'footnote', text: 'Limits: the model prices a launch as if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued, and it knows nothing the snapshot does not carry — no points program, no team, no audit. Implied value is this entry\u2019s claim, never a price.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  var closingForRender = false;
  dialog.addEventListener('close', function () { if (closingForRender) return; state.selected = null; writeHash(); });

  function comparableLine(row) {
    var found = null;
    DATA.category_multiples.forEach(function (c) { if (c.category === (row.category || 'Other')) found = c; });
    if (!found) return 'Too few live-token protocols in this category to show a category median.';
    return 'Live ' + found.category + ' protocols trade at a median ' + fmtMult(found.median_multiple) + ' of TVL across ' + found.live_count + ' protocols — context only; the ranking uses the single market median of ' + fmtMult(DATA.model.base_multiple) + '.';
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var growth = growthOf(row, DATA.model);
    var maturity = maturityOf(row, DATA.model);
    var base = row.tvl_usd * DATA.model.base_multiple;
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (WATCHLIST[row.slug] ? 'Watchlist' : 'Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · first listed ' + (row.listed_at || 'unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsdFull(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Market median multiple' }), el('b', { class: 'num', text: fmtMult(DATA.model.base_multiple) })),
        el('div', null, el('span', { text: 'Base value' }), el('b', { class: 'num', text: fmtUsdFull(Math.round(base)) })),
        el('div', null, el('span', { text: 'Seven-day growth (clamped ' + DATA.model.growth_floor + ' to ' + DATA.model.growth_cap + ')' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → ' + growth.pct.toFixed(2) + '%' })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token recorded' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsdFull(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This page recomputes the row as ' + fmtUsdFull(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' ' + comparableLine(row) + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'note', text: 'The plan is derived from this protocol\u2019s own record — its category, chains, TVL and age — the same derivation board.json carries. It is a starting point, not financial advice.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Data: ' + DATA.source + '. The snapshot is frozen; nothing on this page reaches the network.' }),
      el('span', { text: 'A protocol is listed as pre-token when the snapshot records no token for it: no market cap, no CoinGecko id, no symbol. Implied values are this entry\u2019s model claims, not predictions that a token will be issued or what it would trade at.' })
    );
  }

  function render() {
    if (dialog.open) { closingForRender = true; dialog.close(); closingForRender = false; }
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; state.tab = 'pre-token'; state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
