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

  let STOCKS = [], PRICES = {}, group = 'Portfolio';

  /* ---------- Navigation ---------- */
  const PAGES = ['aktien', 'news', 'ausblick'];
  function show(page, first) {
    if (!PAGES.includes(page)) page = 'aktien';
    PAGES.forEach((p) => { $('#' + p).hidden = p !== page; });
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
    const rows = STOCKS.filter((r) => r.group === group).sort((a, b) =>
      (a.alert === 'hoch' ? 0 : 1) - (b.alert === 'hoch' ? 0 : 1) || (STATUS[a.status] || {o: 9}).o - (STATUS[b.status] || {o: 9}).o || a.ticker.localeCompare(b.ticker));
    ul.innerHTML = rows.map((r) => {
      const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'};
      const q = PRICES[r.ticker] || {};
      const chg = q.chg_pct != null ? q.chg_pct : null;
      return `<li class="row" data-t="${esc(r.ticker)}" style="--sc:${s.c}" tabindex="0">
        <div><div class="t">${esc(r.ticker)}${r.alert === 'hoch' ? '<span class="hot" title="Dringend"></span>' : ''}</div><div class="n">${esc(r.name)}</div></div>
        <div><div class="p" data-v="${r.price}" data-cur="${cur(r)}">${money(r.price, r)}</div>
          <div class="c ${chg == null ? '' : chg >= 0 ? 'up' : 'down'}">${chg == null ? '' : pct(chg)}</div></div>
        <div class="meta"><span class="pill" style="--sc:${s.c}">${s.l}</span>
          <span class="zone"><em>Zone</em> ${num(r.entry_low)}–${money(r.entry_high, r)}</span></div>
        ${rowBar(r)}</li>`;
    }).join('') || '<li class="empty">Keine Werte.</li>';
    ul.querySelectorAll('.row').forEach((li) => {
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
  function openSheet(t) {
    const r = STOCKS.find((x) => x.ticker === t); if (!r) return;
    const s = STATUS[r.status] || {l: r.status, c: 'var(--dim)'};
    const q = PRICES[r.ticker] || {};
    const k = crv(r);
    const auto = !(Array.isArray(r.waves) && r.waves.length);
    $('#sheetBody').innerHTML = `
      <div class="sh-head"><div><div class="t">${esc(r.ticker)}</div><div class="n">${esc(r.name)} · ${esc(r.sector || '')}</div></div>
        <div class="sh-price"><div class="p" id="shP">${money(r.price, r)}</div>
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
      <details class="more"><summary>Wellenanalyse</summary>
        <p><b>Hauptszenario</b>${esc(r.wave_primary)}</p><p><b>Alternative</b>${esc(r.wave_alt)}</p>
        <p><b>Bestätigung / Invalidierung</b>Über ${money(r.trigger, r)} bestätigt · unter ${money(r.invalidation, r)} ist die Zählung falsch.</p></details>
      ${r.news_brief ? `<details class="more"><summary>Aktuelle Lage</summary><p>${esc(r.news_brief)}</p></details>` : ''}
      <p class="foot">Technisches Szenario, keine Anlageberatung.</p>`;
    const sh = $('#sheet'), bg = $('#sheetBg');
    sh.hidden = false; bg.hidden = false; sh.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    anim((g) => {
      g.fromTo(bg, {opacity: 0}, {opacity: 1, duration: .25});
      g.fromTo(sh, {y: 60, opacity: 0}, {y: 0, opacity: 1, duration: .45, ease: 'power3.out'});
      const w = sh.querySelector('.wave'), p = sh.querySelector('.proj');
      if (w) { const L = w.getTotalLength(); g.fromTo(w, {strokeDasharray: L, strokeDashoffset: L}, {strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', delay: .2}); }
      if (p) g.from(p, {opacity: 0, duration: .5, delay: 1.1});
      g.from(sh.querySelectorAll('.cdl > *'), {opacity: 0, duration: .02, stagger: .004, delay: .1});
      g.from(sh.querySelectorAll('.do, .if, .levels > div'), {y: 12, opacity: 0, duration: .4, stagger: .05, delay: .25, ease: 'power2.out', clearProps: 'transform,opacity'});
      const el = $('#shP'), o = {v: r.price * .97};
      g.to(o, {v: r.price, duration: .8, ease: 'power2.out', onUpdate: () => { el.textContent = money(o.v, r); }});
    });
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
      if (STOCKS.some((r) => r.ticker === li.dataset.t)) { location.hash = 'aktien'; setTimeout(() => openSheet(li.dataset.t), 50); }
    }));
    const today = new Date().toISOString().slice(0, 10);
    $('#eventList').innerHTML = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15)
      .map((e) => `<li><span class="d">${dShort(e.date)}</span><span class="e"><span class="tk">${esc(e.ticker)}</span> ${esc(e.event)}</span></li>`).join('')
      || '<li class="empty">Keine Termine.</li>';
  }

  /* ---------- Start ---------- */
  (async () => {
    const h = location.hash.slice(1).split('/');
    show(h[0] || 'aktien', true);
    try {
      const [stocks, news, events, alerts, run] = await Promise.all(['stocks', 'news', 'events', 'alerts', 'run'].map(load));
      let prices = null; try { prices = await load('prices'); } catch (e) { /* ohne Kerzen weiter */ }
      PRICES = (prices && prices.stocks) || {};
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
      renderList(); renderNews(news); renderAusblick(run, alerts, events);
      if (h[0] === 'aktien' && h[1]) openSheet(decodeURIComponent(h[1]));
      anim((g) => g.from('.brand img', {rotate: -90, scale: .6, opacity: 0, duration: .8, ease: 'back.out(1.7)'}));
      setTimeout(() => { if (!document.hidden && $('#sheet').hidden) location.reload(); }, 30 * 60 * 1000);
    } catch (e) {
      $('#list').innerHTML = '<li class="empty">Daten konnten nicht geladen werden.</li>';
    }
  })();
})();
