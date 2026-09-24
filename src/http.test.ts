import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErroreHttp, creaClientHttp } from './http.ts';

type Risposte = Record<string, Array<() => Response>>;

/** Un `fetch` finto che serve, per ogni URL, le risposte date in ordine e registra le chiamate. */
function finto(risposte: Risposte) {
  const eventi: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    eventi.push(`GET ${url}`);
    const prossima = risposte[url]?.shift();
    if (!prossima) throw new TypeError('fetch failed');
    return prossima();
  }) as typeof globalThis.fetch;
  const dormi = async (ms: number) => {
    eventi.push(`attesa ${ms}`);
  };
  return { eventi, http: creaClientHttp({ fetch, dormi, intervallo: 100, attesaBase: 1000, tentativi: 3 }) };
}

const json = (dati: unknown, stato = 200, tipo = 'application/json; charset=UTF-8') =>
  () => new Response(JSON.stringify(dati), { status: stato, headers: { 'content-type': tipo } });
const html = (stato = 200) => () => new Response('<html>Too many requests</html>', { status: stato, headers: { 'content-type': 'text/html' } });

test('json decodifica la risposta e ne restituisce le intestazioni', async () => {
  const { http } = finto({ 'https://a.it/x': [json({ ok: 1 })] });
  const { dati, intestazioni } = await http.json('https://a.it/x');
  assert.deepEqual(dati, { ok: 1 });
  assert.equal(intestazioni.get('content-type'), 'application/json; charset=UTF-8');
});

test('riprova con attesa crescente dopo 429, 5xx, errori di rete e HTML al posto di JSON', async () => {
  const { http, eventi } = finto({ 'https://a.it/x': [html(429), html(200), json([1])] });
  assert.deepEqual((await http.json('https://a.it/x')).dati, [1]);
  assert.deepEqual(eventi, [
    'GET https://a.it/x',
    'attesa 1000',
    'attesa 100',
    'GET https://a.it/x',
    'attesa 2000',
    'attesa 100',
    'GET https://a.it/x',
  ]);

  const { http: http2 } = finto({ 'https://a.it/y': [html(503)] });
  await assert.rejects(http2.json('https://a.it/y'), (e: ErroreHttp) => e instanceof ErroreHttp && e.stato === null);
});

test('si arrende dopo i tentativi previsti e non riprova sugli altri 4xx', async () => {
  const { http, eventi } = finto({ 'https://a.it/x': [html(500), html(500), html(500)], 'https://a.it/n': [json({}, 404)] });
  await assert.rejects(http.json('https://a.it/x'), (e: ErroreHttp) => e.stato === 500);
  assert.equal(eventi.filter((e) => e.startsWith('GET')).length, 3);

  await assert.rejects(http.json('https://a.it/n'), (e: ErroreHttp) => e.stato === 404);
  assert.equal(eventi.filter((e) => e === 'GET https://a.it/n').length, 1);
});

test('una richiesta alla volta per host, con una pausa tra le richieste; host diversi non si aspettano', async () => {
  const eventi: string[] = [];
  const sblocchi: Array<() => void> = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    eventi.push(`inizio ${url}`);
    await new Promise<void>((risolvi) => sblocchi.push(risolvi));
    eventi.push(`fine ${url}`);
    return json({ url })();
  }) as typeof globalThis.fetch;
  const http = creaClientHttp({ fetch, intervallo: 5, dormi: async (ms) => void eventi.push(`attesa ${ms}`) });

  const tutte = Promise.all([http.json('https://a.it/1'), http.json('https://a.it/2'), http.json('https://b.it/1')]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(eventi, ['inizio https://a.it/1', 'inizio https://b.it/1']);
  while (sblocchi.length > 0 || eventi.filter((e) => e.startsWith('fine')).length < 3) {
    sblocchi.shift()?.();
    await new Promise((r) => setImmediate(r));
  }
  await tutte;
  const a = eventi.filter((e) => e.includes('a.it') || e.startsWith('attesa'));
  assert.deepEqual(a, ['inizio https://a.it/1', 'fine https://a.it/1', 'attesa 5', 'inizio https://a.it/2', 'fine https://a.it/2']);
});

test('scarica accetta solo i content-type indicati', async () => {
  const pdf = () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-type': 'application/pdf' } });
  const { http } = finto({ 'https://a.it/d.pdf': [pdf], 'https://a.it/e.pdf': [html(), html(), html()] });
  const { corpo } = await http.scarica('https://a.it/d.pdf', ['application/pdf']);
  assert.deepEqual([...corpo], [37, 80, 68, 70]);
  await assert.rejects(http.scarica('https://a.it/e.pdf', ['application/pdf']), /Content-type inatteso "text\/html"/);
});
