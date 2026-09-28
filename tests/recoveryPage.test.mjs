import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/recovery.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function page(raw, config = null, readFailure = false) {
  const effects = { writes: 0, network: 0, downloads: [] };
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, disabled: false, events: {},
      addEventListener(type, handler) { this.events[type] = handler; } });
    return elements.get(id);
  }
  const values = new Map([['workboard:data', raw], ['workboard:sync', config]]);
  const forbidWrite = () => { effects.writes++; throw new Error('Unexpected storage write'); };
  const forbidNetwork = () => { effects.network++; throw new Error('Unexpected network request'); };
  class PageURL extends URL {}
  PageURL.createObjectURL = blob => { effects.downloads.push({ blob }); return 'blob:synthetic-download'; };
  PageURL.revokeObjectURL = () => {};
  const document = {
    getElementById: element,
    body: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, 'a');
      return { click() { effects.downloads.at(-1).filename = this.download; }, remove() {} };
    },
  };
  vm.runInNewContext(script, {
    document, location: { origin: 'https://test.invalid' }, URL: PageURL, Blob,
    setTimeout() {}, fetch: forbidNetwork, XMLHttpRequest: forbidNetwork, WebSocket: forbidNetwork,
    navigator: { sendBeacon: forbidNetwork },
    localStorage: {
      getItem(key) { if (readFailure) throw new Error('Storage unavailable'); return values.get(key) ?? null; },
      setItem: forbidWrite, removeItem: forbidWrite, clear: forbidWrite,
    },
  });
  return { element, effects, text: () => [...elements.values()].map(item => item.textContent).join('\n'),
    click: id => element(id).events.click() };
}

test('recovery reads counts only, never writes or contacts a server, and downloads the exact source', async () => {
  const raw = '  { "projects": [{"name":"PRIVATE_PROJECT","subs":[{"todos":[{},{}]}]}], "memos":[{}], "notes":[{}], "clients":[{"name":"PRIVATE_CLIENT"}], "resv":[{},{}], "extra":"preserved" }\n';
  const config = JSON.stringify({ mode: 'supabase', url: 'https://synthetic.supabase.co/path?private=SECRET_QUERY', key: 'SECRET_KEY', code: 'SECRET_BOARD' });
  const view = page(raw, config);
  assert.equal(view.element('projects').textContent, '1');
  assert.equal(view.element('subs').textContent, '1');
  assert.equal(view.element('todos').textContent, '3');
  assert.equal(view.element('clients').textContent, '1');
  assert.equal(view.element('resv').textContent, '2');
  assert.equal(view.element('host').textContent, 'synthetic.supabase.co');
  assert.doesNotMatch(view.text(), /PRIVATE_|SECRET_/);
  view.click('download');
  assert.equal(await view.effects.downloads[0].blob.text(), raw);
  assert.doesNotMatch(await view.effects.downloads[0].blob.text(), /SECRET_/);
  view.click('check');
  assert.equal(view.effects.writes, 0);
  assert.equal(view.effects.network, 0);
});

test('missing storage and denied reads remain distinct and cannot download a fabricated empty board', () => {
  for (const [view, title] of [[page(null), /저장된 업무 자료가 없습니다/], [page(null, null, true), /저장소를 읽을 수 없습니다/]]) {
    assert.match(view.element('status').textContent, title);
    assert.equal(view.element('download').disabled, true);
    view.click('download');
    assert.equal(view.effects.downloads.length, 0);
    assert.equal(view.effects.writes, 0);
    assert.equal(view.effects.network, 0);
  }
});

test('corrupt, unsupported, and encrypted sources remain downloadable without exposing contents', async () => {
  for (const [raw, title] of [['{ broken PRIVATE_CONTENT', /원본은 있지만/], ['{"other":"PRIVATE_CONTENT"}', /형식 확인/], ['{"enc":1,"iv":"PRIVATE_IV","ct":"PRIVATE_CONTENT"}', /잠긴 자료/]]) {
    const view = page(raw);
    assert.match(view.element('status').textContent, title);
    assert.equal(view.element('counts').hidden, true);
    assert.doesNotMatch(view.text(), /PRIVATE_/);
    view.click('download');
    assert.equal(await view.effects.downloads[0].blob.text(), raw);
    assert.equal(view.effects.writes, 0);
    assert.equal(view.effects.network, 0);
  }
});

test('unexpected child structure is not silently reported as zero', () => {
  const view = page('{"projects":[{"subs":null}],"resv":"unexpected"}');
  assert.match(view.element('status').textContent, /일부 자료/);
  assert.equal(view.element('subs').textContent, '—');
  assert.equal(view.element('todos').textContent, '—');
  assert.equal(view.element('resv').textContent, '—');
  assert.equal(view.effects.writes, 0);
});

test('recovery has no dependency requests and rejects outgoing connections through CSP', () => {
  assert.doesNotMatch(html, /<(?:script|iframe|img)\b[^>]*\bsrc\s*=/i);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src 'none'/);
  assert.doesNotMatch(script, /\.setItem\s*\(|\.removeItem\s*\(|\bfetch\s*\(|serviceWorker|innerHTML/);
});

test('service worker never substitutes the workboard for a recovery navigation', () => {
  const handlers = {};
  let responses = 0;
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL,
    self: { location: { href: 'https://test.invalid/sw.js', origin: 'https://test.invalid' }, addEventListener(type, handler) { handlers[type] = handler; } },
  });
  for (const path of ['/recovery.html', '/recovery.html?check=1']) {
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `https://test.invalid${path}` }, respondWith() { responses++; } });
  }
  assert.equal(responses, 0);
});
