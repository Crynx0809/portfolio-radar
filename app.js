(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const G = window.gsap || null;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = (fn) => { if (G && !calm) try { fn(G); } catch (e) { /* Animation ist Deko */ } };

  const STATUS = {
    zone:        {l: 'In der Zone',      c: 'var(--up)',     o: 0},
    annaeherung: {l: 'Läuft drauf zu',   c: 'var(--warn)',   o: 1},
    boden:       {l: 'Bodenbildung',     c: 'var(--purple)', o: 2},
    trend:       {l: 'Aufwärtstrend',    c: 'var(--blue)',   o: 3},
    meiden:      {l: 'Meiden',           c: 'var(--down)',   o: 4},
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const num = (v, d) => {
    if (v == null || isNaN(v)) return '—';
    const x = Number(v);
    if (d == null) d = Math.abs(x) >= 1000 || (Number.isInteger(x) && Math.abs(x) >= 10) ? 0 : 2;
    return x.toLocaleString('de-DE', {minimumFractionDigits: d, maximumFractionDigits: d});
  };
  const cur = (r) => (r.currency === 'EUR' ? '€' : '$');
  const money = (v, r, d) => num(v, d) + ' ' + cur(r);
  const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1).replace('.', ',') + ' %';
  const dShort = (s) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? s : d.toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit'}); };
  const load = async (n) => { const r = await fetch('data/' + n + '.json?v=' + Date.now()); if (!r.ok) throw new Error(n); return r.json(); };

  let HOR = (() => { try { return localStorage.getItem('radar-hor') || 'kurz'; } catch (e) { return 'kurz'; } })();
  let WEEKLY = null, DAILY = null;
  let STOCKS = [], PRICES = {}, group = 'Portfolio', SEARCH = '', KPIS = {}, MARKET = null, TRACK = null, FUND = {}, SCREEN = null;
  const REPO = 'Crynx0809/portfolio-radar';

  /* ---------- Navigation ---------- */
  const PAGES = ['aktien', 'chancen', 'news', 'ausblick', 'analyse'];
  function show(page, first) {
    if (!PAGES.includes(page)) page = 'aktien';
    PAGES.forEach((p) => { $('#' + p).hidden = p !== page; });
    document.body.dataset.page = page;
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.page === page));
    if (!first) window.scrollTo({top: 0});
    anim((g) => g.from('#' + page + ' > *', {y: 14, opacity: 0, duration: .45, stagger: .05, ease: 'power2.out', clearProps: 'all'}));
    if (page === 'aktien' && !first) staggerRows();
  }
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1).split('/');
    if (h[1]) return;
    if (!$('#sheet').hidden) { $('#sheet').hidden = true; $('#sheetBg').hidden = true; document.body.style.overflow = ''; }
    show(h[0]);
  });

  document.querySelectorAll('.seg button').forEach((b, i) => b.addEventListener('click', () => {
    group = b.dataset.grp;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('.seg').dataset.i = i;
    renderList();
  }));

  const HORTXT = {
    kurz: 'Kurzfristig = Trade über Wochen bis Monate: Einstiegszone, enger Stop, nächstes Ziel aus dem Tageschart.',
    lang: 'Langfristig = Investment über Monate bis Jahre: große Wellen im Wochenchart (5 Jahre). Wie lange es dauert, ergibt sich aus der Länge der bisherigen Wellen.'};
  function setHor(h, keepScroll) {
    HOR = h; try { localStorage.setItem('radar-hor', h); } catch (e) { /* ok */ }
    document.body.dataset.hor = h;
    document.querySelectorAll('.hor button[data-h], .hz-sw button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.h === h)));
    $('#horNote').textContent = HORTXT[h];
    const go = () => { renderList(); if (SEL && isDesk()) openSheet(SEL); else if (SEL && !$('#sheet').hidden) refreshSheet(); };
    ensure(h).then(go);
  }
  document.querySelectorAll('.hor button[data-h]').forEach((b) => b.addEventListener('click', () => setHor(b.dataset.h)));

  /* ---------- Suche & Wünsche ---------- */
  const sIn = $('#search');
  sIn.addEventListener('input', () => { SEARCH = sIn.value; renderList(); $('#searchClear').hidden = !SEARCH; });
  $('#searchClear').addEventListener('click', () => { sIn.value = ''; SEARCH = ''; $('#searchClear').hidden = true; renderList(); sIn.focus(); });
  function openWish(name) {
    const d = $('#wish'); d.hidden = false; $('#wishOpen').hidden = true; $('#wishName').value = name || ''; $('#wishNote').value = '';
    anim((g) => g.from(d, {y: 10, opacity: 0, duration: .3, ease: 'power2.out', clearProps: 'all'}));
    d.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(() => $('#wishName').focus(), 300);
  }
  $('#wishOpen').addEventListener('click', () => openWish(''));
  $('#wishCancel').addEventListener('click', () => { $('#wish').hidden = true; $('#wishOpen').hidden = false; });
  $('#wish').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('#wishName').value.trim(); if (!n) return;
    const note = $('#wishNote').value.trim();
    const body = 'Bitte beim nächsten Abend-Update zur Watchlist hinzufügen: **' + n + '**' + (note ? '\n\nHinweis: ' + note : '') + '\n\n(gesendet über die Website)';
    window.open('https://github.com/' + REPO + '/issues/new?labels=wunsch&title=' + encodeURIComponent('Wunsch: ' + n) + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
    $('#wish').hidden = true; $('#wishOpen').hidden = false;
    $('#wishInfo').textContent = 'GitHub geöffnet – dort nur noch auf „Create“ tippen. „' + n + '“ kommt dann beim nächsten Abend-Update dazu.';
  });
  async function loadWishes() {
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/issues?state=open&per_page=30');
      if (!r.ok) return;
      const w = (await r.json()).filter((i) => !i.pull_request && /^wunsch:/i.test(i.title || ''));
      $('#wishList').innerHTML = w.map((i) => `<li><span>${esc(i.title.replace(/^wunsch:\s*/i, ''))}</span><em>wartet aufs Abend-Update</em></li>`).join('');
    } catch (e) { /* ohne Liste weiter */ }
  }

  /* ---------- Liste ---------- */
  function rowBar(r) {
    const lo = Math.min(r.stop, r.price) , hi = Math.max(r.target_high || r.target_low, r.price);
    const span = hi - lo || 1, x = (v) => Math.max(0, Math.min(100, (v - lo) / span * 100));
    return `<div class="bar">
      <span class="z" style="left:${x(r.entry_low)}%;width:${Math.max(1.5, x(r.entry_high) - x(r.entry_low))}%"></span>
      <span class="g" style="left:${x(r.target_low)}%;width:${Math.max(1.5, x(r.target_high) - x(r.target_low))}%"></span>
      <span class="s" style="left:${x(r.stop)}%"></span>
      <span class="k" style="left:${x(r.price)}%"></span></div>`;
  }
  function distText(r) {
    if (r.price > r.entry_high) return 'noch ' + pct(r.entry_high / r.price - 1).replace('−', '') + ' darüber';
    if (r.price < r.entry_low) return r.entry_type === 'Ausbruch' ? 'Ausbruch ab ' + num(r.entry_low) : pct(r.price / r.entry_low - 1).replace('−', '') + ' darunter';
    return 'im Bereich';
  }

  /* ---------- Filter, Land, Spalten ---------- */
  let ALERTS = [], FIL = 'alle', LAND = '', SEK = '', SORT = {k: 'score', d: -1};
  const LAND_X = {'NOVO-B': 'Dänemark', AIR: 'Frankreich', RACE: 'Italien', MELI: 'Uruguay', NU: 'Brasilien'};
  const landOf = (r) => LAND_X[r.ticker] || (/^(XETR|FWB|GETTEX)/.test(r.tv_symbol || '') ? 'Deutschland' : /^EURONEXT/.test(r.tv_symbol || '') ? 'Frankreich' : r.currency === 'EUR' ? 'Europa' : 'USA');
  const nearTgt = (r) => r.target_low != null && r.status !== 'boden' && r.status !== 'meiden' && r.price >= r.target_low * .98;
  const sell = (r) => nearTgt(r) || /teilverkauf|gewinne? sichern|ziel (war )?erreicht/i.test(r.action || '');
  const FILT = {
    alle: ['Alle', () => true],
    kauf: ['Kaufbereich', (r) => HOR === 'lang' ? ltState(r)[0] === 'In Zone' : r.status === 'zone'],
    sell: ['Gewinne sichern', sell],
    wait: ['Abwarten', (r) => r.status === 'annaeherung' || r.status === 'boden'],
    up: ['Aufwärtstrend', (r) => r.status === 'trend'],
    down: ['Abwärtstrend', (r) => r.status === 'meiden' || r.lt_view === 'bärisch'],
    hot: ['Dringend', (r) => r.alert === 'hoch'],
  };
  function ltState(r) {
    const z = ltZone(r), p = r.price;
    if (r.lt_target_low != null && p >= r.lt_target_low) return ['Ziel erreicht', 'var(--warn)'];
    if (z && p >= z[0] && p <= z[1] * 1.02) return ['In Zone', 'var(--up)'];
    if (r.lt_stop != null && p < r.lt_stop) return ['Unter Stop', 'var(--down)'];
    const v = {bullisch: ['Aufwärts', 'var(--up)'], neutral: ['Offen', 'var(--warn)'], spekulativ: ['Spekulativ', 'var(--purple)'], 'bärisch': ['Schwach', 'var(--down)']}[r.lt_view];
    return v || ['—', 'var(--dim)'];
  }
  const waveTxt = (lv) => { const c = (lv && lv.count) || []; const l = c.length ? c[c.length - 1].l : ''; return l ? 'Welle ' + l : ''; };
  function crvLang(r) { const p = r.price; return r.lt_target_low != null && r.lt_stop != null && p > r.lt_stop ? (r.lt_target_low - p) / (p - r.lt_stop) : null; }
  const crvOf = (r) => HOR === 'lang' ? crvLang(r) : crv(r);
  const crvCls = (c) => c == null ? '' : c >= 2 ? 'g' : c >= 1.5 ? 'a' : 'r';
  const scCls = (s) => s == null ? '' : s >= 65 ? 'g' : s >= 45 ? 'a' : 'r';
  function wireFilters() {
    const lands = [...new Set(STOCKS.map(landOf))].sort(), seks = [...new Set(STOCKS.map((r) => r.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    $('#fLand').innerHTML = '<option value="">Alle Länder</option>' + lands.map((x) => `<option>${esc(x)}</option>`).join('');
    $('#fSek').innerHTML = '<option value="">Alle Sektoren</option>' + seks.map((x) => `<option>${esc(x)}</option>`).join('');
    $('#fLand').onchange = (e) => { LAND = e.target.value; renderList(); };
    $('#fSek').onchange = (e) => { SEK = e.target.value; renderList(); };
  }
  function renderChips(base) {
    $('#chips').innerHTML = Object.entries(FILT).map(([k, [l, f]]) => { const n = base.filter(f).length;
      return k !== 'alle' && !n ? '' : `<button data-f="${k}" aria-pressed="${FIL === k}">${l}${k === 'alle' ? '' : ` <i>${n}</i>`}</button>`; }).join('');
    $('#chips').querySelectorAll('button').forEach((b) => b.onclick = () => { FIL = b.dataset.f; renderList(); });
  }
  function renderTable(rows, SC) {
    const W = (r) => (KPIS[r.ticker] || {}).perf_1w;
    const th = (k, l, c) => `<th data-k="${k}" class="${c || ''}${SORT.k === k ? ' on' : ''}">${l}${SORT.k === k ? (SORT.d < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    const bar = (w) => w == null ? '' : `<span class="wb"><i class="${w >= 0 ? 'up' : 'down'}" style="width:${Math.min(100, Math.abs(w) / .3 * 100)}%"></i></span>`;
    $('#tbl').innerHTML = `<table class="st"><thead><tr>${th('name', 'Aktie')}${th('price', 'Kurs', 'n')}${th('day', 'Heute', 'n wide')}${th('week', 'Woche', 'n')}${th('score', 'Score', 'c')}${th('crv', 'CRV', 'c wide')}${th('lang', 'Langfristig', 'wide')}${th('kurz', 'Kurzfristig', 'wide')}</tr></thead><tbody>` +
      rows.map((r) => {
        const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'}, q = PRICES[r.ticker] || {}, w = W(r), sc = SC[r.ticker], k = crvOf(r), L = ltState(r);
        const lv = (r.ew || {}).lang, wt = waveTxt(lv);
        return `<tr class="go${r.ticker === SEL ? ' sel' : ''}" data-t="${esc(r.ticker)}" tabindex="0">
          <td><div class="nm"><i class="dot" style="background:${HOR === 'lang' ? L[1] : s.c}"></i><div><b>${esc(r.name)}</b> <span class="tk">${esc(r.ticker)}</span>${r.alert === 'hoch' ? '<span class="hot" title="Dringend"></span>' : ''}<small>${esc(landOf(r))} · ${esc(r.sector || '')}</small></div></div></td>
          <td class="n"><b class="mono">${money(r.price, r)}</b></td>
          <td class="n wide ${q.chg_pct == null ? '' : q.chg_pct >= 0 ? 'up' : 'down'}">${q.chg_pct == null ? '' : pct(q.chg_pct)}</td>
          <td class="n"><span class="wk ${w == null ? '' : w >= 0 ? 'up' : 'down'}">${w == null ? '—' : pct(w)}</span>${bar(w)}</td>
          <td class="c"><span class="bdg ${scCls(sc)}">${sc == null ? '—' : sc}</span></td>
          <td class="c wide"><span class="bdg ${crvCls(k)}">${k == null ? '—' : num(k, 1) + ' : 1'}</span></td>
          <td class="wide"><span class="stt" style="--c:${L[1]}">${L[0]}</span>${wt ? `<small>${esc(wt)}</small>` : ''}</td>
          <td class="wide"><span class="stt" style="--c:${s.c}">${s.l}</span><small>${esc(distText(r))}</small></td></tr>`;
      }).join('') + '</tbody></table>' + (rows.length ? '' : '<p class="empty">Keine Aktie passt zu diesem Filter.</p>');
    $('#tbl').querySelectorAll('th').forEach((h) => h.onclick = () => { const k = h.dataset.k; SORT = {k, d: SORT.k === k ? -SORT.d : (k === 'name' || k === 'kurz' || k === 'lang' ? 1 : -1)}; renderList(); });
    $('#tbl').querySelectorAll('tr.go').forEach((tr) => { const go = () => openSheet(tr.dataset.t); tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
  }
  /* rechte Spalte am Desktop, solange keine Aktie offen ist */
  function todoHTML() {
    const today = new Date().toLocaleDateString('de-DE', {weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit'});
    const item = (r, tag, cls, txt, warn) => `<button class="td" data-t="${esc(r.ticker)}"><span class="tag ${cls}">${tag}</span><span><b>${esc(r.name)}</b><small>${esc(txt)}</small>${warn ? `<em>⚠ ${esc(warn)}</em>` : ''}</span></button>`;
    const evt = (r) => { const d = r.next_event_date ? Math.round((new Date(r.next_event_date + 'T12:00:00') - Date.now()) / 864e5) : null; return d != null && d >= 0 && d <= 3 ? (r.next_event || 'Termin') + (d === 0 ? ' heute' : d === 1 ? ' morgen' : ' in ' + d + ' Tagen') : ''; };
    const short = (t) => String(t || '').split(/ – | — /)[0].slice(0, 90);
    const G = [
      ['Dringend', STOCKS.filter((r) => r.alert === 'hoch'), 'r', 'Prüfen', (r) => { const a = ALERTS.find((x) => x.ticker === r.ticker && x.level === 'hoch'); return a ? a.text : r.action; }],
      ['Kaufbereich', STOCKS.filter((r) => r.status === 'zone' && r.alert !== 'hoch'), 'g', 'Zone'],
      ['Gewinne sichern', STOCKS.filter((r) => sell(r) && r.alert !== 'hoch' && r.status !== 'zone'), 'a', 'Sichern'],
    ];
    let h = `<div class="pnl"><div class="pnl-h"><b>🌙 Heute zu tun</b><small>${today}</small></div>` +
      G.filter((g) => g[1].length).map(([l, a, c, tag, tx]) => `<h4>${l} · ${a.length}</h4>` + a.map((r) => item(r, tag, c, short(tx ? tx(r) : r.action), evt(r))).join('')).join('') + '</div>';
    const mv = STOCKS.map((r) => ({r, c: (PRICES[r.ticker] || {}).chg_pct})).filter((x) => x.c != null && Math.abs(x.c) >= .05).sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    const SCm = {}; mv.forEach((x) => { SCm[x.r.ticker] = scoreOf(x.r).total; });
    h += `<div class="pnl"><div class="pnl-h"><b>⚡ Ausreißer heute</b><small>ab ±5 %</small></div>` + (mv.map(({r, c}) => {
      const hint = c < 0 ? (r.status === 'zone' ? 'Fällt in die Zone – Umkehrsignal abwarten' : r.status === 'meiden' ? 'Abwärtstrend – nicht auffangen' : 'Rücksetzer – Zone ' + num(r.entry_low) + '–' + money(r.entry_high, r) + ' beobachten')
        : (nearTgt(r) ? 'Am Ziel – Gewinne sichern prüfen' : 'Starker Anstieg – nicht hinterherkaufen');
      return `<button class="mv" data-t="${esc(r.ticker)}"><span class="mv-c ${c >= 0 ? 'up' : 'down'}">${pct(c)}</span><span><b>${esc(r.name)}</b> <span class="tk">${esc(r.ticker)}</span><small class="${c >= 0 ? 'up' : 'down'}">${hint}</small></span><span class="bdg ${scCls(SCm[r.ticker])}">${SCm[r.ticker] ?? '—'}</span></button>`;
    }).join('') || '<p class="empty">Heute keine großen Ausschläge.</p>') + '</div>';
    return h;
  }
  function renderTodo() {
    const box = $('#detail'); if (!box || !isDesk() || SEL) return;
    box.innerHTML = todoHTML(); box.scrollTop = 0;
    box.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => openSheet(b.dataset.t));
  }
  function closePick() {
    SEL = null; document.body.classList.remove('pick');
    history.replaceState(null, '', '#aktien'); renderList(); renderTodo();
  }
  function renderList() {
    const ul = $('#list');
    const qy = SEARCH.trim().toLowerCase();
    const hit = (r) => [r.ticker, r.name, r.sector, r.tv_symbol].some((v) => String(v || '').toLowerCase().includes(qy));
    
    const LTO = {bullisch: 0, neutral: 1, spekulativ: 2, 'bärisch': 3};
    const base = STOCKS.filter((r) => (!qy || hit(r)) && (!LAND || landOf(r) === LAND) && (!SEK || r.sector === SEK));
    renderChips(base);
    const flt = (FILT[FIL] || FILT.alle)[1];
    const SC = {}; STOCKS.forEach((r) => { SC[r.ticker] = scoreOf(r).total; });
    const KEY = {name: (r) => r.name, price: (r) => r.price, day: (r) => (PRICES[r.ticker] || {}).chg_pct, week: (r) => (KPIS[r.ticker] || {}).perf_1w, score: (r) => SC[r.ticker], crv: crvOf, lang: (r) => ltState(r)[0], kurz: (r) => (STATUS[r.status] || {o: 9}).o};
    const tr = base.filter(flt).sort((a, b) => { const x = KEY[SORT.k](a), y = KEY[SORT.k](b); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y, 'de') : x - y) * SORT.d; });
    renderTable(tr, SC);
    $('#cnt').textContent = tr.length + ' von ' + STOCKS.length;
    const rows = base.filter(flt).sort((a, b) => HOR === 'lang'
      ? (LTO[a.lt_view] ?? 9) - (LTO[b.lt_view] ?? 9) || (b.lt_target_low / b.price) - (a.lt_target_low / a.price)
      : (a.alert === 'hoch' ? 0 : 1) - (b.alert === 'hoch' ? 0 : 1) || (STATUS[a.status] || {o: 9}).o - (STATUS[b.status] || {o: 9}).o || a.ticker.localeCompare(b.ticker));
    ul.innerHTML = rows.map((r) => {
      const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'};
      const q = PRICES[r.ticker] || {};
      const chg = q.chg_pct != null ? q.chg_pct : null;
      const rc = HOR === 'lang' ? (LTV[r.lt_view] || [, 'var(--muted)'])[1] : s.c;
      return `<li class="row" data-t="${esc(r.ticker)}" style="--sc:${rc}" tabindex="0">
        <div><div class="t">${esc(r.ticker)}${r.alert === 'hoch' && HOR !== 'lang' ? '<span class="hot" title="Dringend"></span>' : ''}</div><div class="n">${esc(r.name)}</div></div>
        <div><div class="p" data-v="${r.price}" data-cur="${cur(r)}">${money(r.price, r)}</div>
          <div class="c ${chg == null ? '' : chg >= 0 ? 'up' : 'down'}">${chg == null ? '' : pct(chg)}</div></div>
        ${HOR === 'lang' && r.lt_target_low != null ? `<div class="meta"><span class="pill" style="--sc:${(LTV[r.lt_view] || [, 'var(--muted)'])[1]}">${(LTV[r.lt_view] || ['—'])[0]}</span>
          <span class="zone"><em>Ziel ~${esc(ltUntil(r))}</em> ${num(r.lt_target_low)}–${money(r.lt_target_high, r)} · <b class="up">${pct(r.lt_target_low / r.price - 1)}</b></span></div>
        ${ltBar(r)}` : `<div class="meta"><span class="pill" style="--sc:${s.c}">${s.l}</span>
          <span class="zone"><em>Zone</em> ${num(r.entry_low)}–${money(r.entry_high, r)}</span></div>
        ${rowBar(r)}`}</li>`;
    }).join('') || (qy ? `<li class="empty">„${esc(SEARCH.trim())}“ ist noch nicht dabei.<br><button class="wish-btn" id="wishFromSearch">＋ „${esc(SEARCH.trim())}“ wünschen</button></li>` : '<li class="empty">Keine Werte.</li>');
    const wf = $('#wishFromSearch'); if (wf) wf.onclick = () => openWish(SEARCH.trim());
    ul.querySelectorAll('.row').forEach((li) => {
      li.classList.toggle('sel', li.dataset.t === SEL);
      const go = () => openSheet(li.dataset.t);
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
    staggerRows();
  }
  function renderHello() {
    const h = new Date().getHours();
    $('#hello').textContent = h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
    $('#helloSub').textContent = 'Dein Radar für ' + new Date().toLocaleDateString('de-DE', {weekday: 'long', day: 'numeric', month: 'long'});
    const hot = STOCKS.filter((r) => r.alert === 'hoch'), zone = STOCKS.filter((r) => r.status === 'zone');
    const fg = MARKET && MARKET.fear_greed, Z = TRACK && TRACK.summary;
    const fgl = fg ? (fg.score < 25 ? 'Extreme Angst' : fg.score < 45 ? 'Angst' : fg.score <= 55 ? 'Neutral' : fg.score <= 75 ? 'Gier' : 'Extreme Gier') : '';
    const nz = Z ? Z.zone_won + Z.zone_lost : 0;
    const tile = (ic, l, v, sub, cls, act) => `<button class="k4" ${act || ''}><span class="k4-i">${ic}</span><small>${l}</small><b class="${cls || ''}">${v}</b><em>${sub}</em></button>`;
    $('#kp4').innerHTML =
      tile('⚠️', 'Dringend', hot.length, hot.length ? hot.map((r) => r.ticker).slice(0, 3).join(' · ') : 'alles ruhig', hot.length ? 'down' : '', 'data-go="hot"') +
      tile('🎯', 'In der Zone', zone.length, zone.length ? zone.map((r) => r.ticker).slice(0, 3).join(' · ') : 'gerade keine', zone.length ? 'up' : '', 'data-go="zone"') +
      tile('🌡️', 'Markt', fg ? fg.score : '—', fgl || 'Fear &amp; Greed', fg ? (fg.score < 45 ? 'down' : fg.score > 55 ? 'up' : '') : '') +
      tile('✓', 'Zonen-Treffer', Z && Z.zone_rate != null ? Math.round(Z.zone_rate * 100) + ' %' : '—', nz ? `aus ${nz} Zonen` : 'Messung läuft', '', 'data-go="analyse"');
    $('#kp4').querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
      const g = b.dataset.go;
      if (g === 'analyse') { location.hash = 'analyse'; return; }
      const r = (g === 'hot' ? hot : zone)[0]; if (r) openSheet(r.ticker);
    });
  }
  function staggerRows() {
    anim((g) => {
      g.from('#list .row', {y: 18, opacity: 0, duration: .5, stagger: .035, ease: 'power3.out', clearProps: 'transform,opacity'});
      g.from('#list .bar .k', {left: '0%', duration: .9, stagger: .035, ease: 'power2.out', delay: .15});
    });
  }

  /* ---------- Elliott-Chart ---------- */
  function zigzag(c, mult) {
    const ranges = c.map((k) => (k[2] - k[3]) / k[4]).sort((a, b) => a - b);
    const th = Math.max(mult ? 0.15 : 0.05, (mult || 2.8) * (ranges[Math.floor(ranges.length / 2)] || 0.02));
    const piv = []; let dir = 0, hi = 0, lo = 0;
    for (let i = 1; i < c.length; i++) {
      if (dir >= 0 && c[i][2] > c[hi][2]) hi = i;
      if (dir <= 0 && c[i][3] < c[lo][3]) lo = i;
      if (dir >= 0 && c[i][3] < c[hi][2] * (1 - th) && hi !== (piv.length ? piv[piv.length - 1].i : -1)) {
        piv.push({i: hi, p: c[hi][2], h: 1}); dir = -1; lo = i;
      } else if (dir <= 0 && c[i][2] > c[lo][3] * (1 + th) && lo !== (piv.length ? piv[piv.length - 1].i : -1)) {
        piv.push({i: lo, p: c[lo][3], h: 0}); dir = 1; hi = i;
      }
    }
    return piv.slice(-7);
  }
  /* ---------- Elliott-Chart (zwei Ebenen: kurz = Wochen/Monate, lang = Monate/Jahre) ---------- */
  const MN = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const MNL = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
  const NEXT = {'1': '2', '2': '3', '3': '4', '4': '5', '5': 'A', 'A': 'B', 'B': 'C', 'C': '1', 'W': 'X', 'X': 'Y', 'Y': 'Z', 'Z': '1', 'Start': '1',
    'i': 'ii', 'ii': 'iii', 'iii': 'iv', 'iv': 'v', 'v': 'a', 'a': 'b', 'b': 'c', 'c': 'i', 'w': 'x', 'x': 'y', 'y': 'z'};
  // Wellengrad aus der Schreibweise: [3] = groß, (3) = mittel, 3 / iii = klein
  const deg = (l) => /^\[.*\]$/.test(l) ? 2 : /^\(.*\)$/.test(l) ? 1 : 0;
  const DEGC = ['#4fd8c4', '#5aa7ff', '#c08bff'];
  const core = (l) => String(l).replace(/^alt\.?\s*/i, '').replace(/[[\]()]/g, '');
  const wrap = (l, d) => d === 2 ? '[' + l + ']' : d === 1 ? '(' + l + ')' : l;
  const ddays = (a, b) => (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5;
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + Math.round(n)); return d.toISOString().slice(0, 10); };
  const monthTxt = (s) => { const d = new Date(s + 'T12:00:00'); return MNL[d.getMonth()] + ' ' + d.getFullYear(); };
  const roughTxt = (s) => { const d = new Date(s + 'T12:00:00'), t = d.getDate(); return (t <= 10 ? 'Anfang ' : t <= 20 ? 'Mitte ' : 'Ende ') + MNL[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''); };

  function series(r, L) {
    const q = PRICES[r.ticker] || {}, live = (q.ohlc || []).filter((k) => k.every((v) => v != null));
    let c;
    if (L) {
      c = ((WEEKLY && WEEKLY[r.ticker]) || []).filter((k) => k.every((v) => v != null)).map((k) => k.slice());
      if (c.length && live.length) { const z = live[live.length - 1], w = c[c.length - 1]; w[4] = z[4]; w[2] = Math.max(w[2], z[4]); w[3] = Math.min(w[3], z[4]); }
    } else {
      const d = ((DAILY && DAILY[r.ticker]) || []).filter((k) => k.every((v) => v != null));
      const f = live.length ? live[0][0] : '9999';
      c = d.filter((k) => k[0] < f).concat(live).slice(-250);
    }
    return c.length >= 20 ? c : null;
  }
  const near = (c, d) => { // Index der Kerze am oder vor dem Datum
    let lo = 0, hi = c.length - 1; if (d <= c[0][0]) return 0; if (d >= c[hi][0]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m][0] <= d) lo = m; else hi = m; } return lo;
  };

  // Plan einer Ebene: Zählung, Zukunftspfad mit Daten aus den Wellenlängen, Alternative, Marken
  function ewPlan(r, lv) {
    const L = lv === 'lang', e = (r.ew && r.ew[lv]) || {}, c = series(r, L);
    if (!c) return null;
    const n = c.length, now = c[n - 1][0], p0 = c[n - 1][4], bar = L ? 7 : 7 / 5; // Kalendertage je Kerze
    const tgt = L ? [r.lt_target_low, r.lt_target_high] : [r.target_low, r.target_high];
    if (tgt[0] == null) return null;
    const stop = L ? r.lt_stop : r.stop;
    let up = e.up !== undefined ? e.up : L ? null : r.trigger;
    const down = e.down !== undefined ? e.down : stop;
    // Zählung
    let cnt = e.count || (!L && Array.isArray(r.waves) && r.waves.length ? r.waves : null), auto = !cnt;
    const snap = (w) => { const i0 = near(c, w.d), k = L ? 3 : 2; let bi = i0, bd = Infinity;
      for (let i = Math.max(0, i0 - k); i <= Math.min(n - 1, i0 + k); i++) { const dd = Math.min(Math.abs(c[i][2] - w.p), Math.abs(c[i][3] - w.p)); if (dd < bd) { bd = dd; bi = i; } }
      return bi; };
    let piv = cnt ? cnt.map((w) => { const i = snap(w); return {i, d: c[i][0], p: w.p, l: String(w.l)}; }).filter((p) => p.d > c[0][0] || p.i > 0)
      : ((z) => (L && z.length < 4 ? zigzag(c, 3) : z))(zigzag(c, L ? 5 : 0)).map((p) => ({i: p.i, d: c[p.i][0], p: p.p, l: null}));
    // kurzer Chart: Labels der großen Zählung (ew.lang.count) mit anzeigen – mehrere Grade übereinander
    const hiL = !L && r.ew && r.ew.lang && r.ew.lang.count ? r.ew.lang.count.filter((w) => w.d >= c[0][0]).map((w) => { const i = snap(w); return {i, d: c[i][0], p: w.p, l: String(w.l)}; }) : [];
    hiL.forEach((h, j) => { const pr = j ? hiL[j - 1].p : null; h.top = pr == null ? h.p >= c[h.i][4] : h.p >= pr; });
    // Wellenlängen: Dauer (Tage) und Größe (%) der bisherigen Wellen je Richtung
    const legs = [];
    for (let j = 1; j < piv.length; j++) legs.push({up: piv[j].p > piv[j - 1].p, t: ddays(piv[j - 1].d, piv[j].d), m: Math.abs(Math.log(piv[j].p / piv[j - 1].p))});
    if (piv.length) legs.push({up: p0 > piv[piv.length - 1].p, t: ddays(piv[piv.length - 1].d, now), m: Math.abs(Math.log(p0 / piv[piv.length - 1].p)), open: 1});
    const dflt = L ? 200 : Math.max(20, (r.horizon_weeks_high || 6) * 7 * .7);
    const avg = (a, k) => a.length ? a.reduce((s, x) => s + x[k], 0) / a.length : null;
    const legFor = (isUp, move) => {
      const same = legs.filter((g) => g.up === isUp && !g.open && g.t >= (L ? 21 : 3)).slice(-2);
      const t = avg(same, 't') || avg(legs.filter((g) => !g.open), 't') || dflt, m = avg(same, 'm') || avg(legs, 'm') || .1;
      const ratio = Math.max(.5, Math.min(1.8, Math.abs(Math.log(move)) / m)); // größere Welle braucht länger
      return Math.max(L ? 90 : 10, Math.min(L ? 1100 : 220, t * Math.sqrt(ratio)));
    };
    if (up == null && L && e.up === undefined) { // lang: letztes großes Hoch über dem Kurs als Bestätigung
      const hs = piv.filter((q) => q.p > p0 * 1.03 && q.p < Math.max(...tgt)); if (hs.length) up = Math.max(...hs.map((q) => q.p));
    }
    const needEntry = !L && r.entry_type !== 'Ausbruch' && r.price > r.entry_high && ['annaeherung', 'boden', 'meiden'].includes(r.status);
    const emid = (r.entry_low + r.entry_high) / 2, tmid = (tgt[0] + tgt[1]) / 2;
    const lastL = !auto && piv.length ? piv[piv.length - 1].l : null, dg = lastL ? deg(lastL) : (L ? 2 : 1);
    const lastTop = piv.length ? piv[piv.length - 1].p > p0 : false;
    let path;
    const timed = (pts) => { let d = now, pp = p0; return pts.map((w) => { d = w.d || addDays(d, legFor(w.p > pp, w.p / pp)); pp = w.p; return {d, p: w.p, l: w.l || null}; }); };
    if (e.path && e.path.length) path = timed(e.path);
    else {
      path = []; let d = now, pp = p0, lb = lastL ? core(lastL) : null;
      if (needEntry) {
        const lp = piv.length ? piv[piv.length - 1] : null;
        const ext = lp && !lastTop && emid < lp.p; // neues Tief unter dem letzten Tief: dieselbe Welle läuft weiter
        d = addDays(d, legFor(false, emid / pp) * (lastTop ? .45 : 1));
        let l = ext ? lb : lb && NEXT[lb];
        if (ext && lp) lp.moved = 1;
        path.push({d, p: emid, l: l ? wrap(l, dg) : null}); lb = l || lb; pp = emid;
      }
      const isUp = tmid > pp, cont = !needEntry && lastTop !== isUp && piv.length; // Ziel liegt in Richtung der laufenden Welle
      const full = legFor(isUp, cont ? tmid / piv[piv.length - 1].p : tmid / pp), run = cont ? legs[legs.length - 1].t : 0; // laufende Welle: bereits vergangene Zeit abziehen
      d = addDays(d, Math.max(full * .25, full - run, L ? 60 : 7));
      let l = lb && (cont ? null : NEXT[lb]); if (l && (isUp ? /^[24bBXx]$|^ii$|^iv$/.test(l) : /^[135Cc]$|^i+$|^v$/.test(l))) l = NEXT[l];
      path.push({d, p: tmid, l: l ? wrap(l, dg) : (cont && lastL ? null : null)});
    }
    // Alternative
    let alt = null;
    const altDefault = L ? stop : (r.invalidation != null && r.invalidation < r.stop ? r.invalidation : r.stop);
    if (e.alt !== null) {
      const a = e.alt || {};
      const ap = a.path && a.path.length ? a.path : [{d: addDays(now, legFor(false, altDefault / p0) * .8), p: altDefault, l: null}];
      alt = {path: a.path && a.path.length ? timed(ap) : ap, prob: a.prob != null ? a.prob : null, label: a.label || 'Alternative'};
    }
    const end = path[path.length - 1];
    const P_up = end.p >= p0; let P_why = [];
    // Wahrscheinlichkeit: aus der Analyse, sonst grob aus der Sicherheit der Einschätzung
    // Schätzung, solange die Abendanalyse keinen Wert gesetzt hat – aus nachvollziehbaren Punkten statt pauschal 60 %
    const pDef = (() => {
      const why = [];
      let p = 55;
      const lu = r.lt_view === 'bullisch', ld = r.lt_view === 'bärisch', ku = r.bias === 'bullisch', kd = r.bias === 'bärisch';
      const pathUp = P_up;
      if (L) {
        if (r.lt_conf === 'hoch') { p += 12; why.push('hohe Sicherheit der langen Einschätzung'); } else if (r.lt_conf === 'niedrig') { p -= 8; why.push('geringe Sicherheit'); }
        if (r.lt_view === 'spekulativ') { p -= 5; why.push('spekulativ'); }
        if ((lu && ku) || (ld && kd)) { p += 5; why.push('kurze und lange Sicht zeigen in dieselbe Richtung'); } else if ((lu && kd) || (ld && ku)) { p -= 5; why.push('kurze Sicht widerspricht'); }
      } else {
        if ((ku && pathUp) || (kd && !pathUp)) { p += 6; why.push('Pfad passt zur Einschätzung'); } else if ((ku && !pathUp) || (kd && pathUp)) { p -= 6; why.push('Pfad gegen die Einschätzung'); }
        if ((lu && pathUp) || (ld && !pathUp)) { p += 6; why.push('übergeordneter Trend in Pfad-Richtung'); } else if ((lu && !pathUp) || (ld && pathUp)) { p -= 8; why.push('gegen den übergeordneten Trend'); }
        if (r.status === 'zone' || r.status === 'trend') { p += 4; why.push(r.status === 'zone' ? 'Kurs in der Zone' : 'intakter Aufwärtstrend'); }
        if (r.status === 'meiden') { p -= 6; why.push('aktiver Abwärtstrend'); }
        if (r.alert === 'hoch') { p -= 6; why.push('dringende Meldung, Lage unklar'); }
        const inv = r.invalidation != null ? r.invalidation : r.stop, gap = inv ? (r.price - inv) / r.price : 0;
        if (gap > 0 && gap < .04) { p -= 5; why.push('Invalidierung sehr nah'); }
      }
      p = Math.max(40, Math.min(75, Math.round(p / 5) * 5));
      P_why = why; return p;
    })();
    let prob = e.prob != null ? e.prob : alt && alt.prob != null ? 100 - alt.prob : pDef;
    const probEst = e.prob == null && !(alt && alt.prob != null);
    if (alt && alt.prob == null) alt.prob = 100 - prob;
    // Einstiegs-/Kaufzone: immer zeigen
    let zone = null;
    if (L) { const z = ltZone(r); zone = z ? {lo: z[0], hi: z[1], at: 'path', label: 'Kaufzone'} : {lo: p0 * .97, hi: p0 * 1.01, at: 'now', label: 'Kaufzone (Kurs)'}; }
    else if (r.entry_low != null) zone = {lo: r.entry_low, hi: r.entry_high, at: needEntry ? 'path' : 'now', label: r.entry_type === 'Ausbruch' ? 'Einstieg (Ausbruch)' : 'Einstieg'};
    return {L, e, c, n, now, p0, bar, tgt, stop, up, down, piv, auto, path, alt, needEntry, emid, end, prob, probEst, why: P_why, zone, hi: hiL,
      fib: e.fib || null};
  }
  const ewEnd = (r, lv) => { const P = ewPlan(r, lv); return P ? P.end.d : null; };
  const ltUntil = (r) => { const d = WEEKLY ? ewEnd(r, 'lang') : null; return d ? monthTxt(d) : (r.lt_until || ''); };

  // Fibonacci-Stufen im Zielbereich aus den letzten Wellen
  function fibLevels(P) {
    if (P.fib && P.fib.levels) return P.fib.levels;
    const pv = P.piv, out = [];
    if (pv.length < 2) return out;
    const lo = Math.min(...P.tgt) * .97, hi = Math.max(...P.tgt) * 1.03;
    const a = pv[pv.length - 2].p, b = pv[pv.length - 1].p;
    [.382, .5, .618, .786].forEach((k) => out.push([k, b + (a - b) * k]));            // Retracement der letzten Welle
    if (pv.length >= 3) { const s = pv[pv.length - 3].p; [1, 1.272, 1.618, 2, 2.618].forEach((k) => out.push([k, b + (a - s) * k])); } // Ausdehnung
    [1.272, 1.618].forEach((k) => out.push([k, a + (b - a) * k]));
    const seen = [], tm = (P.tgt[0] + P.tgt[1]) / 2;
    return out.filter(([k, v]) => v > 0 && v >= lo && v <= hi && !seen.some((s) => Math.abs(s - v) / v < .025) && seen.push(v))
      .sort((x, y) => Math.abs(x[1] - tm) - Math.abs(y[1] - tm)).slice(0, 3).sort((x, y) => y[1] - x[1]);
  }

  // Farben wie im Profi-Chart: Grad klein = türkis, ( ) = pink, [ ] = hellgrün, w/x/y (sehr groß) = weiß
  const DEGC2 = ['#26c6da', '#ff4f9a', '#b5e3a1', '#e8e8e8'];
  const deg2 = (l) => { const c0 = core(l); return /^\[.*\]$/.test(core0(l)) ? 2 : /^\(.*\)$/.test(core0(l)) ? 1 : /^[wxyz]$/.test(c0) ? 3 : 0; };
  const core0 = (l) => String(l).replace(/^alt\.?\s*/i, '');
  function ewChart(r, lv, sz) {
    const P = ewPlan(r, lv);
    if (!P) return `<p class="empty">${lv === 'lang' ? 'Wochenchart' : 'Chart'} lädt …</p>`;
    const {L, c, n, now, p0, bar} = P;
    const fi = (d) => (n - 1) + ddays(now, d) / bar;
    const ends = P.path.map((w) => fi(w.d)).concat(P.alt ? P.alt.path.map((w) => fi(w.d)) : []);
    const W = sz ? sz.W : 400, H = sz ? sz.H : 320, PL = 2, PR = 54, PT = 20, PB = 36, TXR = 74; // TXR: Platz für Marken-Text rechts
    // Zukunft so breit, dass der Zielkasten samt Beschriftung links der Marken-Texte endet
    const LBW = sz ? 82 : 60, eOff = Math.max(...ends) - (n - 1), BXF = (W - PR - TXR - 10 - PL) / (W - PL - PR);
    const fut = Math.min(n * (sz ? 1 : .8), Math.max(n * .45, ((n - 1) + eOff * 1.15 + 2) / BXF - n));
    const cw = (W - PL - PR) / (n + fut), x = (i) => PL + i * cw + cw / 2;
    const zoneV = P.zone ? [P.zone.lo, P.zone.hi] : [];
    const vals = c.map((k) => k[4]).concat(P.tgt, P.path.map((w) => w.p), P.alt ? P.alt.path.map((w) => w.p) : [], [P.up, P.stop].filter((v) => v != null), zoneV);
    let lo = Math.min(...c.map((k) => k[3]), ...vals), hi = Math.max(...c.map((k) => k[2]), ...vals);
    const logS = false; // linear wie im Profi-Chart
    const tf = (v) => logS ? Math.log(v) : v;
    let tlo = tf(lo), thi = tf(hi); const pad = (thi - tlo) * .09; tlo -= pad; thi += pad;
    const y = (v) => PT + (thi - tf(v)) / (thi - tlo) * (H - PT - PB);
    const fmt = (v) => num(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2);
    const x0 = x(n - 1), xr = W - PR;
    const id = r.ticker.replace(/\W/g, '') + lv + (sz ? 'f' : '');
    const arrow = (k, col) => `<marker id="a${k}${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="${col}" stroke-width="1.6"/></marker>`;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="ew ew2" font-family="Inter, system-ui, sans-serif" role="img" aria-label="Elliott-Wellen ${esc(r.name)} ${L ? 'Monate/Jahre' : 'Wochen/Monate'}">
      <defs>${arrow('G', '#3ddc5a')}${arrow('R', '#ff3b3b')}${arrow('g', '#3ddc5a')}${arrow('r', '#ff3b3b')}</defs>
      <rect width="${W}" height="${H}" fill="#131722"/>`;
    if (sz) s += `<text x="${PL + (sz.inline ? 74 : 6)}" y="13" font-size="8.5" fill="#9598a1">${esc(r.name)} · ${L ? '1W · Wochenkerzen' : '1T · Tageskerzen'} · ${esc((r.tv_symbol || '').split(':')[0])}</text>`;
    // Kerzen (weiß/grau, schlank)
    const bw = Math.max(.6, Math.min(5, cw * .62));
    s += '<g class="cdl">' + c.map((k, i) => {
      const upk = k[4] >= k[1], col = upk ? '#e6e8ee' : '#8a8e99', yo = y(k[1]), yc = y(k[4]);
      return `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(k[2]).toFixed(1)}" y2="${y(k[3]).toFixed(1)}" stroke="${col}" stroke-width="${Math.max(.6, Math.min(1, cw * .3))}"/>` +
        (cw > 1.6 ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" width="${bw.toFixed(1)}" y="${Math.min(yo, yc).toFixed(1)}" height="${Math.max(.6, Math.abs(yo - yc)).toFixed(1)}" fill="${upk ? '#131722' : col}" stroke="${col}" stroke-width=".6"/>` : '');
    }).join('') + '</g>';
    // Marken-Linien: grün = Widerstände/Bestätigung über dem Kurs (ab ihrem Wendepunkt), rot = Stop/Absicherung
    const pivAll = P.piv.concat(P.hi || []);
    const startOf = (v) => { const q = pivAll.filter((p) => Math.abs(p.p - v) / v < .02).sort((a, b) => a.i - b.i)[0]; return q ? x(q.i) : PL; };
    let ups = [];
    if (P.up != null) ups.push(P.up);
    pivAll.filter((p) => p.p > p0 * 1.04 && p.p > (P.up || 0) * 1.03).sort((a, b) => a.p - b.p).forEach((p) => { if (ups.length < 3 && ups.every((u) => Math.abs(u - p.p) / u > .05)) ups.push(p.p); });
    const used = [];
    const lvl = (v, col, upw) => {
      const yy = y(v), sx = startOf(v), ax = xr - TXR + 4;
      let ty = yy + (upw ? -3 : 11); while (used.some((u) => Math.abs(u - ty) < 11)) ty += upw ? -11 : 11; used.push(ty);
      return `<line x1="${sx}" x2="${xr - 4}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="1.1"/>` +
        `<path d="${upw ? `M${ax} ${ty - 1}l4 -6l4 6h-2.5v3h-3v-3z` : `M${ax} ${ty - 9}l4 6l4 -6h-2.5v-3h-3v3z`}" fill="${col}"/>` +
        `<text x="${ax + 11}" y="${ty}" font-size="9" font-weight="800" fill="${col}">${fmt(v)} ${cur(r)}</text>`;
    };
    ups.forEach((v) => { s += lvl(v, '#3ddc5a', true); });
    if (P.stop != null) s += lvl(P.stop, '#ff3b3b', false);
    const BXR = xr - TXR - 6; // Kästen enden links davon, damit ihre Beschriftung Platz hat
    // Fibonacci-Beschriftung eines Kastens: Retracement der letzten großen Bewegung
    const swing = (() => { const hs = pivAll.filter((p) => p.i <= n - 1); if (hs.length < 2) return null;
      const top = hs.reduce((a, b) => (b.p > a.p ? b : a)); const base = hs.filter((p) => p.i < top.i).reduce((a, b) => (b.p < a.p ? b : a), {p: Math.min(...c.slice(0, top.i + 1).map((k) => k[3])), i: 0});
      return top.p > base.p ? {top: top.p, base: base.p} : null; })();
    const STD = [23.6, 38.2, 50, 61.8, 70.7, 76.4, 78.6, 88.7, 100, 127.2, 161.8];
    const fibTxt = (v) => {
      if (!swing) return '';
      let pc = (swing.top - v) / (swing.top - swing.base) * 100; // Retracement
      if (v > swing.top) pc = (v - swing.base) / (swing.top - swing.base) * 100; // Ausdehnung über das Hoch
      const st = STD.find((f) => Math.abs(f - pc) < 1.6);
      return (st != null ? num(st, st % 1 ? 1 : 0) : num(pc, 1)) + ' %';
    };
    // Beschriftung rechts vom Kasten, wenn Platz ist, sonst links davon
    const boxLab = (bx2, v, col, bx1) => { const right = bx2 + LBW <= xr - TXR || bx1 == null;
      return `<text x="${right ? bx2 + 4 : bx1 - 4}" y="${y(v) + 3}" font-size="8.5" font-weight="700" fill="${col}"${right ? '' : ' text-anchor="end"'} class="halo2">${fibTxt(v)} (${fmt(v)})</text>`; };
    // Einstiegs-/Kaufzone (blau mit grünem Rand, wie „Long-term Entry“)
    let ZB = null;
    if (P.zone) {
      const Z = P.zone, w2 = Math.max(fut * .2, 6);
      const ei2 = Z.at === 'path' && P.path.length ? fi(P.path[0].d) : n - 1 + w2 * .55;
      const ex2 = Math.min(BXR, x(ei2 + w2 * .55)), ex1 = Math.min(ex2 - 14, x(Math.max(n - 1 + .5, ei2 - w2 * .55)));
      const zy1 = y(Z.hi), zh = Math.max(7, y(Z.lo) - zy1);
      s += `<rect x="${ex1}" y="${zy1}" width="${Math.max(12, ex2 - ex1)}" height="${zh}" fill="#1a3a8f" fill-opacity=".55" stroke="#3ddc5a" stroke-width="1"/>`;
      s += boxLab(ex2, Z.hi, '#3ddc5a', ex1) + (zh > 12 ? boxLab(ex2, Z.lo, '#3ddc5a', ex1) : '');
      ZB = {x1: ex1, x2: Math.max(ex1 + 12, ex2), y2: zy1 + zh + 26};
      s += `<text x="${ex1}" y="${zy1 + zh + 11}" font-size="9" font-weight="700" fill="#e8e8e8">${L ? 'Langfristiger Einstieg' : 'Einstieg'}:</text><text x="${ex1}" y="${zy1 + zh + 22}" font-size="9" font-weight="700" fill="#e8e8e8">${fmt(Z.hi)} – ${fmt(Z.lo)} ${cur(r)}</text>`;
    }
    // Zielzone (rot = dort wird eine Umkehr erwartet, wenn der Pfad danach fällt; sonst grün)
    const ei = fi(P.end.d), tw2 = Math.max(fut * .16, 5);
    const bx2 = Math.min(BXR, x(ei + tw2 * .5)), bx1 = Math.min(bx2 - 14, x(Math.max(n - 1 + 1, ei - tw2 * .6)));
    const ty1 = y(Math.max(...P.tgt)), th = Math.max(6, y(Math.min(...P.tgt)) - ty1);
    s += `<rect x="${bx1}" y="${ty1}" width="${Math.max(12, bx2 - bx1)}" height="${th}" fill="#3ddc5a" fill-opacity=".12" stroke="#3ddc5a" stroke-opacity=".8"/>`;
    s += boxLab(bx2, Math.max(...P.tgt), '#3ddc5a', bx1) + (th > 12 ? boxLab(bx2, Math.min(...P.tgt), '#3ddc5a', bx1) : '');
    // Zwischen-Hochs im Pfad, nach denen es fällt: roter Widerstandskasten
    P.path.forEach((w, j) => {
      const nx = P.path[j + 1], pv = j ? P.path[j - 1].p : p0;
      if (!nx || !(w.p > pv && nx.p < w.p)) return;
      const xi = fi(w.d), a1 = x(Math.max(n - 1 + .5, xi - tw2 * .5)), a2 = x(xi + tw2 * .5), hh = w.p * .04;
      s += `<rect x="${a1}" y="${y(w.p + hh)}" width="${a2 - a1}" height="${y(w.p - hh) - y(w.p + hh)}" fill="#8b1a1a" fill-opacity=".55" stroke="#ff3b3b" stroke-opacity=".6"/>` + boxLab(a2, w.p + hh, '#ff5a5a', a1) + boxLab(a2, w.p - hh, '#ff5a5a', a1);
    });
    // Wellen-Labels, mehrere Grade am selben Wendepunkt übereinander
    const groups = [];
    const addLab = (i, p, l, top, alt) => {
      let g = groups.find((q) => Math.abs(q.i - i) <= (L ? 2 : 3) && q.top === top);
      if (!g) { g = {i, p, top, ls: []}; groups.push(g); }
      if (top ? p > g.p : p < g.p) { g.p = p; g.i = i; }
      g.ls.push({l, alt});
    };
    P.piv.forEach((p, j) => {
      if (!p.l) return;
      const prev = j ? P.piv[j - 1].p : null, nxt = j < P.piv.length - 1 ? P.piv[j + 1].p : p0;
      if (!p.moved) addLab(p.i, p.p, p.l, prev == null ? p.p > nxt : p.p >= prev);
    });
    (P.hi || []).forEach((p) => addLab(p.i, p.p, p.l, p.top));
    let pv0 = p0;
    P.path.forEach((w) => { if (w.l) addLab(fi(w.d), w.p, w.l, w.p >= pv0); pv0 = w.p; });
    if (P.alt) { let pa = p0; P.alt.path.forEach((w, j) => { const last = j === P.alt.path.length - 1; addLab(fi(w.d), w.p, last ? (P.alt.label || 'alt.') : (w.l || ''), w.p >= pa, true); pa = w.p; }); }
    const labSvg = groups.map((g) => {
      const ls = g.ls.filter((q) => q.l).sort((a, b) => deg2(a.l) - deg2(b.l)); // klein am nächsten am Kurs
      return ls.map((q, k) => {
        const dgx = q.alt ? -1 : deg2(q.l), col = q.alt ? '#b5e3a1' : DEGC2[dgx], fs = q.alt ? 9 : [9.5, 10, 11, 10.5][dgx];
        const below0 = ZB && !g.top && x(g.i) >= ZB.x1 - 4 && x(g.i) <= ZB.x2 + 4 && y(g.p) < ZB.y2 ? ZB.y2 - y(g.p) : 0; // nicht in die Einstiegs-Beschriftung schreiben
        const yy = g.top ? y(g.p) - 5 - k * (fs + 1.5) : y(g.p) + 4 + fs * .85 + below0 + k * (fs + 1.5);
        return `<text x="${x(g.i)}" y="${yy}" font-size="${fs}" font-weight="${q.alt ? 600 : 700}" fill="${col}" text-anchor="middle"${q.alt ? ' font-style="italic"' : ''} class="halo2">${esc(q.l)}</text>`;
      }).join('');
    }).join('');
    // Hauptpfad: grün aufwärts, rot abwärts, offene Pfeilspitzen
    let px = x0, py = y(p0), pv = p0;
    P.path.forEach((w) => {
      const nx = x(fi(w.d)), ny = y(w.p), upw = w.p >= pv;
      s += `<line x1="${px}" y1="${py}" x2="${nx}" y2="${ny}" stroke="${upw ? '#3ddc5a' : '#ff3b3b'}" stroke-width="1.5" marker-end="url(#a${upw ? 'G' : 'R'}${id})" class="proj"/>`;
      px = nx; py = ny; pv = w.p;
    });
    // Alternative: gepunktet, mit Wahrscheinlichkeit im Kasten
    if (P.alt) {
      let ax = x0, ay = y(p0), av = p0, mid = null;
      P.alt.path.forEach((w, j) => {
        const nx = x(fi(w.d)), ny = y(w.p), upw = w.p >= av;
        s += `<line x1="${ax}" y1="${ay}" x2="${nx}" y2="${ny}" stroke="${upw ? '#3ddc5a' : '#ff3b3b'}" stroke-width="1.3" stroke-dasharray="1.5 2.5" marker-end="url(#a${upw ? 'g' : 'r'}${id})"/>`;
        if (!j) mid = [(ax + nx) / 2, (ay + ny) / 2];
        ax = nx; ay = ny; av = w.p;
      });
      if (P.alt.prob != null && mid) {
        const t = P.alt.prob + '%', bw2 = 30, bx = Math.max(PL + 2, ax - bw2 - 10), by = ay - 26;
        s += `<rect x="${bx}" y="${by}" width="${bw2}" height="15" fill="#131722" stroke="#e8e8e8" stroke-width="1"/><text x="${bx + bw2 / 2}" y="${by + 11}" font-size="9.5" font-weight="700" fill="#e8e8e8" text-anchor="middle" font-style="italic">${t}</text>`;
      }
    }
    s += labSvg;
    // Preisachse rechts
    const tick = (() => { const span = hi - lo, raw = span / 6, mag = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) || raw; })();
    const gl = logS ? [1, 2, 5].flatMap((k) => [1, 10, 100, 1000, 10000].map((m) => k * m)).filter((v) => v > lo * 1.05 && v < hi * .95) : (() => { const g = []; for (let v = Math.ceil(lo / tick) * tick; v <= hi; v += tick) g.push(v); return g; })();
    s += `<line x1="${xr}" x2="${xr}" y1="${PT - 6}" y2="${H - PB + 4}" stroke="#2a2e39"/>`;
    gl.forEach((v) => { if (Math.abs(y(v) - y(p0)) > 10) s += `<text x="${xr + 5}" y="${y(v) + 3}" font-size="8.5" fill="#b2b5be" font-family="JetBrains Mono, monospace">${fmt(v)}</text>`; });
    s += `<rect x="${xr + 2}" y="${y(p0) - 7}" width="${PR - 3}" height="14" fill="#e8e8e8"/><text x="${xr + 5}" y="${y(p0) + 3.5}" font-size="9" font-weight="700" fill="#131722" font-family="JetBrains Mono, monospace">${fmt(p0)}</text>`;
    // Quartalszahlen „E“
    const f = FUND[r.ticker] || {}, zy = H - PB + 6;
    const ern = (f.eps_hist || []).map((h) => ({d: addDays(new Date(h.q * 1000).toISOString().slice(0, 10), 32), s: h.surprise}));
    const nxE = f.next_earnings || (/zahl/i.test(r.next_event || '') ? r.next_event_date : null);
    if (nxE && !ern.some((h) => Math.abs(ddays(h.d, nxE)) < 20)) ern.push({d: nxE, s: null, fut: nxE > now});
    let lastE = -99;
    ern.sort((a, b) => (a.d < b.d ? -1 : 1)).forEach((h) => {
      const i = fi(h.d); if (i < 0 || x(i) > xr - 6 || x(i) - lastE < 12) return; lastE = x(i);
      const col = h.fut ? '#c147e9' : h.s == null ? '#9aa0b4' : h.s >= 0 ? '#2fbf71' : '#ef4444', cx = x(i);
      s += `<g><title>Quartalszahlen ${dShort(h.d)}${h.s != null ? ' · Überraschung ' + pct(h.s) : ''}</title><path d="M${cx - 5} ${zy}h10v8l-5 3l-5 -3z" fill="none" stroke="${col}" stroke-width="1.1"/><text x="${cx}" y="${zy + 7.3}" font-size="6.5" font-weight="800" fill="${col}" text-anchor="middle">E</text></g>`;
    });
    // Zeitachse
    const ay2 = H - 8;
    const totalDays = (n + fut) * bar, stepM = L ? (totalDays > 2400 ? 12 : 6) : (totalDays > 500 ? 2 : 1);
    let d = new Date(c[0][0].slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() + 1);
    const endD = addDays(now, fut * bar);
    while (d.toISOString().slice(0, 10) <= endD) {
      const ds = d.toISOString().slice(0, 10), m = d.getMonth();
      if (m % stepM === 0) {
        const i = ds <= now ? near(c, ds) + .5 : fi(ds);
        if (x(i) > PL + 10 && x(i) < xr - 10) s += `<text x="${x(i)}" y="${ay2}" font-size="8.5" fill="#b2b5be" text-anchor="middle"${m === 0 ? ' font-weight="700"' : ''}>${m === 0 ? d.getFullYear() : MN[m]}</text>`;
      }
      d.setMonth(d.getMonth() + 1);
    }
    return s + '</svg>';
  }

  /* ---------- Detail-Sheet ---------- */
  function crv(r) {
    const mid = (r.entry_low + r.entry_high) / 2, risk = mid - r.stop;
    if (!(risk > 0) || r.target_low == null) return null;
    return (r.target_low - mid) / risk;
  }

  /* ---------- Langfristiges Ziel (große Wellen) ---------- */
  const LTV = {bullisch: ['Langfristig aufwärts', 'var(--up)'], neutral: ['Langfristig offen', 'var(--warn)'], spekulativ: ['Spekulativ', 'var(--purple)'], 'bärisch': ['Langfristig schwach', 'var(--down)']};
  // Langfristige Kaufzone: lt_entry_* oder erster Rücksetzer im Wellenpfad (gleiche Regel wie die Auswertung)
  function ltZone(r) {
    if (r.lt_entry_low != null && r.lt_entry_high != null) return [r.lt_entry_low, r.lt_entry_high];
    const p = (((r.ew || {}).lang || {}).path || [])[0];
    return p && p.p < r.price * .97 ? [Math.round(p.p * 97) / 100, Math.round(p.p * 103) / 100] : null;
  }
  function ltHTML(r) {
    if (r.lt_target_low == null) return '';
    const p = r.price, v = LTV[r.lt_view] || ['Langfristig', 'var(--muted)'];
    const mid = (r.entry_low + r.entry_high) / 2;
    const crvNow = p > r.lt_stop ? (r.lt_target_low - p) / (p - r.lt_stop) : null;
    const crvZone = mid > r.lt_stop && mid < p ? (r.lt_target_low - mid) / (mid - r.lt_stop) : null;
    const col = (k) => k == null ? 'inherit' : k >= 2 ? 'var(--up)' : 'var(--warn)';
    const lo = Math.min(r.lt_stop, p), hi = r.lt_target_high, span = hi - lo || 1, x = (val) => Math.max(0, Math.min(100, (val - lo) / span * 100));
    return `<div class="lt">
      <div class="lt-h"><b>Großes Ziel · um ${esc(ltUntil(r))}</b><span class="pill" style="--sc:${v[1]}">${v[0]}</span></div>
      <div class="lt-bar"><span class="g" style="left:${x(r.lt_target_low)}%;width:${Math.max(1.5, x(r.lt_target_high) - x(r.lt_target_low))}%"></span>
        <span class="s" style="left:${x(r.lt_stop)}%"></span><span class="k" style="left:${x(p)}%"></span></div>
      <div class="levels lt-lv">
        <div><small>Großes Ziel</small><b class="up">${num(r.lt_target_low)}–${money(r.lt_target_high, r)}</b><em>${pct(r.lt_target_low / p - 1)} ab Kurs</em></div>
        <div><small>Langfristige Absicherung</small><b class="down">${money(r.lt_stop, r)}</b><em>${pct(r.lt_stop / p - 1)}</em></div>
        <div><small>Langfristige Kaufzone</small><b>${(() => { const z = ltZone(r); return z ? num(z[0]) + '–' + money(z[1], r) : 'ab aktuellem Kurs'; })()}</b><em>${ltZone(r) ? 'erwarteter Rücksetzer' : 'kein tieferer Rücksetzer erwartet'}</em></div>
        <div><small>Chance : Risiko ab Kurs</small><b style="color:${col(crvNow)}">${crvNow == null ? '—' : '1 : ' + num(crvNow, 1)}</b></div>
        <div><small>Analysten-Ziel (Schnitt)</small><b>${r.lt_consensus != null ? money(r.lt_consensus, r) : '—'}</b>${r.lt_analysts ? `<em>${r.lt_analysts} Analysten</em>` : ''}</div>
      </div>
      <p class="lt-t">${esc(r.lt_text || '')}</p>
      <p class="lt-c">Sicherheit der Einschätzung: <b>${esc(r.lt_conf || '—')}</b> · Grundlage: Wochenchart (5 Jahre). Die Absicherung liegt weiter weg als beim kurzen Trade – dafür kleinere Position.</p>
    </div>`;
  }

  function ltBar(r) {
    const lo = Math.min(r.lt_stop, r.price), hi = Math.max(r.lt_target_high, r.price);
    const span = hi - lo || 1, x = (v) => Math.max(0, Math.min(100, (v - lo) / span * 100));
    return `<div class="bar lt-bar2"><span class="g" style="left:${x(r.lt_target_low)}%;width:${Math.max(1.5, x(r.lt_target_high) - x(r.lt_target_low))}%"></span>
      <span class="s" style="left:${x(r.lt_stop)}%"></span><span class="k" style="left:${x(r.price)}%"></span></div>`;
  }
  function ltDo(r) {
    const p = r.price, k = p > r.lt_stop ? (r.lt_target_low - p) / (p - r.lt_stop) : null, z = ltZone(r);
    const small = r.lt_view === 'spekulativ' || r.lt_view === 'bärisch' || r.lt_conf === 'niedrig' ? ' Nur mit einer kleinen Position.' : '';
    if (r.lt_view === 'bärisch') return 'Langfristig noch kein bestätigter Boden – eher abwarten.' + small;
    if (z) {
      const m = (z[0] + z[1]) / 2, kz = m > r.lt_stop ? (r.lt_target_low - m) / (m - r.lt_stop) : null;
      return `Langfristig wird zuerst ein Rücksetzer in die Kaufzone ${num(z[0])}–${money(z[1], r)} erwartet. Dort wäre der Einstieg deutlich besser (Chance : Risiko 1 : ${kz == null ? '—' : num(kz, 1)} statt ${k == null ? '—' : '1 : ' + num(k, 1)} ab Kurs). Absicherung unter ${money(r.lt_stop, r)} (Wochenschluss).` + small;
    }
    if (k != null && k >= 2) return `Ab dem aktuellen Kurs lohnt sich ein langfristiger Einstieg rechnerisch (Chance : Risiko 1 : ${num(k, 1)}). Absicherung unter ${money(r.lt_stop, r)}.` + small;
    return `Ab dem aktuellen Kurs ist der Abstand zum großen Ziel zu klein (Chance : Risiko ${k == null ? '—' : '1 : ' + num(k, 1)}). Langfristig besser in Rücksetzern kaufen – je näher an der Absicherung ${money(r.lt_stop, r)}, desto besser.` + small;
  }
  function legend(r, lv) {
    const P = ewPlan(r, lv); if (!P) return '';
    const gr = new Set(P.piv.concat(P.hi || []).filter((p) => p.l).map((p) => deg2(p.l)).concat(P.path.filter((w) => w.l).map((w) => deg2(w.l))));
    const G = [['w x y sehr groß', 3], ['[ ] groß', 2], ['( ) mittel', 1], ['klein', 0]].filter((g) => gr.has(g[1]));
    return `<div class="lgd"><div class="legend">${G.map((g) => `<span style="--lc:${DEGC2[g[1]]}">Wellen ${g[0]}</span>`).join('')}${P.auto ? '<span style="--lc:#c9b8ff">noch keine Zählung</span>' : ''}
      <span style="--lc:#3ddc5a">Hauptszenario ${P.prob} %</span><span style="--lc:#e8e8e8">gepunktet = Alternative ${P.alt ? P.alt.prob + ' %' : ''}</span><span style="--lc:#1a3a8f">${P.L ? 'Langfristiger Einstieg' : 'Einstiegszone'}</span><span style="--lc:#3ddc5a">grüne Linien = Marken nach oben · Ziel</span><span style="--lc:#ff3b3b">rote Linie = ${P.L ? 'Absicherung' : 'Stop'}</span><span style="--lc:#c147e9">E = Quartalszahlen</span></div>
      <p class="ew-note">Zeitpunkte aus der Länge der bisherigen Wellen geschätzt${P.e.path ? '' : ' (automatisch)'} – keine festen Termine.${P.probEst ? ` Wahrscheinlichkeit geschätzt (noch nicht von der Abendanalyse festgelegt)${P.why.length ? ': ' + esc(P.why.join(', ')) : ''}.` : ''}</p></div>`;
  }
  // Vollbild für den Wellen-Chart (dreh das Handy quer für mehr Platz)
  let FS = null;
  function fsDraw() {
    if (!FS) return;
    const r = STOCKS.find((x) => x.ticker === FS.t); if (!r) return;
    const k = innerWidth < 700 ? 1.15 : innerWidth < 1100 ? 1.5 : 1.9, top = 64, legendH = innerWidth < 700 ? 70 : 40;
    const W = Math.max(380, Math.round((innerWidth - 16) / k)), H = Math.max(260, Math.round((innerHeight - top - legendH - 12) / k));
    FS.el.querySelector('.fs-h').innerHTML = `<div><b>${esc(r.ticker)}</b> <span>${esc(r.name)}</span></div>
      <span class="hz-sw"><button data-l="kurz" aria-selected="${FS.lv === 'kurz'}">⚡ Wochen/Monate</button><button data-l="lang" aria-selected="${FS.lv === 'lang'}">🧭 Monate/Jahre</button></span>
      <button class="fs-x" aria-label="Schließen">✕</button>`;
    FS.el.querySelector('.fs-c').innerHTML = ewChart(r, FS.lv, {W, H}) + legend(r, FS.lv);
    FS.el.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { FS.lv = b.dataset.l; ensure(FS.lv).then(fsDraw); fsDraw(); });
    FS.el.querySelector('.fs-x').onclick = fsClose;
  }
  function fsOpen(t, lv) {
    const el = document.createElement('div'); el.className = 'fs'; el.innerHTML = '<div class="fs-h"></div><div class="fs-c"></div>';
    document.body.appendChild(el); document.body.classList.add('fs-on');
    FS = {t, lv, el}; ensure(lv).then(fsDraw); fsDraw();
    try { if (el.requestFullscreen && innerWidth < 900) el.requestFullscreen().catch(() => {}); } catch (e) { /* ok */ }
  }
  function fsClose() {
    if (!FS) return; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ok */ }
    FS.el.remove(); FS = null; document.body.classList.remove('fs-on');
  }
  addEventListener('resize', () => { clearTimeout(window.__fsT); window.__fsT = setTimeout(fsDraw, 150); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && FS) fsClose(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && FS && innerWidth < 900) fsClose(); });
  function ensure(h) {
    if (h === 'lang' && !WEEKLY) return load('weekly').then((w) => { WEEKLY = (w && w.stocks) || {}; return true; }).catch(() => { WEEKLY = {}; return true; });
    if (h === 'kurz' && !DAILY) return load('daily').then((w) => { DAILY = (w && w.stocks) || {}; return true; }).catch(() => { DAILY = {}; return true; });
    return Promise.resolve(false);
  }
  function redraw() {
    const r = STOCKS.find((x) => x.ticker === SEL); if (!r) return;
    if (isDesk() && $('#detail')) { const box = $('#detail'), top = box.scrollTop; box.innerHTML = deskHTML(r); wireDetail(box, r); box.scrollTop = top; }
    else if (!$('#sheet').hidden) refreshSheet();
  }
  const deskHTML = (r) => '<button class="back" type="button" data-back>← Alle Aktien</button>' + detailHTML(r, 'dtP');
  document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) closePick(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !FS && SEL && isDesk()) closePick(); });
  const isDesk = () => matchMedia('(min-width: 1180px)').matches;
  // breites Analyse-Fenster am Desktop: Chart in echter Größe zeichnen (Schrift bleibt gut lesbar)
  const deskSz = () => { if (!isDesk()) return null; const d = $('#detail'); const w = Math.max(560, ((d && d.clientWidth) || 900) - 40);
    return {W: Math.round(w / 1.25), H: Math.round(Math.min(560, Math.max(380, innerHeight * .55)) / 1.25), inline: 1}; };
  let SEL = null;
  function detailHTML(r, pid) {
    const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'};
    const q = PRICES[r.ticker] || {};
    const k = crv(r);
    return `
      <div class="sh-head"><div><div class="t">${esc(r.ticker)}</div><div class="n">${esc(r.name)} · ${esc(r.sector || '')}</div></div>
        <div class="sh-price"><div class="p" id="${pid}">${money(r.price, r)}</div>
        <div class="c ${q.chg_pct >= 0 ? 'up' : 'down'}">${q.chg_pct != null ? pct(q.chg_pct) : esc(r.chg_note || '')}</div></div></div>
      <div class="sh-pills">${HOR === 'lang' && r.lt_view ? `<span class="pill" style="--sc:${(LTV[r.lt_view] || [, 'var(--muted)'])[1]}">${(LTV[r.lt_view] || ['—'])[0]}</span>` : `<span class="pill" style="--sc:${s.c}">${s.l}</span>`}
        ${HOR === 'lang' ? '' : r.alert === 'hoch' ? '<span class="pill" style="--sc:var(--down)">Dringend</span>' : r.alert === 'mittel' ? '<span class="pill" style="--sc:var(--warn)">Beobachten</span>' : ''}
        <span class="pill" style="--sc:var(--muted)">${r.group === 'Portfolio' ? 'Im Depot' : 'Watchlist'}</span>
        <span class="hz-sw" role="tablist" aria-label="Zeitraum"><button data-h="kurz" aria-selected="${HOR === 'kurz'}">⚡ Kurz</button><button data-h="lang" aria-selected="${HOR === 'lang'}">🧭 Lang</button></span></div>
      <div class="dtabs"><button data-p="ov">Überblick</button><button data-p="num">Zahlen</button><button data-p="calc">Rechner</button></div>
${HOR === 'lang' && r.lt_target_low != null ? `      <div class="dpane" data-pane="ov">
      <div class="do do-top lang"><small>Was heißt das langfristig?</small>${esc(ltDo(r))}</div>
      <div class="hz-band lang"><b>🧭 Langfristig · Monate bis Jahre</b><span>Ziel um ${esc(ltUntil(r))} · Wochenchart</span></div>
      <div class="chart"><button class="fs-btn" data-fs="lang" aria-label="Vollbild">⛶ Vollbild</button>${ewChart(r, 'lang', deskSz())}
        ${legend(r, 'lang')}</div>
      ${ltHTML(r)}
      <p class="foot">Technisches Szenario auf Wochenbasis, keine Anlageberatung.</p></div>
` : `      <div class="dpane" data-pane="ov">
      <div class="do do-top"><small>Was tun?</small>${esc(r.action || r.plan || '')}</div>
      <div class="hz-band kurz"><b>⚡ Kurzfristig · Wochen bis Monate</b><span>${(() => { const d = ewEnd(r, 'kurz'); return d ? 'Ziel um ' + esc(roughTxt(d)) : esc(r.horizon_text || ''); })()} · Tageschart</span></div>
      <div class="chart"><button class="fs-btn" data-fs="kurz" aria-label="Vollbild">⛶ Vollbild</button>${ewChart(r, 'kurz', deskSz())}
        ${legend(r, 'kurz')}</div>
      <div class="ifs">
        ${r.if_up ? `<div class="if" style="--ic:var(--up)"><span class="ic">▲</span><div><b>Wenn es steigt</b>${esc(r.if_up)}</div></div>` : ''}
        ${r.if_wait ? `<div class="if" style="--ic:var(--warn)"><span class="ic">▶</span><div><b>Solange dazwischen</b>${esc(r.if_wait)}</div></div>` : ''}
        ${r.if_down ? `<div class="if" style="--ic:var(--down)"><span class="ic">▼</span><div><b>Wenn es fällt</b>${esc(r.if_down)}</div></div>` : ''}
      </div>
      <div class="levels">
        <div><small>Einstieg${r.entry_type === 'Ausbruch' ? ' (Ausbruch)' : ''}</small><b>${num(r.entry_low)}–${money(r.entry_high, r)}</b></div>
        <div><small>Stop</small><b class="down">${money(r.stop, r)}</b></div>
        <div><small>Kurzes Ziel (Swing)</small><b class="up">${num(r.target_low)}–${money(r.target_high, r)}</b></div>
        <div><small>Chance : Risiko</small><b style="color:${k == null ? 'inherit' : k >= 2 ? 'var(--up)' : 'var(--warn)'}">${k == null ? '—' : '1 : ' + num(k, 1)}</b></div>
      </div>
      <div class="when">${r.entry_eta_text && r.status !== 'zone' && r.status !== 'trend' ? `<span>${esc(r.entry_eta_text)}</span>` : ''}${r.horizon_text ? `<span>${esc(r.horizon_text)}</span>` : ''}${r.next_event ? `<span>${esc(r.next_event)}${r.next_event_date ? ' · ' + dShort(r.next_event_date) : ''}</span>` : ''}</div>
      <details class="more"><summary>Wellenanalyse</summary>
        <p><b>Hauptszenario</b>${esc(r.wave_primary)}</p><p><b>Alternative</b>${esc(r.wave_alt)}</p>
        <p><b>Bestätigung / Invalidierung</b>Über ${money(r.trigger, r)} bestätigt · unter ${money(r.invalidation, r)} ist die Zählung falsch.</p></details>
      ${r.news_brief ? `<details class="more"><summary>Aktuelle Lage</summary><p>${esc(r.news_brief)}</p></details>` : ''}
      <p class="foot">Technisches Szenario, keine Anlageberatung.</p></div>
`}      <div class="dpane kpis" data-pane="num" hidden><p class="kpi-note">Gesamtbild aus Technik, Fundament, Bewertung und Stimmung – gilt für kurz und lang.</p>${checkHTML(r)}${analystHTML(r)}${kpiHTML(r)}<p class="foot">Analysten: Yahoo Finance · Kennzahlen: TradingView, Yahoo</p></div>
      <div class="dpane" data-pane="calc" hidden>${calcHTML(r)}</div>`;
  }
  let DTAB = 'ov';
  function wireDetail(box, r) {
    const set = (p) => {
      DTAB = p;
      box.querySelectorAll('.dtabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
      box.querySelectorAll('.dpane').forEach((x) => { x.hidden = x.dataset.pane !== p; });
      const tabs = box.querySelector('.dtabs'); if (tabs && box.scrollTop > tabs.offsetTop) box.scrollTop = Math.max(0, tabs.offsetTop - 10);
      anim((g) => g.from(box.querySelectorAll('.dpane:not([hidden]) > *'), {y: 8, opacity: 0, duration: .3, stagger: .03, clearProps: 'all'}));
    };
    box.querySelectorAll('.dtabs button').forEach((b) => b.addEventListener('click', () => set(b.dataset.p)));
    box.querySelectorAll('.dtabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === DTAB));
    box.querySelectorAll('.dpane').forEach((x) => { x.hidden = x.dataset.pane !== DTAB; });
    wireCalc(box, r);
    box.querySelectorAll('.hz-sw button').forEach((b) => b.addEventListener('click', () => setHor(b.dataset.h)));
    box.querySelectorAll('.fs-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); fsOpen(r.ticker, b.dataset.fs); }));
  }
  function refreshSheet() {
    const r = STOCKS.find((x) => x.ticker === SEL); if (!r) return;
    const sh = $('#sheet'), top = sh.scrollTop;
    $('#sheetBody').innerHTML = detailHTML(r, 'shP'); wireDetail(sh, r); sh.scrollTop = top;
  }
  function animateDetail(box, r, pid, delay) {
    wireDetail(box, r);
    anim((g) => {
      const ring = box.querySelector('.ring .fg');
      if (ring) g.from(ring, {strokeDashoffset: ring.getAttribute('stroke-dasharray'), duration: 1, ease: 'power2.out', delay: delay});
      const w = box.querySelector('.wave'), p = box.querySelector('.proj');
      if (w) { const L = w.getTotalLength(); g.fromTo(w, {strokeDasharray: L, strokeDashoffset: L}, {strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', delay: delay}); }
      if (p) g.from(p, {opacity: 0, duration: .5, delay: delay + .9});
      g.from(box.querySelectorAll('.cdl > *'), {opacity: 0, duration: .02, stagger: .004, delay: delay - .1});
      g.from(box.querySelectorAll('.dpane:not([hidden]) .do, .dpane:not([hidden]) .if, .dpane:not([hidden]) .levels > div, .check'), {y: 12, opacity: 0, duration: .4, stagger: .03, delay: delay + .05, ease: 'power2.out', clearProps: 'transform,opacity'});
      const el = document.getElementById(pid), o = {v: r.price * .97};
      if (el) g.to(o, {v: r.price, duration: .8, ease: 'power2.out', onUpdate: () => { el.textContent = money(o.v, r); }});
    });
  }
  function openSheet(t) {
    const r = STOCKS.find((x) => x.ticker === t); if (!r) return;
    SEL = r.ticker;
    ensure(HOR).then((ch) => { if (ch && SEL === r.ticker) redraw(); });
    document.querySelectorAll('#list .row, #tbl tr.go').forEach((li) => li.classList.toggle('sel', li.dataset.t === SEL));
    if (isDesk() && $('#detail')) {
      const box = $('#detail');
      document.body.classList.add('pick');
      box.innerHTML = deskHTML(r); box.scrollTop = 0;
      anim((g) => g.from(box, {opacity: 0, x: 16, duration: .35, ease: 'power2.out', clearProps: 'all'}));
      animateDetail(box, r, 'dtP', .15);
      history.replaceState(null, '', '#aktien/' + r.ticker);
      return;
    }
    $('#sheetBody').innerHTML = detailHTML(r, 'shP');
    const sh = $('#sheet'), bg = $('#sheetBg');
    sh.hidden = false; bg.hidden = false; sh.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    anim((g) => {
      g.fromTo(bg, {opacity: 0}, {opacity: 1, duration: .25});
      g.fromTo(sh, {y: 60, opacity: 0}, {y: 0, opacity: 1, duration: .45, ease: 'power3.out'});
    });
    animateDetail(sh, r, 'shP', .2);
    history.replaceState(null, '', '#aktien/' + r.ticker);
  }
  function closeSheet() {
    const sh = $('#sheet'), bg = $('#sheetBg');
    const done = () => { sh.hidden = true; bg.hidden = true; document.body.style.overflow = ''; };
    history.replaceState(null, '', '#aktien');
    if (G && !calm) { G.to(sh, {y: 60, opacity: 0, duration: .25, ease: 'power2.in', onComplete: done}); G.to(bg, {opacity: 0, duration: .25}); } else done();
  }
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBg').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  // Nach unten wischen schließt das Sheet
  (() => { let y0 = null; const sh = $('#sheet');
    sh.addEventListener('touchstart', (e) => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, {passive: true});
    sh.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) closeSheet(); y0 = null; }, {passive: true});
  })();

  /* ---------- News & Ausblick ---------- */
  function renderNews(news) {
    const imp = news.filter((n) => n.impact === 'hoch').sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('#newsList').innerHTML = imp.map((n) => `<li><div class="h"><span class="tk">${esc(n.ticker)}</span><span>${dShort(n.date)}</span>
      <span class="${n.direction === 'positiv' ? 'up' : n.direction === 'negativ' ? 'down' : ''}">${n.direction === 'positiv' ? '▲ positiv' : n.direction === 'negativ' ? '▼ negativ' : ''}</span></div>
      <b>${esc(n.headline)}</b><p>${esc(n.summary)}</p>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">Quelle ↗</a>` : ''}</li>`).join('')
      || '<li class="empty">Gerade keine wirklich wichtigen News.</li>';
    const today = new Date().toISOString().slice(0, 10);
    $('#newsDot').hidden = !imp.some((n) => n.date >= today);
  }
  function renderAusblick(run, alerts, events) {
    const R = run[0] || {};
    $('#hero').innerHTML = `<div class="k">${esc(R.kind || '')}</div><div class="h">${esc(R.headline || '')}</div>
      <p class="m">${esc(R.market || '')}</p><div class="nx">Nächstes Update: ${esc(R.next_update || '—')}</div>`;
    const lv = (l) => l === 'hoch' ? 'var(--down)' : 'var(--warn)';
    $('#alertList').innerHTML = alerts.slice().sort((a, b) => (a.level === 'hoch' ? 0 : 1) - (b.level === 'hoch' ? 0 : 1))
      .map((a) => `<li data-t="${esc(a.ticker)}" style="--lc:${lv(a.level)}"><span class="tk">${esc(a.ticker)}</span><span class="lv">${a.level === 'hoch' ? 'Dringend' : 'Beobachten'}</span><div class="x">${esc(a.text)}</div></li>`).join('')
      || '<li class="empty">Keine Meldungen.</li>';
    $('#alertList').querySelectorAll('li[data-t]').forEach((li) => li.addEventListener('click', () => {
      if (STOCKS.some((r) => r.ticker === li.dataset.t)) { location.hash = 'aktien'; setTimeout(() => openSheet(li.dataset.t), 60); }
    }));
    const today = new Date().toISOString().slice(0, 10);
    $('#eventList').innerHTML = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15)
      .map((e) => `<li><span class="d">${dShort(e.date)}</span><span class="e"><span class="tk">${esc(e.ticker)}</span> ${esc(e.event)}</span></li>`).join('')
      || '<li class="empty">Keine Termine.</li>';
  }

  /* ---------- Kennzahlen je Aktie ---------- */
  const pc = (x, d) => x == null || isNaN(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d == null ? 1 : d).replace('.', ',') + ' %';
  const cls = (x) => x == null ? '' : x >= 0 ? 'up' : 'down';
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const big = (v) => v == null ? '—' : v >= 1e12 ? num(v / 1e12, 2) + ' Bio.' : v >= 1e9 ? num(v / 1e9, 1) + ' Mrd.' : num(v / 1e6, 0) + ' Mio.';
  function kpiHTML(r) {
    const k = KPIS[r.ticker]; if (!k) return '';
    const bm = r.currency === 'EUR' ? 'DAX' : 'S&P 500';
    const cell = (label, val, c, hint) => `<div${hint ? ` title="${esc(hint)}"` : ''}><small>${label}</small><b class="${c || ''}">${val}</b></div>`;
    let h = '<h4>Kursverlauf</h4><div class="kpi-grid">';
    h += cell('1 Woche', pc(k.perf_1w), cls(k.perf_1w)) + cell('1 Monat', pc(k.perf_1m), cls(k.perf_1m)) + cell('3 Monate', pc(k.perf_3m), cls(k.perf_3m));
    h += cell('vs. ' + bm + ' (1 M)', pc(k.rs_1m), cls(k.rs_1m), 'Relative Stärke: besser (+) oder schlechter (−) als der Index')
       + cell('vs. ' + bm + ' (3 M)', pc(k.rs_3m), cls(k.rs_3m), 'Relative Stärke über 3 Monate');
    h += cell('Abst. 50-Tage-Linie', pc(k.vs_sma50), cls(k.vs_sma50)) + cell('Abst. 200-Tage-Linie', pc(k.sma200_gap), cls(k.sma200_gap), 'Über der 200-Tage-Linie = langfristiger Aufwärtstrend');
    h += cell('Abst. 52-W-Hoch', pc(k.from_high_52w), 'down') + cell('Schwankung pro Tag', k.atr_pct != null ? num(k.atr_pct * 100, 1) + ' %' : '—', '', 'Durchschnittliche Tagesspanne (ATR) – Maß für das Risiko');
    h += '</div>';
    const tv = (f) => k['tv_' + f];
    const val = [];
    if (tv('market_cap_basic') != null) val.push(cell('Börsenwert', big(tv('market_cap_basic')) + ' ' + cur(r)));
    if (tv('price_earnings_ttm') != null) val.push(cell('KGV', num(tv('price_earnings_ttm'), 1), '', 'Kurs-Gewinn-Verhältnis (letzte 12 Monate)'));
    if (tv('price_earnings_growth_ttm') != null) val.push(cell('PEG', num(tv('price_earnings_growth_ttm'), 2), '', 'KGV geteilt durch Gewinnwachstum – unter 1 gilt als günstig'));
    if (tv('price_sales_current') != null) val.push(cell('KUV', num(tv('price_sales_current'), 1), '', 'Kurs-Umsatz-Verhältnis'));
    if (tv('price_book_fq') != null) val.push(cell('KBV', num(tv('price_book_fq'), 1), '', 'Kurs-Buchwert-Verhältnis'));
    const dy = tv('dividends_yield_current') != null ? tv('dividends_yield_current') : tv('dividend_yield_recent');
    if (dy != null) val.push(cell('Dividendenrendite', num(dy, 2) + ' %'));
    if (tv('total_revenue_yoy_growth_ttm') != null) val.push(cell('Umsatzwachstum', pc(tv('total_revenue_yoy_growth_ttm') / 100), cls(tv('total_revenue_yoy_growth_ttm'))));
    if (tv('earnings_per_share_diluted_yoy_growth_ttm') != null) val.push(cell('Gewinnwachstum', pc(tv('earnings_per_share_diluted_yoy_growth_ttm') / 100), cls(tv('earnings_per_share_diluted_yoy_growth_ttm'))));
    if (tv('net_margin_ttm') != null) val.push(cell('Nettomarge', num(tv('net_margin_ttm'), 1) + ' %'));
    if (tv('beta_1_year') != null) val.push(cell('Beta', num(tv('beta_1_year'), 2), '', 'Schwankung im Vergleich zum Markt (1 = wie der Markt)'));
    if (tv('Recommend_All') != null) {
      const v = tv('Recommend_All'), t = v > .5 ? 'Stark kaufen' : v > .1 ? 'Kaufen' : v >= -.1 ? 'Neutral' : v >= -.5 ? 'Verkaufen' : 'Stark verkaufen';
      val.push(cell('TradingView-Technik', t, v > .1 ? 'up' : v < -.1 ? 'down' : '', 'Sammelsignal aus gleitenden Durchschnitten und Oszillatoren'));
    }
    if (tv('earnings_release_next_date')) val.push(cell('Nächste Zahlen', new Date(tv('earnings_release_next_date') * 1000).toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: '2-digit'})));
    if (val.length) h += '<h4>Bewertung &amp; Fundamentaldaten</h4><div class="kpi-grid">' + val.join('') + '</div>';
    if (k.season) {
      const m = new Date().getMonth() + 1, cm = k.season[String(m)];
      const vals = Object.values(k.season).map((x) => Math.abs(x.avg)); const mx = Math.max(...vals, 0.01);
      h += `<h4>Saisonalität (10 Jahre)</h4><p class="kpi-note">${cm ? `Im ${MON[m - 1]} im Schnitt <b class="${cls(cm.avg)}">${pc(cm.avg)}</b>, in ${Math.round(cm.up * cm.n)} von ${cm.n} Jahren gestiegen.` : ''}</p><div class="season">`;
      for (let i = 1; i <= 12; i++) {
        const x = k.season[String(i)]; const v = x ? x.avg : 0; const hh = Math.round(Math.abs(v) / mx * 34);
        h += `<div class="${i === m ? 'now' : ''}" title="${MON[i - 1]}: ${pc(v)}"><span class="${v >= 0 ? 'pos' : 'neg'}" style="height:${Math.max(2, hh)}px"></span><em>${MON[i - 1][0]}</em></div>`;
      }
      h += '</div>';
    }
    const sig = TRACK && TRACK.signals ? TRACK.signals.filter((x) => x.ticker === r.ticker) : [];
    if (sig.length) {
      h += '<h4>Bisherige Signale</h4><ul class="sig-mini">' + sig.slice(0, 5).map((x) => `<li><span>${dShort(x.issued_day)}</span><span>${esc((STATUS[x.status] || {l: x.status}).l)}</span><span class="oc oc-${x.outcome}">${OUT[x.outcome] || x.outcome}</span><span class="${cls(x.r)}">${x.r != null ? num(x.r, 2) + ' R' : ''}</span></li>`).join('') + '</ul>';
    }
    return h;
  }

  /* ---------- Markt-Cockpit ---------- */
  function spark(v, w, h) {
    if (!v || v.length < 2) return '';
    const mn = Math.min(...v), mx = Math.max(...v), sx = w / (v.length - 1), sy = (h - 4) / ((mx - mn) || 1);
    const pts = v.map((x, i) => (i * sx).toFixed(1) + ',' + (h - 2 - (x - mn) * sy).toFixed(1)).join(' ');
    const up = v[v.length - 1] >= v[0];
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${up ? '#2fd08a' : '#ff5d6c'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  function cockpitHTML(events) {
    const M = MARKET; if (!M || !M.items) return '<p class="empty">Marktdaten werden geladen, sobald der nächste Kursabruf gelaufen ist.</p>';
    const it = (k) => M.items.find((x) => x.key === k);
    let h = '';
    // Stimmung
    const vix = it('VIX'), fg = M.fear_greed, spx = it('SPX');
    const vixL = !vix ? '' : vix.last < 15 ? 'ruhig' : vix.last < 20 ? 'normal' : vix.last < 30 ? 'nervös' : 'Panik';
    h += '<div class="ck-card"><h3>Stimmung</h3>';
    if (fg) {
      const lab = fg.score < 25 ? 'Extreme Angst' : fg.score < 45 ? 'Angst' : fg.score <= 55 ? 'Neutral' : fg.score <= 75 ? 'Gier' : 'Extreme Gier';
      h += `<div class="gauge"><div class="gauge-bar"><i style="left:${fg.score}%"></i></div><div class="gauge-l"><b>${fg.score}</b> ${lab}<small>Fear &amp; Greed · vor 1 Woche ${fg.prev_week}</small></div></div>`;
    }
    h += '<div class="ck-mini">';
    if (vix) h += `<div><small>VIX (Angst)</small><b>${num(vix.last, 1)}</b><em>${vixL}</em></div>`;
    if (spx && spx.above_200 != null) h += `<div><small>Trend S&amp;P 500</small><b class="${spx.above_200 ? 'up' : 'down'}">${spx.above_200 ? 'über' : 'unter'}</b><em>200-Tage-Linie</em></div>`;
    if (M.breadth_50 != null) h += `<div><small>Marktbreite</small><b>${Math.round(M.breadth_50 * 100)} %</b><em>unserer Werte über 50-T-Linie</em></div>`;
    h += '</div></div>';
    // Indizes
    const row = (x, digits) => `<div class="ck-row"><div><b>${esc(x.name)}</b><small>1M ${pc(x.chg_1m)} · Jahr ${pc(x.chg_ytd)}</small></div>${spark(x.spark, 56, 24)}<div class="r"><b>${num(x.last, digits)}</b><small class="${cls(x.chg_1d)}">${pc(x.chg_1d)}</small></div></div>`;
    h += '<div class="ck-card"><h3>Indizes</h3>' + ['SPX', 'NDX', 'DAX', 'STOXX'].map(it).filter(Boolean).map((x) => row(x, 0)).join('') + '</div>';
    h += '<div class="ck-card"><h3>Zinsen, Währung, Rohstoffe</h3>' + ['EURUSD', 'TNX', 'BRENT', 'GOLD', 'BTC'].map(it).filter(Boolean)
      .map((x) => row(x, x.key === 'EURUSD' ? 4 : x.key === 'TNX' ? 2 : x.last > 1000 ? 0 : 1)).join('') + '<p class="kpi-note">Steigt EUR/USD, verlieren US-Aktien in Euro an Wert.</p></div>';
    // Sektoren
    if (M.sectors && M.sectors.length) {
      const sec = M.sectors.slice().sort((a, b) => (b.chg_1w || 0) - (a.chg_1w || 0));
      const col = (v) => { const a = Math.min(1, Math.abs(v || 0) / 0.05); return v >= 0 ? `rgba(47,208,138,${.12 + a * .55})` : `rgba(255,93,108,${.12 + a * .55})`; };
      h += '<div class="ck-card"><h3>Sektoren (USA, 1 Woche)</h3><div class="heat">' + sec.map((x) => `<div style="background:${col(x.chg_1w)}" title="1 Monat ${pc(x.chg_1m)} · 3 Monate ${pc(x.chg_3m)}"><b>${esc(x.name)}</b><span>${pc(x.chg_1w)}</span></div>`).join('') + '</div></div>';
    }
    // Termine nächste 7 Tage
    const today = new Date().toISOString().slice(0, 10), wk = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
    const ev = (events || []).filter((e) => e.date >= today && e.date <= wk).sort((a, b) => a.date.localeCompare(b.date));
    if (ev.length) h += '<div class="ck-card"><h3>Diese Woche</h3><ul class="ck-ev">' + ev.map((e) => `<li><span>${dShort(e.date)}</span><span class="tk">${esc(e.ticker)}</span><span>${esc(e.event)}</span></li>`).join('') + '</ul></div>';
    h += `<p class="foot">Marktdaten: Yahoo Finance${fg ? ', CNN' : ''} · ${M.generated_at ? new Date(M.generated_at).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' Uhr' : ''}</p>`;
    return h;
  }
  function renderCockpit(events) {
    const html = cockpitHTML(events);
    if ($('#cockpit')) $('#cockpit').innerHTML = html;
    if ($('#cockpitM')) $('#cockpitM').innerHTML = html;
  }

  /* ---------- Analyse / Trefferquote ---------- */
  const OUT = {ziel: 'Ziel erreicht', stop: 'Stop', laeuft: 'läuft', wartet: 'wartet auf Einstieg', ersetzt: 'ersetzt', ersetzt_ohne_einstieg: 'ersetzt (kein Einstieg)', abgelaufen: 'abgelaufen', nicht_ausgeloest: 'nicht ausgelöst'};
  const GRP = {status: 'Nach Phase beim Signal', group: 'Depot vs. Watchlist', entry_type: 'Nach Einstiegsart', bias: 'Nach Einschätzung', crv: 'Nach geplantem Chance:Risiko', sector: 'Nach Branche'};
  let ALV = null;
  const ZON = {funktioniert: '✓ funktioniert', gebrochen: '✗ gebrochen', offen: 'offen', ersetzt: 'ersetzt', abgelaufen: 'abgelaufen'};
  function wireA(box) { box.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { ALV = b.dataset.a; renderAnalyse(); })); }
  function renderAnalyse() {
    const box = $('#analyseBody'); if (!box) return;
    if (!TRACK || !TRACK.summary) { box.innerHTML = '<p class="empty">Die Auswertung erscheint nach dem nächsten Kursabruf.</p>'; return; }
    const lv = ALV || HOR, LG = lv === 'lang';
    const T = LG ? Object.assign({curve: []}, TRACK.lang || {summary: null}) : TRACK;
    const sw = `<div class="hor" role="tablist" aria-label="Ebene"><button role="tab" data-a="kurz" aria-selected="${!LG}"><b>⚡ Trades</b><small>kurzfristig · Tageschart</small></button><button role="tab" data-a="lang" aria-selected="${LG}"><b>🧭 Investments</b><small>langfristig · Wochenchart</small></button></div>`;
    if (!T.summary) { box.innerHTML = sw + '<p class="empty">Die Auswertung der Investments startet mit dem nächsten Kursabruf.</p>'; wireA(box); return; }
    const S = T.summary;
    const pr = (x) => x == null ? '—' : Math.round(x * 100) + ' %';
    const r2 = (x) => x == null ? '—' : num(x, 2) + ' R';
    const tile = (l, v, c, hint, sub) => `<div class="kpi"${hint ? ` title="${esc(hint)}"` : ''}><small>${l}</small><b class="${c || ''}">${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const nz = S.zone_won + S.zone_lost, few = nz < 20;
    let h = sw + `<p class="sub">${LG ? 'Jede langfristige Einschätzung' : 'Jede Trade-Einschätzung'} wird seit dem ${dShort(T.since)}${T.since.slice(0, 4)} gespeichert und mit den echten ${LG ? 'Wochenkerzen' : 'Tageskerzen'} nachgespielt.
      ${LG ? 'Kaufzone = langfristige Zone bzw. Kurs bei der Einschätzung, Absicherung zählt nur per Wochenschluss.' : 'Einstieg, sobald der Kurs die Zone berührt.'} <b>R</b> = Gewinn oder Verlust in Vielfachen des Risikos (1 R = Abstand Einstieg bis Stop).</p>
      <div class="rulebox"><b>Wann zählt eine Zone als Treffer?</b> Nach dem Einstieg schließt der Kurs ${LG ? 'zwei Wochen' : 'zwei Tage'} in Folge über der Zone <i>und</i> steht mindestens 1 R im Plus – bevor der Stop fällt. Ab da kann der Stop auf den Einstiegskurs: Der Trade kann nicht mehr verlieren. Fällt vorher der Stop, war die Zone falsch. Ob das Ziel erreicht wird, steht zusätzlich darunter.</div>`;
    if (few) h += `<div class="warnbox">Noch wenig Daten: ${nz} entschiedene Zonen. Aussagekräftig wird es ab etwa 20–30 – bis dahin sind die Zahlen ein erster Eindruck.${LG ? ' Investments brauchen naturgemäß Monate.' : ''}</div>`;
    h += '<h2>Ergebnis</h2><div class="kpis-big">' +
      tile('Zone hat funktioniert', pr(S.zone_rate), S.zone_rate == null ? '' : S.zone_rate >= .5 ? 'up' : 'down', 'Funktioniert ÷ (funktioniert + gebrochen)', `${S.zone_won} funktioniert · ${S.zone_lost} gebrochen · ${S.zone_open} offen`) +
      tile('Ziel erreicht', pr(S.hit_rate), S.hit_rate == null ? '' : S.hit_rate >= .4 ? 'up' : 'down', 'Ziel erreicht ÷ (Ziel + Stop). Bei 1:2-Chance reichen schon gut 33 %.', `${S.wins} Ziele · ${S.losses} Stops`) +
      tile('Ø Ergebnis pro Trade', r2(S.avg_r), cls(S.avg_r), 'Erwartungswert: über 0 R verdient die Methode Geld') +
      tile('Summe', r2(S.sum_r), cls(S.sum_r), 'Alle abgeschlossenen Trades zusammen') +
      tile('Profit-Faktor', S.profit_factor == null ? '—' : num(S.profit_factor, 2), S.profit_factor == null ? '' : S.profit_factor >= 1.5 ? 'up' : S.profit_factor < 1 ? 'down' : '', 'Summe Gewinne ÷ Summe Verluste – über 1,5 ist gut') + '</div>';
    h += '<h2>Signale &amp; Trades</h2><div class="kpis-grid">' +
      tile('Signale gesamt', S.signals) + tile('Einstieg ausgelöst', pr(S.fill_rate), '', 'Anteil der Signale, bei denen der Kurs die Zone erreicht hat', `${S.filled} Trades`) +
      tile('Laufende Trades', S.open) + tile('Warten auf Einstieg', S.waiting) + tile('Abgeschlossen', S.closed) +
      tile('Bester / schlechtester', S.best_r == null ? '—' : num(S.best_r, 1) + ' / ' + num(S.worst_r, 1) + ' R') +
      tile('Ø Gewinner', r2(S.avg_win_r), 'up') + tile('Ø Verlierer', r2(S.avg_loss_r), 'down') + '</div>';
    h += '<h2>Wie genau sind die Analysen?</h2><div class="kpis-grid">' +
      tile('Ø geplantes Chance:Risiko', S.avg_crv_plan == null ? '—' : '1 : ' + num(S.avg_crv_plan, 1), S.avg_crv_plan >= 2 ? 'up' : 'down', 'Durchschnitt aller Signale – Ziel ist mindestens 1:2') +
      tile('Wenig Gegenwind', pr(S.zone_respected), '', 'Anteil der Trades, die nach dem Einstieg weniger als 0,5 R ins Minus liefen – zeigt, wie genau die Einstiegszone sitzt') +
      tile('Ø bester Stand', r2(S.avg_mfe_r), 'up', 'Wie weit lief der Trade im Schnitt maximal ins Plus (MFE)') +
      tile('Ø schlechtester Stand', r2(S.avg_mae_r), 'down', 'Wie weit lief der Trade im Schnitt maximal ins Minus (MAE)') +
      (LG ? '' : tile('Richtung nach 5 Tagen', pr(S.dir_hit_5d), '', 'Bullisch → Kurs höher, bärisch → tiefer', `${S.dir_n_5d} Signale`) +
      tile('Richtung nach 20 Tagen', pr(S.dir_hit_20d), '', 'Bullisch → Kurs höher, bärisch → tiefer', `${S.dir_n_20d} Signale`)) +
      tile('Hauptszenario bestätigt', pr(S.scenario_ok), '', 'Kurs schloss zuerst über der Bestätigungsmarke statt unter der Invalidierung', `${S.scenario_n} entschieden`) +
      tile('Ziel im Zeitfenster', pr(S.horizon_ok), '', 'Ziel innerhalb des geschätzten Zeitraums erreicht') +
      tile('Ø Tage bis Einstieg', S.avg_days_fill == null ? '—' : num(S.avg_days_fill, 1)) + tile('Ø Haltedauer (Tage)', S.avg_days_trade == null ? '—' : num(S.avg_days_trade, 1)) + '</div>';
    // Kurve
    h += '<h2>Verlauf (Summe R)</h2>';
    if (T.curve && T.curve.length > 1) {
      const v = T.curve.map((c) => c[1]); const W = 600, H = 160, mn = Math.min(0, ...v), mx = Math.max(0, ...v), sx = W / (v.length - 1), sy = (H - 20) / ((mx - mn) || 1);
      const y = (x) => 10 + (mx - x) * sy;
      h += `<div class="chart"><svg viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#ffffff" stroke-opacity=".15" stroke-dasharray="4 4"/><polyline class="wave" points="${v.map((x, i) => (i * sx).toFixed(1) + ',' + y(x).toFixed(1)).join(' ')}" fill="none" stroke="#22d3a6" stroke-width="2.2"/></svg></div>`;
    } else h += '<p class="empty small">Erscheint nach den ersten abgeschlossenen Trades.</p>';
    // Aufschlüsselung
    Object.keys(GRP).forEach((g) => {
      const rows = (T.groups || {})[g]; if (!rows || !rows.length) return;
      const lab = (k) => LG ? ((LTV[k] || [k])[0]) : g === 'status' ? (STATUS[k] || {l: k}).l : g === 'group' ? (k === 'Portfolio' ? 'Depot' : k) : k;
      h += `<h2>${GRP[g]}</h2><div class="tbl"><table><tr><th></th><th>Signale</th><th>Einstieg</th><th>Zone ✓ / ✗</th><th>Zone</th><th>Ziel / Stop</th><th>Ø R</th></tr>` +
        rows.map((x) => `<tr><td>${esc(lab(x.key))}</td><td>${x.signals}</td><td>${x.filled}</td><td>${x.zone_won} / ${x.zone_lost}</td><td>${pr(x.zone_rate)}</td><td>${x.wins} / ${x.losses}</td><td class="${cls(x.avg_r)}">${x.avg_r == null ? '—' : num(x.avg_r, 2)}</td></tr>`).join('') + '</table></div>';
    });
    // Signal-Liste
    const sig = T.signals || [];
    const live = sig.filter((x) => x.outcome === 'laeuft');
    if (live.length) {
      h += '<h2>Laufende Trades</h2><div class="tbl"><table><tr><th>Aktie</th><th>Einstieg</th><th>Stop</th><th>Ziel</th><th>Zone</th><th>Stand</th><th>bester / schlechtester</th></tr>' +
        live.map((x) => `<tr class="go" data-t="${esc(x.ticker)}"><td><b>${esc(x.ticker)}</b></td><td>${num(x.fill)} · ${dShort(x.fill_day)}</td><td>${num(x.stop)}</td><td>${num(x.target_low)}</td><td>${ZON[x.zone] || '—'}</td><td class="${cls(x.r)}">${x.r == null ? '—' : num(x.r, 2) + ' R'}</td><td>${x.mfe_r == null ? '—' : num(x.mfe_r, 1) + ' / ' + num(x.mae_r, 1)}</td></tr>`).join('') + '</table></div>';
    }
    h += `<details class="more"><summary>Alle ${sig.length} Signale</summary><div class="tbl"><table><tr><th>Datum</th><th>Aktie</th><th>Phase</th><th>Zone</th><th>Stop</th><th>Ziel</th><th>C:R</th><th>Zone</th><th>Ergebnis</th><th>R</th></tr>` +
      sig.map((x) => `<tr class="go" data-t="${esc(x.ticker)}"><td>${dShort(x.issued_day)}</td><td><b>${esc(x.ticker)}</b></td><td>${esc(LG ? (LTV[x.status] || [x.status || ''])[0] : (STATUS[x.status] || {l: x.status}).l)}</td><td>${num(x.entry_low)}–${num(x.entry_high)}</td><td>${num(x.stop)}</td><td>${num(x.target_low)}</td><td>${x.crv_plan == null ? '—' : num(x.crv_plan, 1)}</td><td>${ZON[x.zone] || ''}</td><td><span class="oc oc-${x.outcome}">${OUT[x.outcome] || x.outcome}</span></td><td class="${cls(x.r)}">${x.r == null ? '' : num(x.r, 2)}</td></tr>`).join('') + '</table></div></details>';
    h += '<p class="foot">Vereinfachte Simulation: nur Kauf (long), ohne Gebühren und Steuern, Einstieg zum Zonenpreis, am selben Tag gilt im Zweifel der Stop. Kein Versprechen für die Zukunft.</p>';
    box.innerHTML = h; wireA(box);
    box.querySelectorAll('tr.go').forEach((tr) => tr.addEventListener('click', () => { location.hash = 'aktien'; setTimeout(() => openSheet(tr.dataset.t), 60); }));
  }

  /* ---------- Entscheidungs-Check ---------- */
  function scoreOf(r) {
    const k = KPIS[r.ticker] || {}, f = FUND[r.ticker] || {};
    const P = {tech: {l: 'Technik', s: 50, n: [], d: 0}, fund: {l: 'Fundament', s: 50, n: [], d: 0}, val: {l: 'Bewertung', s: 50, n: [], d: 0}, mood: {l: 'Stimmung', s: 50, n: [], d: 0}};
    const add = (p, pts, txt) => { P[p].s += pts; P[p].d++; if (txt) P[p].n.push({pts, txt}); };
    const has = (x) => typeof x === 'number' && !isNaN(x);
    // Technik
    const st = {zone: [20, 'Kurs in der Einstiegszone'], annaeherung: [8, 'Kurs läuft auf die Einstiegszone zu'], boden: [0, ''], trend: [5, 'Intakter Aufwärtstrend'], meiden: [-30, 'Aktiver Abwärtstrend']}[r.status];
    if (st) add('tech', st[0], st[1]);
    if (has(k.sma200_gap)) add('tech', k.sma200_gap > 0 ? 10 : -12, k.sma200_gap > 0 ? 'Über der 200-Tage-Linie' : 'Unter der 200-Tage-Linie (langfristig schwach)');
    if (has(k.rs_3m)) add('tech', k.rs_3m > .05 ? 10 : k.rs_3m < -.05 ? -10 : 0, k.rs_3m > .05 ? 'Stärker als der Index (3 M ' + pc(k.rs_3m, 0) + ')' : k.rs_3m < -.05 ? 'Schwächer als der Index (3 M ' + pc(k.rs_3m, 0) + ')' : '');
    if (has(k.vs_sma50) && k.vs_sma50 < -.05) add('tech', -8, 'Unter der 50-Tage-Linie (kurzfristig schwach)');
    if (has(k.perf_1m) && k.perf_1m < -.1) add('tech', -8, 'Starker Rückgang im letzten Monat (' + pc(k.perf_1m, 0) + ')');
    if (has(k.atr_pct) && k.atr_pct > .05) add('tech', -4, 'Sehr schwankungsanfällig (Ø ' + num(k.atr_pct * 100, 0) + ' % pro Tag)');
    if (r.bias === 'bärisch') add('tech', -10, 'Wellenbild bärisch');
    if (r.alert === 'hoch') add('tech', -6, 'Dringende Meldung offen – Lage angespannt');
    const c = crv(r);
    if (c != null) add('tech', c >= 2 ? 12 : c < 1.5 ? -12 : 0, c >= 2 ? 'Chance:Risiko 1:' + num(c, 1) : c < 1.5 ? 'Chance:Risiko nur 1:' + num(c, 1) : '');
    // Fundament
    if (has(f.revenueGrowth)) add('fund', f.revenueGrowth > .15 ? 15 : f.revenueGrowth > .05 ? 5 : f.revenueGrowth < 0 ? -15 : 0, f.revenueGrowth > .15 ? 'Umsatz wächst stark (' + pc(f.revenueGrowth, 0) + ')' : f.revenueGrowth < 0 ? 'Umsatz schrumpft (' + pc(f.revenueGrowth, 0) + ')' : '');
    if (has(f.earningsGrowth)) add('fund', f.earningsGrowth > .15 ? 10 : f.earningsGrowth < 0 ? -10 : 0, f.earningsGrowth > .15 ? 'Gewinn wächst (' + pc(f.earningsGrowth, 0) + ')' : f.earningsGrowth < 0 ? 'Gewinn rückläufig (' + pc(f.earningsGrowth, 0) + ')' : '');
    if (has(f.profitMargins)) add('fund', f.profitMargins > .15 ? 10 : f.profitMargins < 0 ? -15 : 0, f.profitMargins > .15 ? 'Hohe Gewinnmarge (' + num(f.profitMargins * 100, 0) + ' %)' : f.profitMargins < 0 ? 'Macht Verlust' : '');
    if (has(f.freeCashflow)) add('fund', f.freeCashflow > 0 ? 5 : -12, f.freeCashflow > 0 ? '' : 'Negativer Free Cashflow');
    if (has(f.debtToEquity)) add('fund', f.debtToEquity > 200 ? -10 : f.debtToEquity < 50 ? 5 : 0, f.debtToEquity > 200 ? 'Hohe Verschuldung' : f.debtToEquity < 50 ? 'Wenig Schulden' : '');
    // Bewertung
    const peg = has(f.pegRatio) ? f.pegRatio : k.tv_price_earnings_growth_ttm;
    if (has(peg) && peg > 0) add('val', peg < 1 ? 20 : peg < 2 ? 5 : peg > 3 ? -15 : 0, peg < 1 ? 'Günstig im Verhältnis zum Wachstum (PEG ' + num(peg, 1) + ')' : peg > 3 ? 'Teuer im Verhältnis zum Wachstum (PEG ' + num(peg, 1) + ')' : '');
    if (has(f.forwardPE) && f.forwardPE > 0) add('val', f.forwardPE < 15 ? 10 : f.forwardPE > 40 ? -15 : 0, f.forwardPE < 15 ? 'Niedriges erwartetes KGV (' + num(f.forwardPE, 0) + ')' : f.forwardPE > 40 ? 'Hohes erwartetes KGV (' + num(f.forwardPE, 0) + ')' : '');
    const kgv = k.tv_price_earnings_ttm;
    if (has(kgv)) add('val', kgv <= 0 ? -10 : kgv > 60 ? -12 : kgv < 15 ? 8 : 0, kgv <= 0 ? 'Kein Gewinn (KGV negativ)' : kgv > 60 ? 'Sehr hohes KGV (' + num(kgv, 0) + ')' : kgv < 15 ? 'Niedriges KGV (' + num(kgv, 0) + ')' : '');
    const up = has(f.targetMeanPrice) && r.price ? f.targetMeanPrice / r.price - 1 : null;
    if (up != null && f.numberOfAnalystOpinions >= 3) add('val', up > .2 ? 15 : up > .1 ? 5 : up < 0 ? -15 : 0, up > .1 ? 'Analysten-Kursziel ' + pc(up, 0) + ' über dem Kurs' : up < 0 ? 'Kurs schon über dem Analysten-Kursziel' : '');
    // Stimmung
    if (has(f.recommendationMean)) add('mood', f.recommendationMean <= 1.8 ? 15 : f.recommendationMean <= 2.5 ? 5 : f.recommendationMean > 3 ? -15 : 0, f.recommendationMean <= 1.8 ? 'Analysten klar positiv' : f.recommendationMean > 3 ? 'Analysten skeptisch' : '');
    const t0 = (f.eps_trend || []).find((x) => x.period === '0y');
    if (t0 && has(t0.eps_now) && has(t0.eps_30d) && t0.eps_30d) {
      const ch = t0.eps_now / t0.eps_30d - 1;
      add('mood', ch > .01 ? 15 : ch < -.01 ? -15 : 0, ch > .01 ? 'Gewinnschätzungen steigen (30 T ' + pc(ch, 1) + ')' : ch < -.01 ? 'Gewinnschätzungen sinken (30 T ' + pc(ch, 1) + ')' : '');
    }
    if (has(k.tv_Recommend_All)) add('mood', k.tv_Recommend_All > .1 ? 5 : k.tv_Recommend_All < -.1 ? -5 : 0, '');
    if (has(f.shortPercentOfFloat) && f.shortPercentOfFloat > .1) add('mood', -10, 'Viele Leerverkäufer (' + num(f.shortPercentOfFloat * 100, 0) + ' %)');
    const pil = Object.entries(P).map(([key, p]) => ({key, l: p.l, s: p.d ? Math.max(0, Math.min(100, Math.round(p.s))) : null, n: p.n}));
    const W = {tech: .3, fund: .25, val: .2, mood: .25};
    const av = pil.filter((p) => p.s != null); const ws = av.reduce((a, p) => a + W[p.key], 0);
    const total = av.length ? Math.round(av.reduce((a, p) => a + p.s * W[p.key], 0) / ws) : null;
    const all = pil.flatMap((p) => p.n).filter((x) => x.txt);
    const pros = Array.isArray(r.pros) && r.pros.length ? r.pros : all.filter((x) => x.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 3).map((x) => x.txt);
    const cons = Array.isArray(r.cons) && r.cons.length ? r.cons : all.filter((x) => x.pts < 0).sort((a, b) => a.pts - b.pts).slice(0, 3).map((x) => x.txt);
    let risk = r.risk || '';
    const ne = f.next_earnings || r.next_event_date;
    if (ne) { const dd = Math.round((new Date(ne + 'T12:00:00') - Date.now()) / 864e5); if (dd >= 0 && dd <= 14) {
      const t = `Zahlen ${dd === 0 ? 'heute' : dd === 1 ? 'morgen' : 'in ' + dd + ' Tagen'}`;
      if (!risk) risk = t + ' – der Kurs kann stark springen.';
      if (!(Array.isArray(r.cons) && r.cons.length) && cons.length < 3) cons.push(t + ' (Kurslücke möglich)');
    } }
    if (!risk && cons.length) risk = cons[0];
    if (risk && cons[0] === risk && cons.length > 1) { /* doppelt vermeiden */ }
    return {total, pil, pros, cons, risk, partial: av.length < 4};
  }
  const tone = (s) => s == null ? 'var(--dim)' : s >= 65 ? 'var(--up)' : s >= 45 ? 'var(--warn)' : 'var(--down)';
  function checkHTML(r) {
    const S = scoreOf(r); if (S.total == null) return '';
    const lab = S.total >= 70 ? 'Starkes Gesamtbild' : S.total >= 55 ? 'Solide' : S.total >= 40 ? 'Gemischt' : 'Schwach';
    const R = 26, C = 2 * Math.PI * R;
    return `<div class="check">
      <div class="check-top">
        <div class="ring" style="--rc:${tone(S.total)}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${R}" class="bg"/><circle cx="32" cy="32" r="${R}" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - S.total / 100)}"/></svg><b>${S.total}</b></div>
        <div class="check-l"><small>Entscheidungs-Check</small><b>${lab}</b>
          <div class="amps">${S.pil.map((p) => `<span title="${p.s == null ? 'keine Daten' : p.s + ' / 100'}"><i style="background:${tone(p.s)}"></i>${p.l}</span>`).join('')}</div></div>
      </div>
      <div class="pc">
        <div><h5 class="up">Spricht dafür</h5><ul>${S.pros.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="dim">—</li>'}</ul></div>
        <div><h5 class="down">Spricht dagegen</h5><ul>${S.cons.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="dim">—</li>'}</ul></div>
      </div>
      ${S.risk ? `<div class="risk"><b>Größtes Risiko:</b> ${esc(S.risk)}</div>` : ''}
    </div>`;
  }

  /* ---------- Analysten & Gewinnschätzungen ---------- */
  function analystHTML(r) {
    const f = FUND[r.ticker]; if (!f) return '<p class="empty small">Analystendaten folgen mit dem nächsten Kursabruf.</p>';
    let h = '';
    if (f.targetMeanPrice && f.targetLowPrice && f.targetHighPrice) {
      const lo = Math.min(f.targetLowPrice, r.price), hi = Math.max(f.targetHighPrice, r.price), x = (v) => (v - lo) / ((hi - lo) || 1) * 100;
      const up = f.targetMeanPrice / r.price - 1;
      h += `<h4>Kursziele der Analysten${f.numberOfAnalystOpinions ? ' (' + f.numberOfAnalystOpinions + ')' : ''}</h4>
        <div class="tgt"><div class="tgt-bar"><span class="rng" style="left:${x(f.targetLowPrice)}%;right:${100 - x(f.targetHighPrice)}%"></span>
          <i class="avg" style="left:${x(f.targetMeanPrice)}%"></i><i class="now" style="left:${x(r.price)}%"></i></div>
          <div class="tgt-l"><span>Tief ${num(f.targetLowPrice)}</span><span>Ø <b>${money(f.targetMeanPrice, r)}</b> <em class="${cls(up)}">${pc(up, 0)}</em></span><span>Hoch ${num(f.targetHighPrice)}</span></div></div>`;
    }
    const rt = (f.rec_trend || []).find((t) => t.period === '0m');
    if (rt) {
      const parts = [['Stark kaufen', rt.strongBuy, '#2fd08a'], ['Kaufen', rt.buy, '#7bdcae'], ['Halten', rt.hold, '#f5b74a'], ['Verkaufen', (rt.sell || 0) + (rt.strongSell || 0), '#ff5d6c']];
      const tot = parts.reduce((a, p) => a + (p[1] || 0), 0);
      if (tot) h += '<h4>Empfehlungen</h4><div class="recbar">' + parts.filter((p) => p[1]).map((p) => `<span style="flex:${p[1]};background:${p[2]}" title="${p[0]}: ${p[1]}">${p[1]}</span>`).join('') + '</div><div class="reclab">' + parts.map((p) => `<span><i style="background:${p[2]}"></i>${p[0]}</span>`).join('') + '</div>';
    }
    const tr = (f.eps_trend || []).filter((t) => t.period === '0y' || t.period === '+1y');
    if (tr.length) {
      h += '<h4>Gewinnschätzungen je Aktie</h4><div class="tbl"><table><tr><th></th><th>heute</th><th>vor 30 T</th><th>vor 90 T</th><th>↑ / ↓ (30 T)</th></tr>' +
        tr.map((t) => { const ch = t.eps_30d ? t.eps_now / t.eps_30d - 1 : null; return `<tr><td>${t.period === '0y' ? 'dieses Jahr' : 'nächstes Jahr'}</td><td><b>${num(t.eps_now, 2)}</b> <span class="${cls(ch)}">${ch == null ? '' : pc(ch, 1)}</span></td><td>${num(t.eps_30d, 2)}</td><td>${num(t.eps_90d, 2)}</td><td><span class="up">${t.up_30d || 0}</span> / <span class="down">${t.down_30d || 0}</span></td></tr>`; }).join('') + '</table></div><p class="kpi-note">Steigende Schätzungen sind einer der stärksten Kurstreiber.</p>';
    }
    const eh = (f.eps_hist || []).filter((e) => e.actual != null);
    if (eh.length) {
      h += '<h4>Letzte Quartalszahlen</h4><div class="beats">' + eh.map((e) => { const s = e.surprise; const beat = s != null ? s >= 0 : e.actual >= e.est; return `<div class="${beat ? 'b' : 'm'}"><b>${beat ? 'geschlagen' : 'verfehlt'}</b><span>${s != null ? pc(s, 0) : ''}</span><em>${e.q ? new Date(e.q * 1000).toLocaleDateString('de-DE', {month: 'short', year: '2-digit'}) : ''}</em></div>`; }).join('') + '</div>';
    }
    const rc = (f.rating_changes || []).filter((x) => x.date >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10));
    if (rc.length) h += '<h4>Neue Einstufungen (60 Tage)</h4><ul class="sig-mini">' + rc.slice(0, 5).map((x) => `<li><span>${dShort(x.date)}</span><span>${esc(x.firm)}</span><span class="oc ${x.action === 'up' ? 'oc-ziel' : x.action === 'down' ? 'oc-stop' : ''}">${esc(x.to || '')}</span><span></span></li>`).join('') + '</ul>';
    return h || '<p class="empty small">Keine Analystendaten verfügbar.</p>';
  }

  /* ---------- Positionsgrößen-Rechner ---------- */
  const store = {get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }};
  function calcHTML(r) {
    const L = HOR === 'lang' && r.lt_stop != null;
    const entry = L ? r.price : r.price >= r.entry_low && r.price <= r.entry_high ? r.price : (r.entry_low + r.entry_high) / 2;
    return `<div class="calc" data-t="${esc(r.ticker)}">
      <p class="kpi-note">${L ? '🧭 Langfristig: ' : '⚡ Kurzfristig: '}Wie viele Stück darf ich kaufen, damit ${L ? 'die langfristige Absicherung' : 'ein Stop'} nur einen festen Teil meines Kontos kostet?</p>
      <div class="calc-in">
        <label>Konto (€)<input type="number" inputmode="decimal" data-k="acct" value="${esc(store.get('pr_acct', '10000'))}"></label>
        <label>Risiko pro Trade (%)<input type="number" inputmode="decimal" step="0.25" data-k="risk" value="${esc(store.get('pr_risk', '1'))}"></label>
        <label>Einstieg (${cur(r)})<input type="number" inputmode="decimal" data-k="entry" value="${+entry.toFixed(2)}"></label>
        <label>${L ? 'Langfr. Absicherung' : 'Stop'} (${cur(r)})<input type="number" inputmode="decimal" data-k="stop" value="${L ? r.lt_stop : r.stop}"></label>
        <label>${L ? 'Großes Ziel' : 'Ziel'} (${cur(r)})<input type="number" inputmode="decimal" data-k="target" value="${L ? r.lt_target_low : r.target_low}"></label>
      </div>
      <div class="calc-out"></div>
      <p class="foot">Ohne Gebühren und Steuern. Ein Stop schützt nicht vor Kurslücken (z. B. nach Zahlen).</p></div>`;
  }
  function wireCalc(box, r) {
    const c = box.querySelector('.calc'); if (!c) return;
    const fx = r.currency === 'USD' ? ((MARKET && (MARKET.items || []).find((x) => x.key === 'EURUSD')) || {}).last || 1.1 : 1;
    const run = () => {
      const v = {}; c.querySelectorAll('input').forEach((i) => { v[i.dataset.k] = parseFloat(String(i.value).replace(',', '.')); });
      store.set('pr_acct', v.acct); store.set('pr_risk', v.risk);
      const o = c.querySelector('.calc-out');
      const rps = (v.entry - v.stop) / fx;
      if (!(v.acct > 0 && v.risk > 0 && rps > 0)) { o.innerHTML = '<p class="empty small">Stop muss unter dem Einstieg liegen.</p>'; return; }
      const budget = v.acct * v.risk / 100; let n = Math.floor(budget / rps);
      const cap = Math.floor(v.acct * .25 / (v.entry / fx)); const capped = n > cap; if (capped) n = cap;
      const pos = n * v.entry / fx, loss = n * rps, gain = v.target > v.entry ? n * (v.target - v.entry) / fx : null;
      o.innerHTML = `<div class="calc-big"><small>Stückzahl</small><b>${n.toLocaleString('de-DE')}</b></div>
        <div class="kpi-grid">
          <div><small>Kaufsumme</small><b>${num(pos, 0)} €</b></div><div><small>Anteil am Konto</small><b>${num(pos / v.acct * 100, 1)} %</b></div>
          <div><small>Verlust beim Stop</small><b class="down">−${num(loss, 0)} €</b></div><div><small>Gewinn beim Ziel</small><b class="up">${gain == null ? '—' : '+' + num(gain, 0) + ' €'}</b></div>
          <div><small>Chance : Risiko</small><b>${gain == null ? '—' : '1 : ' + num(gain / loss, 1)}</b></div>${fx !== 1 ? `<div><small>Umrechnung</small><b>1 € = ${num(fx, 4)} $</b></div>` : ''}</div>
        ${capped ? '<div class="warnbox">Auf 25 % des Kontos begrenzt – sonst hinge zu viel an einer Aktie.</div>' : ''}${n === 0 ? '<div class="warnbox">Der Abstand zum Stop ist für dieses Risiko zu groß – Risiko erhöhen oder kleineres Setup wählen.</div>' : ''}`;
    };
    c.querySelectorAll('input').forEach((i) => i.addEventListener('input', run)); run();
  }

  /* ---------- Chancen-Finder ---------- */
  let SCR_MODE = 'pullback';
  const SECT = {'Technology Services': 'Software & IT', 'Electronic Technology': 'Elektronik & Halbleiter', 'Finance': 'Finanzen', 'Health Technology': 'Pharma & Medizintechnik',
    'Retail Trade': 'Handel', 'Consumer Non-Durables': 'Basiskonsum', 'Consumer Durables': 'Gebrauchsgüter', 'Producer Manufacturing': 'Industrie', 'Energy Minerals': 'Energie',
    'Utilities': 'Versorger', 'Communications': 'Telekom', 'Transportation': 'Transport', 'Commercial Services': 'Dienstleistungen', 'Health Services': 'Gesundheitsdienste',
    'Process Industries': 'Chemie & Grundstoffe', 'Non-Energy Minerals': 'Rohstoffe', 'Industrial Services': 'Industriedienste', 'Consumer Services': 'Konsumdienste',
    'Distribution Services': 'Großhandel', 'Miscellaneous': 'Sonstiges'};
  function renderChancen() {
    const box = $('#chancenBody'); if (!box) return;
    const D = SCREEN;
    if (!D || (!D.pullback && !D.breakout)) { box.innerHTML = '<p class="empty">Der Chancen-Finder erscheint nach dem nächsten Kursabruf.</p>'; return; }
    const list = D[SCR_MODE] || [];
    box.innerHTML = `<div class="seg seg-sc" data-i="${SCR_MODE === 'pullback' ? 0 : 1}"><button data-m="pullback" aria-selected="${SCR_MODE === 'pullback'}">Rücksetzer im Trend</button><button data-m="breakout" aria-selected="${SCR_MODE === 'breakout'}">Vor dem Ausbruch</button><span class="seg-ink"></span></div>
      <p class="sub small">${SCR_MODE === 'pullback' ? 'Starke Aktien im Aufwärtstrend, die gerade an ihre 50-Tage-Linie zurückgekommen sind.' : 'Aktien mit Schwung knapp unter ihrem 52-Wochen-Hoch.'} Automatischer Vorfilter aus ${D.universe} großen US- und deutschen Aktien – erst nach der vollen Analyse kaufen.</p>
      <ul class="opps">${list.map((x, i) => `<li>
        <div class="o-h"><span class="o-rank">${i + 1}</span><div><b>${esc(x.name || x.ticker)}</b><small>${esc(x.ticker)} · ${esc(SECT[x.sector] || x.sector || '')}</small></div>
          <div class="o-p"><b>${num(x.close)} ${x.currency === 'EUR' ? '€' : x.currency === 'USD' ? '$' : esc(x.currency || '')}</b><small class="${cls(x.perf_1m)}">1 M ${pc(x.perf_1m, 0)}</small></div></div>
        <div class="o-why">${x.why.slice(0, 4).map((w) => `<span>${esc(w)}</span>`).join('')}</div>
        <div class="o-act">${x.have ? '<span class="o-have">✓ schon im Radar</span>' : `<button class="o-add" data-n="${esc(x.name || x.ticker)}" data-t="${esc(x.tv)}">＋ Analysieren lassen</button>`}
          <a href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(x.tv)}" target="_blank" rel="noopener">Chart ↗</a><span class="o-sc" title="Wie gut das Muster passt">${x.score}</span></div></li>`).join('') || '<li class="empty">Gerade keine Treffer für dieses Muster.</li>'}</ul>
      <p class="foot">Stand ${D.generated_at ? new Date(D.generated_at).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' Uhr' : ''} · Quelle: TradingView-Screener</p>`;
    box.querySelectorAll('.seg-sc button').forEach((b) => b.addEventListener('click', () => { SCR_MODE = b.dataset.m; renderChancen(); }));
    box.querySelectorAll('.o-add').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.n + ' (' + b.dataset.t + ')';
      window.open('https://github.com/' + REPO + '/issues/new?labels=wunsch&title=' + encodeURIComponent('Wunsch: ' + n) + '&body=' + encodeURIComponent('Bitte beim nächsten Abend-Update analysieren und zur Watchlist hinzufügen: **' + n + '**\n\n(aus dem Chancen-Finder)'), '_blank', 'noopener');
      b.textContent = '✓ Wunsch geöffnet'; b.disabled = true;
    }));
    anim((g) => g.from('#chancenBody .opps li', {y: 14, opacity: 0, duration: .4, stagger: .04, ease: 'power2.out', clearProps: 'all'}));
  }


  /* ---------- Pop-up bei dringenden Meldungen ---------- */
  function popups(alerts, watch) {
    const seenKey = (id) => 'radar-seen:' + id;
    const seen = (id) => { try { return localStorage.getItem(seenKey(id)) === '1'; } catch (e) { return false; } };
    const mine = new Set(STOCKS.filter((r) => r.group === 'Portfolio').map((r) => r.ticker));
    const fresh = (iso) => !iso || (Date.now() - new Date(iso).getTime()) < 36 * 3600 * 1000;
    const items = [];
    ((watch && watch.events) || []).filter((e) => e.level === 'hoch' && mine.has(e.ticker)).forEach((e) => !items.some((i) => i.t === e.ticker) &&
      items.push({id: 'w:' + e.id, t: e.ticker, title: e.title, text: e.text, todo: e.todo, src: 'Wächter · ' + new Date(e.at).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'}) + ' Uhr'}));
    alerts.filter((a) => a.level === 'hoch' && mine.has(a.ticker) && fresh(a.at)).forEach((a) => {
      if (items.some((i) => i.t === a.ticker)) return;
      const r = STOCKS.find((x) => x.ticker === a.ticker) || {};
      items.push({id: 'a:' + a.id, t: a.ticker, title: (r.name || a.ticker), text: a.text, todo: r.action || '', src: 'Analyse'});
    });
    const open = items.filter((i) => !seen(i.id)).slice(0, 5);
    if (!open.length) return;
    const bg = document.createElement('div'); bg.className = 'pop-bg';
    const box = document.createElement('div'); box.className = 'pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Dringende Meldungen');
    box.innerHTML = `<div class="pop-h"><span class="pop-ic">⚠️</span><b>${open.length === 1 ? 'Dringende Meldung' : open.length + ' dringende Meldungen'} zu deinem Depot</b></div>` +
      open.map((i) => `<div class="pop-i"><div class="pop-t"><b>${esc(i.title)}</b><small>${esc(i.src)}</small></div><p>${esc(i.text)}</p>` +
        (i.todo ? `<p class="pop-todo"><span>Was laut deinem Plan gilt</span>${esc(i.todo)}</p>` : '') +
        `<button type="button" class="pop-go" data-t="${esc(i.t)}">Zur Aktie →</button></div>`).join('') +
      `<p class="pop-note">Technische Regeln aus der Analyse, keine Anlageberatung. Erst den Schlusskurs abwarten, nicht im Affekt handeln.</p>` +
      `<button type="button" class="pop-ok">Verstanden</button>`;
    document.body.append(bg, box);
    const close = () => { open.forEach((i) => { try { localStorage.setItem(seenKey(i.id), '1'); } catch (e) { /* ok */ } }); bg.remove(); box.remove(); };
    box.querySelector('.pop-ok').addEventListener('click', close); bg.addEventListener('click', close);
    box.querySelectorAll('.pop-go').forEach((b) => b.addEventListener('click', () => { close(); show('aktien'); openSheet(b.dataset.t); }));
    anim((g) => { g.fromTo(bg, {opacity: 0}, {opacity: 1, duration: .25}); g.fromTo(box, {y: 30, opacity: 0, scale: .97}, {y: 0, opacity: 1, scale: 1, duration: .4, ease: 'power3.out'}); });
    box.querySelector('.pop-ok').focus();
  }

  /* ---------- Start ---------- */
  (async () => {
    const h = location.hash.slice(1).split('/');
    show(h[0] || 'aktien', true);
    try {
      const [stocks, news, events, alerts, run] = await Promise.all(['stocks', 'news', 'events', 'alerts', 'run'].map(load));
      let prices = null; try { prices = await load('prices'); } catch (e) { /* ohne Kerzen weiter */ }
      PRICES = (prices && prices.stocks) || {};
      const opt = async (n) => { try { return await load(n); } catch (e) { return null; } };
      const [market, kpis, track, fund, screen, watch] = await Promise.all(['market', 'kpis', 'track', 'fund', 'screen', 'watch'].map(opt));
      MARKET = market; KPIS = (kpis && kpis.stocks) || {}; TRACK = track; FUND = (fund && fund.stocks) || {}; SCREEN = screen;
      window.__events = events;
      stocks.forEach((r) => {
        const q = PRICES[r.ticker];
        if (q && q.close && String(q.date) >= String(r.price_date || '')) { r.price = q.close; r.price_date = q.date; }
      });
      STOCKS = stocks; ALERTS = alerts || [];
      const R = run[0] || {};
      const st = R.updated_at ? new Date(R.updated_at) : null;
      $('#stand').textContent = st ? 'Stand ' + st.toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' Uhr' : '';
      const nh = alerts.filter((a) => a.level === 'hoch').length;
      if (nh) { const b = $('#hotBadge'); b.hidden = false; b.textContent = nh + ' dringend'; b.style.cursor = 'pointer'; b.onclick = () => { location.hash = 'ausblick'; }; }
      document.body.dataset.hor = HOR; document.querySelectorAll('.hor button[data-h]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.h === HOR))); $('#horNote').textContent = HORTXT[HOR];
      if (HOR === 'lang') { try { WEEKLY = ((await load('weekly')) || {}).stocks || {}; } catch (e) { WEEKLY = {}; } }
      wireFilters(); renderHello(); renderList(); renderNews(news); renderAusblick(run, alerts, events); loadWishes();
      renderCockpit(events); renderAnalyse(); renderChancen();
      setTimeout(() => popups(alerts, watch), 700);
      if (h[0] === 'aktien' && h[1]) openSheet(decodeURIComponent(h[1]));
      else renderTodo();
      anim((g) => g.from('.brand img', {rotate: -90, scale: .6, opacity: 0, duration: .8, ease: 'back.out(1.7)'}));
      setTimeout(() => { if (!document.hidden && $('#sheet').hidden) location.reload(); }, 30 * 60 * 1000);
    } catch (e) {
      $('#list').innerHTML = '<li class="empty">Daten konnten nicht geladen werden.</li>';
    }
  })();
})();
