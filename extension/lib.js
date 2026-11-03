// Utilidades compartilhadas entre o hub e o service worker.

export const DEFAULT_SETTINGS = {
  gameFullscreen: true,   // abrir jogos em tela cheia
  hubFullscreen: true,    // menu em tela cheia
  autosaveMin: 3,         // backup automático (0 = desligado)
  keepSaves: 10,          // cópias guardadas por jogo/origem
  diskMirror: true,       // copiar saves para Downloads/Couchport/Saves
  sounds: true,           // sons de navegação
  groupBy: 'platform',    // biblioteca agrupada por 'platform' ou 'cat'
  steamGridKey: '',       // chave opcional do SteamGridDB para capas
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function slug(s) {
  return String(s || 'jogo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'jogo';
}

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u); }
}

export function normUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return '';
    return x.href;
  } catch (e) { return ''; }
}

export function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export function textToB64(text) {
  return bytesToB64(new TextEncoder().encode(text));
}

export async function sha1(text) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function stamp(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Converte uma imagem (Blob) numa capa JPEG compacta, como data URL.
export async function blobToCover(blob, maxW = 960, maxH = 960) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxW / bmp.width, maxH / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const cv = new OffscreenCanvas(w, h);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, w, h);
    cx.drawImage(bmp, 0, 0, w, h);
    const out = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    return { dataUrl: 'data:image/jpeg;base64,' + bytesToB64(bytes), w, h };
  } catch (e) {
    // SVG e formatos que o createImageBitmap não lê: guarda como veio, se for pequeno.
    if (blob.size < 400 * 1024) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { dataUrl: `data:${blob.type || 'image/png'};base64,` + bytesToB64(bytes), w: 0, h: 0 };
    }
    throw e;
  }
}

export async function urlToCover(url) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  if (!/^image\//.test(blob.type) && !/^data:image/.test(url)) {
    // alguns servidores mandam octet-stream; tenta mesmo assim
  }
  return blobToCover(blob);
}
