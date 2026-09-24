import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientRegistrato, leggiRegistrazioni } from './registrazioni.ts';
import { pubblicazioneDaPost, urlPagina, wordpress } from './wordpress.ts';

// Registrate il 24/09/2026 da uspbari.it: 20 post dal 25/08/2026, 10 per pagina.
const registrazioni = leggiRegistrazioni('wordpress', 'usp-bari-post.json');
const impostazioni = { api: 'https://www.uspbari.it/usp/wp-json/wp/v2/posts', cerca: 'interpell', perPagina: 10 };
const dal = new Date('2026-08-25T00:00:00Z');

test('legge tutte le pagine dei post e ne fa Pubblicazioni grezze', async () => {
  const http = clientRegistrato(registrazioni);
  const pubblicazioni = await wordpress.crea(impostazioni).leggi({ dal, http });

  assert.deepEqual(http.richiesti, [urlPagina(impostazioni, dal, 1), urlPagina(impostazioni, dal, 2)]);
  assert.equal(pubblicazioni.length, 20);
  assert.equal(new Set(pubblicazioni.map((p) => p.chiave)).size, 20);
  assert.ok(pubblicazioni.every((p) => p.pubblicataIl >= dal && p.documenti.length > 0));
  assert.deepEqual(pubblicazioni[0], {
    chiave: '74394',
    url: 'https://www.uspbari.it/usp/interpello-per-supplenza-scuola-primaria-sostegno-adee-con-titolo-di-specializzazione-i-c-de-gasperi-pende-noicattaro.html',
    intestazione: 'Interpello per supplenza scuola primaria sostegno ADEE - con titolo di specializzazione. I.C. "De Gasperi-Pende", Noicattaro',
    pubblicataIl: new Date('2026-09-24T06:21:31Z'),
    documenti: [
      { url: 'https://www.uspbari.it/usp/wp-content/uploads/2026/09/C1-24-09-2026.pdf', etichetta: 'Interpello prot. 8494 del 24-09-2026' },
      { url: 'https://www.uspbari.it/usp/wp-content/uploads/2026/09/DICHIARAZIONE-MESSA-A-DISPOSIZIONE-INTERPELLO.doc', etichetta: 'Allegato' },
    ],
  });
});

test("l'URL chiede i post da `dal` in poi, con ricerca o categorie", () => {
  const url = new URL(urlPagina({ api: 'https://www.istruzionebrindisi.it/wp-json/wp/v2/posts', categorie: [984] }, dal, 3));
  assert.equal(url.origin + url.pathname, 'https://www.istruzionebrindisi.it/wp-json/wp/v2/posts');
  assert.equal(url.searchParams.get('categories'), '984');
  assert.equal(url.searchParams.get('search'), null);
  assert.equal(url.searchParams.get('after'), '2026-08-25T00:00:00Z');
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.searchParams.get('page'), '3');
});

test('i documenti sono i link http(s) del contenuto, senza ripetizioni', () => {
  const grezza = pubblicazioneDaPost({
    id: 1,
    date_gmt: '2026-09-01T08:00:00',
    link: 'https://x.it/p',
    title: { rendered: 'Interpello &#8211; A011' },
    content: {
      rendered:
        '<p><a href="https://x.it/a.pdf">Interpello <strong>prot. 1</strong></a> <a href="mailto:scuola@example.org">scrivi</a> ' +
        '<a class="b" href="https://x.it/a.pdf">di nuovo</a> <a href="https://x.it/b.zip?x=1&amp;y=2">Allegati</a></p>',
    },
  });
  assert.equal(grezza.intestazione, 'Interpello - A011');
  assert.deepEqual(grezza.documenti, [
    { url: 'https://x.it/a.pdf', etichetta: 'Interpello prot. 1' },
    { url: 'https://x.it/b.zip?x=1&y=2', etichetta: 'Allegati' },
  ]);
});

test('impostazioni non valide sono rifiutate alla creazione', () => {
  assert.throws(() => wordpress.crea({ api: 'uspbari.it', cerca: 'x' }), /"api" deve essere un URL/);
  assert.throws(() => wordpress.crea({ api: 'https://x.it/wp-json/wp/v2/posts' }), /serve "cerca" o "categorie"/);
  assert.throws(() => wordpress.crea({ api: 'https://x.it/wp-json/wp/v2/posts', cerca: 'x', perPagina: 500 }), /perPagina/);
});

test('una risposta che non è un elenco di post è un errore', async () => {
  const url = urlPagina(impostazioni, dal, 1);
  const http = clientRegistrato([{ url, stato: 200, intestazioni: { 'content-type': 'application/json' }, corpo: { code: 'errore' } }]);
  await assert.rejects(wordpress.crea(impostazioni).leggi({ dal, http }), /non è un elenco/);
});
