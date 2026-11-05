// ------------------------------------------------------------ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const nf = (min, max) => new Intl.NumberFormat('pt-BR', {minimumFractionDigits: min, maximumFractionDigits: max});
const NF1 = nf(1, 1);
const NFQ = nf(0, 8);
const NF01 = nf(0, 1);
const NF4 = nf(2, 4);
const BRL = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
const USD = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'USD'});
const COMPACT = new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1});
const ok = v => v != null && Number.isFinite(v);
const brl = v => (ok(v) ? BRL.format(v) : '–');
const money = (v, ccy) => (ok(v) ? (ccy === 'USD' ? USD : BRL).format(v) : '–');
const pct = v => (ok(v) ? `${NF1.format(v * 100)}%` : '–');
const signedPct = v => (ok(v) ? `${(v > 0 ? '+' : '') + NF1.format(v * 100)}%` : '–');
const qty = v => (ok(v) ? NFQ.format(v) : '–');
const dt = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '–');
const sign = v => (!ok(v) ? '' : v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '');
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const monthLabel = ym => `${MONTHS[+ym.slice(5, 7) - 1]}/${ym.slice(2, 4)}`;
const monthLong = ym => `${MONTHS_LONG[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;
const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

function parseNum(text) {
  let s = String(text ?? '').replace(/R\$|US\$|\s|%/g, '');
  if (!s) return null;
  if (s.includes(','))
    s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 4.000 = four thousand
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Número inválido: ${text}`);
  return n;
}

const CLASS_ORDER = ['Ações', 'FIIs', 'ETFs', 'BDRs', 'Stocks', 'REITs', 'Renda Fixa', 'Cripto'];
const classSort = (a, b) =>
  (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b);
const COLORS = {
  Ações: '#2563eb',
  FIIs: '#16a34a',
  ETFs: '#9333ea',
  BDRs: '#ea580c',
  Stocks: '#0d9488',
  REITs: '#ca8a04',
  'Renda Fixa': '#0891b2',
  Cripto: '#db2777',
  Outros: '#64748b',
};
const EXTRA = ['#4f46e5', '#dc2626', '#7c3aed', '#65a30d', '#0369a1'];
function color(name) {
  if (COLORS[name]) return COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}
const dot = name => `<i class="dot" style="background:${color(name)}"></i>`;

async function api(path, {json, body, headers = {}, auth = true} = {}) {
  const opts = {method: json !== undefined || body !== undefined ? 'POST' : 'GET', headers};
  if (json !== undefined) {
    opts.body = JSON.stringify(json);
    headers['Content-Type'] = 'application/json';
  } else if (body !== undefined) opts.body = body;
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) {
    showLogin(false);
    throw new Error('Sessão expirada: entre novamente');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, error = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = error ? 'error' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.hidden = true;
    },
    error ? 7000 : 3500,
  );
}

// ------------------------------------------------------------ state
let S = null; // /api/state
let PLAN = null; // last aporte plan
let IR = null;
let irLoading = false; // /api/ir for UI.irYear
let ME = null; // logged-in user
let USERS = null; // admin: account list
const UI = {
  tab: location.hash.slice(1) || 'carteira',
  showClosed: false,
  filter: '',
  aporte: '',
  imports: [],
  range: 'all',
  irYear: null,
};

async function refresh() {
  S = await api('/api/state');
  IR = null;
  render();
}

function render() {
  if (!S || !ME) return;
  // keep focus and in-progress form input across re-renders
  const a = document.activeElement;
  const key = a?.dataset?.change
    ? `[data-change="${a.dataset.change}"][data-code="${CSS.escape(a.dataset.code)}"]`
    : a?.id
      ? `#${CSS.escape(a.id)}`
      : a?.name && a.form?.id
        ? `#${a.form.id} [name="${a.name}"]`
        : null;
  const saved = UI.clearForms ? [] : $$('main form[id]').map(f => [f.id, Object.fromEntries(new FormData(f))]);
  UI.clearForms = false;

  for (const el of $$('nav a')) el.classList.toggle('active', el.dataset.tab === UI.tab);
  $('#total').textContent = S.summary.value ? brl(S.summary.value) : '';
  $('#view').innerHTML = (VIEWS[UI.tab] || VIEWS.carteira)();

  for (const [id, values] of saved)
    for (const [k, v] of Object.entries(values)) {
      const el = $(`#${id} [name="${k}"]`);
      if (el?.type === 'checkbox') el.checked = true;
      else if (el) el.value = v;
    }
  const el = key && $(key);
  if (el) {
    el.focus();
    if (el.id === 'filter') el.setSelectionRange(el.value.length, el.value.length);
  }
}

const card = (label, value, sub = '', cls = '') =>
  `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
const empty = msg =>
  `<div class="empty"><img src="/static/logo.svg" alt=""><p>${msg}</p><p><a href="#dados">Importar extratos da B3 →</a></p></div>`;
const hasData = () => S.counts.trades + S.counts.movements + S.counts.manual > 0;
const openAssets = c => c.assets.filter(a => a.open);
const allAssets = () => S.classes.flatMap(c => c.assets);
const typeLabel = t => (S.asset_types.find(x => x.type === t) || {label: t}).label;

// ------------------------------------------------------------ charts (plain SVG)
const CHARTS = {};

function niceStep(span) {
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function svgChart(id, {labels, stacks = [], lines = [], yfmt, tip, height = 250}) {
  const n = labels.length;
  if (n < 2) return '<p class="muted">Histórico insuficiente para o gráfico.</p>';
  const W = 960;
  const H = height;
  const L = 78;
  const R = 16;
  const T = 12;
  const B = 28;
  const tops = labels.map((_, i) => stacks.reduce((acc, s) => acc + (s.values[i] || 0), 0));
  const vals = [...tops, ...lines.flatMap(l => l.values.filter(ok))];
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (!(hi > lo)) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const x = i => L + (i * (W - L - R)) / (n - 1);
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const f = v => v.toFixed(1);
  let svg = '';
  for (let k = 0; lo + k * step <= hi + step / 2; k++) {
    const v = lo + k * step;
    svg += `<line x1="${L}" x2="${W - R}" y1="${f(y(v))}" y2="${f(y(v))}" class="${Math.abs(v) < step / 2 ? 'axis' : 'grid'}"/>`;
    svg += `<text x="${L - 8}" y="${f(y(v) + 4)}" class="ylab">${yfmt(v)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 9));
  for (let i = 0; i < n; i += every) svg += `<text x="${f(x(i))}" y="${H - 8}" class="xlab">${labels[i]}</text>`;
  let base = labels.map(() => 0);
  for (const s of stacks) {
    const top = base.map((b, i) => b + (s.values[i] || 0));
    const fwd = top.map((v, i) => `${f(x(i))},${f(y(v))}`).join('L');
    const back = base
      .map((v, i) => `${f(x(i))},${f(y(v))}`)
      .reverse()
      .join('L');
    svg += `<path d="M${fwd}L${back}Z" style="fill:${s.color}" fill-opacity=".82"/>`;
    base = top;
  }
  for (const l of lines) {
    let d = '';
    let pen = false;
    for (const [i, v] of l.values.entries()) {
      if (ok(v)) d += `${pen ? 'L' : 'M'}${f(x(i))},${f(y(v))}`;
      pen = ok(v); // gaps (null) break the line
    }
    svg += `<path d="${d}" fill="none" style="stroke:${l.color}" stroke-width="${l.width || 2}" stroke-linejoin="round"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}/>`;
  }
  svg += `<line class="cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  CHARTS[id] = {n, W, L, R, x, tip};
  return `<div class="chart-wrap" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" class="svgchart">${svg}</svg><div class="tip" hidden></div></div>`;
}

function chartHover(e) {
  const wrap = e.target.closest?.('.chart-wrap');
  for (const w of $$('.chart-wrap'))
    if (w !== wrap) {
      w.querySelector('.tip').hidden = true;
      w.querySelector('.cursor').setAttribute('visibility', 'hidden');
    }
  const c = wrap && CHARTS[wrap.dataset.chart];
  if (!c) return;
  const r = wrap.querySelector('svg').getBoundingClientRect();
  const vx = ((e.clientX - r.left) / r.width) * c.W;
  const i = Math.max(0, Math.min(c.n - 1, Math.round(((vx - c.L) / (c.W - c.L - c.R)) * (c.n - 1))));
  const cursor = wrap.querySelector('.cursor');
  cursor.setAttribute('x1', c.x(i));
  cursor.setAttribute('x2', c.x(i));
  cursor.setAttribute('visibility', 'visible');
  const tip = wrap.querySelector('.tip');
  tip.innerHTML = c.tip(i);
  tip.hidden = false;
  const px = (c.x(i) / c.W) * r.width;
  tip.style.left = `${px + 14 + tip.offsetWidth > r.width ? Math.max(0, px - tip.offsetWidth - 14) : px + 14}px`;
}

const rangeButtons = () =>
  `<span class="seg">${[
    ['12', '12m'],
    ['24', '24m'],
    ['60', '5a'],
    ['all', 'Tudo'],
  ]
    .map(([v, l]) => `<button data-act="range" data-range="${v}" class="${UI.range === v ? 'on' : ''}">${l}</button>`)
    .join('')}</span>`;

function historyPoints() {
  const pts = S.history.points || [];
  return UI.range === 'all' ? pts : pts.slice(-Number(UI.range));
}

function patrimonioPanel(pts) {
  const classes = [...new Set(pts.flatMap(p => Object.keys(p.classes)))].sort(classSort);
  const stacks = classes.map(c => ({name: c, color: color(c), values: pts.map(p => p.classes[c] || 0)}));
  const lines = [{color: 'var(--text)', dash: '6 4', width: 1.6, values: pts.map(p => p.cost)}];
  const tip = i => {
    const p = pts[i];
    return `<span class="t">${monthLong(p.month)}</span>
      <div><span>Patrimônio</span><b>${brl(p.value)}</b></div><div><span>Aplicado</span><b>${brl(p.cost)}</b></div>
      ${classes
        .filter(c => p.classes[c])
        .map(c => `<div><span>${dot(c)}${esc(c)}</span><span>${brl(p.classes[c])}</span></div>`)
        .join('')}`;
  };
  const legend = `${classes.map(c => `<span>${dot(c)}${esc(c)}</span>`).join('')}<span><i class="line dash" style="border-color:var(--text)"></i>Valor aplicado</span>`;
  return `<section class="panel"><h3>Evolução do patrimônio ${rangeButtons()}</h3>
    ${svgChart('patrimonio', {labels: pts.map(p => monthLabel(p.month)), stacks, lines, yfmt: v => `R$ ${COMPACT.format(v)}`, tip})}
    <div class="legend">${legend}</div></section>`;
}

function rentabilidadePanel(pts) {
  const acc = {ret: 1, cdi: 1, ibov: 1};
  const series = {ret: [], cdi: [], ibov: []};
  let started = false;
  for (const p of pts) {
    if (ok(p.ret)) {
      started = true;
      acc.ret *= 1 + p.ret;
      if (ok(p.cdi)) acc.cdi *= 1 + p.cdi;
      if (ok(p.ibov)) acc.ibov *= 1 + p.ibov;
    }
    for (const k in series) series[k].push(started ? acc[k] - 1 : null);
  }
  if (!started) return '';
  const lines = [
    {name: 'Carteira', color: 'var(--chart-main)', width: 2.6, values: series.ret},
    {name: 'CDI', color: 'var(--muted)', width: 1.8, values: series.cdi},
    {name: 'Ibovespa', color: 'var(--chart-ibov)', width: 1.8, values: series.ibov},
  ];
  const tip = i => `<span class="t">${monthLong(pts[i].month)}</span>
    ${lines.map(l => `<div><span>${l.name}</span><b>${signedPct(l.values[i])}</b></div>`).join('')}
    <div><span>No mês (carteira)</span><span>${signedPct(pts[i].ret)}</span></div>`;
  const last = k => acc[k] - 1;
  return `<section class="panel"><h3>Rentabilidade acumulada ${rangeButtons()}</h3>
    <div class="returns"><span>Carteira <b class="${sign(last('ret'))}">${signedPct(last('ret'))}</b></span>
      <span>CDI <b>${signedPct(last('cdi'))}</b></span><span>Ibovespa <b class="${sign(last('ibov'))}">${signedPct(last('ibov'))}</b></span>
      <span class="small">retorno ponderado no tempo (Modified Dietz); meses sem posição não contam</span></div>
    ${svgChart('rentab', {labels: pts.map(p => monthLabel(p.month)), lines, yfmt: v => `${NF01.format(v * 100)}%`, tip, height: 230})}
    <div class="legend">${lines.map(l => `<span><i class="line" style="border-color:${l.color}"></i>${l.name}</span>`).join('')}</div></section>`;
}

// ------------------------------------------------------------ Carteira
const SOURCE_BADGE = {
  manual: ['manual', 'info'],
  custo: ['custo', ''],
  tesouro: ['Tesouro', 'ok'],
  indexador: ['estimado', 'ok'],
  'último PU': ['último PU', ''],
};
const sourceBadge = a => {
  const b = SOURCE_BADGE[a.source];
  return b ? `<span class="badge ${b[1]}" title="${esc(a.source_note || '')}">${b[0]}</span>` : '';
};

function viewCarteira() {
  if (!hasData()) return empty('Nenhum dado ainda.');
  const s = S.summary;
  const notices = [];
  if (s.missing_quotes.length)
    notices.push(
      `<div class="notice">Sem cotação para ${s.missing_quotes.map(esc).join(', ')} — avaliado pelo custo. Use <b>↻ Cotações</b> ou clique na cotação para informar manualmente.</div>`,
    );
  const warns = S.warnings.filter(w => w.level === 'warn').length;
  if (warns) notices.push(`<div class="notice">${warns} aviso(s) nos dados. <a href="#dados">Ver detalhes</a></div>`);
  const pts = historyPoints();
  return `
    ${notices.join('')}
    <div class="cards">
      ${card('Patrimônio', brl(s.value), `${s.n_assets} ativos`)}
      ${card('Valor aplicado', brl(s.cost), `lucro realizado ${brl(s.realized)}`)}
      ${card('Resultado', brl(s.pnl), pct(s.pnl_pct), sign(s.pnl))}
      ${card('Proventos 12m', brl(s.proventos_12m), `total ${brl(s.proventos_total)}`)}
    </div>
    ${pts.length > 1 ? patrimonioPanel(pts) + rentabilidadePanel(pts) : ''}
    ${allocation()}
    ${S.classes
      .filter(c => openAssets(c).length)
      .map(classTable)
      .join('')}
    ${closedTable()}
    <p class="muted small">${s.market_at ? `Dados de mercado de ${dt(s.market_at)} ${s.market_at.slice(11, 16)} (Yahoo Finance, Tesouro Transparente, Banco Central). ` : ''}
      ${ok(s.usdbrl) ? `US$ 1 = ${brl(s.usdbrl)}. ` : ''}${S.filters?.exclude?.length ? `Ignorando ${S.filters.exclude.map(esc).join(', ')} (<a href="#dados">Dados → Filtros</a>). ` : ''}Clique no valor de um título de renda fixa para configurar o indexador ou informar o valor atual.</p>`;
}

function allocation() {
  const t = S.summary.targets_set;
  const classes = S.classes.filter(c => c.value > 0 || c.target > 0);
  if (!classes.length) return '';
  const seg = (c, w) =>
    w > 0 ? `<div style="flex:${w};background:${color(c.name)}" title="${esc(c.name)}"></div>` : '';
  const legend = classes
    .map(
      c =>
        `<span>${dot(c.name)}${esc(c.name)} <b>${pct(c.pct)}</b>${t ? ` <small>meta ${pct(c.target)}</small>` : ''}</span>`,
    )
    .join('');
  return `<section class="panel">
    <h3>Alocação por classe <small>${t ? 'barra fina = meta' : '<a href="#balanceamento">definir metas</a>'}</small></h3>
    <div class="bar">${classes.map(c => seg(c, c.value)).join('')}</div>
    ${t ? `<div class="bar target">${classes.map(c => seg(c, c.target)).join('')}</div>` : ''}
    <div class="legend">${legend}</div></section>`;
}

const priceCell = a =>
  `<button class="link" data-act="price" data-code="${esc(a.code)}" title="Definir cotação manual">${a.price != null ? money(a.price, a.currency) : 'definir'}</button>${a.source === 'manual' ? '<span class="badge info">manual</span>' : ''}`;
const valueCell = a =>
  `<button class="link" data-act="asset-dlg" data-code="${esc(a.code)}" title="Configurar avaliação">${brl(a.value)}</button>${sourceBadge(a)}`;

function classTable(c) {
  const rows = openAssets(c)
    .map(
      a => `<tr>
      <td><b>${esc(a.code)}</b><small title="${esc(a.name)}">${esc(a.name || a.type_label)}</small></td>
      <td class="num">${a.quoted ? qty(a.qty) : ''}</td>
      <td class="num">${a.quoted ? brl(a.avg_price) : ''}${ok(a.avg_price_usd) ? `<small>${money(a.avg_price_usd, 'USD')}</small>` : ''}</td>
      <td class="num">${a.quoted ? priceCell(a) : ''}</td>
      <td class="num">${brl(a.cost)}</td>
      <td class="num">${a.quoted ? brl(a.value) + (a.source === 'custo' ? sourceBadge(a) : '') : valueCell(a)}</td>
      <td class="num ${sign(a.pnl)}">${brl(a.pnl)}<small>${pct(a.pnl_pct)}</small></td>
      <td class="num">${pct(a.pct_class)}</td>
      <td class="num">${pct(a.pct_total)}</td>
    </tr>`,
    )
    .join('');
  return `<section class="panel">
    <h3><span>${dot(c.name)}${esc(c.name)}</span>
      <small>${brl(c.value)} · ${pct(c.pct)} da carteira · resultado <span class="${sign(c.pnl)}">${brl(c.pnl)}</span></small></h3>
    <table><thead><tr><th>Ativo</th><th class="num">Qtd</th><th class="num">Preço médio</th><th class="num">Cotação</th>
      <th class="num">Custo</th><th class="num">Valor atual</th><th class="num">Resultado</th><th class="num">% classe</th><th class="num">% carteira</th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;
}

function closedTable() {
  if (!S.closed.length) return '';
  const head = `<h3>Posições encerradas (${S.closed.length}) <button data-act="toggle-closed">${UI.showClosed ? 'ocultar' : 'mostrar'}</button></h3>`;
  if (!UI.showClosed) return `<section class="panel">${head}</section>`;
  const rows = S.closed
    .map(
      a => `<tr>
      <td><b>${esc(a.code)}</b><small>${esc(a.name)}</small></td><td>${esc(a.class)}</td><td class="num">${dt(a.last_date)}</td>
      <td class="num ${sign(a.realized)}">${a.realized_unknown && !a.realized ? '?' : brl(a.realized)}${a.realized_unknown ? '<small>valor de resgate não informado pela B3</small>' : ''}</td>
      <td class="num">${brl(a.proventos)}</td></tr>`,
    )
    .join('');
  return `<section class="panel">${head}<table><thead><tr><th>Ativo</th><th>Classe</th><th class="num">Última mov.</th>
    <th class="num">Resultado realizado</th><th class="num">Proventos</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

// ------------------------------------------------------------ Proventos
function viewProventos() {
  const p = S.proventos;
  if (!p.items.length) return empty('Nenhum provento encontrado. Importe o extrato de Movimentação.');
  const max = Math.max(...p.months.map(m => m.total), 0.01);
  const bars = p.months
    .map(
      m => `<div class="col" title="${monthLabel(m.month)}: ${brl(m.total)}">
      <div style="height:${((m.total / max) * 100).toFixed(1)}%"></div><span>${monthLabel(m.month)}</span></div>`,
    )
    .join('');
  const byAsset = p.by_asset
    .map(
      a => `<tr><td><b>${esc(a.code)}</b></td><td class="num">${a.count}</td>
      <td class="num">${brl(a.last12)}</td><td class="num">${pct(a.yoc)}</td><td class="num">${brl(a.total)}</td></tr>`,
    )
    .join('');
  const simple = rows => rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${brl(v)}</td></tr>`).join('');
  const items = p.items
    .map(
      x => `<tr><td>${dt(x.date)}</td><td><b>${esc(x.code)}</b></td><td>${esc(x.type)}</td>
      <td class="num">${qty(x.qty)}</td><td class="num">${x.unit != null ? NFQ.format(x.unit) : '–'}</td><td class="num">${brl(x.value)}</td></tr>`,
    )
    .join('');
  return `
    <div class="cards">
      ${card('Total recebido', brl(p.total))}
      ${card('Últimos 12 meses', brl(p.last12), `média ${brl(p.avg12)}/mês`)}
      ${card(`Em ${new Date().getFullYear()}`, brl(p.year))}
    </div>
    <section class="panel"><h3>Por mês <small>últimos 24 meses</small></h3><div class="chart">${bars}</div></section>
    <div class="grid2">
      <section class="panel"><h3>Por ativo <small>YoC = proventos 12m ÷ custo atual</small></h3>
        <table><thead><tr><th>Ativo</th><th class="num">Pagamentos</th><th class="num">12 meses</th><th class="num">YoC 12m</th><th class="num">Total</th></tr></thead>
        <tbody>${byAsset}</tbody></table></section>
      <div>
        <section class="panel"><h3>Por ano</h3><table><tbody>${simple(p.by_year.map(y => [y.year, y.total]))}</tbody></table></section>
        <section class="panel"><h3>Por tipo</h3><table><tbody>${simple(p.by_type.map(t => [t.type, t.total]))}</tbody></table></section>
      </div>
    </div>
    <section class="panel"><h3>Histórico <small>valores como informados pela B3 (JCP já líquido de IR)</small></h3>
      <table><thead><tr><th>Data</th><th>Ativo</th><th>Tipo</th><th class="num">Qtd</th><th class="num">Valor unit.</th><th class="num">Valor</th></tr></thead>
      <tbody>${items}</tbody></table></section>`;
}

// ------------------------------------------------------------ Balanceamento
function viewBalanceamento() {
  if (!hasData()) return empty('Importe seus extratos para balancear a carteira.');
  const byName = Object.fromEntries(S.classes.map(c => [c.name, c]));
  const targetSum = S.class_names.reduce((acc, n) => acc + (S.targets[n] || 0), 0);
  const targetRows = S.class_names
    .map(n => {
      const c = byName[n] || {value: 0, pct: 0, gap: null};
      return `<tr><td>${dot(n)}${esc(n)}</td><td class="num">${brl(c.value)}</td><td class="num">${pct(c.pct)}</td>
      <td class="num"><input class="small target" data-class="${esc(n)}" inputmode="decimal" value="${S.targets[n] ?? ''}" placeholder="0"> %</td>
      <td class="num ${sign(c.gap)}">${c.gap == null ? '–' : brl(c.gap)}</td></tr>`;
    })
    .join('');
  const quotedTypes = S.asset_types
    .filter(t => t.yahoo)
    .map(t => `<option value="${t.type}">${esc(t.label)}</option>`)
    .join('');
  return `
    <div class="notice info">Método holder: defina a <b>meta de cada classe</b> e uma <b>nota</b> para cada ativo (peso dentro da classe; nota 0 = não aportar).
      Cada aporte vai para o que está mais abaixo da meta — sem precisar vender nada.</div>
    <section class="panel"><h3>Aporte <small>sugestão de compra</small></h3>
      <div class="row"><label>Valor a investir: <input id="aporte" inputmode="decimal" placeholder="ex.: 5.000,00" value="${esc(UI.aporte)}"></label>
        <button class="primary" data-act="aporte">Calcular</button></div>
      <div id="plan">${planHtml()}</div></section>
    <div class="grid2">
      <section class="panel"><h3>Metas por classe <small>soma: <b id="target-sum">${NF1.format(targetSum)}%</b></small></h3>
        <table><thead><tr><th>Classe</th><th class="num">Atual</th><th class="num">% atual</th><th class="num">Meta</th><th class="num">Falta p/ meta</th></tr></thead>
        <tbody>${targetRows}</tbody></table>
        <p class="row"><button class="primary" data-act="save-targets">Salvar metas</button>
          <span class="muted">metas que não somam 100% são normalizadas</span></p></section>
      <section class="panel"><h3>Adicionar ativo</h3>
        <div class="form-grid">
          <label>Ticker<input id="new-code" placeholder="ex.: TAEE11, AAPL, BTC"></label>
          <label>Tipo<select id="new-type">${quotedTypes}</select></label>
          <label>Classe<input id="new-class" list="classlist" placeholder="automática"></label>
          <label>Nota<input id="new-nota" inputmode="decimal" value="1"></label>
        </div>
        <p class="row"><button data-act="add-asset">Adicionar</button><span class="muted small">para começar a aportar em um ativo que você ainda não tem</span></p></section>
    </div>
    <datalist id="classlist">${S.class_names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <section class="panel"><h3>Notas dos ativos <small>ideal na carteira = meta da classe × peso da nota</small></h3>
      ${S.classes
        .filter(c => c.assets.length)
        .map(notaTable)
        .join('')}</section>`;
}

function notaTable(c) {
  const rows = c.assets
    .map(
      a => `<tr>
      <td><b>${esc(a.code)}</b>${a.open ? '' : '<span class="badge">sem posição</span>'}<small>${esc(a.name || a.type_label)}</small></td>
      <td><input list="classlist" size="11" value="${esc(a.class)}" data-change="class" data-code="${esc(a.code)}"></td>
      <td class="num">${brl(a.value)}</td><td class="num">${pct(a.pct_class)}</td>
      <td class="num"><input class="small" inputmode="decimal" value="${NFQ.format(a.nota)}" data-change="nota" data-code="${esc(a.code)}"></td>
      <td class="num">${pct(a.target_class)}</td><td class="num">${pct(a.target_total)}</td>
      <td class="num ${sign(a.gap)}">${a.gap == null ? '–' : brl(a.gap)}</td>
      <td>${a.open ? '' : `<button class="link danger" data-act="remove-asset" data-code="${esc(a.code)}">remover</button>`}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr class="group"><td colspan="9">${dot(c.name)}${esc(c.name)} · meta ${pct(c.target)}</td></tr>
    <tr><th>Ativo</th><th>Classe</th><th class="num">Valor</th><th class="num">% classe</th><th class="num">Nota</th>
      <th class="num">Ideal na classe</th><th class="num">Ideal na carteira</th><th class="num">Falta p/ meta</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function planHtml() {
  if (!PLAN) return '';
  const rows = PLAN.classes
    .map(
      c => `
    <tr class="group"><td colspan="3">${dot(c.class)}${esc(c.class)}${c.note ? ` <span class="muted">— ${esc(c.note)}</span>` : ''}</td><td class="num">${brl(c.spent)}</td></tr>
    ${c.assets
      .map(
        a => `<tr><td><b>${esc(a.code)}</b><small>${esc(a.name)}</small></td>
      <td class="num">${a.qty != null ? `${qty(a.qty)} × ${brl(a.price)}` : a.price ? `≈ ${qty(+(a.amount / a.price).toFixed(8))} un.` : 'sem cotação'}</td>
      <td class="num muted">${brl(a.ideal)}</td><td class="num">${brl(a.amount)}</td></tr>`,
      )
      .join('')}`,
    )
    .join('');
  return `<table><thead><tr><th>Ativo</th><th class="num">Comprar</th><th class="num">Ideal (sem arredondar)</th><th class="num">Valor</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="muted">Nada a aportar.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total sugerido</td><td class="num">${brl(PLAN.amount - PLAN.leftover)}</td></tr>
      <tr><td colspan="3" class="muted">Sobra (não completa 1 cota)</td><td class="num muted">${brl(PLAN.leftover)}</td></tr></tfoot></table>`;
}

// ------------------------------------------------------------ IR
async function loadIR(year) {
  irLoading = true;
  try {
    IR = await api(`/api/ir?year=${year}`);
  } catch (err) {
    IR = {year, error: err.message};
  } finally {
    irLoading = false;
  }
  if (UI.tab === 'ir') render();
}

const BUCKETS = [
  ['comum', 'Comum (15%)'],
  ['daytrade', 'Day trade (20%)'],
  ['fii', 'FIIs (20%)'],
];

function viewIR() {
  if (!hasData()) return empty('Importe seus extratos para gerar os relatórios de IR.');
  const year = UI.irYear || S.ir_years[0];
  if (!IR || IR.year !== year) {
    if (!irLoading) loadIR(year);
    return '<p class="muted">Calculando…</p>';
  }
  if (IR.error) return `<div class="notice">Erro ao calcular: ${esc(IR.error)}</div>`;
  const years = `<span class="seg">${S.ir_years.map(y => `<button data-act="ir-year" data-year="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}</span>`;
  const last = IR.months[IR.months.length - 1];
  const carry = last ? BUCKETS.map(([k, l]) => `${l.split(' ')[0]} ${brl(last.categories[k].carry)}`).join(' · ') : '–';
  const months = IR.months
    .map(m => {
      const c = k => m.categories[k];
      const cell = k =>
        `<td class="num ${sign(c(k).result)}">${c(k).result ? brl(c(k).result) : '–'}${c(k).compensated ? `<small>compensado ${brl(c(k).compensated)}</small>` : ''}</td>`;
      return `<tr class="${m.darf ? 'hl' : ''}"><td>${monthLabel(m.month)}</td>
      <td class="num">${m.share_sales ? brl(m.share_sales) : '–'}${m.exempt ? '<span class="badge ok">isento</span>' : ''}</td>
      <td class="num">${m.exempt_gain ? brl(m.exempt_gain) : '–'}</td>${cell('comum')}${cell('daytrade')}${cell('fii')}
      <td class="num">${m.tax ? brl(m.tax) : '–'}</td><td class="num">${m.irrf ? brl(m.irrf) : '–'}</td>
      <td class="num"><b>${m.darf ? brl(m.darf) : '–'}</b>${m.darf_pending ? `<small>acumulado p/ próximo mês ${brl(m.darf_pending)}</small>` : ''}</td>
      <td class="num">${m.due_date ? dt(m.due_date) : ''}</td></tr>`;
    })
    .join('');
  const sales = IR.sales
    .map(
      s => `<tr><td>${dt(s.date)}</td><td><b>${esc(s.code)}</b></td><td>${s.daytrade ? 'day trade' : 'comum'}</td>
      <td class="num">${qty(s.qty)}</td><td class="num">${brl(s.proceeds)}</td><td class="num">${brl(s.cost)}</td>
      <td class="num ${sign(s.gain)}">${brl(s.gain)}</td></tr>`,
    )
    .join('');
  const bens = IR.bens
    .map(
      b => `<tr><td>${b.group || '–'}</td><td>${b.group_code || '<span class="badge warn">confira</span>'}</td>
      <td><b>${esc(b.code)}</b><small title="${esc(b.label)}">${esc(b.label)}</small></td>
      <td class="wrap">${esc(b.discriminacao)} <button class="link small" data-act="copy" data-text="${esc(b.discriminacao)}">copiar</button></td>
      <td class="num">${brl(b.prev)}</td><td class="num">${brl(b.cur)}</td></tr>`,
    )
    .join('');
  const rend = rows =>
    rows.length
      ? `<table><thead><tr><th>Código</th><th>Descrição</th><th>Ativo</th><th class="num">Valor</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.code || '–'}</td><td>${esc(r.label)}</td><td><b>${esc(r.asset || r.type)}</b></td><td class="num">${brl(r.value)}</td></tr>`).join('')}
      </tbody></table>`
      : '<p class="muted">Nada no ano.</p>';
  return `
    <div class="notice info">Ferramenta de apoio — confira tudo antes de declarar. Custos de corretagem/emolumentos não vêm nos arquivos da B3
      (lance-os como <i>ajuste de custo</i> na aba Dados). Vencimento do DARF (código 6015) considera apenas fins de semana, não feriados.</div>
    <section class="panel"><h3>Ano ${years}</h3>
      <div class="cards" style="margin:0">
        ${card('DARF no ano', brl(IR.darf_total), IR.pending_darf ? `pendente &lt; R$ 10: ${brl(IR.pending_darf)}` : '')}
        ${card('Prejuízo a compensar', last ? '' : '–', carry)}
        ${card('Bens e direitos 31/12', brl(IR.bens.reduce((a, b) => a + b.cur, 0)), `${IR.bens.filter(b => b.cur > 0).length} ativos`)}
      </div></section>
    <section class="panel"><h3>Apuração mensal — renda variável B3</h3>
      ${
        IR.months.length
          ? `<table><thead><tr><th>Mês</th><th class="num">Vendas de ações</th><th class="num">Ganho isento</th>
        ${BUCKETS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th class="num">IR devido</th><th class="num">IRRF</th><th class="num">DARF</th><th class="num">Vencimento</th></tr></thead>
        <tbody>${months}</tbody></table>`
          : '<p class="muted">Nenhuma venda de renda variável neste ano.</p>'
      }
      ${
        sales
          ? `<h3 style="margin-top:18px">Vendas no ano</h3><table><thead><tr><th>Data</th><th>Ativo</th><th>Operação</th><th class="num">Qtd</th>
        <th class="num">Valor de venda</th><th class="num">Custo</th><th class="num">Resultado</th></tr></thead><tbody>${sales}</tbody></table>`
          : ''
      }</section>
    <section class="panel"><h3>Bens e Direitos <small>situação em 31/12 (custo de aquisição) · grupo/código são sugestões</small></h3>
      ${
        bens
          ? `<table><thead><tr><th>Grupo</th><th>Código</th><th>Ativo</th><th>Discriminação</th><th class="num">31/12/${year - 1}</th><th class="num">31/12/${year}</th></tr></thead>
        <tbody>${bens}</tbody></table>`
          : '<p class="muted">Nenhum bem no período.</p>'
      }</section>
    <div class="grid2" style="grid-template-columns:1fr 1fr">
      <section class="panel"><h3>Rendimentos isentos e não tributáveis</h3>${rend(IR.isentos)}</section>
      <section class="panel"><h3>Tributação exclusiva/definitiva</h3>${rend(IR.exclusivos)}</section>
    </div>
    ${IR.outros.length ? `<section class="panel"><h3>Outros (verifique)</h3>${rend(IR.outros)}</section>` : ''}`;
}

// ------------------------------------------------------------ Extrato
const STATUS = {
  skip: ['duplicada', 'badge'],
  ignore: ['ignorada', 'badge'],
  unhandled: ['não tratada', 'badge warn'],
  dt_part: ['day trade', 'badge info'],
};

function viewExtrato() {
  if (!hasData()) return empty('Nenhuma movimentação importada.');
  const f = UI.filter.trim().toLowerCase();
  const evs = S.ledger
    .filter(e => !f || [e.code, e.name, e.label, e.note, e.source, e.institution].join(' ').toLowerCase().includes(f))
    .reverse();
  const rows = evs
    .map(e => {
      const st = STATUS[e.action];
      return `<tr class="${st && e.action !== 'dt_part' ? 'muted' : ''}"><td>${dt(e.date)}</td><td><b>${esc(e.code)}</b></td>
      <td>${esc(e.label)}${st ? `<span class="${st[1]}">${st[0]}</span>` : ''}${e.note ? `<small title="${esc(e.note)}">${esc(e.note)}</small>` : ''}</td>
      <td class="num">${qty(e.qty)}</td><td class="num">${e.price != null ? NFQ.format(e.price) : '–'}</td>
      <td class="num">${brl(e.value)}${e.currency && e.currency !== 'BRL' ? `<small>${money(e.value_ccy, e.currency)}</small>` : ''}</td>
      <td>${esc(e.source)}<small>${esc(e.institution)}</small></td></tr>`;
    })
    .join('');
  return `<section class="panel"><h3>Extrato consolidado <small>${evs.length} de ${S.ledger.length} lançamentos</small></h3>
    <p><input id="filter" placeholder="Filtrar por ativo, tipo, instituição…" value="${esc(UI.filter)}" size="40"></p>
    <table><thead><tr><th>Data</th><th>Ativo</th><th>Operação</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Valor</th><th>Origem</th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;
}

// ------------------------------------------------------------ Dados
const OPS = {buy: 'Compra', sell: 'Venda', provento: 'Provento', adjust: 'Ajuste de custo'};

function viewDados() {
  const results = UI.imports
    .map(r =>
      r.error
        ? `<li class="neg">${esc(r.file)}: ${esc(r.error)}</li>`
        : `<li>${esc(r.file)} — ${r.kind === 'negociacao' ? 'Negociação' : 'Movimentação'}: ${r.rows} linhas, <b>${r.inserted} novas</b>, ${r.duplicates} já existentes</li>`,
    )
    .join('');
  const warns = S.warnings
    .map(
      w => `<li><span class="badge ${w.level === 'warn' ? 'warn' : 'info'}">${w.level === 'warn' ? 'atenção' : 'info'}</span>
      ${dt(w.date)} <b>${esc(w.code)}</b>: ${esc(w.msg)}</li>`,
    )
    .join('');
  const types = S.asset_types.map(t => `<option value="${t.type}">${esc(t.label)}</option>`).join('');
  const manual = S.manual
    .slice()
    .reverse()
    .map(
      m => `<tr><td>${dt(m.date)}</td><td>${OPS[m.op] || m.op}${m.kind ? `<small>${esc(m.kind)}</small>` : ''}</td>
      <td><b>${esc(m.code)}</b><small>${esc(typeLabel(m.asset_type))}</small></td><td class="num">${qty(m.qty)}</td>
      <td class="num">${money(m.price, m.currency)}</td>
      <td class="num">${money(m.total, m.currency)}${m.fees ? `<small>taxas ${money(m.fees, m.currency)}</small>` : ''}</td>
      <td class="num">${m.currency !== 'BRL' ? NF4.format(m.fx) : ''}</td>
      <td><button class="link danger" data-act="del-manual" data-id="${m.id}">excluir</button></td></tr>`,
    )
    .join('');
  return `
    <section class="panel"><h3>Importar extratos da B3</h3>
      <ol>
        <li>Acesse <a href="https://www.investidor.b3.com.br" target="_blank" rel="noopener">investidor.b3.com.br</a> → <b>Extratos</b>.</li>
        <li>Nas abas <b>Movimentação</b> e <b>Negociação</b>, filtre o período (quanto mais histórico, melhor) e baixe em <b>Excel</b>.</li>
        <li>Envie os arquivos aqui. Pode repetir arquivos ou períodos sobrepostos: o que já foi importado é ignorado.</li>
      </ol>
      <label class="drop" id="drop"><input type="file" id="files" multiple accept=".xlsx">Arraste os arquivos .xlsx aqui ou clique para escolher</label>
      ${results ? `<ul>${results}</ul>` : ''}</section>
    <section class="panel"><h3>Lançamento manual <small>exterior, cripto, previdência… ou ajustes (taxas, custo de bonificação)</small></h3>
      <form id="manual-form" class="form-grid" autocomplete="off">
        <label>Data<input type="date" name="date" value="${today()}" required></label>
        <label>Operação<select name="op">${Object.entries(OPS)
          .map(([k, l]) => `<option value="${k}">${l}</option>`)
          .join('')}</select></label>
        <label>Tipo de ativo<select name="asset_type">${types}</select></label>
        <label>Ativo<input name="code" placeholder="AAPL, BTC, PETR4…" required></label>
        <label>Quantidade<input name="qty" inputmode="decimal"></label>
        <label>Preço unitário<input name="price" inputmode="decimal"></label>
        <label>Valor total<input name="total" inputmode="decimal" placeholder="opcional"></label>
        <label>Taxas<input name="fees" inputmode="decimal" placeholder="0"></label>
        <label>Moeda<select name="currency"><option>BRL</option><option>USD</option></select></label>
        <label>Câmbio (R$ por US$)<input name="fx" inputmode="decimal" placeholder="auto (PTAX)"></label>
        <label>Tipo de provento<select name="kind"><option>Dividendo</option><option>JCP</option><option>Rendimento</option><option>Juros</option></select></label>
        <label>Nome / descrição<input name="name" placeholder="opcional"></label>
      </form>
      <p class="row"><button class="primary" data-act="add-manual">Adicionar lançamento</button>
        <span class="muted small">Ajuste de custo: valor somado ao custo do ativo, sem mudar a quantidade.</span></p>
      ${
        manual
          ? `<table><thead><tr><th>Data</th><th>Operação</th><th>Ativo</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th>
        <th class="num">Câmbio</th><th></th></tr></thead><tbody>${manual}</tbody></table>`
          : ''
      }</section>
    <section class="panel"><h3>Avisos <small>${S.warnings.length}</small></h3>
      ${warns ? `<ul class="warnings">${warns}</ul>` : '<p class="muted">Nenhum aviso.</p>'}</section>
    ${filtersPanel()}
    ${accountPanels()}
    <section class="panel"><h3>Dados</h3>
      <p class="muted">${S.counts.trades} negócios, ${S.counts.movements} movimentações${S.counts.excluded ? ` (${S.counts.excluded} ignoradas pelos filtros)` : ''} e ${S.counts.manual} lançamentos manuais — tudo num SQLite local (data/yorkfolio.db).
        ${S.summary.market_at ? `Dados de mercado atualizados em ${dt(S.summary.market_at)} ${S.summary.market_at.slice(11, 16)}.` : ''}</p>
      <p class="row"><button data-act="market-force">Rebaixar histórico de preços</button>
        <button class="danger" data-act="reset">Apagar extratos importados</button>
        <button class="danger" data-act="reset-all">Apagar tudo (inclui lançamentos, metas e notas)</button></p></section>`;
}

const VIEWS = {
  carteira: viewCarteira,
  proventos: viewProventos,
  balanceamento: viewBalanceamento,
  ir: viewIR,
  extrato: viewExtrato,
  dados: viewDados,
};

function accountPanels() {
  const account = `<section class="panel"><h3>Conta <small>${esc(ME.username)}${ME.is_admin ? ' · administrador' : ''}</small></h3>
    <form id="password-form" class="form-grid" autocomplete="off">
      <label>Senha atual<input type="password" name="current" autocomplete="current-password" required></label>
      <label>Nova senha<input type="password" name="new" autocomplete="new-password" minlength="6" required></label>
      <label>Confirmar nova senha<input type="password" name="confirm" autocomplete="new-password" required></label>
      <div><button class="primary" type="submit">Alterar senha</button></div>
    </form></section>`;
  if (!ME.is_admin) return account;
  if (!USERS) loadUsers();
  const rows = (USERS || [])
    .map(
      u => `<tr><td><b>${esc(u.username)}</b>${u.is_admin ? '<span class="badge info">admin</span>' : ''}${u.id === ME.id ? '<span class="badge">você</span>' : ''}</td>
      <td>${dt(u.created_at)}</td><td class="num">${
        u.id === ME.id
          ? ''
          : `
        <button class="link" data-act="user-password" data-id="${u.id}" data-name="${esc(u.username)}">redefinir senha</button> ·
        <button class="link danger" data-act="user-delete" data-id="${u.id}" data-name="${esc(u.username)}">excluir</button>`
      }</td></tr>`,
    )
    .join('');
  return `${account}<section class="panel"><h3>Usuários <small>cada conta tem a própria carteira</small></h3>
    ${USERS ? `<table><thead><tr><th>Usuário</th><th>Criado em</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Carregando…</p>'}
    <form id="user-form" class="form-grid" autocomplete="off" style="margin-top:14px">
      <label>Novo usuário<input name="username" autocapitalize="none" required></label>
      <label>Senha inicial<input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
      <label class="check"><input type="checkbox" name="is_admin"> administrador</label>
      <div><button type="submit">Criar usuário</button></div>
    </form></section>`;
}

async function loadUsers() {
  try {
    USERS = await api('/api/users');
  } catch (err) {
    USERS = [];
    toast(err.message, true);
  }
  if (UI.tab === 'dados') render();
}

function filtersPanel() {
  const kinds = Object.entries(S.filters?.kinds || {});
  if (!kinds.length) return '';
  return `<section class="panel"><h3>Filtros <small>tipos de renda fixa ignorados em todo o app — vale também para importações futuras</small></h3>
    <div class="row">${kinds
      .map(
        ([k, n]) => `<label class="check"><input type="checkbox" data-filter="${esc(k)}"
      ${S.filters.exclude.includes(k) ? 'checked' : ''}> Ignorar ${esc(k)} <span class="muted">(${n} lançamentos)</span></label>`,
      )
      .join('')}</div>
    <p class="muted small">Os registros continuam no banco: desmarque para vê-los de novo.</p></section>`;
}

// ------------------------------------------------------------ asset dialog (fixed income valuation)
const INDEXERS = {cdi: '% do CDI', selic: '% da Selic', ipca: 'IPCA + taxa a.a.', pre: 'Prefixado (taxa a.a.)'};

function openAssetDialog(code) {
  const a = allAssets().find(x => x.code === code);
  if (!a) return;
  const dlg = $('#dlg');
  const tesouro = a.asset_type === 'tesouro';
  const fixed = ['rf', 'tesouro'].includes(a.asset_type);
  dlg.innerHTML = `<form method="dialog" class="dlg">
      <h3>${esc(a.code)}</h3><p class="muted">${esc(a.name || a.type_label)}</p>
      <p>Valor atual: <b>${brl(a.value)}</b> ${sourceBadge(a)}<br><span class="muted small">${esc(a.source_note || '')}</span></p>
      ${tesouro ? '<p class="muted small">Títulos do Tesouro são avaliados automaticamente pelo preço oficial (Tesouro Transparente).</p>' : ''}
      ${
        fixed && !tesouro
          ? `<div class="row">
        <label>Indexador<select name="indexer"><option value="">— sem estimativa —</option>
          ${Object.entries(INDEXERS)
            .map(([k, l]) => `<option value="${k}" ${a.indexer === k ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>
        <label>Taxa<input name="rate" inputmode="decimal" size="8" value="${a.rate ?? ''}" placeholder="ex.: 110"></label></div>
        <p class="muted small">% do CDI/Selic: informe o percentual (ex.: 110). IPCA+ e prefixado: taxa ao ano (ex.: 6,5).
          A estimativa parte do último preço unitário informado pela B3 (aplicação ou resgate).</p>`
          : ''
      }
      <label>Valor atual manual (opcional — tem prioridade)<input name="manual_value" inputmode="decimal" value="${a.manual_value ?? ''}" placeholder="vazio = automático"></label>
      <menu><button value="cancel" formnovalidate>Cancelar</button><button value="save" class="primary">Salvar</button></menu>
    </form>`;
  dlg.dataset.code = code;
  dlg.showModal();
}

$('#dlg').addEventListener('close', async () => {
  const dlg = $('#dlg');
  if (dlg.returnValue !== 'save') return;
  try {
    const form = new FormData(dlg.querySelector('form'));
    const fields = {manual_value: parseNum(form.get('manual_value'))};
    if (form.has('indexer'))
      Object.assign(fields, {indexer: form.get('indexer') || null, rate: parseNum(form.get('rate'))});
    await saveAsset(dlg.dataset.code, fields);
  } catch (err) {
    toast(err.message, true);
  }
});

// ------------------------------------------------------------ login
function showLogin(setup = false) {
  ME = null;
  document.body.classList.add('login');
  $('#view').innerHTML = `<div class="login-card">
      <img src="/static/logo.svg" alt="" width="72" height="72"><h2>YorkFolio</h2>
      <p class="muted">${setup ? 'Bem-vindo! Crie a primeira conta (administrador). Dados já existentes serão associados a ela.' : 'Entre com sua conta'}</p>
      <form id="login-form" class="dlg" data-setup="${setup ? '1' : ''}">
        <label>Usuário<input name="username" autocomplete="username" autocapitalize="none" required></label>
        <label>Senha<input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
        ${setup ? '<label>Confirmar senha<input name="confirm" type="password" autocomplete="new-password" required></label>' : ''}
        <button class="primary" type="submit">${setup ? 'Criar conta' : 'Entrar'}</button>
        <p id="login-error" class="neg small"></p>
      </form></div>`;
  $('#login-form [name=username]').focus();
}

async function submitLogin(form) {
  const data = Object.fromEntries(new FormData(form));
  const setup = form.dataset.setup === '1';
  if (setup && data.password !== data.confirm) {
    $('#login-error').textContent = 'As senhas não conferem';
    return;
  }
  try {
    await api(setup ? '/api/setup' : '/api/login', {
      json: {username: data.username, password: data.password},
      auth: false,
    });
    location.reload();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
}

async function submitForm(form) {
  const d = Object.fromEntries(new FormData(form));
  if (form.id === 'manual-form') return ACTIONS['add-manual']();
  if (form.id === 'password-form') {
    if (d.new !== d.confirm) throw new Error('As senhas não conferem');
    await api('/api/password', {json: {current: d.current, new: d.new}});
    toast('Senha alterada');
  } else if (form.id === 'user-form') {
    await api('/api/users', {json: {username: d.username, password: d.password, is_admin: Boolean(d.is_admin)}});
    USERS = null;
    toast(`Usuário ${d.username} criado`);
  } else return;
  UI.clearForms = true;
  render();
}

// ------------------------------------------------------------ actions
let marketBusy = false;
async function updateMarket(silent = false, force = false) {
  if (marketBusy) return;
  marketBusy = true;
  const btn = $('#btn-market');
  btn.disabled = true;
  btn.textContent = '↻ Atualizando…';
  try {
    const r = await api('/api/market', {json: {force}});
    const n = Object.keys(r.updated).length;
    const failed = Object.keys(r.errors);
    if (!silent || failed.length)
      toast(
        `${n} cotações atualizadas${failed.length ? ` · falharam: ${failed.join(', ')}` : ''}`,
        failed.length > 0 && !n,
      );
    await refresh();
  } catch (err) {
    toast(`Cotações: ${err.message}`, true);
  } finally {
    marketBusy = false;
    btn.disabled = false;
    btn.textContent = '↻ Cotações';
  }
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter(f => /\.xlsx$/i.test(f.name));
  if (!files.length) return toast('Escolha arquivos .xlsx exportados da B3', true);
  UI.imports = [];
  for (const f of files) {
    try {
      UI.imports.push(await api('/api/import', {body: f, headers: {'X-Filename': encodeURIComponent(f.name)}}));
    } catch (err) {
      UI.imports.push({file: f.name, error: err.message});
    }
  }
  PLAN = null;
  await refresh();
  await updateMarket(true);
}

async function saveAsset(code, fields) {
  await api('/api/asset', {json: {code, ...fields}});
  PLAN = null;
  await refresh();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#btn-theme');
  btn.textContent = theme === 'dark' ? '☀' : '☾';
  btn.title = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
}
applyTheme(document.documentElement.dataset.theme || 'light');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if (!localStorage.getItem('yorkfolio-theme')) applyTheme(e.matches ? 'dark' : 'light'); // follow the OS until the user picks
});

const ACTIONS = {
  theme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('yorkfolio-theme', next);
    applyTheme(next);
  },
  market: () => updateMarket(false),
  'market-force': () => updateMarket(false, true),
  async logout() {
    await api('/api/logout', {json: {}, auth: false});
    location.reload();
  },
  async 'user-delete'(el) {
    if (!confirm(`Excluir o usuário ${el.dataset.name}? A carteira dele é guardada em data/users/deleted/.`)) return;
    await api('/api/users/delete', {json: {id: +el.dataset.id}});
    USERS = null;
    render();
  },
  async 'user-password'(el) {
    const password = prompt(`Nova senha para ${el.dataset.name} (mínimo 6 caracteres)`);
    if (!password) return;
    await api('/api/users/password', {json: {id: +el.dataset.id, password}});
    toast('Senha redefinida (sessões dele foram encerradas)');
  },
  range: el => {
    UI.range = el.dataset.range;
    render();
  },
  'ir-year': el => {
    UI.irYear = +el.dataset.year;
    render();
  },
  'toggle-closed': () => {
    UI.showClosed = !UI.showClosed;
    render();
  },
  'asset-dlg': el => openAssetDialog(el.dataset.code),
  async copy(el) {
    await navigator.clipboard.writeText(el.dataset.text);
    toast('Discriminação copiada');
  },
  async price(el) {
    const v = prompt(`Cotação manual de ${el.dataset.code}\n(deixe vazio para voltar à cotação automática)`, '');
    if (v !== null) await saveAsset(el.dataset.code, {manual_price: parseNum(v)});
  },
  async 'save-targets'() {
    const targets = {};
    for (const inp of $$('input.target')) targets[inp.dataset.class] = parseNum(inp.value) ?? 0;
    await api('/api/targets', {json: {targets}});
    PLAN = null;
    await refresh();
    toast('Metas salvas');
  },
  async 'add-asset'() {
    const code = $('#new-code').value.trim().toUpperCase();
    if (!code) throw new Error('Informe o ticker');
    await saveAsset(code, {
      asset_type: $('#new-type').value,
      class: $('#new-class').value.trim() || null,
      nota: parseNum($('#new-nota').value) ?? 1,
    });
    await updateMarket(true);
  },
  async 'remove-asset'(el) {
    await api('/api/asset/delete', {json: {code: el.dataset.code}});
    await refresh();
  },
  async aporte() {
    const amount = parseNum($('#aporte').value);
    if (!amount) throw new Error('Informe o valor do aporte');
    PLAN = await api('/api/aporte', {json: {amount}});
    $('#plan').innerHTML = planHtml();
  },
  async 'add-manual'() {
    const data = Object.fromEntries(new FormData($('#manual-form')));
    const r = await api('/api/manual', {json: data});
    toast(`Lançamento adicionado${data.currency !== 'BRL' ? ` (câmbio ${NF4.format(r.fx)})` : ''}`);
    UI.clearForms = true;
    await refresh();
    await updateMarket(true);
  },
  async 'del-manual'(el) {
    if (!confirm('Excluir este lançamento?')) return;
    await api('/api/manual/delete', {json: {id: +el.dataset.id}});
    await refresh();
  },
  async reset() {
    if (!confirm('Apagar todos os extratos importados da B3? (lançamentos manuais, metas e notas são mantidos)'))
      return;
    await api('/api/reset', {json: {}});
    PLAN = null;
    await refresh();
  },
  async 'reset-all'() {
    if (!confirm('Apagar TUDO, incluindo lançamentos manuais, metas e notas?')) return;
    await api('/api/reset', {json: {everything: true}});
    PLAN = null;
    await refresh();
  },
};

// ------------------------------------------------------------ wiring
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  try {
    await ACTIONS[el.dataset.act]?.(el);
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'login-form') return submitLogin(e.target);
  submitForm(e.target).catch(err => toast(err.message, true));
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'files') return uploadFiles(el.files);
  if (el.dataset.filter) {
    try {
      const exclude = $$('input[data-filter]')
        .filter(x => x.checked)
        .map(x => x.dataset.filter);
      await api('/api/filters', {json: {exclude}});
      PLAN = null;
      await refresh();
      toast(exclude.length ? `Ignorando ${exclude.join(', ')}` : 'Nenhum filtro ativo');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (el.name === 'asset_type' && el.form?.id === 'manual-form') {
    const t = S.asset_types.find(x => x.type === el.value);
    el.form.elements.currency.value = t ? t.currency : 'BRL';
    return;
  }
  if (!el.dataset.change) return;
  try {
    const field = el.dataset.change;
    await saveAsset(el.dataset.code, {[field]: field === 'nota' ? (parseNum(el.value) ?? 0) : el.value});
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.classList.contains('target')) {
    let sum = 0;
    for (const inp of $$('input.target')) {
      try {
        sum += parseNum(inp.value) ?? 0;
      } catch {
        /* typing */
      }
    }
    $('#target-sum').textContent = `${NF1.format(sum)}%`;
  } else if (el.id === 'filter') {
    UI.filter = el.value;
    render();
  } else if (el.id === 'aporte') UI.aporte = el.value;
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'aporte') ACTIONS.aporte().catch(err => toast(err.message, true));
});

document.addEventListener('mousemove', chartHover);

for (const type of ['dragover', 'dragleave', 'drop']) {
  window.addEventListener(type, e => {
    e.preventDefault(); // never let the browser open the dropped file
    const zone = e.target.closest?.('#drop');
    zone?.classList.toggle('over', type === 'dragover');
    if (type === 'drop' && zone) uploadFiles(e.dataTransfer.files);
  });
}

window.addEventListener('hashchange', () => {
  UI.tab = location.hash.slice(1) || 'carteira';
  render();
});

(async () => {
  try {
    const session = await api('/api/session', {auth: false});
    if (!session.user) return showLogin(session.setup);
    ME = session.user;
    document.body.classList.remove('login');
    $('#whoami').textContent = ME.username;
    await refresh();
    const s = S.summary;
    const stale =
      !s.market_at || Date.now() - new Date(s.market_at).getTime() > 30 * 60 * 1000 || s.missing_quotes.length;
    if (hasData() && stale) updateMarket(true);
  } catch (err) {
    $('#view').innerHTML = `<div class="empty neg">Erro ao carregar: ${esc(err.message)}</div>`;
  }
})();
