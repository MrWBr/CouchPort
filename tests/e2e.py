"""Teste ponta a ponta do Couchport num Chromium/Chrome for Testing headless.

    pip install playwright
    CHROME=/caminho/do/chrome python3 tests/e2e.py

O Google Chrome "normal" ignora --load-extension; use Chromium ou Chrome for Testing.
"""
import asyncio, http.server, os, sys, tempfile, threading
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = str(ROOT / 'extension')
FIX = str(ROOT / 'tests' / 'fixtures')
ID = 'gophecbelcdemgikiigfdmihjplabpbc'
HUB = f'chrome-extension://{ID}/hub.html'
PORT = int(os.environ.get('PORT', 8123))
GAME = f'http://127.0.0.1:{PORT}/game.html'
fails = []

def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: fails.append(msg)

async def wait_js(page, expr, timeout=10000):
    # wait_for_function usa eval, que a CSP das páginas de extensão bloqueia
    for _ in range(timeout // 200):
        if await page.evaluate(expr): return True
        await page.wait_for_timeout(200)
    raise TimeoutError(expr)

def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *a, **k): super().__init__(*a, directory=FIX, **k)
        def log_message(s, *a): pass
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Q).serve_forever()

async def main():
    threading.Thread(target=serve, daemon=True).start()
    async with async_playwright() as p:
        kw = {'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {'channel': 'chromium'}
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, **kw,
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--headless=new'],
            viewport={'width': 1366, 'height': 768})
        errors = []
        if not ctx.service_workers: await ctx.wait_for_event('serviceworker', timeout=15000)
        box = open(os.path.join(FIX, 'boxart.png'), 'rb').read()
        async def fake(route):
            u = route.request.url
            if 'api.github.com/repos/libretro-thumbnails/Nintendo_-_Nintendo_64/git/trees/HEAD' in u:
                return await route.fulfill(json={'tree': [{'path': 'Named_Boxarts', 'type': 'tree', 'sha': 'box64'}]})
            if 'api.github.com/repos/libretro-thumbnails/Nintendo_-_Nintendo_64/git/trees/box64' in u:
                return await route.fulfill(json={'tree': [{'path': 'Super Mario 64 (Japan).png', 'type': 'blob'}, {'path': 'Super Mario 64 (USA).png', 'type': 'blob'}]})
            if 'api.github.com' in u: return await route.fulfill(status=404, json={})
            if 'raw.githubusercontent.com/libretro-thumbnails' in u:
                ok = 'Super%20Mario%2064%20(USA).png' in u
                return await route.fulfill(status=200 if ok else 404, body=box if ok else b'', content_type='image/png')
            if 'wikidata.org' in u and 'wbsearchentities' in u:
                return await route.fulfill(json={'search': [{'id': 'Q1'}] if 'Mario' in u else []})
            if 'wikidata.org' in u and 'ids=Q1' in u:
                return await route.fulfill(json={'entities': {'Q1': {'id': 'Q1', 'labels': {'en': {'value': 'Super Mario 64'}}, 'sitelinks': {},
                    'claims': {'P31': [{'mainsnak': {'datavalue': {'value': {'id': 'Q7889'}}}}],
                               'P400': [{'mainsnak': {'datavalue': {'value': {'id': 'Q10'}}}}, {'mainsnak': {'datavalue': {'value': {'id': 'Q11'}}}}],
                               'P577': [{'mainsnak': {'datavalue': {'value': {'time': '+1996-06-23T00:00:00Z'}}}, 'qualifiers': {'P400': [{'datavalue': {'value': {'id': 'Q10'}}}]}},
                                        {'mainsnak': {'datavalue': {'value': {'time': '+2006-11-19T00:00:00Z'}}}, 'qualifiers': {'P400': [{'datavalue': {'value': {'id': 'Q11'}}}]}}]}}}})
            if 'wikidata.org' in u and 'ids=Q10' in u:
                return await route.fulfill(json={'entities': {'Q10': {'labels': {'en': {'value': 'Nintendo 64'}}}, 'Q11': {'labels': {'en': {'value': 'Wii'}}}}})
            if 'wikipedia.org' in u: return await route.fulfill(json={'query': {'pages': {}}})
            if 'steampowered.com' in u: return await route.fulfill(json={'items': []})
            return await route.fallback()
        await ctx.route('**/*', fake)
        hub = await ctx.new_page()
        hub.on('pageerror', lambda e: errors.append(str(e)))
        await hub.goto(HUB)
        await hub.wait_for_timeout(800)

        print('Boas-vindas e adicionar jogo pelo teclado')
        txt = await hub.locator('.panel').inner_text()
        check('pacote inicial (7 jogos)' in txt, 'biblioteca vazia oferece o pacote inicial')
        await hub.keyboard.press('ArrowDown'); await hub.keyboard.press('ArrowDown')
        await hub.keyboard.press('Enter')
        await hub.wait_for_timeout(300)
        await hub.keyboard.type(GAME)
        await hub.keyboard.press('ArrowDown')
        await hub.keyboard.type('Jogo de Teste')
        await hub.locator('button.item', has_text='Buscar capa automaticamente').click()
        await wait_js(hub, "document.querySelector('#edStatus').textContent.includes('Nenhuma capa')", 15000)
        check(await hub.locator('#edCands .cand').count() == 0, 'nunca sugere a imagem do próprio site (og:image) como capa')
        await hub.locator('button.item', has_text='Salvar').first.click()
        await hub.wait_for_timeout(600)
        games = await hub.evaluate("(async()=>(await chrome.storage.local.get('games')).games)()")
        check(len(games) == 1 and not games[0]['cover'], 'jogo salvo sem capa (arte gerada)')
        gid = games[0]['id']
        check(await hub.locator('#heroTitle').inner_text() == 'Jogo de Teste', 'jogo em foco na tela principal')

        print('Abrir jogo e fazer backup')
        async with ctx.expect_page() as pi:
            await hub.keyboard.press('Enter')
        game = await pi.value
        await game.wait_for_load_state()
        await game.evaluate('writeSave(7)')
        await game.wait_for_timeout(1200)
        r = await hub.evaluate(f"chrome.runtime.sendMessage({{t:'saveNow', gameId:'{gid}'}})")
        check(any(x.get('saved') for x in r['results']), 'primeiro save gravado')
        r = await hub.evaluate(f"chrome.runtime.sendMessage({{t:'saveNow', gameId:'{gid}'}})")
        check(any(x.get('unchanged') for x in r['results']), 'save repetido é ignorado')
        await game.evaluate('writeSave(42)')
        r = await hub.evaluate(f"chrome.runtime.sendMessage({{t:'saveNow', gameId:'{gid}'}})")
        check(any(x.get('saved') for x in r['results']), 'segundo save gravado')
        saves = await hub.evaluate(f"(async()=>(await chrome.storage.local.get('saves:{gid}'))['saves:{gid}'])()")
        check(len(saves) == 2, '2 pontos de restauração')

        print('Restaurar o save antigo')
        old = min(saves, key=lambda s: s['ts'])
        r = await hub.evaluate(f"chrome.runtime.sendMessage({{t:'restore', gameId:'{gid}', saveId:'{old['id']}'}})")
        check(r.get('ok'), f'restauração concluída ({r})')
        chk = await ctx.new_page()
        await chk.goto(GAME)
        await chk.wait_for_timeout(400)
        s = await chk.evaluate('readSave()')
        check(s == {'ls': '{"level":7}', 'contents': [1, 2, 3, 7], 'isU8': True, 'ts': 1700000000000, 'blob': 'hello7'},
              f'dados restaurados idênticos (localStorage, Uint8Array, Date, Blob): {s}')

        print('Menu sem duplicar')
        dup = await ctx.new_page()
        await dup.goto(HUB)
        await hub.wait_for_timeout(1200)
        n = sum(1 for pg in ctx.pages if not pg.is_closed() and pg.url.startswith(HUB))
        check(n == 1, f'abrir o menu de novo reaproveita o existente ({n} aba)')

        print('Importar catálogo (coluna Play)')
        await hub.bring_to_front()
        await hub.evaluate("window.__GH.fire('start','kb')")
        await hub.wait_for_timeout(300)
        await hub.locator('button.item', has_text='Catálogos de jogos').click()
        await hub.wait_for_timeout(500)
        await hub.locator('.panel input').fill(f'http://127.0.0.1:{PORT}/catalog.md')
        await hub.locator('.panel input').press('Enter')
        await hub.wait_for_timeout(600)
        await hub.locator('button.item', has_text='127.0.0.1').first.click()
        await wait_js(hub, "document.querySelector('.panel h2') && document.querySelector('.panel h2').textContent.includes('127.0.0.1')", 8000)
        names = await hub.evaluate("[...document.querySelectorAll('.panel .item .lbl')].map(e=>e.textContent)")
        check(all(n in names for n in ['Alpha Port', 'Beta | Edição', 'Gamma']) and 'Sem Demo' not in names, f'só entradas com link jogável, nomes limpos: {names}')
        await hub.locator('button.item', has_text='Marcar visíveis').click()
        await hub.locator('button.item', has_text='Importar 3 jogos').click()
        await hub.wait_for_timeout(800)
        games = await hub.evaluate("(async()=>(await chrome.storage.local.get('games')).games.map(g=>g.name))()")
        check(len(games) == 4 and 'Alpha Port' in games, f'catálogo importado ({games})')

        print('Aviso de site compartilhado')
        await hub.evaluate(f"window.__GH.S.pendingFocus='{gid}'")
        await hub.evaluate("window.__GH.fire('up','kb')")
        await hub.evaluate(f"""(()=>{{ const N=window.__GH.NAV; for (let r=0;r<N.rows.length;r++){{ const c=N.rows[r].items.findIndex(g=>g.id==='{gid}'); if(c>=0){{N.row=r;N.cols[N.rows[r].key]=c;}} }} }})()""")
        await hub.evaluate("window.__GH.fire('y','kb')")
        await hub.wait_for_timeout(600)
        txt = await hub.locator('.panel').inner_text()
        check('Site compartilhado' in txt, 'aviso aparece nos saves do jogo que divide o site')
        await hub.keyboard.press('Escape')

        print('Plataforma e capa (fontes simuladas: libretro, Wikidata)')
        await hub.evaluate(f"""async () => {{
          const {{games}} = await chrome.storage.local.get('games');
          games.push({{id:'mario', name:'Super Mario 64 (PC Port)', url:'https://exemplo.net/sm64/', cat:'Webports', cover:null, plays:0, last:0, added:Date.now()}});
          games.push({{id:'sitecov', name:'Jogo Desconhecido', url:'{GAME}?x', cat:'Jogos', cover:'data:image/png;base64,iVBORw0KGgo=', coverSrc:'http://127.0.0.1:{PORT}/cover.png', plays:0, last:0, added:Date.now()}});
          for (let i = 0; i < 18; i++) games.push({{id:'f'+i, name:'Fila '+String(i).padStart(2,'0'), url:'https://exemplo.org/f'+i, cat:'Jogos', cover:null, plays:0, last:0, added:Date.now(), enrichV:2, platform:'pc'}});
          await chrome.storage.local.set({{games}});
        }}""")
        await hub.wait_for_timeout(500)
        await hub.evaluate("window.__GH.fire('start','kb')")
        await hub.wait_for_timeout(300)
        await hub.locator('button.item', has_text='Atualizar capas e plataformas').click()
        await wait_js(hub, "(async()=>{const g=(await chrome.storage.local.get('games')).games; const m=g.find(x=>x.id==='mario'), s=g.find(x=>x.id==='sitecov'); return m.enrichV===2 && s.enrichV===2})()", 20000)
        g = await hub.evaluate("(async()=>{const g=(await chrome.storage.local.get('games')).games; return [g.find(x=>x.id==='mario'), g.find(x=>x.id==='sitecov')].map(x=>({p:x.platform, src:x.coverSrc, a:x.coverAspect, y:x.year, has:!!x.cover}))})()")
        check(g[0]['p'] == 'n64', f"Super Mario 64 classificado como N64 pela data de lançamento ({g[0]['p']})")
        check(g[0]['src'] and 'USA' in g[0]['src'] and g[0]['a'] < 1.25, f"boxart (USA) aplicada em pé ({g[0]['src']}, aspecto {g[0]['a']})")
        check(g[0]['y'] == 1996, 'ano de lançamento vindo do Wikidata')
        check(not g[1]['has'], f"capa tirada do próprio site foi removida ({g[1]})")

        print('Fileiras limitadas e biblioteca em grade')
        await hub.evaluate("window.__GH.S.settings.groupBy='cat'")
        await hub.evaluate("chrome.storage.local.set({settings:{...window.__GH.S.settings, groupBy:'cat', sounds:false}})")
        await hub.wait_for_timeout(600)
        info = await hub.evaluate("window.__GH.NAV.rows.map(r=>[r.title, r.items.length, r.total])")
        jogos = [r for r in info if r[0] == 'Jogos'][0]
        check(jogos[1] == 12 and jogos[2] == 20, f'fileira mostra 12 de 20 + "Ver todos" ({jogos})')
        await hub.evaluate("""(()=>{const N=window.__GH.NAV; const r=N.rows.findIndex(x=>x.title==='Jogos'); N.row=r; N.cols[N.rows[r].key]=12; window.__GH.fire('up','kb'); window.__GH.fire('down','kb');})()""")
        await hub.keyboard.press('Enter')
        await hub.wait_for_timeout(600)
        lib = await hub.evaluate("({open: !document.querySelector('#library').hidden, tab: document.querySelector('.ltab.on').textContent, n: document.querySelectorAll('#libGrid .card').length})")
        check(lib['open'] and lib['tab'].startswith('Jogos') and lib['n'] == 20, f'"Ver todos" abre a grade da categoria ({lib})')
        cols = await hub.evaluate("window.__GH.LIB.cols")
        await hub.keyboard.press('ArrowDown')
        idx = await hub.evaluate("window.__GH.LIB.idx")
        check(cols > 1 and idx == cols, f'grade navega na vertical ({cols} colunas, foco no índice {idx})')
        await hub.screenshot(path='/tmp/claude-0/-home-claude/f8029e3e-74fa-52cb-a8c9-c3cb440d3262/scratchpad/lib.png')
        await hub.keyboard.press('/')
        await hub.wait_for_timeout(500)
        tabs = await hub.evaluate("[...document.querySelectorAll('.ltab')].map(t=>t.textContent)")
        check(any(t.startswith('Nintendo 64') for t in tabs), f'agrupar por plataforma mostra a aba Nintendo 64 ({tabs})')
        await hub.keyboard.press('Escape')
        await hub.wait_for_timeout(300)
        check(await hub.evaluate("document.querySelector('#library').hidden"), 'B/Esc volta da grade para a tela principal')

        print('Pacote inicial pelo menu')
        n0 = await hub.evaluate("(async()=>(await chrome.storage.local.get('games')).games.length)()")
        await hub.evaluate("window.__GH.fire('start','kb')")
        await hub.wait_for_timeout(300)
        await hub.locator('button.item', has_text='Adicionar pacote inicial').click()
        await hub.wait_for_timeout(800)
        st = await hub.evaluate("(async()=>(await chrome.storage.local.get('games')).games.filter(g=>/Crash Bash|Cyberpunk/.test(g.name)).map(g=>[g.name,g.platform]))()")
        n1 = await hub.evaluate("(async()=>(await chrome.storage.local.get('games')).games.length)()")
        check(n1 - n0 == 7 and ['Crash Bash', 'ps1'] in st, f'7 jogos do pacote inicial adicionados ({st})')

        check(not errors, f'sem erros de JavaScript no menu {errors}')
        await ctx.close()
    print('\n' + ('TUDO OK' if not fails else f'{len(fails)} FALHA(S)'))
    sys.exit(1 if fails else 0)

asyncio.run(main())
