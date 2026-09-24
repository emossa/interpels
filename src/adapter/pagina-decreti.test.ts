import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chiaveDaImpronta, leggiDataOra, paginaDecreti, pubblicazioniDaPagina } from './pagina-decreti.ts';
import { clientRegistrato, leggiRegistrazioni } from './registrazioni.ts';

// Registrata il 24/09/2026 da uspbari.it: 1123 voci, dal 02/12/2024.
const registrazioni = leggiRegistrazioni('pagina-decreti', 'usp-bari-decreti.json');
const pagina = 'https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze';
const html = registrazioni[0]!.corpo as string;

const voce = (h2: string, data: string, link: string) =>
  `<div style="background-color: #e4e9ee;"><h2>${h2}</h2></div><p style="font-size: 10px;">${data}</p><p>${link}</p>`;
const conVoci = (...voci: string[]) =>
  `<html><body><div class="USP-postcontent"><h1>Titolo</h1>${voci.join('\n')}</div></body></html>`;

test('legge la pagina e tiene le voci pubblicate da `dal` in poi', async () => {
  const http = clientRegistrato(registrazioni);
  const dal = new Date('2026-08-25T00:00:00Z');
  const pubblicazioni = await paginaDecreti.crea({ pagina }).leggi({ dal, http });

  assert.deepEqual(http.richiesti, [pagina]);
  assert.equal(pubblicazioni.length, 122);
  assert.ok(pubblicazioni.every((p) => p.pubblicataIl >= dal && p.url === pagina && p.documenti.length > 0));
  assert.equal(new Set(pubblicazioni.map((p) => p.chiave)).size, 122);
  assert.deepEqual(pubblicazioni[0], {
    chiave: 'https://www.uspbari.it/usp/wp-content/uploads/2026/09/C6-24-09-2026.zip',
    url: pagina,
    intestazione: 'Interpello per n.7 posti di sostegno EN scuola primaria presso il plesso "La nostra famiglia " I.C. "CASALE"-Brindisi.',
    pubblicataIl: new Date('2026-09-24T10:10:00Z'),
    documenti: [
      { url: 'https://www.uspbari.it/usp/wp-content/uploads/2026/09/C6-24-09-2026.zip', etichetta: 'Interpello prot.10148 del 24-09-2026' },
    ],
  });
});

test("tutte le voci della pagina hanno data e documento; quelle ripetute tali e quali contano una volta", () => {
  const pubblicazioni = pubblicazioniDaPagina(html, pagina);
  // 1123 voci, di cui 4 ripetute identiche (stessa intestazione, data e documento).
  assert.equal(pubblicazioni.length, 1119);
  assert.equal(new Set(pubblicazioni.map((p) => p.chiave)).size, 1119);
  assert.deepEqual(pubblicazioni.at(-1)!.pubblicataIl, new Date('2024-12-02T09:56:00Z')); // ora solare: +1
  assert.ok(pubblicazioni.every((p) => p.documenti.length > 0 && p.intestazione !== ''));
  // Due voci con più documenti: la chiave è il primo.
  const multiple = pubblicazioni.filter((p) => p.documenti.length > 1);
  assert.equal(multiple.length, 2);
  assert.ok(multiple.every((p) => p.chiave === p.documenti[0]!.url));
});

test("due voci diverse con lo stesso documento: la più vecchia tiene l'URL, la più nuova prende l'impronta", () => {
  const pubblicazioni = pubblicazioniDaPagina(html, pagina);
  const zip = 'https://www.uspbari.it/usp/wp-content/uploads/2025/10/D17-20-10-25.zip';
  const stesse = pubblicazioni.filter((p) => p.documenti[0]!.url === zip);
  assert.equal(stesse.length, 2);
  const [nuova, vecchia] = stesse;
  assert.equal(vecchia!.chiave, zip);
  assert.equal(nuova!.chiave, chiaveDaImpronta(nuova!.intestazione, nuova!.pubblicataIl));
  assert.match(nuova!.intestazione, /^TOIS032003/);
});

test("una voce senza link ha per chiave l'impronta di intestazione e data", () => {
  const [p] = pubblicazioniDaPagina(conVoci(voce('Interpello A011 &#8211; Liceo "Fermi", Bari', '3 marzo 2026 ore 9:05 |', 'Documento non disponibile')), pagina);
  assert.equal(p!.intestazione, 'Interpello A011 - Liceo "Fermi", Bari');
  assert.deepEqual(p!.pubblicataIl, new Date('2026-03-03T08:05:00Z'));
  assert.deepEqual(p!.documenti, []);
  assert.equal(p!.chiave, chiaveDaImpronta(p!.intestazione, p!.pubblicataIl));
  assert.match(p!.chiave, /^impronta:[0-9a-f]{32}$/);
  // L'impronta cambia con la data di pubblicazione.
  assert.notEqual(p!.chiave, chiaveDaImpronta(p!.intestazione, new Date('2026-03-04T08:05:00Z')));
});

test('i link relativi diventano assoluti; mailto e ripetizioni sono scartati', () => {
  const [p] = pubblicazioniDaPagina(
    conVoci(
      voce(
        'Interpello ADMM',
        '1 ottobre 2026 ore 12:00|',
        '<a href="/usp/wp-content/a.pdf">Interpello <strong>prot. 1</strong><br /></a> <a href="mailto:x@example.org">scrivi</a> <a href="https://www.uspbari.it/usp/wp-content/a.pdf">di nuovo</a>',
      ),
    ),
    pagina,
  );
  assert.deepEqual(p!.documenti, [{ url: 'https://www.uspbari.it/usp/wp-content/a.pdf', etichetta: 'Interpello prot. 1' }]);
});

test("le date sono l'ora italiana, con l'ora legale", () => {
  assert.deepEqual(leggiDataOra('24 Settembre 2026 ore 10:23|'), new Date('2026-09-24T08:23:00Z'));
  assert.deepEqual(leggiDataOra('2 dicembre 2024 ore 10:56 |'), new Date('2024-12-02T09:56:00Z'));
  // Il giorno del cambio d'ora: le 03:30 del 29/03/2026 sono già ora legale.
  assert.deepEqual(leggiDataOra('29 marzo 2026 ore 03:30'), new Date('2026-03-29T01:30:00Z'));
  assert.deepEqual(leggiDataOra('7 Gennaio 2026'), new Date('2026-01-06T23:00:00Z'));
  assert.equal(leggiDataOra('Interpello prot. 12 del 3/3/2026'), null);
  assert.equal(leggiDataOra('3 brumaio 2026 ore 10:00'), null);
});

test('una pagina senza voci o una voce senza data sono errori, non letture vuote', () => {
  assert.throws(() => pubblicazioniDaPagina('<html><body><p>Manutenzione</p></body></html>', pagina), /nessuna voce trovata/);
  assert.throws(() => pubblicazioniDaPagina(conVoci(voce('Interpello A011', 'ieri', '')), pagina), /"Interpello A011" non ha una data/);
});

test('impostazioni non valide sono rifiutate alla creazione', () => {
  assert.throws(() => paginaDecreti.crea({}), /"pagina" deve essere un URL/);
  assert.throws(() => paginaDecreti.crea({ pagina: 'uspbari.it' }), /"pagina" deve essere un URL/);
});
