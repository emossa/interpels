// Composizione e resa del Riepilogo. Dopo un cambiamento voluto alla resa:
// `node --test --test-update-snapshots src/riepilogo/riepilogo.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istanteDiRoma } from '../estrazione/scadenza.ts';
import { componi, perProvincia, type Candidato, type Contesto, type DestinatarioDaServire } from './componi.ts';
import { escapeHtml, giornoDiRoma, rendiRiepilogo, rendiSoloAvvisi } from './rendi.ts';

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
  avvisi: [],
};

const destinatario: DestinatarioDaServire = {
  creatoIl: new Date('2026-09-20T10:00:00Z'),
  preferenze: { classi: ['A011'], gruppi: ['Sostegno secondaria'], province: ['BA', 'BR'] },
  // Ha già ricevuto il primo Riepilogo il giorno dopo essere stato aggiunto.
  primoRiepilogo: new Date('2026-09-21T04:40:00Z'),
};
/** Lo stesso Destinatario, al suo primo Riepilogo. */
const nuovo: DestinatarioDaServire = { ...destinatario, primoRiepilogo: null };

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

test('il primo Riepilogo porta ogni Interpello ancora aperto, pubblicato quando che sia', () => {
  // adesso: 24/09 alle 06:40 a Roma.
  const scadeDomani = candidato({ pubblicataIl: '2026-08-30T08:00:00Z', scadenza: new Date('2026-09-25T10:00:00Z') });
  const scaduto = candidato({ pubblicataIl: '2026-09-22T08:00:00Z', scadenza: new Date('2026-09-24T04:39:59Z') });
  const senzaScadenzaRecente = candidato({ pubblicataIl: '2026-09-17T04:40:00Z' });
  const senzaScadenzaVecchio = candidato({ pubblicataIl: '2026-09-17T04:39:59Z' });
  const daVerificareAperto = candidato({ provincia: null, comune: null, pubblicataIl: '2026-09-01T08:00:00Z', scadenza: new Date('2026-09-30T10:00:00Z') });
  const candidati = [scadeDomani, scaduto, senzaScadenzaRecente, senzaScadenzaVecchio, daVerificareAperto];

  const primo = componi(nuovo, candidati, new Set(), contesto)!;
  assert.deepEqual(primo.gruppi.flatMap((g) => g.voci.map((v) => v.id)), [scadeDomani.id, senzaScadenzaRecente.id]);
  assert.deepEqual(primo.daVerificare.map((v) => v.id), [daVerificareAperto.id]);
  // Già inviati: non tornano neppure nel primo.
  assert.equal(componi(nuovo, candidati, new Set([scadeDomani.id, senzaScadenzaRecente.id, daVerificareAperto.id]), contesto), null);
});

test('dopo il primo Riepilogo vale la regola di sempre, e ciò che il primo ha lasciato fuori perché chiuso resta fuori', () => {
  const primoRiepilogo = new Date('2026-09-22T04:40:00Z');
  const giaServito = { ...destinatario, creatoIl: new Date('2026-09-21T10:00:00Z'), primoRiepilogo };
  // Pubblicato dopo che è stato aggiunto (meno 3 giorni), ma scaduto prima del suo primo Riepilogo.
  const scadutoPrimaDelPrimo = candidato({ pubblicataIl: '2026-09-19T08:00:00Z', scadenza: new Date('2026-09-21T10:00:00Z') });
  // Scaduto dopo il primo Riepilogo senza essere stato inviato: si invia come prima.
  const scadutoDopo = candidato({ pubblicataIl: '2026-09-23T08:00:00Z', scadenza: new Date('2026-09-23T10:00:00Z') });
  // Aperto ma pubblicato troppo prima che il Destinatario fosse aggiunto: come prima, non entra.
  const apertoVecchio = candidato({ pubblicataIl: '2026-09-01T08:00:00Z', scadenza: new Date('2026-09-30T10:00:00Z') });
  const nuovoOggi = candidato({ pubblicataIl: '2026-09-23T09:00:00Z' });
  const contenuto = componi(giaServito, [scadutoPrimaDelPrimo, scadutoDopo, apertoVecchio, nuovoOggi], new Set(), contesto)!;
  assert.deepEqual(contenuto.gruppi.flatMap((g) => g.voci.map((v) => v.id)), [scadutoDopo.id, nuovoOggi.id]);
});

test('Da verificare va in fondo, a parte, con ciò che manca', () => {
  const contenuto = componi(
    destinatario,
    [
      candidato({ provincia: null, comune: null }),
      candidato({ classi: [] }),
      candidato({ classi: [], provincia: 'LE' }),
      candidato({ documentoNonLeggibile: true }),
    ],
    new Set(),
    contesto,
  )!;
  assert.deepEqual(contenuto.gruppi, []);
  assert.deepEqual(
    contenuto.daVerificare.map((v) => v.mancanti),
    [['provincia non specificata'], ['classe di concorso non specificata'], ['documento non leggibile']],
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

test('un Possibile duplicato entra comunque, e dice se l\'altro è già stato inviato', () => {
  const inviato = candidato({ pubblicataIl: '2026-09-22T08:00:00Z' });
  const nonInviato = candidato({ pubblicataIl: '2026-09-22T09:00:00Z' });
  const dove = (c: Candidato) => ({ id: c.id, url: c.pubblicazioni[0]!.url, fonte: 'USP Brindisi', pubblicataIl: c.pubblicazioni[0]!.pubblicataIl });
  const duplicato = candidato({ possibiliDuplicati: [dove(inviato), dove(nonInviato)] });
  const contenuto = componi(destinatario, [inviato, nonInviato, duplicato], new Set([inviato.id]), contesto)!;
  const voci = contenuto.gruppi.flatMap((g) => g.voci);
  assert.deepEqual(voci.map((v) => v.id), [nonInviato.id, duplicato.id]);
  assert.deepEqual(
    voci[1]!.possibiliDuplicati.map((d) => [d.id, d.giaInviato]),
    [
      [inviato.id, true],
      [nonInviato.id, false],
    ],
  );
  assert.deepEqual(voci[0]!.possibiliDuplicati, []);
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
      possibiliDuplicati: [
        {
          id: 999,
          url: 'https://www.uspbari.it/usp/wp-content/uploads/2026/09/C1-22-09-2026.pdf',
          fonte: 'USP Bari – Decreti',
          pubblicataIl: new Date('2026-09-22T08:00:00Z'),
        },
      ],
    }),
    candidato({
      classi: ['A011', 'A012'],
      scuola: 'Liceo "Salvemini" <Bari>',
      comune: 'Bari',
      provincia: 'BA',
      ore: 18,
      finoAl: '30/06/2027',
      // "entro il 27/09/2026", senza ora.
      scadenza: istanteDiRoma(2026, 9, 27, 23, 59, 59),
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
  // L'Interpello 999, di cui la rettifica potrebbe essere un duplicato, è già stato inviato.
  return componi(destinatario, candidati, new Set([999]), contesto)!;
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

const avvisi = [
  {
    fonte: 'usp-brindisi',
    genere: 'errore' as const,
    testo: 'USP <Brindisi> non consultabile da 2 giorni: eventuali interpelli da questa fonte arriveranno appena torna disponibile.',
  },
  { fonte: 'usp-bari-post', genere: 'ripresa' as const, testo: 'USP Bari di nuovo disponibile.' },
];

test('il riquadro degli Avvisi sta in cima al Riepilogo, una riga per Fonte', () => {
  const contenuto = componi(destinatario, [candidato({})], new Set(), { ...contesto, avvisi })!;
  const { testo, html } = rendiRiepilogo(contenuto);
  assert.ok(testo.startsWith(`⚠ ${avvisi[0]!.testo}\n✓ USP Bari di nuovo disponibile.\n\n── ADMM`));
  const riquadro = html.indexOf('background:#fff8c5');
  assert.ok(riquadro > html.indexOf('<body') && riquadro < html.indexOf('<h2'));
  assert.match(html, /⚠ USP &lt;Brindisi&gt; non consultabile/);
  // Senza problemi, nessun riquadro.
  assert.doesNotMatch(rendiRiepilogo(componi(destinatario, [candidato({})], new Set(), contesto)!).html, /fff8c5/);
});

test('email di solo Avviso', (t) => {
  const resa = rendiSoloAvvisi({ giorno: '2026-09-24', generatoIl: new Date('2026-09-24T04:40:00Z'), fontiLette: ['USP Bari'], avvisi });
  assert.equal(resa.oggetto, 'Interpelli: avviso sulle fonti · 24 set 2026');
  assert.doesNotMatch(resa.html, /<Brindisi>/);
  t.assert.snapshot(resa, { serializers: [(r: { testo: string; html: string }) => `\n${r.testo}\n${r.html}`] });
});

// ── Un Riepilogo per Provincia ──

test('perProvincia: ogni Interpello nel Riepilogo della sua Provincia, quelli senza Provincia in tutti', () => {
  const ba1 = candidato({ provincia: 'BA', comune: 'Bari' });
  const ba2 = candidato({ provincia: 'BA', comune: 'Bari' });
  const br1 = candidato({ classi: ['A011'] });
  const br2 = candidato({ classi: ['A011'] });
  const brAdmm = candidato({});
  const senzaProvincia = candidato({ provincia: null, comune: null });
  const senzaClasseBa = candidato({ classi: [], provincia: 'BA', comune: 'Bari' });
  const contenuto = componi(destinatario, [ba1, ba2, br1, br2, brAdmm, senzaProvincia, senzaClasseBa], new Set(), contesto)!;
  assert.deepEqual(contenuto.gruppi.map((g) => g.classe), ['ADMM', 'A011']);

  const riepiloghi = perProvincia(contenuto, ['BA', 'BR']);
  assert.deepEqual(
    riepiloghi.map((r) => [r.provincia, r.gruppi.map((g) => [g.classe, g.voci.map((v) => v.id)]), r.daVerificare.map((v) => v.id)]),
    [
      ['BA', [['ADMM', [ba1.id, ba2.id]]], [senzaProvincia.id, senzaClasseBa.id]],
      // I gruppi si riordinano nel Riepilogo della Provincia: qui A011 ne ha più di ADMM.
      ['BR', [['A011', [br1.id, br2.id]], ['ADMM', [brAdmm.id]]], [senzaProvincia.id]],
    ],
  );
  assert.ok(riepiloghi.every((r) => r.avvisi === contenuto.avvisi && r.giorno === contenuto.giorno));
});

test('perProvincia: una Provincia senza nulla di nuovo non ha Riepilogo, a meno di Interpelli senza Provincia', () => {
  const soloBr = componi(destinatario, [candidato({})], new Set(), contesto)!;
  assert.deepEqual(perProvincia(soloBr, ['BA', 'BR']).map((r) => r.provincia), ['BR']);
  const senzaProvincia = componi(destinatario, [candidato({ provincia: null, comune: null })], new Set(), contesto)!;
  assert.deepEqual(perProvincia(senzaProvincia, ['BA', 'BR']).map((r) => r.provincia), ['BA', 'BR']);
});

test("l'oggetto del Riepilogo di una Provincia la nomina", () => {
  const contenuto = componi(destinatario, [candidato({}), candidato({ classi: [], provincia: null, comune: null })], new Set(), contesto)!;
  const [br] = perProvincia(contenuto, ['BR']);
  const resa = rendiRiepilogo(br!);
  assert.equal(resa.oggetto, 'Interpelli BR: 2 nuovi (ADMM) · 24 set 2026');
  assert.match(resa.html, /<title>Interpelli BR: 2 nuovi/);
  assert.match(resa.testo, /── Da verificare/);
});
