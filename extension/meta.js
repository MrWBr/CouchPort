// Metadados de jogos: plataforma de origem e capas de fontes de jogos
// (nunca a imagem ou o ícone do site onde o jogo está hospedado).

export const PLATFORMS = [
  // id, rótulo, rótulo curto, repositório do libretro-thumbnails, regex do nome no Wikidata, regex de etiqueta no título
  { id: 'arcade', label: 'Arcade', short: 'ARC', wd: /\barcade\b/i, tag: /\b(arcade|mame)\b/i },
  { id: 'dos', label: 'MS-DOS', short: 'DOS', lr: 'DOS', wd: /\bDOS\b/, tag: /\b(ms-?dos|dos)\b/i },
  { id: 'nes', label: 'NES', short: 'NES', lr: 'Nintendo_-_Nintendo_Entertainment_System', wd: /^(Nintendo Entertainment System|Family Computer|Famicom)$/i, tag: /\b(nes|famicom)\b/i },
  { id: 'sms', label: 'Master System', short: 'SMS', lr: 'Sega_-_Master_System_-_Mark_III', wd: /Master System/i, tag: /\b(sms|master system)\b/i },
  { id: 'gb', label: 'Game Boy', short: 'GB', lr: 'Nintendo_-_Game_Boy', wd: /^Game Boy$/i, tag: /\b(game ?boy|gb)\b(?! ?(color|advance))/i },
  { id: 'md', label: 'Mega Drive', short: 'MD', lr: 'Sega_-_Mega_Drive_-_Genesis', wd: /(Mega Drive|Sega Genesis)/i, tag: /\b(genesis|mega ?drive|md)\b/i },
  { id: 'snes', label: 'Super Nintendo', short: 'SNES', lr: 'Nintendo_-_Super_Nintendo_Entertainment_System', wd: /(Super Nintendo|Super Famicom)/i, tag: /\b(snes|super nintendo|super famicom|sfc)\b/i },
  { id: 'ps1', label: 'PlayStation', short: 'PS1', lr: 'Sony_-_PlayStation', wd: /^PlayStation$/i, tag: /\b(ps1|psx|psone|playstation 1)\b/i },
  { id: 'saturn', label: 'Saturn', short: 'SAT', lr: 'Sega_-_Saturn', wd: /Sega Saturn/i, tag: /\b(saturn)\b/i },
  { id: 'n64', label: 'Nintendo 64', short: 'N64', lr: 'Nintendo_-_Nintendo_64', wd: /^Nintendo 64$/i, tag: /\b(n64|nintendo 64)\b/i },
  { id: 'gbc', label: 'Game Boy Color', short: 'GBC', lr: 'Nintendo_-_Game_Boy_Color', wd: /Game Boy Color/i, tag: /\b(gbc|game ?boy color)\b/i },
  { id: 'dc', label: 'Dreamcast', short: 'DC', lr: 'Sega_-_Dreamcast', wd: /Dreamcast/i, tag: /\b(dreamcast)\b/i },
  { id: 'ps2', label: 'PlayStation 2', short: 'PS2', lr: 'Sony_-_PlayStation_2', wd: /^PlayStation 2$/i, tag: /\b(ps2|playstation 2)\b/i },
  { id: 'gba', label: 'Game Boy Advance', short: 'GBA', lr: 'Nintendo_-_Game_Boy_Advance', wd: /Game Boy Advance/i, tag: /\b(gba|game ?boy advance)\b/i },
  { id: 'gc', label: 'GameCube', short: 'GC', lr: 'Nintendo_-_GameCube', wd: /GameCube/i, tag: /\b(gamecube|gcn|ngc)\b/i },
  { id: 'xbox', label: 'Xbox', short: 'XBOX', wd: /^Xbox$/i, tag: /\b(xbox)\b(?! ?(360|one|series))/i },
  { id: 'nds', label: 'Nintendo DS', short: 'NDS', lr: 'Nintendo_-_Nintendo_DS', wd: /^Nintendo DS$/i, tag: /\b(nds|nintendo ds)\b/i },
  { id: 'psp', label: 'PSP', short: 'PSP', lr: 'Sony_-_PlayStation_Portable', wd: /PlayStation Portable/i, tag: /\b(psp)\b/i },
  { id: 'x360', label: 'Xbox 360', short: '360', wd: /Xbox 360/i, tag: /\b(xbox 360|x360)\b/i },
  { id: 'wii', label: 'Wii', short: 'WII', lr: 'Nintendo_-_Wii', wd: /^Wii$/i, tag: /\b(wii)\b(?! ?u)/i },
  { id: 'ps3', label: 'PlayStation 3', short: 'PS3', wd: /^PlayStation 3$/i, tag: /\b(ps3|playstation 3)\b/i },
  { id: 'switch', label: 'Nintendo Switch', short: 'NSW', wd: /Nintendo Switch/i, tag: /\b(switch)\b/i },
  { id: 'pc', label: 'PC', short: 'PC', wd: /^(Microsoft Windows|Windows|macOS|Classic Mac OS|Linux|Mac OS X|PC|IBM PC compatible)$/i, tag: /\b(pc|windows)\b/i },
  { id: 'flash', label: 'Flash', short: 'FLASH', wd: /Flash/i, tag: /\b(flash|ruffle|swf)\b/i },
  { id: 'web', label: 'Navegador', short: 'WEB', wd: /(web browser|HTML5|browser game)/i, tag: /\b(html5)\b/i },
];
export const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));
const CONSOLE_IDS = new Set(PLATFORMS.filter(p => !['pc', 'flash', 'web', 'dos', 'arcade'].includes(p.id)).map(p => p.id));

async function fetchT(url, ms = 12000, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { credentials: 'omit', ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}
async function json(url, opts) {
  const r = await fetchT(url, 12000, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ---------- nomes ----------
// "Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)" -> "legend of zelda ocarina of time"
export function normKey(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/,\s*the\b/g, ' ').replace(/^the\s+/, '')
    .replace(/&/g, ' ').replace(/\band\b/g, ' ')
    .replace(/[’'`]/g, '')
    .replace(/\b(web ?port|port|webgl|wasm|html5|browser|online|unblocked|decomp(ilation)?|recomp(iled)?|remake|pc port|demo)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Etiqueta de plataforma no próprio nome: "Animal Crossing (GAMECUBE)", "[PS1] Crash"
export function platformFromName(name) {
  const groups = [...String(name).matchAll(/[([]([^)\]]+)[)\]]/g)].map(m => m[1]);
  for (const g of groups) {
    for (const p of PLATFORMS) {
      if (!p.tag.test(g)) continue;
      // "(PC Port)" diz para onde foi portado, não a origem; "(PSP Recomp)" diz a origem
      if (p.id === 'pc' && /\bport\b/i.test(g)) continue;
      return p.id;
    }
  }
  return null;
}

// ---------- libretro-thumbnails (boxarts nomeadas pelos dumps No-Intro/Redump) ----------
const LR_TTL = 14 * 864e5;
const lrMem = {};
function lrIndex(repo, store) {
  // promessa compartilhada: buscas simultâneas não repetem as chamadas à API do GitHub (limite 60/h)
  if (!lrMem[repo]) lrMem[repo] = lrLoad(repo, store);
  return lrMem[repo];
}
async function lrLoad(repo, store) {
  const key = 'lr:' + repo;
  const cached = (await store.get(key))[key];
  if (cached && Date.now() - cached.ts < LR_TTL) return buildIndex(cached.files);
  try {
    const root = await json(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/HEAD`);
    const box = (root.tree || []).find(t => t.path === 'Named_Boxarts' && t.type === 'tree');
    if (!box) throw new Error('sem Named_Boxarts');
    const sub = await json(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/${box.sha}`);
    const files = (sub.tree || []).filter(t => t.type === 'blob' && /\.png$/i.test(t.path)).map(t => t.path);
    await store.set({ [key]: { ts: Date.now(), files } });
    return buildIndex(files);
  } catch (e) {
    if (cached) return buildIndex(cached.files);
    return new Map(); // sem rede ou limite da API do GitHub: segue sem
  }
}
function regionRank(f) {
  if (/\(USA/.test(f)) return 0;
  if (/\(World/.test(f)) return 1;
  if (/\(Europe/.test(f)) return 2;
  if (/\(Brazil/.test(f)) return 3;
  if (/\(Japan/.test(f)) return 5;
  return 4;
}
function buildIndex(files) {
  const m = new Map();
  for (const f of files) {
    if (/\((Beta|Proto|Demo|Sample|Kiosk|Pirate|Hack)/i.test(f)) continue;
    const k = normKey(f.replace(/\.png$/i, ''));
    if (!k) continue;
    const prev = m.get(k);
    if (!prev || regionRank(f) < regionRank(prev)) m.set(k, f);
  }
  return m;
}
export const LR_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails';
function lrUrl(repo, file) {
  return `${LR_BASE}/${repo}/HEAD/Named_Boxarts/${encodeURIComponent(file)}`;
}
// Procura a boxart em todos os sistemas; devolve [{platform, url}]
export async function libretroMatches(name, store, onlyPlatform) {
  const k = normKey(name);
  if (!k) return [];
  const out = [];
  for (const p of PLATFORMS) {
    if (!p.lr || (onlyPlatform && p.id !== onlyPlatform)) continue;
    const idx = await lrIndex(p.lr, store);
    const f = idx.get(k);
    if (f) out.push({ platform: p.id, url: lrUrl(p.lr, f), label: f.replace(/\.png$/i, '') });
  }
  return out;
}

// ---------- Wikidata: plataforma em que o jogo saiu primeiro ----------
function claimIds(ent, prop) {
  return ((ent.claims || {})[prop] || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
}
function wdTime(v) {
  const m = /([+-]\d+)-(\d\d)-(\d\d)/.exec(v && v.time || '');
  return m ? Date.UTC(+m[1], Math.max(0, +m[2] - 1), Math.max(1, +m[3])) : Infinity;
}
export async function wikidataInfo(name) {
  const q = encodeURIComponent(String(name).replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim());
  const s = await json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=en&type=item&limit=6&format=json&origin=*`);
  const ids = (s.search || []).map(x => x.id);
  if (!ids.length) return null;
  const e = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=claims|sitelinks|labels&languages=en&sitefilter=enwiki|ptwiki&format=json&origin=*`);
  const want = normKey(name);
  const games = ids.map(id => e.entities[id]).filter(ent => ent && claimIds(ent, 'P31').some(x => x === 'Q7889' || x === 'Q4393107' || x === 'Q865493'));
  const ent = games.find(g => normKey((g.labels.en || {}).value) === want) || games[0];
  if (!ent) return null;
  const pids = [...new Set(claimIds(ent, 'P400'))];
  // data de lançamento por plataforma (qualificador P400 nas declarações P577)
  const firstByPlatform = {};
  for (const c of (ent.claims.P577 || [])) {
    const t = wdTime(c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value);
    for (const q2 of ((c.qualifiers || {}).P400 || [])) {
      const pid = q2.datavalue && q2.datavalue.value && q2.datavalue.value.id;
      if (pid && t < (firstByPlatform[pid] ?? Infinity)) firstByPlatform[pid] = t;
    }
  }
  let mapped = [];
  if (pids.length) {
    const pe = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${pids.slice(0, 40).join('|')}&props=labels&languages=en&format=json&origin=*`);
    for (const pid of pids) {
      const label = ((pe.entities[pid] || {}).labels || {}).en;
      if (!label) continue;
      const p = PLATFORMS.find(x => x.wd.test(label.value));
      if (p) mapped.push({ id: p.id, t: firstByPlatform[pid] ?? Infinity, order: pids.indexOf(pid) });
    }
  }
  // mais antiga com data; sem datas, a primeira listada (no Wikidata costuma ser a original)
  mapped.sort((a, b) => (a.t - b.t) || (a.order - b.order));
  const year = Math.min(...(ent.claims.P577 || []).map(c => wdTime(c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value)));
  return {
    qid: ent.id,
    platform: mapped.length ? mapped[0].id : null,
    platforms: [...new Set(mapped.map(m => m.id))],
    year: Number.isFinite(year) ? new Date(year).getUTCFullYear() : null,
    enwiki: ent.sitelinks && ent.sitelinks.enwiki && ent.sitelinks.enwiki.title,
    ptwiki: ent.sitelinks && ent.sitelinks.ptwiki && ent.sitelinks.ptwiki.title,
  };
}

// ---------- capas ----------
async function wikipediaImage(title, lang = 'en') {
  const j = await json(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=thumbnail&pithumbsize=900&titles=${encodeURIComponent(title)}`);
  const p = Object.values((j.query && j.query.pages) || {})[0];
  return p && p.thumbnail ? p.thumbnail.source : null;
}
async function wikipediaSearchImages(name) {
  const out = [];
  for (const lang of ['en', 'pt']) {
    const q = encodeURIComponent(`${name} video game`);
    const j = await json(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${q}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=900`);
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const p of pages) if (p.thumbnail) out.push({ url: p.thumbnail.source, src: 'Wikipédia', label: p.title });
    if (out.length) break;
  }
  return out;
}
async function steamImages(name) {
  const j = await json(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=portuguese&cc=BR`);
  const a = normKey(name);
  return (j.items || []).slice(0, 4).map(it => {
    const b = normKey(it.name);
    return { url: `https://cdn.akamai.steamstatic.com/steam/apps/${it.id}/header.jpg`, src: 'Steam', label: it.name,
      strong: !!a && (a === b || (a.length > 3 && (b.startsWith(a) || a.startsWith(b)))) };
  });
}
async function steamGridImages(name, key) {
  if (!key) return [];
  const H = { headers: { Authorization: 'Bearer ' + key } };
  const s = await json(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(name)}`, H);
  const game = (s.data || [])[0];
  if (!game) return [];
  const g = await json(`https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=920x430,460x215,600x900`, H);
  return (g.data || []).slice(0, 4).map(x => ({ url: x.url, src: 'SteamGridDB', label: game.name, strong: normKey(game.name) === normKey(name) }));
}

// Descobre plataforma e capas. Nada vem do site que hospeda o jogo.
export async function enrich(game, { store, steamGridKey } = {}) {
  const name = game.name;
  const out = { platform: null, year: null, covers: [] };
  const tagged = platformFromName(name);
  const [wd, lr, steam, sgdb] = await Promise.all([
    wikidataInfo(name).catch(() => undefined),
    libretroMatches(name, store).catch(() => []),
    steamImages(name).catch(() => []),
    steamGridImages(name, steamGridKey).catch(() => []),
  ]);
  // plataforma: etiqueta no nome > Wikidata > boxart encontrada num único sistema
  out.platform = tagged || (wd && wd.platform) || null;
  out.wdFailed = wd === undefined;
  // só usa a boxart para decidir a plataforma se o Wikidata respondeu (sem achar plataforma);
  // sozinha ela erra muito ("Diablo" tem boxart de PS1, mas é de PC)
  if (!out.platform && wd !== undefined && lr.length) {
    const consoles = lr.filter(x => CONSOLE_IDS.has(x.platform));
    out.platform = (consoles[0] || lr[0]).platform;
  }
  out.year = wd && wd.year;
  const box = lr.filter(x => x.platform === out.platform);
  const wiki = [];
  if (wd && wd.enwiki) { const u = await wikipediaImage(wd.enwiki).catch(() => null); if (u) wiki.push({ url: u, src: 'Wikipédia', label: wd.enwiki }); }
  if (!wiki.length) wiki.push(...await wikipediaSearchImages(name.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim()).catch(() => []));
  out.covers = [
    ...box.map(x => ({ url: x.url, src: 'Boxart ' + PLATFORM_BY_ID[x.platform].short, label: x.label })),
    ...sgdb.filter(x => x.strong), ...steam.filter(x => x.strong),
    ...wiki,
    ...sgdb.filter(x => !x.strong), ...steam.filter(x => !x.strong),
    ...lr.filter(x => x.platform !== out.platform).map(x => ({ url: x.url, src: 'Boxart ' + PLATFORM_BY_ID[x.platform].short, label: x.label })),
  ];
  const seen = new Set();
  out.covers = out.covers.filter(c => !seen.has(c.url) && seen.add(c.url));
  return out;
}
