// Página especial usada só para restaurar saves: https://site/__couchport_restore__?id=...
// Para o carregamento do site antes de qualquer script dele rodar,
// assim o jogo não segura o banco de dados aberto.
(() => {
  try { window.stop(); } catch (e) {}
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  const show = (txt, color) => {
    try {
      const root = document.documentElement || document.appendChild(document.createElement('html'));
      root.innerHTML = `<body style="margin:0;background:#0b0d12;color:${color || '#7cf29a'};font:600 22px system-ui;display:grid;place-items:center;height:100vh">${txt}</body>`;
    } catch (e) {}
  };
  show('Restaurando save…');
  chrome.runtime.sendMessage({ t: 'restoreFetch', id }).then(async r => {
    if (!r || !r.json) throw new Error('save não encontrado');
    await window.__GH_SER.restoreOrigin(r.json);
    show('Save restaurado ✓');
    chrome.runtime.sendMessage({ t: 'restoreDone', id, ok: true });
  }).catch(e => {
    show('Falha: ' + (e && e.message || e), '#ff6b6b');
    chrome.runtime.sendMessage({ t: 'restoreDone', id, ok: false, err: String(e && e.message || e) });
  });
})();
