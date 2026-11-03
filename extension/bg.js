// Service worker do Couchport: janelas dos jogos, voltar ao menu, saves e capas.
import { DEFAULT_SETTINGS, uid, slug, hostOf, textToB64, sha1, stamp, urlToCover } from './lib.js';

const HUB = chrome.runtime.getURL('hub.html');
const SAVE_MAX = 48e6; // limite por origem num snapshot

// ---------- armazenamento ----------
const get = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
const set = o => chrome.storage.local.set(o);
const settings = async () => ({ ...DEFAULT_SETTINGS, ...(await get('settings', {})) });
const games = () => get('games', []);
const sget = async (k, d) => (await chrome.storage.session.get(k))[k] ?? d;
const sset = o => chrome.storage.session.set(o);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let lock = Promise.resolve();
function locked(fn) {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}
function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'tempo esgotado')), ms))]);
}

const running = () => sget('running', {});
const setRunning = r => sset({ running: r });

function updateGame(id, fn) {
  return locked(async () => {
    const list = await games();
    const g = list.find(x => x.id === id);
    if (!g) return null;
    fn(g);
    await set({ games: list });
    return g;
  });
}

// ---------- hub ----------
async function findHubTab() {
  const id = await sget('hubTab', null);
  if (id !== null) {
    try {
      const t = await chrome.tabs.get(id);
      if (t && (t.url || t.pendingUrl || '').match(/hub\.html|chrome:\/\/newtab/)) return t;
    } catch (e) {}
  }
  const tabs = await chrome.tabs.query({});
  return tabs.find(t => (t.url || t.pendingUrl || '').startsWith(HUB)) || null;
}

async function focusHub() {
  const st = await settings();
  const state = st.hubFullscreen ? 'fullscreen' : 'maximized';
  const t = await findHubTab();
  if (t) {
    await chrome.tabs.update(t.id, { active: true });
    try { await chrome.windows.update(t.windowId, { focused: true, state }); }
    catch (e) { await chrome.windows.update(t.windowId, { focused: true }); }
    return t;
  }
  const w = await chrome.windows.create({ url: HUB, focused: true, state });
  await sset({ hubTab: w.tabs[0].id });
  return w.tabs[0];
}

// ---------- jogos ----------
async function play(id) {
  const g = (await games()).find(x => x.id === id);
  if (!g) return { ok: false, err: 'jogo não encontrado' };
  const st = await settings();
  const state = st.gameFullscreen ? 'fullscreen' : 'maximized';
  const run = await running();
  if (run[id]) {
    try {
      await chrome.windows.update(run[id].windowId, { focused: true, state });
      return { ok: true, resumed: true };
    } catch (e) {
      delete run[id];
      await setRunning(run);
    }
  }
  const w = await chrome.windows.create({ url: g.url, focused: true, state });
  run[id] = { windowId: w.id, tabId: w.tabs[0].id, frames: {}, started: Date.now(), lastAuto: Date.now(), hinted: false };
  await setRunning(run);
  await updateGame(id, x => { x.plays = (x.plays || 0) + 1; x.last = Date.now(); });
  return { ok: true };
}

async function closeGame(id, save = true) {
  const run = await running();
  if (!run[id]) return { ok: true };
  if (save) await snapGame(id, 'ao fechar');
  try { await chrome.windows.remove(run[id].windowId); } catch (e) {}
  const r2 = await running();
  delete r2[id];
  await setRunning(r2);
  return { ok: true };
}

let backBusy = false;
async function backToHub(tabId) {
  if (backBusy) return;
  backBusy = true;
  try {
    const run = await running();
    const id = Object.keys(run).find(k => run[k].tabId === tabId);
    if (!id) {
      // já está no menu: atalho volta para o último jogo aberto
      const hub = await findHubTab();
      if (hub && hub.id === tabId) {
        const last = Object.entries(run).sort((a, b) => (b[1].started || 0) - (a[1].started || 0))[0];
        if (last) await play(last[0]);
        return;
      }
      await focusHub();
      return;
    }
    await chrome.tabs.sendMessage(tabId, { t: 'toast', text: 'Salvando e voltando ao menu…', ms: 2500 }, { frameId: 0 }).catch(() => {});
    await snapGame(id, 'menu');
    await focusHub();
    const win = run[id].windowId;
    try { await chrome.windows.update(win, { state: 'minimized' }); }
    catch (e) {
      try { await chrome.windows.update(win, { state: 'normal' }); await chrome.windows.update(win, { state: 'minimized' }); } catch (e2) {}
    }
  } finally {
    setTimeout(() => { backBusy = false; }, 1500);
  }
}

chrome.windows.onRemoved.addListener(async winId => {
  const run = await running();
  let changed = false;
  for (const k of Object.keys(run)) if (run[k].windowId === winId) { delete run[k]; changed = true; }
  if (changed) await setRunning(run);
  const pc = await sget('pendingCover', null);
  if (pc && pc.windowId === winId) await clearPendingCover();
});

// ---------- saves ----------
async function snapGame(id, reason) {
  const run = await running();
  const r = run[id];
  if (!r) return { ok: false, err: 'o jogo não está aberto' };
  const byOrigin = {};
  for (const [fid, origin] of Object.entries(r.frames || {})) {
    if (!(origin in byOrigin) || +fid < byOrigin[origin]) byOrigin[origin] = +fid;
  }
  const results = [];
  const gone = [];
  for (const [origin, frameId] of Object.entries(byOrigin)) {
    try {
      const res = await withTimeout(chrome.tabs.sendMessage(r.tabId, { t: 'snap', max: SAVE_MAX }, { frameId }), 30000, 'o jogo não respondeu');
      if (!res || !res.ok) { results.push({ origin, err: res && res.err || 'sem resposta' }); continue; }
      if (res.empty) { results.push({ origin, empty: true }); continue; }
      results.push({ origin, ...(await storeSave(id, res.origin, res.json, reason, res.skipped)) });
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/Receiving end|establish connection|No frame/i.test(msg)) gone.push(frameId);
      else results.push({ origin, err: msg });
    }
  }
  const r2 = await running();
  if (r2[id]) {
    r2[id].lastAuto = Date.now();
    for (const f of gone) delete r2[id].frames[f];
    await setRunning(r2);
  }
  await set({ ['lastSnap:' + id]: { ts: Date.now(), reason, results } });
  return { ok: true, results };
}

async function mirrorToDisk(g, origin, ts, json) {
  try {
    try { await chrome.downloads.setUiOptions({ enabled: false }); } catch (e) {}
    const host = hostOf(origin).replace(/[^\w.-]+/g, '_');
    const dl = await chrome.downloads.download({
      url: 'data:application/json;base64,' + textToB64(json),
      filename: `Couchport/Saves/${slug(g && g.name)}/${host}/${stamp(ts)}.json`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    setTimeout(() => { chrome.downloads.setUiOptions({ enabled: true }).catch(() => {}); }, 5000);
    return dl;
  } catch (e) {
    chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
    return null;
  }
}

async function dropSave(rec) {
  await chrome.storage.local.remove('snap:' + rec.id);
  if (rec.dl) {
    try { await chrome.downloads.removeFile(rec.dl); } catch (e) {}
    try { await chrome.downloads.erase({ id: rec.dl }); } catch (e) {}
  }
}

function storeSave(gameId, origin, json, reason, skipped) {
  return locked(async () => {
    const key = 'saves:' + gameId;
    const list = await get(key, []);
    const hash = await sha1(json);
    const prev = list.filter(s => s.origin === origin).sort((a, b) => b.ts - a.ts)[0];
    if (prev && prev.hash === hash) return { unchanged: true };
    const st = await settings();
    const g = (await games()).find(x => x.id === gameId);
    const ts = Date.now();
    const rec = { id: uid(), origin, ts, size: json.length, hash, reason, skipped: skipped || [] };
    await set({ ['snap:' + rec.id]: json });
    if (st.diskMirror) rec.dl = await mirrorToDisk(g, origin, ts, json);
    list.push(rec);
    const mine = list.filter(s => s.origin === origin).sort((a, b) => b.ts - a.ts);
    const drop = mine.slice(Math.max(1, st.keepSaves));
    for (const d of drop) await dropSave(d);
    await set({ [key]: list.filter(s => !drop.includes(s)) });
    return { saved: true, id: rec.id };
  });
}

function deleteSave(gameId, saveId) {
  return locked(async () => {
    const key = 'saves:' + gameId;
    const list = await get(key, []);
    const rec = list.find(s => s.id === saveId);
    if (rec) await dropSave(rec);
    await set({ [key]: list.filter(s => s.id !== saveId) });
    return { ok: true };
  });
}

async function deleteGame(gameId) {
  await closeGame(gameId, false);
  const saves = await get('saves:' + gameId, []);
  await chrome.storage.local.remove([...saves.map(s => 'snap:' + s.id), 'saves:' + gameId, 'lastSnap:' + gameId]);
  // As cópias em Downloads/Couchport ficam no disco de propósito.
  await locked(async () => set({ games: (await games()).filter(g => g.id !== gameId) }));
  return { ok: true };
}

const pendingRestores = {};
async function restore(gameId, saveId) {
  const rec = (await get('saves:' + gameId, [])).find(s => s.id === saveId);
  if (!rec) return { ok: false, err: 'save não encontrado' };
  // Fecha este jogo e qualquer outro aberto que use o mesmo site (com backup antes),
  // senão o banco fica preso ou o jogo aberto sobrescreve a restauração.
  const run = await running();
  const all = await games();
  const sameSite = id => {
    const r = run[id];
    if (r && Object.values(r.frames || {}).includes(rec.origin)) return true;
    const g = all.find(x => x.id === id);
    try { return !!g && new URL(g.url).origin === rec.origin; } catch (e) { return false; }
  };
  const toClose = Object.keys(run).filter(id => id === gameId || sameSite(id));
  for (const id of toClose) {
    await snapGame(id, 'antes de restaurar');
    await closeGame(id, false);
  }
  if (toClose.length) await sleep(800);
  const hub = await findHubTab();
  const tab = await chrome.tabs.create({
    url: rec.origin + '/__couchport_restore__?id=' + encodeURIComponent(saveId),
    active: false,
    ...(hub ? { windowId: hub.windowId } : {}),
  });
  return new Promise(res => {
    const timer = setTimeout(() => done({ ok: false, err: 'o site não abriu a página de restauração (redirecionou ou bloqueou)' }), 25000);
    function done(r) {
      clearTimeout(timer);
      delete pendingRestores[saveId];
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), r.ok ? 600 : 2500);
      res(r);
    }
    pendingRestores[saveId] = done;
  });
}

// ---------- capas ----------
async function setupMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'gh-cover', title: 'Usar como capa no Couchport', contexts: ['image'], visible: false });
}
async function clearPendingCover() {
  await chrome.storage.session.remove('pendingCover');
  chrome.contextMenus.update('gh-cover', { visible: false }).catch(() => {});
}
async function googleCover(gameId) {
  const g = (await games()).find(x => x.id === gameId);
  if (!g) return { ok: false };
  const q = encodeURIComponent(`${g.name} capa jogo`);
  const w = await chrome.windows.create({ url: `https://www.google.com/search?tbm=isch&q=${q}`, focused: true, state: 'maximized' });
  await sset({ pendingCover: { gameId, name: g.name, windowId: w.id } });
  await chrome.contextMenus.update('gh-cover', { visible: true, title: `Usar como capa de "${g.name}"` }).catch(() => {});
  setTimeout(() => {
    chrome.tabs.sendMessage(w.tabs[0].id, {
      t: 'toast', ms: 9000,
      text: 'Clique numa imagem para ampliar, depois <b>botão direito → Usar como capa</b>',
    }, { frameId: 0 }).catch(() => {});
  }, 2500);
  return { ok: true };
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'gh-cover') return;
  const pc = await sget('pendingCover', null);
  if (!pc || !info.srcUrl) return;
  try {
    const c = await urlToCover(info.srcUrl);
    await updateGame(pc.gameId, g => { g.cover = c.dataUrl; g.coverSrc = info.srcUrl; g.coverManual = true; g.coverAspect = c.w && c.h ? c.w / c.h : null; });
    await clearPendingCover();
    try { await chrome.windows.remove(pc.windowId); } catch (e) {}
    await focusHub();
  } catch (e) {
    chrome.tabs.sendMessage(tab.id, { t: 'toast', text: 'Não consegui usar essa imagem. Tente abrir a imagem maior e repetir.', ms: 5000 }, { frameId: 0 }).catch(() => {});
  }
});

// ---------- mensagens ----------
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const tab = sender.tab;
  const h = async () => {
    switch (m.t) {
      case 'whoami': {
        if (!tab) return null;
        return locked(async () => {
          const run = await running();
          const id = Object.keys(run).find(k => run[k].tabId === tab.id);
          if (!id) return null;
          let origin;
          try { origin = new URL(sender.url).origin; } catch (e) { origin = sender.origin; }
          run[id].frames = run[id].frames || {};
          run[id].frames[sender.frameId] = origin;
          const hint = sender.frameId === 0 && !run[id].hinted;
          if (hint) run[id].hinted = true;
          await setRunning(run);
          return { gameId: id, hint };
        });
      }
      case 'back': return backToHub(tab && tab.id);
      case 'hubReady': {
        if (!tab) return null;
        // Já existe um hub aberto? Vai para ele e fecha a cópia.
        if ((sender.url || '').startsWith(HUB)) {
          const all = await chrome.tabs.query({});
          const other = all.find(t => t.id !== tab.id && (t.url || '').startsWith(HUB));
          if (other) {
            await sset({ hubTab: other.id });
            await focusHub();
            chrome.tabs.remove(tab.id).catch(() => {});
            return { ok: true, dup: true };
          }
        }
        await sset({ hubTab: tab.id });
        const st = await settings();
        const w = await chrome.windows.get(tab.windowId, { populate: true });
        if (st.hubFullscreen && w.tabs.length === 1 && w.state !== 'fullscreen') {
          await chrome.windows.update(tab.windowId, { state: 'fullscreen' }).catch(() => {});
        }
        return { ok: true };
      }
      case 'setHubFullscreen': {
        if (tab) await chrome.windows.update(tab.windowId, { state: m.on ? 'fullscreen' : 'maximized' }).catch(() => {});
        return { ok: true };
      }
      case 'play': return play(m.gameId);
      case 'closeGame': return closeGame(m.gameId, true);
      case 'saveNow': return snapGame(m.gameId, 'manual');
      case 'restore': return restore(m.gameId, m.saveId);
      case 'deleteSave': return deleteSave(m.gameId, m.saveId);
      case 'deleteGame': return deleteGame(m.gameId);
      case 'importSave': {
        let s;
        try { s = JSON.parse(m.json); } catch (e) { return { ok: false, err: 'JSON inválido' }; }
        if (!s || !/^(couchport|gamehub)-save$/.test(s.kind) || !s.origin) return { ok: false, err: 'não é um save do Couchport' };
        return { ok: true, ...(await storeSave(m.gameId, s.origin, m.json, 'importado', s.skipped)) };
      }
      case 'googleCover': return googleCover(m.gameId);
      case 'restoreFetch': return { json: await get('snap:' + m.id, null) };
      case 'restoreDone': {
        const f = pendingRestores[m.id];
        if (f) f({ ok: !!m.ok, err: m.err });
        return { ok: true };
      }
    }
    return null;
  };
  h().then(reply, e => reply({ ok: false, err: String(e && e.message || e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'back-to-hub') return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) backToHub(tab.id);
});

chrome.action.onClicked.addListener(() => focusHub());

// ---------- backup automático ----------
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'autosave') return;
  const st = await settings();
  if (!st.autosaveMin) return;
  const run = await running();
  for (const [id, r] of Object.entries(run)) {
    if (Date.now() - (r.lastAuto || 0) >= st.autosaveMin * 60000 - 5000) await snapGame(id, 'automático');
  }
});

async function init() {
  await setupMenus();
  if (!(await chrome.alarms.get('autosave'))) chrome.alarms.create('autosave', { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
