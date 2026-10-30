/* Portfolio Radar – shared rendering (used by the Claude dashboard and the website) */
(function () {
  const num = (v) => (v === null || v === undefined || v === '') ? null : Number(v);
  const fmtN = (v, d) => new Intl.NumberFormat('de-DE', {minimumFractionDigits: d, maximumFractionDigits: d}).format(v);
  const dec = (v) => Math.abs(v) >= 1000 ? 0 : 2;
  const cur = (c) => c === 'EUR' ? '€' : (c === 'USD' ? '$' : (c || ''));
  const money = (v, c) => num(v) === null ? '–' : fmtN(Number(v), dec(Number(v))) + ' ' + cur(c);
  const rdec = (v, w) => (Number.isInteger(Number(v)) && Number.isInteger(Number(w))) || Math.abs(v) >= 100 ? 0 : (Math.abs(v) >= 10 ? 1 : 2);
  const range = (lo, hi, c) => (num(lo) === null || num(hi) === null) ? '–' : fmtN(Number(lo), rdec(Number(hi), Number(lo))) + '–' + fmtN(Number(hi), rdec(Number(hi), Number(lo))) + ' ' + cur(c);
  const pct = (v, signed = true) => (v === null || v === undefined || isNaN(v)) ? '' : (signed && v > 0 ? '+' : (v < 0 ? '−' : '')) + fmtN(Math.abs(v * 100), Math.abs(v) < 0.1 ? 1 : 0) + ' %';
  const dDate = (s) => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: '2-digit'}) : '–';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
  const rank = (a) => a === 'hoch' ? 0 : (a === 'mittel' ? 1 : 2);

  const STATUS = {
    zone: {label: 'In der Einstiegszone', hint: 'Kaufbereich erreicht – auf Umkehrsignal achten', order: 0},
    annaeherung: {label: 'Läuft auf Einstieg zu', hint: 'Fällt Richtung Einstiegszone – noch warten', order: 1},
    boden: {label: 'Bodenbildung', hint: 'Dreht vielleicht – Bestätigung abwarten', order: 2},
    trend: {label: 'Aufwärtstrend', hint: 'Läuft gut – nicht hinterherkaufen, Rücksetzer abwarten', order: 3},
    meiden: {label: 'Abwärtstrend – meiden', hint: 'Kein Einstieg, bis ein Boden sichtbar ist', order: 4},
  };

  // Per-stock numbers derived from the analysis levels (the same arithmetic the dashboard shows as a calculation).
  function setupOf(r, runDate) {
    const p = num(r.price), el = num(r.entry_low), eh = num(r.entry_high), st = num(r.stop), tl = num(r.target_low);
    if (p === null || el === null || eh === null) return {ticker: r.ticker};
    const mid = (el + eh) / 2;
    const dist = p > eh ? p / eh - 1 : (p < el ? p / el - 1 : 0);
    const risk = st === null ? null : mid - st, reward = tl === null ? null : tl - mid;
    let days = null;
    if (r.next_event_date && runDate) days = Math.round((new Date(String(r.next_event_date).slice(0, 10)) - new Date(String(runDate).slice(0, 10))) / 864e5);
    return {ticker: r.ticker, dist_pct: dist, stop_pct: st === null ? null : st / p - 1, target_pct: tl === null ? null : tl / p - 1,
      crv: (risk && risk > 0 && reward !== null) ? reward / risk : null, days_to_event: days};
  }

  function distText(r, s) {
    if (!s || s.dist_pct === undefined) return '';
    if (s.dist_pct === 0) return 'in der Zone';
    if (r.entry_type === 'Ausbruch' && s.dist_pct < 0) return 'noch ' + pct(-s.dist_pct, false) + ' bis zum Ausbruch';
    return s.dist_pct > 0 ? pct(s.dist_pct) + ' über der Zone' : pct(s.dist_pct) + ' unter der Zone';
  }

  function chip(status, colors) {
    const m = STATUS[status] || STATUS.trend;
    const c = mk('span', 'rx-status rx-s-' + status, m.label);
    if (status === 'trend') c.style.setProperty('--sc', colors[0]);
    if (status === 'boden') c.style.setProperty('--sc', colors[2] || colors[1]);
    return c;
  }

  function ladder(r, s) {
    const items = [];
    const p = Number(r.price);
    if (num(r.target_low) !== null) items.push({k: 'ziel', v: (Number(r.target_low) + Number(r.target_high)) / 2, label: 'Ziel', val: range(r.target_low, r.target_high, r.currency), note: pct(s.target_pct)});
    items.push({k: 'entry', v: (Number(r.entry_low) + Number(r.entry_high)) / 2, label: r.entry_type === 'Ausbruch' ? 'Einstieg bei Ausbruch' : 'Einstiegszone', val: range(r.entry_low, r.entry_high, r.currency), note: distText(r, s)});
    if (num(r.stop) !== null) items.push({k: 'stop', v: Number(r.stop), label: 'Stop', val: money(r.stop, r.currency), note: pct(s.stop_pct)});
    items.push({k: 'kurs', v: p, label: 'Kurs jetzt', val: money(p, r.currency), note: ''});
    items.sort((a, b) => b.v - a.v || (a.k === 'kurs' ? -1 : 1));
    const ul = mk('ul', 'rx-ladder');
    items.forEach((it) => {
      const li = mk('li', 'rx-l rx-l-' + it.k);
      li.append(mk('span', 'rx-l-dot'), mk('span', 'rx-l-lab', it.label), mk('span', 'rx-l-val', it.val), mk('span', 'rx-l-note', it.note));
      ul.append(li);
    });
    return ul;
  }

  function card(r, s, opts) {
    const colors = opts.colors;
    const c = mk('article', 'rx-card' + (r.alert === 'hoch' ? ' rx-hot' : ''));
    c.id = 'card-' + r.ticker;
    const top = mk('div', 'rx-top'), nm = mk('div');
    nm.append(mk('h3', 'rx-name', r.name), mk('p', 'rx-sub', r.ticker + ' · ' + r.sector));
    top.append(nm, chip(r.status, colors));
    c.append(top);

    const pr = mk('div', 'rx-price');
    pr.append(mk('span', 'rx-px', money(r.price, r.currency)));
    if (r.chg_note) pr.append(mk('span', 'rx-small', r.chg_note));
    c.append(pr);
    const meta = [];
    if (r.price_date) meta.push('Kurs vom ' + dDate(r.price_date));
    if (opts.weight !== undefined && num(r.position_eur) !== null) meta.push('Position ' + fmtN(Number(r.position_eur), 2) + ' € (' + fmtN(opts.weight * 100, 1) + ' % vom Depot)');
    const m = mk('p', 'rx-small', meta.join(' · '));
    if (s && s.days_to_event !== null && s.days_to_event >= 0 && s.days_to_event <= 14) {
      m.append(document.createTextNode(meta.length ? ' · ' : ''), mk('span', 'rx-event', s.days_to_event === 0 ? 'Zahlen/Termin heute' : 'Termin in ' + s.days_to_event + (s.days_to_event === 1 ? ' Tag' : ' Tagen')));
    }
    c.append(m);

    const hint = mk('p', 'rx-hint', (STATUS[r.status] || {}).hint || '');
    c.append(hint);

    if (s && s.dist_pct !== undefined) {
      c.append(ladder(r, s));
      if (s.crv !== null && s.crv !== undefined) {
        const ok = s.crv >= 2;
        const cr = mk('p', 'rx-crv ' + (ok ? 'rx-ok' : 'rx-warn'));
        cr.append(mk('span', 'rx-muted', 'Chance : Risiko ab Einstiegszone '), mk('b', '', '1 : ' + fmtN(s.crv, 1)), document.createTextNode(ok ? '  ✓ erfüllt deine 1:2-Regel' : '  ✗ unter deiner 1:2-Regel'));
        c.append(cr);
      }
    }

    const act = mk('div', 'rx-act');
    act.append(mk('p', 'rx-act-l', r.group === 'Portfolio' ? 'Für deine Position' : 'Einstieg'), mk('p', 'rx-act-v', r.action || '–'));
    c.append(act);

    const det = mk('details', 'rx-det');
    det.append(mk('summary', '', 'Szenarien & Wellenanalyse'));
    const ifs = mk('ul', 'rx-ifs');
    [['up', '▲ Wenn stärker', r.if_up], ['wait', '■ Solange dazwischen', r.if_wait], ['down', '▼ Wenn schwächer', r.if_down]].forEach(([k, l, t]) => {
      if (!t) return; const li = mk('li', 'rx-if rx-if-' + k); li.append(mk('span', 'rx-if-l', l), mk('span', '', t)); ifs.append(li);
    });
    det.append(ifs);
    const para = (label, text, cls) => { if (!text) return; const p = mk('p', 'rx-p' + (cls ? ' ' + cls : '')); p.append(mk('b', '', label), document.createTextNode(text)); det.append(p); };
    para('Hauptszenario: ', r.wave_primary);
    para('Alternative: ', r.wave_alt, 'rx-muted');
    para('Invalidierung der Zählung: ', num(r.invalidation) === null ? '' : 'unter ' + money(r.invalidation, r.currency));
    para(r.group === 'Watchlist' ? 'Warum interessant: ' : 'Einordnung: ', r.plan);
    para('News: ', r.news_brief);
    if (r.next_event) det.append(mk('p', 'rx-small', 'Nächster Termin: ' + r.next_event + (r.next_event_date ? ' · ' + dDate(r.next_event_date) : '')));
    c.append(det);
    return c;
  }

  function board(el, stocks, setups, opts) {
    const byT = new Map(setups.map((s) => [s.ticker, s]));
    el.replaceChildren();
    Object.keys(STATUS).forEach((key) => {
      const rows = stocks.filter((r) => r.status === key);
      const lane = mk('div', 'rx-lane rx-lane-' + key);
      const head = mk('div', 'rx-lane-h');
      head.append(chip(key, opts.colors), mk('span', 'rx-lane-n', String(rows.length)));
      lane.append(head, mk('p', 'rx-lane-hint', STATUS[key].hint));
      const list = mk('div', 'rx-lane-list');
      rows.sort((a, b) => Math.abs((byT.get(a.ticker) || {}).dist_pct || 0) - Math.abs((byT.get(b.ticker) || {}).dist_pct || 0)).forEach((r) => {
        const b = mk('button', 'rx-pill' + (r.group === 'Portfolio' ? ' rx-mine' : ''));
        b.type = 'button';
        b.append(mk('span', 'rx-pill-t', r.ticker), mk('span', 'rx-pill-d', distText(r, byT.get(r.ticker))));
        b.title = r.name;
        b.addEventListener('click', () => opts.open(r));
        list.append(b);
      });
      if (!rows.length) list.append(mk('span', 'rx-muted rx-small', '–'));
      lane.append(list);
      el.append(lane);
    });
  }

  function alerts(el, rows) {
    el.replaceChildren();
    const act = rows.filter((a) => a.level === 'hoch' || a.level === 'mittel').sort((a, b) => rank(a.level) - rank(b.level));
    if (!act.length) { el.append(mk('p', 'rx-muted', 'Keine dringenden Meldungen seit dem letzten Update.')); return; }
    act.forEach((a) => {
      const d = mk('div', 'rx-alert rx-al-' + a.level), b = mk('div');
      b.append(mk('b', '', (a.level === 'hoch' ? 'Handlungsbedarf prüfen · ' : 'Beobachten · ') + a.ticker + ' '), document.createTextNode(a.text));
      d.append(mk('span', 'rx-dot'), b); el.append(d);
    });
  }

  function news(el, rows) {
    el.replaceChildren();
    rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || rank(a.impact) - rank(b.impact)).forEach((n) => {
      const li = mk('li'), m = mk('div', 'rx-nmeta');
      m.append(mk('span', '', dDate(n.date)), mk('span', 'rx-chip', n.ticker), mk('span', 'rx-chip rx-i-' + n.impact, 'Relevanz ' + n.impact), mk('span', '', n.direction));
      const h = mk('p', 'rx-nh');
      if (/^https:\/\//.test(n.url || '')) { const a = mk('a', '', n.headline); a.href = n.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; h.append(a); } else h.textContent = n.headline;
      li.append(m, h, mk('p', 'rx-p rx-muted', n.summary)); el.append(li);
    });
  }

  function events(el, rows) {
    el.replaceChildren();
    rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((e) => {
      const li = mk('li', 'rx-ev'), t = mk('div'); t.append(mk('span', 'rx-chip', e.ticker), document.createTextNode(' ' + e.event));
      li.append(mk('span', 'rx-small', dDate(e.date)), t); el.append(li);
    });
  }

  function mix(el, rows, colors) {
    el.replaceChildren();
    rows.slice().sort((a, b) => b.weight - a.weight).forEach((r, i) => {
      const row = mk('div', 'rx-mix-r');
      const bar = mk('div', 'rx-mix-bar'), fill = mk('div', 'rx-mix-fill');
      fill.style.width = (r.weight * 100) + '%';
      fill.style.background = r.tech ? colors[0] : 'var(--rx-muted-bar)';
      bar.append(fill);
      row.append(mk('span', 'rx-mix-l', r.sector), bar, mk('span', 'rx-mix-v', fmtN(r.weight * 100, 0) + ' %'));
      el.append(row);
    });
  }

  window.RX = {num, money, pct, dDate, mk, rank, STATUS, setupOf, card, board, alerts, news, events, mix, distText};
})();
