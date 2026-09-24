// Composizione e resa del Riepilogo. Dopo un cambiamento voluto alla resa:
// `node --test --test-update-snapshots src/riepilogo/riepilogo.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componi, type Candidato, type Contesto, type DestinatarioDaServire } from './componi.ts';
import { escapeHtml, giornoDiRoma, rendiRiepilogo } from './rendi.ts';

const contesto: Contesto = {
  classi: new Map([
    ['A011', 'Discipline letterarie e latino'],
    ['ADMM', 'Sostegno nella scuola secondaria di I grado'],
    ['ADSS', 'Sostegno nella scuola secondaria di II grado'],
    ['A012', 'Discipline letterarie negli istituti di istruzione secondaria di II grado'],
  ]),
  gruppi: new Map([['Sostegno secondaria', ['ADMM', 'ADSS']]]),
  giorno: '2026-09-24',
  adesso: new Date('2026-09-24T04:40:00Z'),
  fontiLette: ['USP Bari', 'USP Brindisi'],
};

const destinatario: DestinatarioDaServire = {
  creatoIl: new Date('2026-09-20T10:00:00Z'),
  preferenze: { classi: ['A011'], gruppi: ['Sostegno secondaria'], province: ['BA', 'BR'] },
};

let prossimoId = 1;
function candidato(campi: Partial<Candidato> & { pubblicataIl?: string }): Candidato {
  const { pubblicataIl = '2026-09-23T08:00:00Z', ...resto } = campi;
  const id = prossimoId++;
  return {
    id,
    tipo: 'interpello',
    personale: 'docente',
    classi: ['ADMM'],
    scuola: 'I.C. Valesium',
    comune: 'Torchiarolo',
    provincia: 'BR',
    ore: null,
    finoAl: null,
    scadenza: null,
    pubblicazioni: [
      {
        fonte: 'USP Brindisi',
        url: `https://www.istruzionebrindisi.it/${id}/`,
        pubblicataIl: new Date(pubblicataIl),
        documenti: [{ url: `https://www.istruzionebrindisi.it/${id}.pdf`, etichetta: 'Interpello' }],
      },
    ],
    ...resto,
  };
}

test('i Gruppi si espandono, Personale non docente e Interpelli fuori Preferenze restano fuori', () => {
  const candidati = [
    candidato({ classi: ['ADSS'], provincia: 'BA' }),
    candidato({ personale: 'ata-dsga', classi: ['ADMM'] }),
    candidato({ classi: ['A012'] }),
    candidato({ provincia: 'LE' }),
  ];
  const contenuto = componi(destinatario, candidati, new Set(), contesto)!;
  assert.deepEqual(
    contenuto.gruppi.map((g) => [g.classe, g.voci.map((v) => v.id)]),
    [['ADSS', [candidati[0]!.id]]],
  );
  assert.deepEqual(contenuto.daVerificare, []);
});

test('niente Riepilogo quando non c\'è nulla di nuovo', () => {
  assert.equal(componi(destinatario, [candidato({ classi: ['A012'] })], new Set(), contesto), null);
});

test('gli Interpelli già inviati non tornano', () => {
  const c = candidato({});
  assert.equal(componi(destinatario, [c], new Set([c.id]), contesto), null);
});

test('entra solo ciò la cui prima Pubblicazione è al più 3 giorni prima che il Destinatario fosse aggiunto', () => {
  const alLimite = candidato({ pubblicataIl: '2026-09-17T10:00:00Z' });
  const troppoVecchio = candidato({ pubblicataIl: '2026-09-17T09:59:59Z' });
  // Una Pubblicazione recente di una notizia vecchia non la rende nuova.
  const ripubblicato = candidato({
    pubblicazioni: [
      { fonte: 'USP Bari', url: 'https://www.uspbari.it/a/', pubblicataIl: new Date('2026-09-10T08:00:00Z'), documenti: [] },
      { fonte: 'USP Brindisi', url: 'https://www.istruzionebrindisi.it/a/', pubblicataIl: new Date('2026-09-23T08:00:00Z'), documenti: [] },
    ],
  });
  const contenuto = componi(destinatario, [alLimite, troppoVecchio, ripubblicato], new Set(), contesto)!;
  assert.deepEqual(contenuto.gruppi.flatMap((g) => g.voci.map((v) => v.id)), [alLimite.id]);
});

test('Da verificare va in fondo, a parte, con ciò che manca', () => {
  const contenuto = componi(
    destinatario,
    [candidato({ provincia: null, comune: null }), candidato({ classi: [] }), candidato({ classi: [], provincia: 'LE' })],
    new Set(),
    contesto,
  )!;
  assert.deepEqual(contenuto.gruppi, []);
  assert.deepEqual(
    contenuto.daVerificare.map((v) => v.mancanti),
    [['provincia non specificata'], ['classe di concorso non specificata']],
  );
});

test('una notizia con più Classi volute compare una volta, sotto la prima; ordine per scadenza', () => {
  const senzaScadenzaVecchio = candidato({ classi: ['A011'], pubblicataIl: '2026-09-21T08:00:00Z' });
  const senzaScadenzaNuovo = candidato({ classi: ['A011'], pubblicataIl: '2026-09-22T08:00:00Z' });
  const scadenzaTardi = candidato({ classi: ['A011', 'ADMM'], scadenza: new Date('2026-09-28T10:00:00Z') });
  const scadenzaPresto = candidato({ classi: ['A012', 'A011'], scadenza: new Date('2026-09-26T10:00:00Z') });
  const sostegno = candidato({ classi: ['ADMM', 'A011'] });
  const contenuto = componi(
    destinatario,
    [senzaScadenzaNuovo, sostegno, scadenzaTardi, senzaScadenzaVecchio, scadenzaPresto],
    new Set(),
    contesto,
  )!;
  assert.deepEqual(
    contenuto.gruppi.map((g) => [g.classe, g.voci.map((v) => v.id)]),
    [
      ['A011', [scadenzaPresto.id, scadenzaTardi.id, senzaScadenzaVecchio.id, senzaScadenzaNuovo.id]],
      ['ADMM', [sostegno.id]],
    ],
  );
});

test('giornoDiRoma usa il fuso di Roma', () => {
  assert.equal(giornoDiRoma(new Date('2026-09-23T22:30:00Z')), '2026-09-24');
  assert.equal(giornoDiRoma(new Date('2026-12-31T22:59:00Z')), '2026-12-31');
});

test('escapeHtml neutralizza i caratteri speciali', () => {
  assert.equal(escapeHtml(`<a href="x">L'I.C. & co</a>`), '&lt;a href=&quot;x&quot;&gt;L&#39;I.C. &amp; co&lt;/a&gt;');
});

// ── Resa ──

function contenutoCompleto() {
  prossimoId = 100;
  const candidati: Candidato[] = [
    candidato({ ore: 9, scadenza: new Date('2026-09-26T10:00:00Z'), pubblicataIl: '2026-09-24T07:00:00Z' }),
    candidato({
      tipo: 'rettifica',
      scuola: 'Primo I.C.',
      comune: 'San Vito dei Normanni',
      pubblicataIl: '2026-09-23T07:00:00Z',
    }),
    candidato({
      classi: ['A011', 'A012'],
      scuola: 'Liceo "Salvemini" <Bari>',
      comune: 'Bari',
      provincia: 'BA',
      ore: 18,
      finoAl: '30/06/2027',
      pubblicazioni: [
        {
          fonte: 'USP Bari – Decreti',
          url: 'https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze/',
          pubblicataIl: new Date('2026-09-22T09:15:00Z'),
          documenti: [{ url: 'https://www.uspbari.it/doc.pdf?a=1&b=2', etichetta: 'Interpello' }],
        },
        {
          fonte: 'USP Bari',
          url: 'https://www.uspbari.it/usp/interpello-a011/',
          pubblicataIl: new Date('2026-09-23T10:00:00Z'),
          documenti: [],
        },
      ],
    }),
    candidato({ tipo: 'esito', scuola: null, comune: null, provincia: null, pubblicataIl: '2026-09-24T06:00:00Z' }),
    candidato({ classi: [], scuola: 'I.I.S.S. Majorana', comune: 'Brindisi', provincia: 'BR', pubblicazioni: [
      { fonte: 'USP Brindisi', url: 'javascript:alert(1)', pubblicataIl: new Date('2026-09-24T06:00:00Z'), documenti: [] },
    ] }),
  ];
  return componi(destinatario, candidati, new Set(), contesto)!;
}

test('oggetto: conteggio, Classi e data', () => {
  const resa = rendiRiepilogo(contenutoCompleto());
  assert.equal(resa.oggetto, 'Interpelli: 5 nuovi (ADMM, A011) · 24 set 2026');
  const uno = componi(destinatario, [candidato({ classi: [] })], new Set(), contesto)!;
  assert.equal(rendiRiepilogo(uno).oggetto, 'Interpelli: 1 nuovo · 24 set 2026');
});

test('resa in testo semplice', (t) => {
  t.assert.snapshot(rendiRiepilogo(contenutoCompleto()).testo, { serializers: [(s: string) => `\n${s}`] });
});

test('resa in HTML', (t) => {
  const { html } = rendiRiepilogo(contenutoCompleto());
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<Bari>/);
  assert.doesNotMatch(html, /disiscri|unsubscribe/i);
  t.assert.snapshot(html, { serializers: [(s: string) => `\n${s}`] });
});
