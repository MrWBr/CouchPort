// Roda em todas as páginas do perfil de jogos. Só se ativa nas abas
// que o Couchport abriu como jogo.
(() => {
  if (window.__GH_CONTENT) return;
  window.__GH_CONTENT = true;
  if (location.pathname.startsWith('/__couchport_restore__')) return;

  const isTop = window.top === window;
  let gameInfo = null;

  // ---------- aviso flutuante (shadow DOM para não brigar com o CSS do site) ----------
  let toastHost = null, toastTimer = null;
  function toast(text, ms = 3500) {
    if (!isTop || !document.documentElement) return;
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:50%;bottom:36px;transform:translateX(-50%);pointer-events:none';
      const sh = toastHost.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>
        .t{font:600 16px/1.3 system-ui,Ubuntu,sans-serif;color:#e8ebf2;background:rgba(12,14,20,.92);
           border:1px solid #2b3245;border-radius:14px;padding:12px 18px;box-shadow:0 10px 40px rgba(0,0,0,.5);
           opacity:0;transform:translateY(10px);transition:.25s;white-space:nowrap}
        .t.on{opacity:1;transform:none}
        b{color:#7cf29a}
      </style><div class="t"></div>`;
      document.documentElement.appendChild(toastHost);
    }
    const el = toastHost.shadowRoot.querySelector('.t');
    el.innerHTML = text;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m.t === 'toast') { toast(m.text, m.ms); return; }
    if (m.t === 'snap') {
      if (!gameInfo) { reply({ ok: false, err: 'não é jogo' }); return; }
      window.__GH_SER.dumpOrigin(m.max)
        .then(r => reply({ ok: true, origin: location.origin, ...r }))
        .catch(e => reply({ ok: false, err: String(e && e.message || e) }));
      return true;
    }
  });

  chrome.runtime.sendMessage({ t: 'whoami' }).then(info => {
    if (!info || !info.gameId) return;
    gameInfo = info;
    startGamepadWatch();
    if (isTop && info.hint) {
      setTimeout(() => toast('Segure <b>SELECT + START</b> ou aperte <b>Ctrl+Shift+H</b> para voltar ao menu', 5000), 1500);
    }
  }).catch(() => {});

  // ---------- combo do controle para voltar ao menu ----------
  function startGamepadWatch() {
    let heldSince = 0, fired = 0;
    setInterval(() => {
      if (document.hidden) return;
      let pads = [];
      try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch (e) { return; }
      let combo = false, home = false;
      for (const p of pads) {
        if (!p || !p.connected) continue;
        const b = i => p.buttons[i] && p.buttons[i].pressed;
        if (b(8) && b(9)) combo = true;
        if (b(16)) home = true;
      }
      const now = Date.now();
      if (now - fired < 2500) return;
      if (home) { fired = now; back(); return; }
      if (combo) {
        if (!heldSince) heldSince = now;
        else if (now - heldSince > 700) { fired = now; heldSince = 0; back(); }
      } else heldSince = 0;
    }, 60);
  }
  function back() {
    toast('Salvando e voltando ao menu…', 2000);
    chrome.runtime.sendMessage({ t: 'back' }).catch(() => {});
  }
})();
