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

  let STOCKS = [], PRICES = {}, group = 'Portfolio', SEARCH = '', KPIS = {}, MARKET = null, TRACK = null;
  const REPO = 'Crynx0809/portfolio-radar';

  /* ---------- Navigation ---------- */
  const PAGES = ['aktien', 'news', 'ausblick', 'analyse'];
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
  function renderList() {
    const ul = $('#list');
    const qy = SEARCH.trim().toLowerCase();
    const hit = (r) => [r.ticker, r.name, r.sector, r.tv_symbol].some((v) => String(v || '').toLowerCase().includes(qy));
    $('.seg').hidden = !!qy;
    const rows = STOCKS.filter((r) => qy ? hit(r) : r.group === group).sort((a, b) =>
      (a.alert === 'hoch' ? 0 : 1) - (b.alert === 'hoch' ? 0 : 1) || (STATUS[a.status] || {o: 9}).o - (STATUS[b.status] || {o: 9}).o || a.ticker.localeCompare(b.ticker));
    ul.innerHTML = rows.map((r) => {
      const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'};
      const q = PRICES[r.ticker] || {};
      const chg = q.chg_pct != null ? q.chg_pct : null;
      return `<li class="row" data-t="${esc(r.ticker)}" style="--sc:${s.c}" tabindex="0">
        <div><div class="t">${esc(r.ticker)}${r.alert === 'hoch' ? '<span class="hot" title="Dringend"></span>' : ''}</div><div class="n">${qy ? (r.group === 'Portfolio' ? 'Depot · ' : 'Watchlist · ') : ''}${esc(r.name)}</div></div>
        <div><div class="p" data-v="${r.price}" data-cur="${cur(r)}">${money(r.price, r)}</div>
          <div class="c ${chg == null ? '' : chg >= 0 ? 'up' : 'down'}">${chg == null ? '' : pct(chg)}</div></div>
        <div class="meta"><span class="pill" style="--sc:${s.c}">${s.l}</span>
          <span class="zone"><em>Zone</em> ${num(r.entry_low)}–${money(r.entry_high, r)}</span></div>
        ${rowBar(r)}</li>`;
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
  function staggerRows() {
    anim((g) => {
      g.from('#list .row', {y: 18, opacity: 0, duration: .5, stagger: .035, ease: 'power3.out', clearProps: 'transform,opacity'});
      g.from('#list .bar .k', {left: '0%', duration: .9, stagger: .035, ease: 'power2.out', delay: .15});
    });
  }

  /* ---------- Elliott-Chart ---------- */
  function zigzag(c) {
    const ranges = c.map((k) => (k[2] - k[3]) / k[4]).sort((a, b) => a - b);
    const th = Math.max(0.05, 2.8 * (ranges[Math.floor(ranges.length / 2)] || 0.02));
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
  function chart(r) {
    const q = PRICES[r.ticker];
    if (!q || !q.ohlc || q.ohlc.length < 10) return '<p class="empty">Keine Kursdaten.</p>';
    const c = q.ohlc.slice(-110).filter((k) => k.every((v) => v != null));
    const W = 360, H = 240, PL = 6, PR = 50, PT = 12, PB = 20, FUT = 66;
    const cw = (W - PL - PR - FUT) / c.length;
    const levels = [r.entry_low, r.entry_high, r.stop, r.target_low, r.target_high, r.trigger].filter((v) => v != null && !isNaN(v));
    let lo = Math.min(...c.map((k) => k[3]), ...levels), hi = Math.max(...c.map((k) => k[2]), ...levels);
    const pad = (hi - lo) * .06; lo -= pad; hi += pad;
    const y = (v) => PT + (hi - v) / (hi - lo) * (H - PT - PB);
    const x = (i) => PL + i * cw + cw / 2;
    const xEnd = PL + c.length * cw, xR = W - PR;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="JetBrains Mono, monospace">`;
    // Zonen
    const band = (a, b, col, op) => `<rect x="${PL}" width="${xR - PL}" y="${y(Math.max(a, b))}" height="${Math.max(1.5, Math.abs(y(a) - y(b)))}" fill="${col}" opacity="${op}"/>`;
    s += band(r.target_low, r.target_high, '#5aa7ff', .13) + band(r.entry_low, r.entry_high, '#2fd08a', .16);
    const hline = (v, col, dash) => `<line x1="${PL}" x2="${xR}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1" stroke-dasharray="${dash}" opacity=".85"/>`;
    s += hline(r.stop, '#ff5d6c', '4 3');
    if (r.trigger != null) s += hline(r.trigger, '#f5b74a', '1.5 3');
    // Kerzen
    s += '<g class="cdl">' + c.map((k, i) => {
      const up = k[4] >= k[1], col = up ? '#2fd08a' : '#ff5d6c';
      const yo = y(k[1]), yc = y(k[4]);
      return `<line x1="${x(i)}" x2="${x(i)}" y1="${y(k[2])}" y2="${y(k[3])}" stroke="${col}" stroke-width=".8" opacity=".55"/>` +
        `<rect x="${x(i) - Math.max(.6, cw * .32)}" width="${Math.max(1.2, cw * .64)}" y="${Math.min(yo, yc)}" height="${Math.max(.8, Math.abs(yo - yc))}" fill="${col}" opacity=".75"/>`;
    }).join('') + '</g>';
    // Wellen: echte Zählung (Feld "waves") oder automatische Wendepunkte
    let pts;
    if (Array.isArray(r.waves) && r.waves.length) {
      const idx = new Map(c.map((k, i) => [k[0], i]));
      pts = r.waves.map((w) => ({i: idx.get(w.d), p: w.p, l: w.l})).filter((p) => p.i != null);
    } else {
      pts = zigzag(c);
    }
    const last = {i: c.length - 1, p: c[c.length - 1][4]};
    const path = pts.concat([last]);
    s += `<polyline class="wave" points="${path.map((p) => x(p.i) + ',' + y(p.p)).join(' ')}" fill="none" stroke="#b18cff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p) => {
      const top = p.h === 1 || (p.h == null && p.p >= c[p.i][4]);
      s += `<circle cx="${x(p.i)}" cy="${y(p.p)}" r="2.6" fill="#b18cff"/>`;
      const lab = p.l != null ? p.l : num(p.p, p.p >= 100 ? 0 : 1);
      s += `<text x="${x(p.i)}" y="${y(p.p) + (top ? -7 : 14)}" text-anchor="middle" font-size="${p.l != null ? 11 : 8.5}" font-weight="600" fill="${p.l != null ? '#e6dcff' : '#a99bd6'}">${esc(lab)}</text>`;
    });
    // Projektion
    const mid = (r.entry_low + r.entry_high) / 2, tgt = r.target_low;
    let proj = [];
    if (r.status === 'trend') proj = [tgt];
    else if (r.status === 'meiden') proj = [mid];
    else if (r.status === 'boden') proj = [r.trigger != null ? r.trigger : mid, tgt];
    else if (r.status === 'zone') proj = [tgt];
    else proj = r.price > r.entry_high ? [mid, tgt] : [tgt];
    const fx = (j) => xEnd + (xR - xEnd) * (j + 1) / proj.length * .92;
    s += `<polyline class="proj" points="${x(last.i)},${y(last.p)} ${proj.map((v, j) => fx(j) + ',' + y(v)).join(' ')}" fill="none" stroke="#22d3a6" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`;
    s += `<circle cx="${fx(proj.length - 1)}" cy="${y(proj[proj.length - 1])}" r="3.5" fill="#22d3a6"/>`;
    s += `<line x1="${xEnd}" x2="${xEnd}" y1="${PT}" y2="${H - PB}" stroke="#ffffff" stroke-opacity=".08"/>`;
    // aktueller Kurs
    s += `<line x1="${PL}" x2="${xR}" y1="${y(last.p)}" y2="${y(last.p)}" stroke="#eef0f6" stroke-opacity=".35" stroke-width=".8"/>`;
    // Achsen-Labels rechts (ohne Überlappung)
    const labs = [[r.target_high, '#5aa7ff'], [r.target_low, '#5aa7ff'], [r.entry_high, '#2fd08a'], [r.entry_low, '#2fd08a'], [r.stop, '#ff5d6c'], [last.p, '#eef0f6']];
    if (r.trigger != null) labs.push([r.trigger, '#f5b74a']);
    labs.sort((a, b) => b[0] - a[0]);
    let prev = -99;
    labs.forEach(([v, col]) => {
      let yy = Math.max(y(v) + 3, prev + 10); prev = yy;
      const isNow = v === last.p && col === '#eef0f6';
      s += isNow ? `<rect x="${xR + 2}" y="${yy - 8.5}" width="${PR - 3}" height="12" rx="3" fill="#eef0f6"/><text x="${xR + 5}" y="${yy}" font-size="9" font-weight="700" fill="#0b0c10">${num(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2)}</text>`
        : `<text x="${xR + 5}" y="${yy}" font-size="9" fill="${col}">${num(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2)}</text>`;
    });
    // Monats-Labels
    let lm = '';
    c.forEach((k, i) => { const m = k[0].slice(5, 7); if (m !== lm && i > 2) { lm = m; s += `<text x="${x(i)}" y="${H - 6}" font-size="8.5" fill="#5d6378">${['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][+m - 1]}</text>`; } else lm = m; });
    s += `<text x="${(xEnd + xR) / 2}" y="${H - 6}" font-size="8.5" fill="#22d3a6" text-anchor="middle">Plan</text>`;
    return s + '</svg>';
  }

  /* ---------- Detail-Sheet ---------- */
  function crv(r) {
    const mid = (r.entry_low + r.entry_high) / 2, risk = mid - r.stop;
    if (!(risk > 0) || r.target_low == null) return null;
    return (r.target_low - mid) / risk;
  }
  const isDesk = () => matchMedia('(min-width: 1180px)').matches;
  let SEL = null;
  function detailHTML(r, pid) {
    const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'};
    const q = PRICES[r.ticker] || {};
    const k = crv(r);
    const auto = !(Array.isArray(r.waves) && r.waves.length);
    return `
      <div class="sh-head"><div><div class="t">${esc(r.ticker)}</div><div class="n">${esc(r.name)} · ${esc(r.sector || '')}</div></div>
        <div class="sh-price"><div class="p" id="${pid}">${money(r.price, r)}</div>
        <div class="c ${q.chg_pct >= 0 ? 'up' : 'down'}">${q.chg_pct != null ? pct(q.chg_pct) : esc(r.chg_note || '')}</div></div></div>
      <div class="sh-pills"><span class="pill" style="--sc:${s.c}">${s.l}</span>
        ${r.alert === 'hoch' ? '<span class="pill" style="--sc:var(--down)">Dringend</span>' : r.alert === 'mittel' ? '<span class="pill" style="--sc:var(--warn)">Beobachten</span>' : ''}
        <span class="pill" style="--sc:var(--muted)">${r.group === 'Portfolio' ? 'Im Depot' : 'Watchlist'}</span></div>
      <div class="chart">${chart(r)}
        <div class="legend"><span style="--lc:#2fd08a">Einstiegszone</span><span style="--lc:#5aa7ff">Ziel</span><span style="--lc:#ff5d6c">Stop</span>${r.trigger != null ? '<span style="--lc:#f5b74a">Bestätigung</span>' : ''}<span style="--lc:#b18cff">${auto ? 'Wellen-Wendepunkte' : 'Elliott-Zählung'}</span><span style="--lc:#22d3a6">erwarteter Weg</span></div></div>
      <div class="do"><small>Was tun?</small>${esc(r.action || r.plan || '')}</div>
      <div class="ifs">
        ${r.if_up ? `<div class="if" style="--ic:var(--up)"><span class="ic">▲</span><div><b>Wenn es steigt</b>${esc(r.if_up)}</div></div>` : ''}
        ${r.if_wait ? `<div class="if" style="--ic:var(--warn)"><span class="ic">▶</span><div><b>Solange dazwischen</b>${esc(r.if_wait)}</div></div>` : ''}
        ${r.if_down ? `<div class="if" style="--ic:var(--down)"><span class="ic">▼</span><div><b>Wenn es fällt</b>${esc(r.if_down)}</div></div>` : ''}
      </div>
      <div class="levels">
        <div><small>Einstieg${r.entry_type === 'Ausbruch' ? ' (Ausbruch)' : ''}</small><b>${num(r.entry_low)}–${money(r.entry_high, r)}</b></div>
        <div><small>Stop</small><b class="down">${money(r.stop, r)}</b></div>
        <div><small>Ziel</small><b class="up">${num(r.target_low)}–${money(r.target_high, r)}</b></div>
        <div><small>Chance : Risiko</small><b style="color:${k == null ? 'inherit' : k >= 2 ? 'var(--up)' : 'var(--warn)'}">${k == null ? '—' : '1 : ' + num(k, 1)}</b></div>
      </div>
      <div class="when">${r.entry_eta_text && r.status !== 'zone' && r.status !== 'trend' ? `<span>${esc(r.entry_eta_text)}</span>` : ''}${r.horizon_text ? `<span>${esc(r.horizon_text)}</span>` : ''}${r.next_event ? `<span>${esc(r.next_event)}${r.next_event_date ? ' · ' + dShort(r.next_event_date) : ''}</span>` : ''}</div>
      ${kpiHTML(r)}
      <details class="more"><summary>Wellenanalyse</summary>
        <p><b>Hauptszenario</b>${esc(r.wave_primary)}</p><p><b>Alternative</b>${esc(r.wave_alt)}</p>
        <p><b>Bestätigung / Invalidierung</b>Über ${money(r.trigger, r)} bestätigt · unter ${money(r.invalidation, r)} ist die Zählung falsch.</p></details>
      ${r.news_brief ? `<details class="more"><summary>Aktuelle Lage</summary><p>${esc(r.news_brief)}</p></details>` : ''}
      <p class="foot">Technisches Szenario, keine Anlageberatung.</p>`;
  }
  function animateDetail(box, r, pid, delay) {
    anim((g) => {
      const w = box.querySelector('.wave'), p = box.querySelector('.proj');
      if (w) { const L = w.getTotalLength(); g.fromTo(w, {strokeDasharray: L, strokeDashoffset: L}, {strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', delay: delay}); }
      if (p) g.from(p, {opacity: 0, duration: .5, delay: delay + .9});
      g.from(box.querySelectorAll('.cdl > *'), {opacity: 0, duration: .02, stagger: .004, delay: delay - .1});
      g.from(box.querySelectorAll('.do, .if, .levels > div, .kpi-grid > div'), {y: 12, opacity: 0, duration: .4, stagger: .03, delay: delay + .05, ease: 'power2.out', clearProps: 'transform,opacity'});
      const el = document.getElementById(pid), o = {v: r.price * .97};
      if (el) g.to(o, {v: r.price, duration: .8, ease: 'power2.out', onUpdate: () => { el.textContent = money(o.v, r); }});
    });
  }
  function openSheet(t) {
    const r = STOCKS.find((x) => x.ticker === t); if (!r) return;
    SEL = r.ticker;
    document.querySelectorAll('#list .row').forEach((li) => li.classList.toggle('sel', li.dataset.t === SEL));
    if (isDesk() && $('#detail')) {
      const box = $('#detail');
      box.innerHTML = detailHTML(r, 'dtP'); box.scrollTop = 0;
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
    let h = '<details class="more kpis" open><summary>Kennzahlen</summary><h4>Kursverlauf</h4><div class="kpi-grid">';
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
    return h + '</details>';
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
  function renderAnalyse() {
    const box = $('#analyseBody'); if (!box) return;
    const T = TRACK;
    if (!T || !T.summary) { box.innerHTML = '<p class="empty">Die Auswertung erscheint nach dem nächsten Kursabruf.</p>'; return; }
    const S = T.summary;
    const pr = (x) => x == null ? '—' : Math.round(x * 100) + ' %';
    const r2 = (x) => x == null ? '—' : num(x, 2) + ' R';
    const tile = (l, v, c, hint, sub) => `<div class="kpi"${hint ? ` title="${esc(hint)}"` : ''}><small>${l}</small><b class="${c || ''}">${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const few = (S.wins + S.losses) < 20;
    let h = `<p class="sub">Jede Einschätzung wird seit dem ${dShort(T.since)}${T.since.slice(0, 4)} gespeichert und mit den echten Kursen nachgespielt: Einstieg, sobald der Kurs die Zone berührt, dann Stop oder Ziel – was zuerst kommt. <b>R</b> = Gewinn oder Verlust in Vielfachen des Risikos (1 R = Abstand Einstieg bis Stop).</p>`;
    if (few) h += `<div class="warnbox">Noch wenig Daten: ${S.wins + S.losses} abgeschlossene Trades. Aussagekräftig wird die Trefferquote ab etwa 20–30 Trades – bis dahin sind die Zahlen ein erster Eindruck.</div>`;
    h += '<h2>Ergebnis</h2><div class="kpis-big">' +
      tile('Trefferquote', pr(S.hit_rate), S.hit_rate == null ? '' : S.hit_rate >= .4 ? 'up' : 'down', 'Ziel erreicht ÷ (Ziel + Stop). Bei 1:2-Chance reichen schon gut 33 %.', `${S.wins} Ziele · ${S.losses} Stops`) +
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
      tile('Zone hat gehalten', pr(S.zone_respected), '', 'Anteil der Trades, die nach dem Einstieg weniger als 0,5 R ins Minus liefen – zeigt, wie genau die Einstiegszone sitzt') +
      tile('Ø bester Stand', r2(S.avg_mfe_r), 'up', 'Wie weit lief der Trade im Schnitt maximal ins Plus (MFE)') +
      tile('Ø schlechtester Stand', r2(S.avg_mae_r), 'down', 'Wie weit lief der Trade im Schnitt maximal ins Minus (MAE)') +
      tile('Richtung nach 5 Tagen', pr(S.dir_hit_5d), '', 'Bullisch → Kurs höher, bärisch → tiefer', `${S.dir_n_5d} Signale`) +
      tile('Richtung nach 20 Tagen', pr(S.dir_hit_20d), '', 'Bullisch → Kurs höher, bärisch → tiefer', `${S.dir_n_20d} Signale`) +
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
      const lab = (k) => g === 'status' ? (STATUS[k] || {l: k}).l : g === 'group' ? (k === 'Portfolio' ? 'Depot' : k) : k;
      h += `<h2>${GRP[g]}</h2><div class="tbl"><table><tr><th></th><th>Signale</th><th>Einstieg</th><th>Ziel / Stop</th><th>Treffer</th><th>Ø R</th></tr>` +
        rows.map((x) => `<tr><td>${esc(lab(x.key))}</td><td>${x.signals}</td><td>${x.filled}</td><td>${x.wins} / ${x.losses}</td><td>${pr(x.hit_rate)}</td><td class="${cls(x.avg_r)}">${x.avg_r == null ? '—' : num(x.avg_r, 2)}</td></tr>`).join('') + '</table></div>';
    });
    // Signal-Liste
    const sig = T.signals || [];
    const live = sig.filter((x) => x.outcome === 'laeuft');
    if (live.length) {
      h += '<h2>Laufende Trades</h2><div class="tbl"><table><tr><th>Aktie</th><th>Einstieg</th><th>Stop</th><th>Ziel</th><th>Stand</th><th>bester / schlechtester</th></tr>' +
        live.map((x) => `<tr class="go" data-t="${esc(x.ticker)}"><td><b>${esc(x.ticker)}</b></td><td>${num(x.fill)} · ${dShort(x.fill_day)}</td><td>${num(x.stop)}</td><td>${num(x.target_low)}</td><td class="${cls(x.r)}">${x.r == null ? '—' : num(x.r, 2) + ' R'}</td><td>${x.mfe_r == null ? '—' : num(x.mfe_r, 1) + ' / ' + num(x.mae_r, 1)}</td></tr>`).join('') + '</table></div>';
    }
    h += `<details class="more"><summary>Alle ${sig.length} Signale</summary><div class="tbl"><table><tr><th>Datum</th><th>Aktie</th><th>Phase</th><th>Zone</th><th>Stop</th><th>Ziel</th><th>C:R</th><th>Ergebnis</th><th>R</th></tr>` +
      sig.map((x) => `<tr class="go" data-t="${esc(x.ticker)}"><td>${dShort(x.issued_day)}</td><td><b>${esc(x.ticker)}</b></td><td>${esc((STATUS[x.status] || {l: x.status}).l)}</td><td>${num(x.entry_low)}–${num(x.entry_high)}</td><td>${num(x.stop)}</td><td>${num(x.target_low)}</td><td>${x.crv_plan == null ? '—' : num(x.crv_plan, 1)}</td><td><span class="oc oc-${x.outcome}">${OUT[x.outcome] || x.outcome}</span></td><td class="${cls(x.r)}">${x.r == null ? '' : num(x.r, 2)}</td></tr>`).join('') + '</table></div></details>';
    h += '<p class="foot">Vereinfachte Simulation: nur Kauf (long), ohne Gebühren und Steuern, Einstieg zum Zonenpreis, am selben Tag gilt im Zweifel der Stop. Kein Versprechen für die Zukunft.</p>';
    box.innerHTML = h;
    box.querySelectorAll('tr.go').forEach((tr) => tr.addEventListener('click', () => { location.hash = 'aktien'; setTimeout(() => openSheet(tr.dataset.t), 60); }));
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
      const [market, kpis, track] = await Promise.all(['market', 'kpis', 'track'].map(opt));
      MARKET = market; KPIS = (kpis && kpis.stocks) || {}; TRACK = track;
      window.__events = events;
      stocks.forEach((r) => {
        const q = PRICES[r.ticker];
        if (q && q.close && String(q.date) >= String(r.price_date || '')) { r.price = q.close; r.price_date = q.date; }
      });
      STOCKS = stocks;
      const R = run[0] || {};
      const st = R.updated_at ? new Date(R.updated_at) : null;
      $('#stand').textContent = st ? 'Stand ' + st.toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' Uhr' : '';
      const nh = alerts.filter((a) => a.level === 'hoch').length;
      if (nh) { const b = $('#hotBadge'); b.hidden = false; b.textContent = nh + ' dringend'; b.style.cursor = 'pointer'; b.onclick = () => { location.hash = 'ausblick'; }; }
      renderList(); renderNews(news); renderAusblick(run, alerts, events); loadWishes();
      renderCockpit(events); renderAnalyse();
      if (h[0] === 'aktien' && h[1]) openSheet(decodeURIComponent(h[1]));
      else if (isDesk()) { const f = $('#list .row'); if (f) openSheet(f.dataset.t); }
      anim((g) => g.from('.brand img', {rotate: -90, scale: .6, opacity: 0, duration: .8, ease: 'back.out(1.7)'}));
      setTimeout(() => { if (!document.hidden && $('#sheet').hidden) location.reload(); }, 30 * 60 * 1000);
    } catch (e) {
      $('#list').innerHTML = '<li class="empty">Daten konnten nicht geladen werden.</li>';
    }
  })();
})();
