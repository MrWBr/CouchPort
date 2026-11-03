// Leitura de catálogos de jogos em tabelas Markdown (README do GitHub e afins).
// Usa só a coluna de link jogável ("Play", "Demo", "Jogar"…).

const NAME_COL = /\b(game|jogo|name|nome|title|t[ií]tulo)\b/i;
const PLAY_COL = /\b(play|demo|jogar|link|url|online)\b/i;

// github.com/dono/repo            -> raw .../HEAD/README.md
// github.com/dono/repo/blob/x/y.md -> raw .../x/y.md
export function catalogRawUrl(u) {
  let x;
  try { x = new URL(u.trim()); } catch (e) { return null; }
  if (x.hostname === 'github.com') {
    const p = x.pathname.split('/').filter(Boolean);
    if (p.length === 2) return `https://raw.githubusercontent.com/${p[0]}/${p[1]}/HEAD/README.md`;
    if (p.length > 4 && p[2] === 'blob') return `https://raw.githubusercontent.com/${p[0]}/${p[1]}/${p.slice(3).join('/')}`;
  }
  return x.href;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.trim());
}
function firstLink(cell) {
  const m = cell.match(/\]\((https?:\/\/[^)\s]+)\)/) || cell.match(/href="(https?:\/\/[^"]+)"/) || cell.match(/(https?:\/\/[^\s|)]+)/);
  return m ? m[1] : null;
}
export function cleanName(cell) {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\\\|/g, '|')
    .replace(/[⭐★\u{1F31F}\u{1F3AE}▶️\u{1F4E6}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCatalog(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  const seen = new Set();
  let cols = null, ni = -1, pi = -1, section = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#{1,6}\s/.test(l)) {
      section = cleanName(l.replace(/^#+\s*/, '').replace(/<sub>.*?<\/sub>/g, '').replace(/·.*$/, ''));
      cols = null;
      continue;
    }
    if (!l.startsWith('|')) { cols = null; continue; }
    const cells = splitRow(l);
    if (!cols) {
      const next = (lines[i + 1] || '').trim();
      if (/^\|?\s*:?-{3,}/.test(next)) {
        cols = cells;
        ni = cols.findIndex(c => NAME_COL.test(c));
        pi = cols.findIndex(c => PLAY_COL.test(c));
        i++;
      }
      continue;
    }
    if (pi < 0) continue;
    const url = firstLink(cells[pi] || '');
    if (!url) continue;
    const name = cleanName(cells[ni >= 0 ? ni : 0] || '');
    if (!name || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url, section });
  }
  return out;
}

export async function fetchCatalog(url) {
  const raw = catalogRawUrl(url);
  if (!raw) throw new Error('link inválido');
  const r = await fetch(raw, { credentials: 'omit', cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o catálogo`);
  const items = parseCatalog(await r.text());
  if (!items.length) throw new Error('nenhuma tabela com coluna de link jogável encontrada');
  return items;
}
