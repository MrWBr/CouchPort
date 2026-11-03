// Exporta e restaura o armazenamento de uma origem (localStorage + IndexedDB).
// Roda como content script, então enxerga o armazenamento do próprio site.
(() => {
  if (window.__GH_SER) return;

  function b64(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const TYPED = {
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
    Float32Array, Float64Array,
    BigInt64Array: typeof BigInt64Array !== 'undefined' ? BigInt64Array : undefined,
    BigUint64Array: typeof BigUint64Array !== 'undefined' ? BigUint64Array : undefined,
  };

  // Serialização síncrona; Blobs ficam pendentes e são lidos depois
  // (ler Blob dentro do cursor deixaria a transação do IndexedDB fechar).
  function ser(v, pend) {
    const t = typeof v;
    if (v === null || t === 'string' || t === 'boolean') return v;
    if (t === 'number') return Number.isFinite(v) ? v : { __gh: 'num', v: String(v) };
    if (t === 'undefined') return { __gh: 'undef' };
    if (t === 'bigint') return { __gh: 'big', v: v.toString() };
    if (t !== 'object') return null;
    if (v instanceof Date) return { __gh: 'date', v: v.getTime() };
    if (v instanceof ArrayBuffer) return { __gh: 'ab', b: b64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) {
      return { __gh: 'ta', c: v instanceof DataView ? 'DataView' : v.constructor.name,
        b: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (v instanceof Blob) {
      const ph = { __gh: v instanceof File ? 'file' : 'blob', t: v.type, n: v.name || '', lm: v.lastModified || 0, b: null, _sz: v.size };
      pend.push([ph, v]);
      return ph;
    }
    if (v instanceof Map) return { __gh: 'map', v: ser([...v.entries()], pend) };
    if (v instanceof Set) return { __gh: 'set', v: ser([...v], pend) };
    if (v instanceof RegExp) return { __gh: 're', s: v.source, f: v.flags };
    if (Array.isArray(v)) {
      const o = new Array(v.length);
      for (let i = 0; i < v.length; i++) o[i] = ser(v[i], pend);
      return o;
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = ser(v[k], pend);
    if ('__gh' in o) return { __gh: 'obj', v: o };
    return o;
  }

  function deser(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deser);
    if (typeof v.__gh === 'string') {
      switch (v.__gh) {
        case 'num': return Number(v.v);
        case 'undef': return undefined;
        case 'big': return BigInt(v.v);
        case 'date': return new Date(v.v);
        case 'ab': return unb64(v.b).buffer;
        case 'ta': {
          const u = unb64(v.b);
          if (v.c === 'DataView') return new DataView(u.buffer);
          const C = TYPED[v.c] || Uint8Array;
          return new C(u.buffer, 0, u.byteLength / (C.BYTES_PER_ELEMENT || 1));
        }
        case 'blob': return new Blob([unb64(v.b)], { type: v.t });
        case 'file': return new File([unb64(v.b)], v.n, { type: v.t, lastModified: v.lm });
        case 'map': return new Map(deser(v.v));
        case 'set': return new Set(deser(v.v));
        case 're': return new RegExp(v.s, v.f);
        case 'obj': {
          const o = {};
          for (const k of Object.keys(v.v)) o[k] = deser(v.v[k]);
          return o;
        }
      }
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = deser(v[k]);
    return o;
  }

  function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  function openExisting(name) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('bloqueado'));
    });
  }
  function approxSize(obj) {
    let extra = 0;
    const s = JSON.stringify(obj, (k, v) => {
      if (v && typeof v === 'object' && v._sz !== undefined && v.b === null) extra += Math.ceil(v._sz * 1.37);
      return v;
    });
    return s.length + extra;
  }

  function dumpStore(db, name, budget) {
    return new Promise((res, rej) => {
      let tx;
      try { tx = db.transaction(name, 'readonly'); } catch (e) { rej(e); return; }
      const st = tx.objectStore(name);
      const meta = {
        name, keyPath: st.keyPath, autoIncrement: st.autoIncrement,
        indexes: [...st.indexNames].map(n => {
          const ix = st.index(n);
          return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
        }),
      };
      const recs = [];
      const pend = [];
      let size = 0;
      const cur = st.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { res({ meta, recs, pend, size, over: false }); return; }
        const rec = [ser(c.primaryKey, pend), ser(c.value, pend)];
        size += approxSize(rec);
        if (size > budget) {
          try { tx.abort(); } catch (e) {}
          res({ meta, recs: [], pend: [], size: 0, over: true });
          return;
        }
        recs.push(rec);
        c.continue();
      };
      cur.onerror = () => rej(cur.error);
    });
  }

  async function dumpOrigin(max) {
    max = max || 48e6;
    const out = { v: 1, kind: 'couchport-save', origin: location.origin, ls: {}, idb: [], skipped: [] };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out.ls[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    let used = JSON.stringify(out.ls).length;
    let list = [];
    try { list = indexedDB.databases ? await indexedDB.databases() : []; } catch (e) {}
    const pend = [];
    for (const info of list) {
      if (!info.name) continue;
      let db;
      try { db = await openExisting(info.name); }
      catch (e) { out.skipped.push(info.name + ' (não abriu)'); continue; }
      const d = { name: info.name, version: db.version, stores: [] };
      for (const sn of [...db.objectStoreNames]) {
        try {
          const r = await dumpStore(db, sn, max - used);
          if (r.over) {
            out.skipped.push(`${info.name}/${sn} (muito grande)`);
            d.stores.push({ ...r.meta, recs: [], skipped: true });
            continue;
          }
          used += r.size;
          pend.push(...r.pend);
          d.stores.push({ ...r.meta, recs: r.recs });
        } catch (e) {
          out.skipped.push(`${info.name}/${sn} (erro)`);
          d.stores.push({ name: sn, keyPath: null, autoIncrement: false, indexes: [], recs: [], skipped: true });
        }
      }
      db.close();
      out.idb.push(d);
    }
    for (const [ph, blob] of pend) {
      ph.b = b64(new Uint8Array(await blob.arrayBuffer()));
      delete ph._sz;
    }
    const empty = !Object.keys(out.ls).length && !out.idb.some(d => d.stores.some(s => s.recs.length));
    return { empty, json: empty ? null : JSON.stringify(out), skipped: out.skipped };
  }

  async function restoreOrigin(json) {
    const s = typeof json === 'string' ? JSON.parse(json) : json;
    if (!s || !/^(couchport|gamehub)-save$/.test(s.kind)) throw new Error('arquivo de save inválido');
    if (s.origin !== location.origin) throw new Error(`este save é de ${s.origin}`);

    localStorage.clear();
    for (const k of Object.keys(s.ls || {})) localStorage.setItem(k, s.ls[k]);

    let existing = [];
    try { existing = indexedDB.databases ? await indexedDB.databases() : []; } catch (e) {}
    for (const d of s.idb || []) {
      let db = null;
      if (existing.some(e => e.name === d.name)) {
        db = await openExisting(d.name);
        const compatible = db.version === d.version && d.stores.every(st => db.objectStoreNames.contains(st.name));
        if (!compatible) {
          db.close();
          await req(indexedDB.deleteDatabase(d.name));
          db = null;
        }
      }
      if (!db) {
        db = await new Promise((res, rej) => {
          const r = indexedDB.open(d.name, d.version || 1);
          r.onupgradeneeded = () => {
            const idb = r.result;
            for (const st of d.stores) {
              if (idb.objectStoreNames.contains(st.name)) continue;
              const opts = { autoIncrement: !!st.autoIncrement };
              if (st.keyPath !== null && st.keyPath !== undefined) opts.keyPath = st.keyPath;
              const os = idb.createObjectStore(st.name, opts);
              for (const ix of st.indexes || []) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
            }
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error('banco em uso — feche o jogo e tente de novo'));
        });
      }
      for (const st of d.stores) {
        if (st.skipped) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction(st.name, 'readwrite');
          const os = tx.objectStore(st.name);
          os.clear();
          for (const [k, v] of st.recs) {
            const val = deser(v);
            if (os.keyPath !== null) os.put(val); else os.put(val, deser(k));
          }
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error || new Error('transação abortada'));
        });
      }
      db.close();
    }
    return true;
  }

  window.__GH_SER = { dumpOrigin, restoreOrigin, ser, deser };
})();
