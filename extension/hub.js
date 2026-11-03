import { DEFAULT_SETTINGS, uid, slug, hostOf, normUrl, fmtSize, stamp, urlToCover, blobToCover } from './lib.js';
import { fetchCatalog } from './catalog.js';
import { enrich, PLATFORMS, PLATFORM_BY_ID, platformFromName } from './meta.js';

/* =========================================================
   Estado
   ========================================================= */
const S = {
  games: [], cats: ['Jogos', 'Webports'], settings: { ...DEFAULT_SETTINGS },
  running: {}, saves: {}, lastSnap: {}, query: '', pendingFocus: null,
};
const NAV = { row: 0, cols: {}, rows: [] };
let inputMode = 'kb';

const $ = s => document.querySelector(s);
const local = chrome.storage.local;
const send = m => chrome.runtime.sendMessage(m).catch(e => ({ ok: false, err: String(e.message || e) }));

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kd of kids.flat()) if (kd != null && kd !== false) e.append(kd.nodeType ? kd : document.createTextNode(kd));
  return e;
}

/* =========================================================
   Dados
   ========================================================= */
async function loadAll() {
  const base = await local.get(['games', 'cats', 'settings']);
  S.games = base.games || [];
  S.cats = base.cats && base.cats.length ? base.cats : ['Jogos', 'Webports'];
  S.settings = { ...DEFAULT_SETTINGS, ...(base.settings || {}) };
  const keys = S.games.flatMap(g => ['saves:' + g.id, 'lastSnap:' + g.id]);
  const r = keys.length ? await local.get(keys) : {};
  S.saves = {}; S.lastSnap = {};
  for (const g of S.games) {
    S.saves[g.id] = r['saves:' + g.id] || [];
    S.lastSnap[g.id] = r['lastSnap:' + g.id] || null;
  }
  S.running = (await chrome.storage.session.get('running')).running || {};
}

async function mutateGames(fn) {
  const { games = [] } = await local.get('games');
  const out = fn(games);
  await local.set({ games });
  return out;
}
async function saveCats(cats) { S.cats = cats; await local.set({ cats }); }
async function saveSetting(k, v) {
  S.settings = { ...S.settings, [k]: v };
  await local.set({ settings: S.settings });
}
const gameById = id => S.games.find(g => g.id === id);

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadAll();
    renderHome();
    const top = OV.stack[OV.stack.length - 1];
    if (top && top.onData) top.onData();
  }, 60);
}
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if (area === 'local' && keys.every(k => k.startsWith('snap:'))) return;
  if (area === 'session' && !keys.includes('running')) return;
  scheduleReload();
});

/* =========================================================
   Utilidades visuais
   ========================================================= */
function hashHue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
function artBg(name) {
  const hu = hashHue(name);
  return `linear-gradient(135deg,hsl(${hu} 58% 34%),hsl(${(hu + 45) % 360} 62% 15%))`;
}
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(ts).toLocaleDateString('pt-BR');
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
let toastT = null;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// Sons curtos de navegação
let actx = null;
function sfx(kind) {
  if (!S.settings.sounds) return;
  try {
    actx = actx || new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    const P = { move: [620, .02, .025], ok: [740, .06, .05], back: [360, .05, .04], err: [170, .14, .05] }[kind] || [600, .02, .02];
    o.type = kind === 'err' ? 'square' : 'sine';
    o.frequency.setValueAtTime(P[0], t);
    if (kind === 'ok') o.frequency.exponentialRampToValueAtTime(P[0] * 1.6, t + .06);
    g.gain.setValueAtTime(P[2], t);
    g.gain.exponentialRampToValueAtTime(.0001, t + P[1] + .05);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + P[1] + .06);
  } catch (e) {}
}

// Glifos de botão (controle ou teclado)
const KB = { a: 'Enter', b: 'Esc', x: 'E', y: 'S', start: 'M', select: '/', lb: 'Q', rb: 'R', lr: '← →' };
function glyph(a) {
  if (inputMode === 'pad') {
    if ('abxy'.includes(a) && a.length === 1) return h('span', { class: 'g ' + a, text: a.toUpperCase() });
    const t = { start: '☰', select: '⧉', lb: 'LB', rb: 'RB', lr: '◀ ▶' }[a];
    return h('span', { class: 'g s', text: t });
  }
  return h('span', { class: 'g k', text: KB[a] });
}

/* =========================================================
   Tela principal
   ========================================================= */
const ROW_MAX = 12;
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');

// Grupos da biblioteca: por categoria ou por plataforma
function groupsFor(by) {
  const out = [];
  if (by === 'platform') {
    for (const p of PLATFORMS) {
      const items = S.games.filter(g => g.platform === p.id).sort(byName);
      if (items.length) out.push({ key: 'plat:' + p.id, title: p.label, items });
    }
    const none = S.games.filter(g => !PLATFORM_BY_ID[g.platform]).sort(byName);
    if (none.length) out.push({ key: 'plat:__none', title: 'Sem plataforma', items: none });
  } else {
    for (const c of S.cats) {
      const items = S.games.filter(g => g.cat === c).sort(byName);
      if (items.length) out.push({ key: 'cat:' + c, title: c, items });
    }
    const orphan = S.games.filter(g => !S.cats.includes(g.cat)).sort(byName);
    if (orphan.length) out.push({ key: 'cat:__outros', title: 'Outros', items: orphan });
  }
  return out;
}

function buildRows() {
  const q = S.query.trim().toLowerCase();
  if (q) {
    const items = S.games.filter(g => g.name.toLowerCase().includes(q) || g.url.toLowerCase().includes(q)).sort(byName);
    return [{ key: 'search', title: `Resultados para “${S.query.trim()}”`, items: items.slice(0, 60), total: items.length }];
  }
  const rows = [];
  const run = new Set(Object.keys(S.running));
  const recent = S.games.filter(g => g.last || run.has(g.id))
    .sort((a, b) => (run.has(b.id) - run.has(a.id)) || (b.last || 0) - (a.last || 0)).slice(0, 10);
  if (recent.length) rows.push({ key: 'recent', title: 'Continuar jogando', items: recent, total: recent.length });
  for (const g of groupsFor(S.settings.groupBy)) rows.push({ ...g, items: g.items.slice(0, ROW_MAX), total: g.items.length });
  return rows;
}
const rowLen = row => row.items.length + (row.total > row.items.length ? 1 : 0);

function coverNodes(g) {
  const nodes = [];
  if (g.cover) {
    const fit = g.coverAspect && g.coverAspect < 1.25; // boxart em pé: mostra inteira sobre fundo desfocado
    if (fit) nodes.push(h('div', { class: 'fill', style: `background-image:url("${g.cover}")` }));
    nodes.push(h('img', { class: 'cover' + (fit ? ' fit' : ''), src: g.cover, alt: '', draggable: 'false' }));
  } else {
    nodes.push(h('div', { class: 'art' },
      h('span', { class: 'ini', text: (g.name.trim()[0] || '?').toUpperCase() }), h('span', { text: g.name })));
  }
  const p = PLATFORM_BY_ID[g.platform];
  if (p) nodes.push(h('span', { class: 'plat', text: p.short }));
  if (S.running[g.id]) nodes.push(h('span', { class: 'badge', text: 'Em execução' }));
  return nodes;
}
function cardEl(g, onHover, onClick) {
  const card = h('div', { class: 'card', 'data-id': g.id }, coverNodes(g));
  if (!g.cover) card.style.background = artBg(g.name);
  card.addEventListener('mouseenter', () => { if (!OV.stack.length && Date.now() - lastMouseMove < 150) onHover(); });
  card.addEventListener('click', onClick);
  return card;
}
function moreCardEl(row, onHover, onClick) {
  const card = h('div', { class: 'card more' },
    h('div', { class: 'moreIn' }, h('b', { text: `+${row.total - row.items.length}` }), h('span', { text: 'Ver todos' })));
  card.addEventListener('mouseenter', () => { if (!OV.stack.length && Date.now() - lastMouseMove < 150) onHover(); });
  card.addEventListener('click', onClick);
  return card;
}

let rowEls = [];
let lastMouseMove = 0;
function renderHome() {
  const prev = currentGame();
  const prevKey = NAV.rows[NAV.row] && NAV.rows[NAV.row].key;
  NAV.rows = buildRows();
  const inner = $('#rowsInner');
  inner.replaceChildren();
  rowEls = [];
  if (LIB.open) renderLibrary();

  if (!S.games.length) {
    inner.append(h('div', { class: 'empty' },
      h('h2', { text: 'Sua biblioteca está vazia' }),
      h('p', {}, 'Abra o menu com ', glyph('start'), ' para adicionar jogos, importar um catálogo ou os favoritos do Chrome.')));
    updateHero(null);
    updateHints();
    return;
  }
  if (!NAV.rows[0].items.length) {
    inner.append(h('div', { class: 'empty' }, h('h2', { text: 'Nada encontrado' }), h('p', {}, glyph('b'), ' limpa a busca.')));
    updateHero(null);
    updateHints();
    return;
  }

  NAV.rows.forEach((row, r) => {
    const cards = row.items.map((g, c) => cardEl(g, () => setHomeFocus(r, c, false), () => {
      if (NAV.row === r && (NAV.cols[row.key] || 0) === c) homeAction('a'); else setHomeFocus(r, c);
    }));
    if (row.total > row.items.length) {
      const c = row.items.length;
      cards.push(moreCardEl(row, () => setHomeFocus(r, c, false), () => openLibrary(row.key)));
    }
    const el = h('div', { class: 'row' },
      h('div', { class: 'rowTitle' }, row.title, h('small', { text: String(row.total) })),
      h('div', { class: 'trackWrap' }, h('div', { class: 'track' }, cards)));
    rowEls.push(el);
    inner.append(el);
  });

  const want = S.pendingFocus || (prev && prev.id);
  S.pendingFocus = null;
  let placed = false;
  const tryPlace = pred => {
    for (let r = 0; r < NAV.rows.length && !placed; r++) {
      if (!pred(NAV.rows[r])) continue;
      const c = NAV.rows[r].items.findIndex(g => g.id === want);
      if (c >= 0) { NAV.row = r; NAV.cols[NAV.rows[r].key] = c; placed = true; }
    }
  };
  if (want) {
    if (!S.pendingFocusFresh) tryPlace(row => row.key === prevKey);
    tryPlace(row => row.key !== 'recent');
    tryPlace(() => true);
  }
  if (!placed && prevKey) {
    const r = NAV.rows.findIndex(x => x.key === prevKey);
    if (r >= 0) NAV.row = r;
  }
  S.pendingFocusFresh = false;
  NAV.row = Math.min(NAV.row, NAV.rows.length - 1);
  for (const row of NAV.rows) NAV.cols[row.key] = Math.min(NAV.cols[row.key] || 0, rowLen(row) - 1);
  applyHomeFocus();
}

function currentGame() {
  if (LIB.open) return libGame();
  const row = NAV.rows[NAV.row];
  if (!row || !row.items.length) return null;
  const c = NAV.cols[row.key] || 0;
  return c < row.items.length ? row.items[c] : null;
}
function onMoreCard() {
  const row = NAV.rows[NAV.row];
  return !!row && (NAV.cols[row.key] || 0) === row.items.length && row.total > row.items.length;
}

function setHomeFocus(r, c, sound = true) {
  if (r === NAV.row && c === (NAV.cols[NAV.rows[r].key] || 0)) return;
  NAV.row = r; NAV.cols[NAV.rows[r].key] = c;
  if (sound) sfx('move');
  applyHomeFocus();
}

function applyHomeFocus() {
  if (!rowEls.length) return;
  rowEls.forEach((el, i) => {
    el.classList.toggle('cur', i === NAV.row);
    el.classList.toggle('above', i < NAV.row);
    const row = NAV.rows[i];
    const col = NAV.cols[row.key] || 0;
    const track = el.querySelector('.track');
    const cards = track.children;
    for (let j = 0; j < cards.length; j++) cards[j].classList.toggle('focus', i === NAV.row && j === col);
    if (cards.length) {
      const wrap = el.querySelector('.trackWrap');
      const cs = getComputedStyle(wrap);
      const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const gap = parseFloat(getComputedStyle(track).columnGap) || 16;
      const step = cards[0].offsetWidth + gap;
      const total = cards.length * step - gap;
      const shift = Math.min(Math.max(0, col - 1) * step, Math.max(0, total - avail + 8));
      track.style.transform = `translateX(${-shift}px)`;
    }
  });
  $('#rowsInner').style.transform = `translateY(${-rowEls[NAV.row].offsetTop}px)`;
  if (LIB.open) { applyLibFocus(); return; }
  if (onMoreCard()) updateHeroMore(NAV.rows[NAV.row]); else updateHero(currentGame());
  updateHints();
}

function updateHeroMore(row) {
  setBackground(null);
  $('#heroKicker').textContent = 'Biblioteca';
  $('#heroTitle').textContent = row.title;
  const meta = $('#heroMeta'); meta.replaceChildren(h('span', { text: `${row.total} jogos` }));
  const acts = $('#heroActions'); acts.replaceChildren(h('div', { class: 'act' }, glyph('a'), 'Ver todos'));
}

/* =========================================================
   Biblioteca em grade (rolagem vertical, uma aba por grupo)
   ========================================================= */
const LIB = { open: false, tab: 0, idx: 0, groups: [], cols: 1, cards: [] };

function libGroups() {
  return [{ key: 'all', title: 'Todos', items: [...S.games].sort(byName) }, ...groupsFor(S.settings.groupBy)];
}
function libGame() {
  const g = LIB.groups[LIB.tab];
  return g ? g.items[LIB.idx] || null : null;
}
function openLibrary(key) {
  LIB.open = true;
  LIB.groups = libGroups();
  LIB.tab = Math.max(0, LIB.groups.findIndex(g => g.key === key));
  LIB.idx = 0;
  $('#home').hidden = true;
  $('#library').hidden = false;
  sfx('ok');
  renderLibrary(true);
}
function closeLibrary() {
  LIB.open = false;
  $('#library').hidden = true;
  $('#home').hidden = false;
  sfx('back');
  applyHomeFocus();
}
function renderLibrary(reset) {
  const keepId = !reset && libGame() && libGame().id;
  const keepKey = !reset && LIB.groups[LIB.tab] && LIB.groups[LIB.tab].key;
  LIB.groups = libGroups();
  if (keepKey) LIB.tab = Math.max(0, LIB.groups.findIndex(g => g.key === keepKey));
  LIB.tab = Math.min(LIB.tab, LIB.groups.length - 1);
  const grp = LIB.groups[LIB.tab];
  if (keepId) { const i = grp.items.findIndex(g => g.id === keepId); if (i >= 0) LIB.idx = i; }
  LIB.idx = Math.min(LIB.idx, Math.max(0, grp.items.length - 1));

  const tabs = $('#libTabs');
  tabs.replaceChildren(...LIB.groups.map((g, i) => {
    const t = h('button', { class: 'ltab' + (i === LIB.tab ? ' on' : ''), type: 'button' }, g.title, h('small', { text: String(g.items.length) }));
    t.addEventListener('click', () => { LIB.tab = i; LIB.idx = 0; renderLibrary(); });
    return t;
  }));
  const on = tabs.querySelector('.on');
  if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('#libBy').textContent = S.settings.groupBy === 'platform' ? 'Plataforma' : 'Categoria';

  const grid = $('#libGrid');
  LIB.cards = grp.items.map((g, i) => cardEl(g, () => libFocus(i, false), () => {
    if (LIB.idx === i) libAction('a'); else libFocus(i);
  }));
  grid.replaceChildren(...LIB.cards);
  if (!grp.items.length) grid.append(h('div', { class: 'empty', text: 'Nenhum jogo aqui.' }));
  applyLibFocus();
}
function libCols() {
  const grid = $('#libGrid');
  const first = LIB.cards[0];
  if (!first) return 1;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  if (cols) return cols;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 16;
  return Math.max(1, Math.floor((grid.clientWidth + gap) / (first.offsetWidth + gap)));
}
function libFocus(i, sound = true) {
  if (i === LIB.idx) return;
  LIB.idx = i;
  if (sound) sfx('move');
  applyLibFocus();
}
function applyLibFocus() {
  LIB.cols = libCols();
  LIB.cards.forEach((c, i) => c.classList.toggle('focus', i === LIB.idx));
  const card = LIB.cards[LIB.idx];
  const view = $('#libView');
  if (card) {
    const top = card.offsetTop - view.clientHeight * 0.28;
    $('#libGrid').style.transform = `translateY(${-Math.max(0, top)}px)`;
  }
  const g = libGame();
  setBackground(g);
  const info = $('#libInfo');
  info.replaceChildren();
  if (g) {
    const p = PLATFORM_BY_ID[g.platform];
    info.append(...[h('b', { text: g.name }),
      p ? h('span', { text: p.label }) : null,
      g.year ? h('span', { text: String(g.year) }) : null,
      S.running[g.id] ? h('span', { class: 'live', text: 'Em execução' }) : null,
      g.plays ? h('span', { text: `Aberto ${g.plays}×` }) : null].filter(Boolean));
  }
  updateHints();
}
function libAction(a) {
  const grp = LIB.groups[LIB.tab];
  const n = grp ? grp.items.length : 0;
  const cols = LIB.cols || 1;
  const i = LIB.idx;
  switch (a) {
    case 'left': if (i % cols > 0) libFocus(i - 1); break;
    case 'right': if (i % cols < cols - 1 && i + 1 < n) libFocus(i + 1); break;
    case 'up': if (i - cols >= 0) libFocus(i - cols); break;
    case 'down': if (i + cols < n) libFocus(i + cols); else if (Math.floor(i / cols) < Math.floor((n - 1) / cols)) libFocus(n - 1); break;
    case 'lb': case 'rb': {
      const t = LIB.tab + (a === 'rb' ? 1 : -1);
      if (t >= 0 && t < LIB.groups.length) { LIB.tab = t; LIB.idx = 0; sfx('move'); renderLibrary(); }
      break;
    }
    case 'select': {
      saveSetting('groupBy', S.settings.groupBy === 'platform' ? 'cat' : 'platform').then(() => {
        LIB.tab = 0; LIB.idx = 0; renderHome();
        toast('Agrupando por ' + (S.settings.groupBy === 'platform' ? 'plataforma' : 'categoria'));
      });
      break;
    }
    case 'a': playGame(libGame()); break;
    case 'x': if (libGame()) { sfx('ok'); editGame(libGame().id); } break;
    case 'y': if (libGame()) { sfx('ok'); savesPanel(libGame().id); } break;
    case 'start': sfx('ok'); mainMenu(); break;
    case 'b': closeLibrary(); break;
  }
}

let bgFlip = false, bgCur = '';
function setBackground(g) {
  const val = g ? (g.cover ? `url("${g.cover}")` : artBg(g.name)) : '';
  if (val === bgCur) return;
  bgCur = val;
  bgFlip = !bgFlip;
  const on = bgFlip ? $('#bgA') : $('#bgB');
  const off = bgFlip ? $('#bgB') : $('#bgA');
  if (val.startsWith('url')) {
    on.style.background = '';
    on.style.backgroundImage = val;
    on.style.backgroundSize = 'cover';
    on.style.backgroundPosition = 'center';
  } else on.style.background = val;
  on.classList.toggle('on', !!val);
  off.classList.remove('on');
}

function updateHero(g) {
  setBackground(g);
  const row = NAV.rows[NAV.row];
  $('#heroKicker').textContent = g ? (row && row.key === 'recent' ? 'Continuar jogando' : g.cat || '') : '';
  $('#heroTitle').textContent = g ? g.name : (S.games.length ? '' : 'Couchport');
  const meta = $('#heroMeta');
  meta.replaceChildren();
  const acts = $('#heroActions');
  acts.replaceChildren();
  if (!g) return;
  const live = !!S.running[g.id];
  if (live) meta.append(h('span', { class: 'live', text: 'Em execução' }));
  const pl = PLATFORM_BY_ID[g.platform];
  if (pl) meta.append(h('span', { class: 'platTxt', text: pl.label }));
  if (g.year) meta.append(h('span', { text: String(g.year) }));
  meta.append(h('span', { text: hostOf(g.url) }));
  if (g.plays) meta.append(h('span', { text: `Aberto ${g.plays}×` }));
  if (g.last) meta.append(h('span', { text: `Jogado ${ago(g.last)}` }));
  const ns = (S.saves[g.id] || []).length;
  if (ns) meta.append(h('span', { text: `${ns} save${ns > 1 ? 's' : ''}` }));
  acts.append(
    h('div', { class: 'act' }, glyph('a'), live ? 'Continuar' : 'Jogar'),
    h('div', { class: 'act' }, glyph('y'), 'Saves'),
    h('div', { class: 'act' }, glyph('x'), 'Editar'));
}

function updateHints() {
  const box = $('#hints');
  box.replaceChildren();
  const add = (a, t) => box.append(h('div', { class: 'h' }, glyph(a), t));
  const top = OV.stack[OV.stack.length - 1];
  if (top) {
    const el = OV.grid.length ? OV.grid[OV.pos.r][OV.pos.c] : null;
    if (el && el._cycle) add('lr', 'Alterar');
    add('a', 'Selecionar');
    add('b', 'Voltar');
    return;
  }
  if (LIB.open) {
    if (libGame()) { add('a', 'Jogar'); add('y', 'Saves'); add('x', 'Editar'); }
    add('lb', 'Abas'); add('select', 'Agrupar'); add('b', 'Voltar');
    return;
  }
  if (onMoreCard()) add('a', 'Ver todos');
  else if (currentGame()) { add('a', 'Jogar'); add('y', 'Saves'); add('x', 'Editar'); }
  add('select', 'Buscar');
  add('start', 'Menu');
  if (S.query) add('b', 'Limpar busca');
}

async function playGame(g) {
  if (!g) return;
  sfx('ok');
  toast(S.running[g.id] ? `Voltando para ${g.name}…` : `Abrindo ${g.name}…`);
  const r = await send({ t: 'play', gameId: g.id });
  if (!r || !r.ok) { sfx('err'); toast('Não consegui abrir: ' + (r && r.err || 'erro')); }
}

function homeAction(a) {
  if (!NAV.rows.length || !rowEls.length) {
    if (a === 'start' || a === 'a') mainMenu();
    else if (a === 'select') searchPanel();
    else if (a === 'b' && S.query) { S.query = ''; renderHome(); sfx('back'); }
    return;
  }
  const row = NAV.rows[NAV.row];
  const col = NAV.cols[row.key] || 0;
  switch (a) {
    case 'up': if (NAV.row > 0) setHomeFocus(NAV.row - 1, NAV.cols[NAV.rows[NAV.row - 1].key] || 0); break;
    case 'down': if (NAV.row < NAV.rows.length - 1) setHomeFocus(NAV.row + 1, NAV.cols[NAV.rows[NAV.row + 1].key] || 0); break;
    case 'left': if (col > 0) setHomeFocus(NAV.row, col - 1); break;
    case 'right': if (col < rowLen(row) - 1) setHomeFocus(NAV.row, col + 1); break;
    case 'lb': setHomeFocus(NAV.row, Math.max(0, col - 4)); break;
    case 'rb': setHomeFocus(NAV.row, Math.min(rowLen(row) - 1, col + 4)); break;
    case 'a': if (onMoreCard()) openLibrary(row.key); else playGame(currentGame()); break;
    case 'x': if (currentGame()) { sfx('ok'); editGame(currentGame().id); } break;
    case 'y': if (currentGame()) { sfx('ok'); savesPanel(currentGame().id); } break;
    case 'start': sfx('ok'); mainMenu(); break;
    case 'select': sfx('ok'); searchPanel(); break;
    case 'b': if (S.query) { S.query = ''; sfx('back'); renderHome(); } break;
  }
}

/* =========================================================
   Painéis navegáveis
   ========================================================= */
const OV = { stack: [], grid: [], pos: { r: 0, c: 0 } };

function openPanel(build, opts = {}) {
  if (OV.stack.length) OV.stack[OV.stack.length - 1].pos = { ...OV.pos };
  OV.stack.push({ build, ...opts, pos: { r: 0, c: 0 } });
  showTop();
}
function showTop() {
  const top = OV.stack[OV.stack.length - 1];
  const panel = $('#panel');
  panel.className = 'panel' + (top.wide ? ' wide' : '');
  panel.replaceChildren();
  top.rebuild = () => { top.pos = { ...OV.pos }; showTop(); };
  top.build(panel, top);
  $('#overlay').hidden = false;
  OV.pos = { ...top.pos };
  refreshNav();
}
function closePanel() {
  const top = OV.stack.pop();
  if (top && top.onClose) top.onClose();
  if (OV.stack.length) showTop();
  else {
    $('#overlay').hidden = true;
    $('#panel').replaceChildren();
    OV.grid = [];
    if (document.activeElement) document.activeElement.blur();
    updateHints();
  }
}
function closeAll() { while (OV.stack.length) closePanel(); }

function visible(el) { return el.offsetParent !== null || el.getClientRects().length > 0; }
function refreshNav(keepEl) {
  const panel = $('#panel');
  const els = [...panel.querySelectorAll('[data-nav]')].filter(visible);
  const grid = [];
  const groupOf = new Map();
  for (const el of els) {
    const g = el.parentElement.closest('.navrow') || el;
    if (!groupOf.has(g)) { groupOf.set(g, []); grid.push(groupOf.get(g)); }
    groupOf.get(g).push(el);
  }
  OV.grid = grid;
  if (keepEl) {
    for (let r = 0; r < grid.length; r++) {
      const c = grid[r].indexOf(keepEl);
      if (c >= 0) { OV.pos = { r, c }; break; }
    }
  }
  if (!grid.length) { OV.pos = { r: 0, c: 0 }; updateHints(); return; }
  OV.pos.r = Math.min(Math.max(0, OV.pos.r), grid.length - 1);
  OV.pos.c = Math.min(Math.max(0, OV.pos.c), grid[OV.pos.r].length - 1);
  applyNav();
}
function navEl() { return OV.grid.length ? OV.grid[OV.pos.r][OV.pos.c] : null; }
function applyNav() {
  $('#panel').querySelectorAll('.nav-focus').forEach(e => e.classList.remove('nav-focus'));
  const el = navEl();
  if (!el) return;
  el.classList.add('nav-focus');
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const isText = el.tagName === 'INPUT';
  if (isText && inputMode === 'kb') { if (document.activeElement !== el) el.focus({ preventScroll: true }); }
  else if (document.activeElement && document.activeElement !== el && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  updateHints();
}
function focusNavEl(el) { refreshNav(el); }

function panelAction(a) {
  const top = OV.stack[OV.stack.length - 1];
  if (top.keys && top.keys[a]) { top.keys[a](); return; }
  const g = OV.grid;
  if (!g.length) { if (a === 'b') { sfx('back'); closePanel(); } return; }
  const { r, c } = OV.pos;
  const el = navEl();
  switch (a) {
    case 'up': if (r > 0) { OV.pos.r--; OV.pos.c = Math.min(c, g[OV.pos.r].length - 1); sfx('move'); applyNav(); } break;
    case 'down': if (r < g.length - 1) { OV.pos.r++; OV.pos.c = Math.min(c, g[OV.pos.r].length - 1); sfx('move'); applyNav(); } break;
    case 'left':
      if (g[r].length > 1 && c > 0) { OV.pos.c--; sfx('move'); applyNav(); }
      else if (el && el._cycle) el._cycle(-1);
      break;
    case 'right':
      if (g[r].length > 1 && c < g[r].length - 1) { OV.pos.c++; sfx('move'); applyNav(); }
      else if (el && el._cycle) el._cycle(1);
      break;
    case 'a':
      if (!el) break;
      if (el.tagName === 'INPUT') { el.focus(); break; }
      if (el._cycle) { el._cycle(1); break; }
      sfx('ok');
      el.click();
      break;
    case 'lb': case 'rb': {
      const nr = Math.min(g.length - 1, Math.max(0, r + (a === 'rb' ? 10 : -10)));
      if (nr !== r) { OV.pos.r = nr; OV.pos.c = 0; sfx('move'); applyNav(); }
      break;
    }
    case 'b': sfx('back'); closePanel(); break;
  }
}

// Componentes
function item(label, onClick, { cls = '', note = '' } = {}) {
  return h('button', { class: 'item ' + cls, 'data-nav': '', type: 'button', onclick: onClick },
    h('span', { class: 'lbl' }, label), note ? h('span', { class: 'note', text: note }) : null);
}
function choice(label, values, labels, current, onChange) {
  const e = h('button', { class: 'item', 'data-nav': '', type: 'button' }, h('span', { class: 'lbl', text: label }));
  const val = h('span', { class: 'val' });
  e.append(val);
  let i = Math.max(0, values.indexOf(current));
  const upd = () => { val.textContent = labels[i]; };
  upd();
  e._cycle = d => { i = (i + d + values.length) % values.length; upd(); sfx('move'); onChange(values[i], e); };
  e._set = v => { i = Math.max(0, values.indexOf(v)); upd(); };
  e.addEventListener('click', () => e._cycle(1));
  return e;
}
function field(label, value, { placeholder = '', onInput, onEnter, type = 'text' } = {}) {
  const inp = h('input', { 'data-nav': '', type, value: value || '', placeholder, spellcheck: 'false', autocomplete: 'off' });
  if (onInput) inp.addEventListener('input', () => onInput(inp.value));
  inp._onEnter = onEnter;
  inp.addEventListener('focus', () => focusNavEl(inp));
  return h('div', { class: 'field' }, h('label', { text: label }), inp);
}
function confirmPanel(title, text, yesLabel, onYes, danger = true) {
  openPanel(p => {
    p.append(h('h2', { text: title }), h('p', { class: 'sub', text }),
      h('div', { class: 'navrow' },
        item('Cancelar', () => closePanel()),
        item(yesLabel, () => { closePanel(); onYes(); }, { cls: danger ? 'danger' : 'pri' })));
  });
}

/* =========================================================
   Menu principal, configurações, ajuda, busca
   ========================================================= */
function mainMenu() {
  openPanel(p => {
    p.append(
      h('h2', { text: 'Menu' }),
      h('p', { class: 'sub', text: S.games.length ? `${S.games.length} jogo${S.games.length > 1 ? 's' : ''} na biblioteca` : 'Bem-vindo! Comece adicionando seus jogos.' }),
      item('Adicionar jogo', () => editGame(null), { cls: S.games.length ? '' : 'pri' }),
      item('Biblioteca completa', () => { closeAll(); openLibrary('all'); }, { note: 'grade por ' + (S.settings.groupBy === 'platform' ? 'plataforma' : 'categoria') }),
      item('Catálogos de jogos', catalogsPanel, { note: 'importar listas prontas' }),
      item('Adicionar pacote inicial', async () => {
        const n = await addStarter(); closeAll(); toast(n ? `${n} jogos adicionados` : 'O pacote inicial já está na biblioteca');
      }),
      item('Atualizar capas e plataformas', () => {
        const n = queueAll(false);
        closeAll();
        toast(n ? `Atualizando ${n} jogo(s) em segundo plano…` : 'Tudo em dia', 4000);
      }, { note: 'troca capas tiradas do site' }),
      item('Importar favoritos do Chrome', () => pickFile('fileBookmarks'), { note: 'precisa de teclado/mouse' }),
      item('Buscar jogo', () => { closeAll(); searchPanel(); }),
      item('Nova categoria', () => newCategory()),
      item('Configurações', settingsPanel),
      item('Controles e atalhos', helpPanel),
      h('div', { class: 'sec', text: 'Backup da biblioteca' }),
      h('div', { class: 'navrow' },
        item('Exportar lista', exportList),
        item('Importar lista', () => pickFile('fileList'))),
    );
  });
}

function settingsPanel() {
  const yn = [true, false], ynl = ['Sim', 'Não'];
  openPanel(p => {
    p.append(
      h('h2', { text: 'Configurações' }),
      h('p', { class: 'sub' }, 'Use ', glyph('lr'), ' para alterar.'),
      choice('Abrir jogos em tela cheia', yn, ynl, S.settings.gameFullscreen, v => saveSetting('gameFullscreen', v)),
      choice('Menu em tela cheia', yn, ynl, S.settings.hubFullscreen, v => { saveSetting('hubFullscreen', v); send({ t: 'setHubFullscreen', on: v }); }),
      choice('Agrupar a biblioteca por', ['platform', 'cat'], ['Plataforma', 'Categoria'], S.settings.groupBy, v => { saveSetting('groupBy', v); }),
      h('div', { class: 'sec', text: 'Saves' }),
      choice('Backup automático enquanto joga', [0, 1, 2, 3, 5, 10], ['Desligado', 'a cada 1 min', 'a cada 2 min', 'a cada 3 min', 'a cada 5 min', 'a cada 10 min'], S.settings.autosaveMin, v => saveSetting('autosaveMin', v)),
      choice('Pontos de restauração por jogo', [3, 5, 10, 20], ['3', '5', '10', '20'], S.settings.keepSaves, v => saveSetting('keepSaves', v)),
      choice('Copiar saves para Downloads/Couchport', yn, ynl, S.settings.diskMirror, v => saveSetting('diskMirror', v)),
      h('div', { class: 'sec', text: 'Interface' }),
      choice('Sons do menu', yn, ynl, S.settings.sounds, v => saveSetting('sounds', v)),
      h('div', { class: 'sec', text: 'Capas' }),
      field('Chave da API do SteamGridDB (opcional)', S.settings.steamGridKey || '', {
        placeholder: 'Grátis em steamgriddb.com → Preferências → API',
        onInput: v => saveSetting('steamGridKey', v.trim()),
      }),
      h('p', { class: 'sub', text: 'Com a chave, a busca de capas usa também o acervo do SteamGridDB, que tem arte para muitos jogos antigos e de console.' }),
    );
  });
}

function helpPanel() {
  const rows = [
    ['a', 'Jogar / selecionar', 'Enter'],
    ['b', 'Voltar / fechar painel', 'Esc'],
    ['y', 'Saves do jogo', 'S'],
    ['x', 'Editar jogo e capa', 'E'],
    ['start', 'Menu', 'M'],
    ['select', 'Buscar', '/'],
    ['lb', 'Pular 4 jogos (com RB)', 'Q / R'],
  ];
  openPanel(p => {
    const grid = h('div', { class: 'keys' });
    const mode = inputMode;
    for (const [a, d, k] of rows) {
      inputMode = 'pad'; const gp = glyph(a); inputMode = mode;
      grid.append(gp, h('span', { class: 'd', text: d }), h('span', { class: 'g k', text: k }));
    }
    p.append(
      h('h2', { text: 'Controles e atalhos' }),
      h('p', { class: 'sub', text: 'Funciona com controle (padrão Xbox/PlayStation) ou teclado.' }),
      grid,
      h('div', { class: 'sec', text: 'Dentro do jogo' }),
      h('p', { class: 'sub', html: 'Segure <b>SELECT + START</b> (ou aperte o botão <b>Home/Xbox/PS</b>) ou use <b>Ctrl+Shift+H</b> para salvar e voltar ao menu. No menu, <b>Ctrl+Shift+H</b> volta para o último jogo.' }),
      h('p', { class: 'sub', text: 'O atalho de teclado pode ser trocado em chrome://extensions/shortcuts.' }),
      item('Fechar', () => closePanel()),
    );
  });
}

function searchPanel() {
  openPanel(p => {
    p.append(
      h('h2', { text: 'Buscar' }),
      field('Nome ou site do jogo', S.query, {
        placeholder: 'Digite para filtrar…',
        onInput: v => { S.query = v; renderHome(); },
        onEnter: () => closePanel(),
      }),
      h('p', { class: 'sub', text: 'A busca precisa de teclado. Enter fecha mantendo o filtro.' }),
    );
  }, { onClose: () => { NAV.row = 0; renderHome(); } });
}

function newCategory(cb) {
  let name = '';
  const commit = async () => {
    const n = name.trim();
    if (!n) { sfx('err'); toast('Digite um nome'); return; }
    if (!S.cats.includes(n)) await saveCats([...S.cats, n]);
    if (cb) cb(n);
    closePanel();
    toast(`Categoria "${n}" criada`);
  };
  openPanel(p => {
    p.append(h('h2', { text: 'Nova categoria' }),
      field('Nome', '', { placeholder: 'Ex.: Retrô, Corrida, Multiplayer', onInput: v => { name = v; }, onEnter: commit }),
      h('div', { class: 'navrow' }, item('Cancelar', () => closePanel()), item('Criar', commit, { cls: 'pri' })));
  });
}

/* =========================================================
   Capas e plataformas (nunca a imagem ou o ícone do site do jogo)
   ========================================================= */
const ENRICH_V = 2;
function coverFromHost(g) {
  try { return !!g.coverSrc && new URL(g.coverSrc).hostname.replace(/^www\./, '') === hostOf(g.url); } catch (e) { return false; }
}
const metaOpts = () => ({ store: local, steamGridKey: S.settings.steamGridKey || '' });
async function findCovers(name) { return (await enrich({ name }, metaOpts())).covers; }

const coverQueue = [];
const queued = new Set();
let coverBusy = 0;
function queueAutoCover(id, force = false) {
  if (queued.has(id)) return;
  queued.add(id);
  coverQueue.push([id, force]);
  pumpCovers();
}
async function pumpCovers() {
  while (coverBusy < 2 && coverQueue.length) {
    const [id, force] = coverQueue.shift();
    coverBusy++;
    enrichGame(id, force).catch(() => {}).finally(() => { coverBusy--; queued.delete(id); pumpCovers(); });
  }
}
function queueAll(force = false) {
  let n = 0;
  for (const g of S.games) {
    if (!force && g.enrichV === ENRICH_V && g.cover && !coverFromHost(g)) continue;
    queueAutoCover(g.id, force); n++;
  }
  return n;
}
async function enrichGame(id, force) {
  const g = ((await local.get('games')).games || []).find(x => x.id === id);
  if (!g) return;
  const wantCover = !g.coverManual && (force || !g.cover || coverFromHost(g));
  const wantPlat = !g.platformManual && (force || !g.platform);
  if (!wantCover && !wantPlat) {
    await mutateGames(list => { const x = list.find(y => y.id === id); if (x) x.enrichV = ENRICH_V; });
    return;
  }
  const r = await enrich(g, metaOpts());
  if (r.wdFailed && !r.platform && !r.covers.length) return; // provavelmente sem rede: tenta de novo depois
  const all = (await local.get('games')).games || [];
  const used = new Set(all.filter(x => x.id !== id && x.coverSrc).map(x => x.coverSrc));
  let cov = null, src = null;
  if (wantCover) {
    for (const c of r.covers.filter(c => !used.has(c.url)).slice(0, 5)) {
      try { cov = await urlToCover(c.url); src = c.url; break; } catch (e) {}
    }
  }
  await mutateGames(list => {
    const x = list.find(y => y.id === id);
    if (!x) return;
    if (wantPlat && r.platform && !x.platformManual) x.platform = r.platform;
    if (r.year && !x.year) x.year = r.year;
    if (wantCover && !x.coverManual) {
      if (cov) { x.cover = cov.dataUrl; x.coverSrc = src; x.coverAspect = cov.w && cov.h ? cov.w / cov.h : null; }
      else if (coverFromHost(x)) { x.cover = null; x.coverSrc = null; x.coverAspect = null; }
    }
    x.enrichV = ENRICH_V;
  });
}

/* =========================================================
   Adicionar / editar jogo
   ========================================================= */
function editGame(id) {
  const orig = id ? gameById(id) : null;
  if (id && !orig) return;
  const g = orig ? { ...orig } : {
    id: null, name: '', url: '', cover: null,
    cat: (NAV.rows[NAV.row] && NAV.rows[NAV.row].key.startsWith('cat:') && S.cats.includes(NAV.rows[NAV.row].title)) ? NAV.rows[NAV.row].title : S.cats[0],
  };
  let cands = null; // null = não buscou; [] = buscou e nada
  let status = '';
  let showLink = false;
  let linkVal = '';

  const setStatus = (t, cls = '') => { status = t; const el = $('#edStatus'); if (el) { el.textContent = t; el.className = 'status ' + cls; } };

  async function commit(close = true) {
    const url = normUrl(g.url);
    if (!url) { sfx('err'); setStatus('Coloque um link válido (https://…)', 'warnTxt'); return null; }
    const name = (g.name || '').trim() || hostOf(url);
    const isNew = !g.id;
    const gid = g.id || uid();
    if (isNew && S.games.some(x => x.url === url)) { sfx('err'); setStatus('Esse link já está na biblioteca', 'warnTxt'); return null; }
    await mutateGames(list => {
      const x = list.find(y => y.id === gid);
      const data = { name, url, cat: g.cat || S.cats[0], cover: g.cover || null, coverSrc: g.coverSrc || null, coverAspect: g.coverAspect || null,
        coverManual: !!g.coverManual, platform: g.platform || null, platformManual: !!g.platformManual };
      if (x) Object.assign(x, data);
      else list.push({ id: gid, ...data, plays: 0, last: 0, added: Date.now() });
    });
    g.id = gid; g.url = url; g.name = name;
    if (isNew && (!g.cover || !g.platform)) queueAutoCover(gid);
    if (close) {
      S.pendingFocus = gid; S.pendingFocusFresh = true;
      closeAll();
      toast(isNew ? `${name} adicionado` : 'Alterações salvas');
    }
    return gid;
  }

  async function applyCover(src, blob) {
    setStatus('Baixando imagem…');
    try {
      const cov = blob ? await blobToCover(blob) : await urlToCover(src);
      g.cover = cov.dataUrl; g.coverSrc = src || null; g.coverManual = true; g.coverAspect = cov.w && cov.h ? cov.w / cov.h : null;
      setStatus('Capa aplicada ✓ — lembre de salvar');
      sfx('ok');
      drawCover();
    } catch (e) {
      sfx('err');
      setStatus('Não consegui usar essa imagem: ' + (e.message || e), 'warnTxt');
    }
  }

  function drawCover() {
    const box = $('#edCover');
    if (!box) return;
    box.replaceChildren();
    if (g.cover) box.append(h('img', { src: g.cover, alt: '' }));
    else {
      box.style.background = artBg(g.name || g.url || '?');
      box.append(h('div', { class: 'art', style: 'position:absolute;inset:0;display:flex;align-items:flex-end;padding:14px;font-weight:800;font-size:20px', text: g.name || 'Sem capa' }));
    }
  }

  function drawCands() {
    const box = $('#edCands');
    if (!box) return;
    box.replaceChildren();
    if (cands === null) return;
    if (!cands.length) { box.append(h('div', { class: 'status', text: 'Nenhuma capa encontrada. Tente o Google.' })); return; }
    for (const c of cands) {
      const img = h('img', { src: c.url, alt: '', loading: 'lazy' });
      const b = h('button', { class: 'cand', 'data-nav': '', type: 'button', title: c.label || c.src, onclick: () => applyCover(c.url) }, img, h('span', { text: c.src }));
      img.addEventListener('error', () => { const was = navEl() === b; b.remove(); refreshNav(was ? null : navEl()); });
      box.append(b);
    }
  }

  async function searchCovers() {
    const name = (g.name || '').trim() || (g.url ? hostOf(normUrl(g.url)) : '');
    if (!name) { sfx('err'); setStatus('Preencha o nome ou o link primeiro', 'warnTxt'); return; }
    setStatus('Procurando boxarts, Wikidata, Steam e Wikipédia…');
    const r = await enrich({ name }, metaOpts());
    cands = r.covers;
    if (r.platform && !g.platformManual) { g.platform = r.platform; const pc = $('#edPlat'); if (pc && pc._set) pc._set(r.platform); }
    const pl = r.platform ? ` · plataforma: ${PLATFORM_BY_ID[r.platform].label}` : '';
    setStatus((cands.length ? `${cands.length} capas encontradas — escolha uma` : 'Nenhuma capa encontrada') + pl);
    const keep = navEl();
    drawCands();
    refreshNav(keep);
    if (cands.length) {
      // pula o foco para a primeira capa
      const first = $('#edCands .cand');
      if (first) refreshNav(first);
    }
  }

  async function googleSearch() {
    const gid = await commit(false);
    if (!gid) return;
    setStatus('Abrindo o Google Imagens…');
    await send({ t: 'googleCover', gameId: gid });
  }

  openPanel((p, top) => {
    top.gameId = id;
    const catVals = [...S.cats, '__new'];
    const catLbls = [...S.cats, '+ Nova categoria…'];
    const catChoice = choice('Categoria', catVals, catLbls, g.cat, (v, e) => {
      if (v === '__new') newCategory(n => { g.cat = n; });
      else g.cat = v;
    });
    const linkField = field('Link da imagem', linkVal, {
      placeholder: 'Cole aqui o endereço da imagem (botão direito → Copiar endereço da imagem)',
      onInput: v => { linkVal = v; },
      onEnter: () => linkVal.trim() && applyCover(linkVal.trim()),
    });
    if (!showLink) linkField.hidden = true;
    const platChoice = choice('Plataforma', ['', ...PLATFORMS.map(x => x.id)], ['Automática', ...PLATFORMS.map(x => x.label)],
      g.platformManual ? g.platform : '', v => { g.platformManual = !!v; g.platform = v || g.platform || null; });
    platChoice.id = 'edPlat';
    if (!g.platformManual && g.platform) platChoice.querySelector('.val').textContent = `Automática (${PLATFORM_BY_ID[g.platform] ? PLATFORM_BY_ID[g.platform].label : g.platform})`;

    p.append(
      h('h2', { text: id ? 'Editar jogo' : 'Adicionar jogo' }),
      field('Link do jogo', g.url, { placeholder: 'https://…', onInput: v => { g.url = v; } }),
      field('Nome', g.name, { placeholder: 'Deixe vazio para usar o domínio', onInput: v => { g.name = v; } }),
      catChoice,
      platChoice,
      h('div', { class: 'sec', text: 'Capa' }),
      h('div', { class: 'coverEdit' },
        h('div', { class: 'coverBox', id: 'edCover' }),
        h('div', { class: 'coverBtns' },
          item('Buscar capa automaticamente', searchCovers, { note: 'boxart · Steam · Wikipédia' }),
          item('Escolher no Google Imagens', googleSearch, { note: 'botão direito na imagem' }),
          item('Colar link de imagem', () => {
            showLink = !showLink;
            linkField.hidden = !showLink;
            refreshNav(showLink ? linkField.querySelector('input') : navEl());
          }),
          item('Usar imagem do computador', () => pickFile('fileCover', f => applyCover(null, f))),
          item('Remover capa', () => { g.cover = null; g.coverSrc = null; g.coverManual = false; g.coverAspect = null; drawCover(); setStatus('Capa removida — lembre de salvar'); }),
        )),
      linkField,
      h('div', { class: 'cands navrow', id: 'edCands' }),
      h('div', { class: 'status', id: 'edStatus', text: status }),
      h('div', { class: 'navrow', style: 'margin-top:14px' },
        item('Salvar', () => commit(true), { cls: 'pri' }),
        item('Cancelar', () => closePanel()),
        id ? item('Excluir jogo', () => confirmPanel('Excluir jogo?', `"${g.name}" sai da biblioteca e os pontos de restauração guardados aqui são apagados. As cópias em Downloads/Couchport ficam no disco.`, 'Excluir', async () => {
          await send({ t: 'deleteGame', gameId: id });
          closeAll();
          toast('Jogo excluído');
        }), { cls: 'danger' }) : null),
    );
    drawCover();
    drawCands();
  }, {
    wide: true,
    onData: () => {
      // a capa pode ter chegado pelo Google (menu de contexto)
      const fresh = g.id && gameById(g.id);
      if (fresh && fresh.cover && fresh.cover !== g.cover) {
        g.cover = fresh.cover; g.coverSrc = fresh.coverSrc;
        drawCover(); setStatus('Capa do Google aplicada ✓');
      }
    },
  });
}

/* =========================================================
   Saves
   ========================================================= */
// Outros jogos da biblioteca que guardam dados na mesma origem deste save.
function sharingGames(gameId, origin) {
  return S.games.filter(g => {
    if (g.id === gameId) return false;
    try { if (new URL(g.url).origin === origin) return true; } catch (e) {}
    return (S.saves[g.id] || []).some(s => s.origin === origin);
  });
}
function sharingText(list, origin) {
  const names = list.slice(0, 3).map(g => g.name).join(', ') + (list.length > 3 ? ` e mais ${list.length - 3}` : '');
  return `${hostOf(origin)} também guarda o progresso de ${list.length} outro${list.length > 1 ? 's' : ''} jogo${list.length > 1 ? 's' : ''} da sua biblioteca (${names}). O navegador não separa o progresso por jogo dentro do mesmo site, então restaurar volta todos eles para esta data.`;
}

const REASON = { 'menu': 'ao voltar ao menu', 'automático': 'automático', 'manual': 'manual', 'ao fechar': 'ao fechar o jogo', 'antes de restaurar': 'antes de restaurar', 'importado': 'importado' };

function savesPanel(id) {
  const g = gameById(id);
  if (!g) return;
  openPanel((p, top) => {
    const gg = gameById(id) || g;
    const list = (S.saves[id] || []).slice().sort((a, b) => b.ts - a.ts);
    const live = !!S.running[id];
    const origins = new Set(list.map(s => s.origin));
    const last = S.lastSnap[id];

    p.append(
      h('h2', { text: `Saves — ${gg.name}` }),
      h('p', { class: 'sub', text: `O Couchport copia o progresso ${S.settings.autosaveMin ? `a cada ${S.settings.autosaveMin} min enquanto você joga e ` : ''}sempre que você volta ao menu.${S.settings.diskMirror ? ` Cópias em Downloads/Couchport/Saves/${slug(gg.name)}/` : ''}` }));

    if (live) {
      p.append(h('div', { class: 'navrow' },
        item('Salvar agora', async () => {
          toast('Salvando…');
          const r = await send({ t: 'saveNow', gameId: id });
          toast(summarize(r));
        }, { cls: 'pri' }),
        item('Fechar jogo', async () => {
          await send({ t: 'closeGame', gameId: id });
          toast('Jogo fechado (progresso salvo)');
        })));
    }
    if (last && last.results && last.results.some(x => x.err || (x.skipped && x.skipped.length))) {
      const errs = last.results.filter(x => x.err).map(x => `${hostOf(x.origin)}: ${x.err}`);
      const sk = last.results.flatMap(x => x.skipped || []);
      p.append(h('p', { class: 'sub warnTxt', text: [errs.join(' · '), sk.length ? `Ignorado por tamanho: ${sk.join(', ')}` : ''].filter(Boolean).join(' — ') }));
    }

    p.append(h('div', { class: 'sec', text: 'Pontos de restauração' }));
    if (!list.length) {
      p.append(h('p', { class: 'sub', text: live
        ? 'Nenhum save ainda. Ele aparece aqui no próximo backup, ou use "Salvar agora".'
        : 'Nenhum save ainda. Abra o jogo pelo Couchport; o progresso passa a ser copiado automaticamente.' }));
    }
    const shared = [...origins].map(o => [o, sharingGames(id, o)]).filter(([, l]) => l.length);
    for (const [o, l] of shared) {
      p.append(h('p', { class: 'sub warnTxt', text: `⚠ Site compartilhado: ${hostOf(o)} tem dados de mais ${l.length} jogo${l.length > 1 ? 's' : ''} da biblioteca. Restaurar um save daqui afeta todos eles.` }));
    }
    for (const s of list) {
      const note = [REASON[s.reason] || s.reason, fmtSize(s.size), origins.size > 1 ? hostOf(s.origin) : ''].filter(Boolean).join(' · ');
      const b = item(h('span', {}, fmtDate(s.ts), (s.skipped && s.skipped.length) ? h('small', { class: 'warnTxt', text: 'parte grande ignorada: ' + s.skipped.join(', ') }) : null),
        () => saveActions(id, s), { cls: 'saveItem', note });
      p.append(b);
    }
    p.append(h('div', { class: 'sec', text: 'Arquivo' }),
      item('Importar save (.json)', () => pickFile('fileSave', async f => {
        const r = await send({ t: 'importSave', gameId: id, json: await f.text() });
        toast(r && r.ok ? (r.unchanged ? 'Igual ao último save' : 'Save importado') : ('Falhou: ' + (r && r.err)));
      })));
  }, { onData: () => { const t = OV.stack[OV.stack.length - 1]; t.rebuild(); } });
}

function summarize(r) {
  if (!r || !r.ok) return 'Falhou: ' + (r && r.err || 'erro');
  const res = r.results || [];
  if (!res.length) return 'O jogo ainda não está pronto — tente em alguns segundos';
  if (res.some(x => x.saved)) return 'Progresso salvo ✓';
  if (res.some(x => x.unchanged)) return 'Nada mudou desde o último save';
  if (res.every(x => x.empty)) return 'Esse jogo não guardou nada no navegador ainda';
  return 'Falhou: ' + res.filter(x => x.err).map(x => x.err).join(', ');
}

function saveActions(id, s) {
  const g = gameById(id);
  openPanel(p => {
    p.append(
      h('h2', { text: fmtDate(s.ts) }),
      h('p', { class: 'sub', text: `${g.name} · ${hostOf(s.origin)} · ${fmtSize(s.size)}` }),
      item('Restaurar este save', () => confirmPanel('Restaurar este save?',
        (S.running[id] ? 'O jogo vai ser fechado (o estado atual é salvo antes, por segurança) e este save vai substituir o progresso.' : 'Este save vai substituir o progresso atual do jogo no navegador.')
          + (sharingGames(id, s.origin).length ? ' ⚠ ' + sharingText(sharingGames(id, s.origin), s.origin) : ''),
        'Restaurar', async () => {
          toast('Restaurando…', 6000);
          const r = await send({ t: 'restore', gameId: id, saveId: s.id });
          if (r && r.ok) {
            sfx('ok');
            closeAll();
            openPanel(pp => pp.append(h('h2', { text: 'Save restaurado ✓' }), h('p', { class: 'sub', text: g.name }),
              h('div', { class: 'navrow' }, item('Jogar agora', () => { closeAll(); playGame(g); }, { cls: 'pri' }), item('Fechar', () => closePanel()))));
          } else { sfx('err'); toast('Falhou: ' + (r && r.err || 'erro'), 6000); }
        }, false), { cls: 'pri' }),
      item('Baixar arquivo', async () => {
        const k = 'snap:' + s.id;
        const json = (await local.get(k))[k];
        if (!json) { toast('Arquivo não encontrado'); return; }
        download(new Blob([json], { type: 'application/json' }), `${slug(g.name)}_${stamp(s.ts)}.json`);
      }),
      item('Apagar', () => confirmPanel('Apagar este save?', 'Apaga daqui e a cópia em Downloads/Couchport.', 'Apagar', async () => {
        await send({ t: 'deleteSave', gameId: id, saveId: s.id });
        closePanel();
        toast('Save apagado');
      }), { cls: 'danger' }),
    );
  });
}

/* =========================================================
   Arquivos: favoritos, lista, imagens
   ========================================================= */
const fileHandlers = {};
function pickFile(inputId, handler) {
  if (handler) fileHandlers[inputId] = handler;
  const inp = document.getElementById(inputId);
  inp.value = '';
  try { inp.showPicker ? inp.showPicker() : inp.click(); }
  catch (e) { toast('Use teclado ou mouse para escolher arquivos'); }
}
for (const id of ['fileBookmarks', 'fileList', 'fileSave', 'fileCover']) {
  document.getElementById(id).addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (fileHandlers[id]) { const fn = fileHandlers[id]; delete fileHandlers[id]; fn(f); return; }
    if (id === 'fileBookmarks') importBookmarks(f);
    if (id === 'fileList') importList(f);
  });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportList() {
  const data = { kind: 'couchport-list', v: 2, cats: S.cats, games: S.games.map(({ id, name, url, cat, cover, plays, last, added }) => ({ id, name, url, cat, cover, plays, last, added })) };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `couchport-lista_${stamp(Date.now())}.json`);
  toast('Lista exportada');
}

async function importList(f) {
  let s;
  try { s = JSON.parse(await f.text()); } catch (e) { toast('Arquivo inválido'); return; }
  const items = s.games || s.items || [];
  if (!Array.isArray(items)) { toast('Arquivo inválido'); return; }
  const cats = [...S.cats];
  for (const c of s.cats || []) if (!cats.includes(c)) cats.push(c);
  const added = [];
  await mutateGames(list => {
    const have = new Set(list.map(g => g.url));
    for (const i of items) {
      const url = normUrl(i.url);
      if (!url || have.has(url)) continue;
      have.add(url);
      const cat = i.cat || cats[0];
      if (!cats.includes(cat)) cats.push(cat);
      const g = { id: uid(), name: i.name || hostOf(url), url, cat, cover: i.cover || null, plays: i.plays || 0, last: i.last || 0, added: i.added || Date.now() };
      list.push(g);
      added.push(g);
    }
  });
  await saveCats(cats);
  added.filter(g => !g.cover).forEach(g => queueAutoCover(g.id));
  closeAll();
  toast(added.length ? `${added.length} jogo(s) importado(s) — buscando capas…` : 'Nada novo para importar', 4000);
}

function parseBookmarks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const groups = new Map();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!/^https?:/i.test(href)) return;
    let folder = '(sem pasta)';
    for (let n = a.parentElement; n; n = n.parentElement) {
      if (n.tagName === 'DL') {
        let p = n.previousElementSibling;
        while (p && p.tagName === 'P') p = p.previousElementSibling;
        if (p && p.tagName === 'H3') { folder = p.textContent.trim(); break; }
      }
    }
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ url: href, name: a.textContent.trim() || hostOf(href) });
  });
  return groups;
}

async function importBookmarks(f) {
  const groups = parseBookmarks(await f.text());
  if (!groups.size) { toast('Nenhum link encontrado nesse arquivo'); return; }
  const entries = [...groups.entries()];
  const guess = /jog|game|play|webport|port|emul|retro/i;
  const sel = entries.map(([n]) => guess.test(n));
  let cat = S.cats[0];
  closeAll();
  openPanel(p => {
    p.append(h('h2', { text: 'Importar favoritos' }), h('p', { class: 'sub', text: 'Marque as pastas com jogos e webports.' }));
    entries.forEach(([name, links], i) => {
      const chk = h('span', { class: 'chk' + (sel[i] ? ' on' : '') });
      p.append(h('button', { class: 'item', 'data-nav': '', type: 'button', onclick: () => { sel[i] = !sel[i]; chk.classList.toggle('on', sel[i]); } },
        chk, h('span', { class: 'lbl', text: name }), h('span', { class: 'note', text: `${links.length} links` })));
    });
    p.append(
      choice('Colocar em', S.cats, S.cats, cat, v => { cat = v; }),
      h('div', { class: 'navrow', style: 'margin-top:12px' },
        item('Importar', async () => {
          const added = [];
          await mutateGames(list => {
            const have = new Set(list.map(g => g.url));
            entries.forEach(([, links], i) => {
              if (!sel[i]) return;
              for (const l of links) {
                const url = normUrl(l.url);
                if (!url || have.has(url)) continue;
                have.add(url);
                const g = { id: uid(), name: l.name, url, cat, cover: null, plays: 0, last: 0, added: Date.now() };
                list.push(g); added.push(g);
              }
            });
          });
          added.forEach(g => queueAutoCover(g.id));
          closeAll();
          toast(added.length ? `${added.length} jogo(s) importado(s) — buscando capas…` : 'Nada novo para importar', 4000);
        }, { cls: 'pri' }),
        item('Cancelar', () => closePanel())));
  });
}

/* =========================================================
   Pacote inicial (extension/starter-pack.json)
   ========================================================= */
async function loadStarter() {
  try { return await (await fetch(chrome.runtime.getURL('starter-pack.json'))).json(); } catch (e) { return []; }
}
async function addStarter() {
  const pack = await loadStarter();
  const added = [];
  await mutateGames(list => {
    const have = new Set(list.map(g => g.url));
    for (const it of pack) {
      const url = normUrl(it.url);
      if (!url || have.has(url)) continue;
      have.add(url);
      const cat = it.cat || S.cats[0];
      const g = { id: uid(), name: it.name, url, cat, cover: null, plays: 0, last: 0, added: Date.now(), platform: it.platform || platformFromName(it.name) || null };
      list.push(g); added.push(g);
    }
  });
  const cats = [...S.cats];
  for (const g of added) if (!cats.includes(g.cat)) cats.push(g.cat);
  if (cats.length !== S.cats.length) await saveCats(cats);
  added.forEach(g => queueAutoCover(g.id));
  return added.length;
}
async function welcomePanel() {
  const pack = await loadStarter();
  openPanel(p => {
    p.append(h('h2', { text: 'Bem-vindo ao Couchport' }),
      h('p', { class: 'sub', text: 'Sua biblioteca está vazia. Como você quer começar?' }));
    if (pack.length) p.append(item(`Adicionar pacote inicial (${pack.length} jogos)`, async () => {
      const n = await addStarter(); closeAll(); toast(`${n} jogos adicionados — buscando capas…`, 4000);
    }, { cls: 'pri', note: pack.slice(0, 3).map(x => x.name.split(/[:—(]/)[0].trim()).join(', ') + '…' }));
    p.append(
      item('Importar de um catálogo', () => { closeAll(); catalogsPanel(); }, { note: 'centenas de webports' }),
      item('Adicionar um jogo', () => { closeAll(); editGame(null); }),
      item('Abrir o menu', () => { closeAll(); mainMenu(); }));
  });
}

/* =========================================================
   Catálogos de jogos (tabelas Markdown, coluna "Play")
   ========================================================= */
async function loadCatalogs() {
  let presets = [];
  try { presets = await (await fetch(chrome.runtime.getURL('catalogs.json'))).json(); } catch (e) {}
  const { catalogs: custom = [] } = await local.get('catalogs');
  return { presets, custom };
}

async function catalogsPanel() {
  const { presets, custom } = await loadCatalogs();
  let newUrl = '';
  const addCustom = async () => {
    const u = normUrl(newUrl);
    if (!u) { sfx('err'); toast('Link inválido'); return; }
    const { catalogs: list = [] } = await local.get('catalogs');
    if (!list.some(c => c.url === u)) list.push({ name: hostOf(u) + new URL(u).pathname.replace(/\/$/, ''), url: u });
    await local.set({ catalogs: list });
    closePanel();
    catalogsPanel();
  };
  openPanel(p => {
    p.append(h('h2', { text: 'Catálogos de jogos' }),
      h('p', { class: 'sub', text: 'Listas em tabela Markdown (como um README do GitHub). Só a coluna de link jogável é usada, e a lista é baixada na hora, sempre atualizada.' }));
    for (const c of presets) p.append(item(c.name, () => openCatalog(c), { note: c.note ? 'sugerido' : hostOf(c.url) }));
    for (const c of custom) {
      p.append(h('div', { class: 'navrow' },
        item(c.name, () => openCatalog(c), { note: hostOf(c.url) }),
        item('Remover', async () => {
          const { catalogs: list = [] } = await local.get('catalogs');
          await local.set({ catalogs: list.filter(x => x.url !== c.url) });
          closePanel(); catalogsPanel();
        }, { cls: 'danger' })));
    }
    p.append(h('div', { class: 'sec', text: 'Adicionar catálogo' }),
      field('Link do repositório ou do arquivo .md', '', { placeholder: 'https://github.com/usuario/repositorio', onInput: v => { newUrl = v; }, onEnter: addCustom }),
      item('Adicionar', addCustom));
  });
}

async function openCatalog(cat) {
  toast('Baixando catálogo…', 8000);
  let items;
  try { items = await fetchCatalog(cat.url); }
  catch (e) { sfx('err'); toast('Não consegui ler o catálogo: ' + (e.message || e), 5000); return; }
  toast(`${items.length} jogos com link jogável`);
  catalogImportPanel(cat, items);
}

function catalogImportPanel(cat, items) {
  const have = new Set(S.games.map(g => g.url));
  const norm = items.map(it => ({ ...it, url: normUrl(it.url) })).filter(it => it.url);
  const fresh = norm.filter(it => !have.has(it.url));
  const sel = new Set();
  let query = '';
  let catName = S.cats.includes('Webports') ? 'Webports' : S.cats[0];
  let listBox, importBtn, countEl;

  const visibleItems = () => {
    const q = query.trim().toLowerCase();
    return norm.filter(it => !q || it.name.toLowerCase().includes(q) || hostOf(it.url).includes(q));
  };
  const updateCount = () => {
    importBtn.querySelector('.lbl').textContent = sel.size ? `Importar ${sel.size} jogo${sel.size > 1 ? 's' : ''}` : 'Importar';
    countEl.textContent = `${norm.length} jogos · ${norm.length - fresh.length} já na biblioteca · ${sel.size} marcados`;
  };
  const drawList = () => {
    const keep = navEl();
    listBox.replaceChildren();
    const vis = visibleItems();
    for (const it of vis.slice(0, 600)) {
      const inLib = have.has(it.url);
      const chk = h('span', { class: 'chk' + (sel.has(it.url) || inLib ? ' on' : '') });
      const b = h('button', {
        class: 'item', type: 'button', 'data-nav': inLib ? false : '',
        style: inLib ? 'opacity:.45' : false,
        onclick: () => {
          if (inLib) return;
          if (sel.has(it.url)) sel.delete(it.url); else sel.add(it.url);
          chk.classList.toggle('on', sel.has(it.url));
          updateCount();
        },
      }, chk, h('span', { class: 'lbl', text: it.name }), h('span', { class: 'note', text: inLib ? 'na biblioteca' : hostOf(it.url) }));
      listBox.append(b);
    }
    if (!vis.length) listBox.append(h('p', { class: 'sub', text: 'Nada encontrado.' }));
    refreshNav(keep && keep.isConnected ? keep : null);
  };

  openPanel(p => {
    countEl = h('p', { class: 'sub' });
    importBtn = item('Importar', async () => {
      if (!sel.size) { sfx('err'); toast('Marque pelo menos um jogo'); return; }
      const pick = norm.filter(it => sel.has(it.url));
      const added = [];
      await mutateGames(list => {
        const urls = new Set(list.map(g => g.url));
        for (const it of pick) {
          if (urls.has(it.url)) continue;
          urls.add(it.url);
          const g = { id: uid(), name: it.name, url: it.url, cat: catName, cover: null, plays: 0, last: 0, added: Date.now(), source: cat.url, platform: platformFromName(it.name) };
          list.push(g); added.push(g);
        }
      });
      added.forEach(g => queueAutoCover(g.id));
      closeAll();
      toast(`${added.length} jogo(s) importado(s) — buscando capas aos poucos`, 4500);
    }, { cls: 'pri' });
    listBox = h('div', {});
    p.append(
      h('h2', { text: cat.name }),
      countEl,
      cat.note ? h('p', { class: 'sub warnTxt', text: cat.note }) : null,
      field('Filtrar', '', { placeholder: 'Nome ou site…', onInput: v => { query = v; drawList(); } }),
      h('div', { class: 'navrow' },
        item('Marcar visíveis', () => { visibleItems().forEach(it => { if (!have.has(it.url)) sel.add(it.url); }); drawList(); updateCount(); }),
        item('Desmarcar todos', () => { sel.clear(); drawList(); updateCount(); }),
        importBtn),
      choice('Colocar em', S.cats, S.cats, catName, v => { catName = v; }),
      h('div', { class: 'sec', text: 'Jogos' }),
      h('p', { class: 'sub' }, glyph('lb'), ' ', glyph('rb'), ' pulam 10 itens'),
      listBox);
    drawList();
    updateCount();
  }, { wide: true });
}

/* =========================================================
   Entrada: teclado e controle
   ========================================================= */
function setMode(m) {
  if (inputMode === m) return;
  inputMode = m;
  document.body.classList.toggle('kb-hide-cursor', m === 'pad');
  // redesenha glifos
  if (OV.stack.length) updateHints(); else { updateHero(currentGame()); updateHints(); }
}

function fire(a, src) {
  setMode(src);
  if (OV.stack.length) panelAction(a); else if (LIB.open) libAction(a); else homeAction(a);
}

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b',
  e: 'x', E: 'x', s: 'y', S: 'y', m: 'start', M: 'start', '/': 'select', q: 'lb', Q: 'lb', r: 'rb', R: 'rb',
};
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  const typing = t && t.tagName === 'INPUT';
  if (typing) {
    let a = null;
    if (e.key === 'Escape') { e.preventDefault(); t.blur(); setMode('kb'); updateHints(); return; }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) a = 'down';
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) a = 'up';
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (t._onEnter) t._onEnter(); else fire('down', 'kb');
      return;
    }
    if (a) { e.preventDefault(); fire(a, 'kb'); }
    return;
  }
  const a = KEYMAP[e.key];
  if (!a) return;
  e.preventDefault();
  fire(a, 'kb');
});

const DIRS = new Set(['up', 'down', 'left', 'right']);
const PAD = { prev: {}, rep: {}, hadFocus: false, quietUntil: 0 };
function readPads() {
  const cur = {};
  let pads = [];
  try { pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; } catch (e) {}
  for (const p of pads) {
    const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
    const ax = p.axes || [];
    cur.a = cur.a || b(0); cur.b = cur.b || b(1); cur.x = cur.x || b(2); cur.y = cur.y || b(3);
    cur.lb = cur.lb || b(4); cur.rb = cur.rb || b(5); cur.select = cur.select || b(8); cur.start = cur.start || b(9);
    cur.up = cur.up || b(12) || ax[1] < -0.55;
    cur.down = cur.down || b(13) || ax[1] > 0.55;
    cur.left = cur.left || b(14) || ax[0] < -0.55;
    cur.right = cur.right || b(15) || ax[0] > 0.55;
  }
  return cur;
}
function pollPads(now) {
  const focused = document.hasFocus() && !document.hidden;
  if (focused) {
    const cur = readPads();
    if (!PAD.hadFocus) {
      // acabou de voltar do jogo: ignora botões que ainda estão apertados
      PAD.prev = cur; PAD.quietUntil = now + 350;
    } else if (now >= PAD.quietUntil) {
      for (const k of ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'lb', 'rb', 'select', 'start']) {
        const on = !!cur[k], was = !!PAD.prev[k];
        if (on && !was) { fire(k, 'pad'); PAD.rep[k] = now + 380; }
        else if (on && was && DIRS.has(k) && now >= PAD.rep[k]) { fire(k, 'pad'); PAD.rep[k] = now + 85; }
      }
      PAD.prev = cur;
    } else PAD.prev = cur;
  }
  PAD.hadFocus = focused;
  requestAnimationFrame(pollPads);
}

function updatePadChip() {
  let pads = [];
  try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (e) {}
  const chip = $('#pad');
  chip.querySelector('.dot').className = 'dot' + (pads.length ? ' ok' : '');
  chip.querySelector('span').textContent = pads.length ? pads[0].id.replace(/\s*\(.*$/, '').slice(0, 32) || 'Controle' : 'Sem controle';
}
window.addEventListener('gamepadconnected', () => { updatePadChip(); toast('Controle conectado 🎮'); setMode('pad'); });
window.addEventListener('gamepaddisconnected', updatePadChip);
document.addEventListener('mousemove', () => { lastMouseMove = Date.now(); document.body.classList.remove('kb-hide-cursor'); });
window.addEventListener('resize', () => { applyHomeFocus(); if (LIB.open) applyLibFocus(); });
let wheelT = 0;
window.addEventListener('wheel', e => {
  if (OV.stack.length || Math.abs(e.deltaY) < 4) return;
  if (LIB.open) { const now2 = Date.now(); if (now2 - wheelT < 120) return; wheelT = now2; libAction(e.deltaY > 0 ? 'down' : 'up'); return; }
  const now = Date.now();
  if (now - wheelT < 220) return;
  wheelT = now;
  fire(e.deltaY > 0 ? 'down' : 'up', 'kb');
}, { passive: true });

/* =========================================================
   GPU, relógio, início
   ========================================================= */
async function checkGpu() {
  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
  } catch (e) {}
  let gpu = '';
  try {
    if (navigator.gpu) {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (a && a.info) gpu = [a.info.vendor, a.info.architecture, a.info.description].filter(Boolean).join(' ');
    }
  } catch (e) {}
  const all = `${renderer} ${gpu}`;
  let cls, label;
  if (/nvidia|geforce|gtx|rtx/i.test(all)) { cls = 'ok'; label = 'eGPU NVIDIA'; }
  else if (!renderer || /llvmpipe|swiftshader|software|softpipe/i.test(all)) { cls = 'bad'; label = 'CPU (sem GPU)'; }
  else { cls = 'warn'; label = 'GPU integrada'; }
  const chip = $('#gpu');
  chip.querySelector('.dot').className = 'dot ' + cls;
  chip.querySelector('span').textContent = label;
  chip.title = renderer.replace(/^ANGLE \(|\)$/g, '') || 'WebGL indisponível';
}

function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

(async function init() {
  await loadAll();
  renderHome();
  updatePadChip();
  tick(); setInterval(tick, 10000);
  setInterval(() => { if (!OV.stack.length) updateHero(currentGame()); }, 60000);
  checkGpu();
  send({ t: 'hubReady' });
  requestAnimationFrame(pollPads);
  if (!S.games.length) welcomePanel();
})();

// Exposto para testes no console
window.__GH = { S, NAV, OV, LIB, fire, findCovers, queueAutoCover };
