// L'invio dei Riepiloghi per chi ne vuole uno per Provincia: su PGlite, con un Mittente finto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { caricaConfigurazione } from '../config.ts';
import { schema, type Db } from '../db/index.ts';
import { creaDbDiTest } from '../db/test-db.ts';
import { aggiungiDestinatario } from '../destinatari.ts';
import { FakeMittente, type Messaggio } from '../mittente.ts';
import { NESSUN_AVVISO } from '../stato-fonti.ts';
import { preparaSoloAvvisi } from './avvisi.ts';
import { inviaRiepiloghi } from './invia.ts';

const configurazione = caricaConfigurazione();
const nomiFonti = new Map([['usp-bari-post', 'USP Bari']]);
const preparazione = (adesso: string) => ({ configurazione, nomiFonti, fontiLette: ['USP Bari'], avvisi: NESSUN_AVVISO, adesso: new Date(adesso) });

async function dbDiTest(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  return db;
}

async function destinatario(db: Db, email: string, separaProvince: boolean) {
  const d = await aggiungiDestinatario(db, configurazione, {
    email,
    preferenze: { classi: ['A011'], gruppi: [], province: ['BA', 'BR'] },
    separaProvince,
  });
  await db.update(schema.destinatario).set({ creatoIl: new Date('2026-09-20T08:00:00Z') }).where(eq(schema.destinatario.id, d.id));
  return d;
}

let prossimaChiave = 1;
/** Un Interpello docente A011 salvato con una Pubblicazione del 23/09. */
async function interpello(db: Db, provincia: string | null): Promise<number> {
  const chiave = String(prossimaChiave++);
  const [p] = await db
    .insert(schema.pubblicazione)
    .values({
      fonte: 'usp-bari-post',
      chiave,
      url: `https://www.uspbari.it/usp/${chiave}/`,
      intestazione: `Interpello A011 ${chiave}`,
      pubblicataIl: new Date('2026-09-23T08:00:00Z'),
      documenti: [],
    })
    .returning();
  const [i] = await db
    .insert(schema.interpello)
    .values({ tipo: 'interpello', personale: 'docente', classi: ['A011'], scuola: `Scuola ${chiave}`, provincia, provinciaDa: provincia ? 'sigla' : null })
    .returning();
  await db.insert(schema.pubblicazioneInterpello).values({ pubblicazioneId: p!.id, interpelloId: i!.id });
  return i!.id;
}

/** Rifiuta i Riepiloghi il cui oggetto comincia così, come farebbe un server SMTP. */
class MittenteCheRifiuta extends FakeMittente {
  rifiutaOggetto: string | null = null;
  override async invia(messaggio: Messaggio): Promise<void> {
    if (this.rifiutaOggetto && messaggio.oggetto.startsWith(this.rifiutaOggetto)) throw new Error('451 riprova più tardi');
    await super.invia(messaggio);
  }
}

test('con --separa-province un Riepilogo per Provincia allo stesso indirizzo; gli altri ne ricevono uno solo', async (t) => {
  const db = await dbDiTest(t);
  const separa = await destinatario(db, 'separa@example.org', true);
  const unico = await destinatario(db, 'unico@example.org', false);
  const ba = await interpello(db, 'BA');
  const br = await interpello(db, 'BR');
  const senzaProvincia = await interpello(db, null);
  await interpello(db, 'LE');
  const mittente = new FakeMittente();

  const esito = await inviaRiepiloghi(db, mittente, preparazione('2026-09-24T04:40:00Z'));
  assert.deepEqual(esito.falliti, []);
  assert.deepEqual(
    mittente.inviati.map((m) => [m.a, m.oggetto]),
    [
      ['separa@example.org', 'Interpelli BA: 2 nuovi (A011) · 24 set 2026'],
      ['separa@example.org', 'Interpelli BR: 2 nuovi (A011) · 24 set 2026'],
      ['unico@example.org', 'Interpelli: 3 nuovi (A011) · 24 set 2026'],
    ],
  );
  const [perBa, perBr] = mittente.inviati;
  // Quello senza Provincia sta in entrambi, tra i Da verificare; gli altri solo nel loro.
  assert.match(perBa!.testo, /Scuola 1 — provincia di BA/);
  assert.doesNotMatch(perBa!.testo, /Scuola 2/);
  assert.match(perBr!.testo, /Scuola 2 — provincia di BR/);
  assert.doesNotMatch(perBr!.testo, /Scuola 1/);
  for (const m of [perBa!, perBr!]) assert.match(m.testo, /── Da verificare ─+\n\n• Scuola 3\n  A011 · scadenza non indicata\n  ⚠ provincia non specificata/);

  const riepiloghi = await db.select().from(schema.riepilogo).orderBy(schema.riepilogo.id);
  assert.deepEqual(
    riepiloghi.map((r) => [r.destinatarioId, r.giorno, r.provincia]),
    [
      [separa.id, '2026-09-24', 'BA'],
      [separa.id, '2026-09-24', 'BR'],
      [unico.id, '2026-09-24', null],
    ],
  );
  // Ogni Interpello una volta per Destinatario; quello senza Provincia col primo Riepilogo che lo conteneva.
  const invii = await db.select().from(schema.invio).where(eq(schema.invio.destinatarioId, separa.id));
  assert.deepEqual(
    invii.map((i) => [i.interpelloId, i.riepilogoId]).sort((a, b) => a[0]! - b[0]!),
    [
      [ba, riepiloghi[0]!.id],
      [br, riepiloghi[1]!.id],
      [senzaProvincia, riepiloghi[0]!.id],
    ],
  );

  // Il job di riserva lo stesso giorno, con un Interpello nuovo: nessun Riepilogo in più.
  await interpello(db, 'BR');
  const riserva = await inviaRiepiloghi(db, mittente, preparazione('2026-09-24T06:10:00Z'));
  assert.deepEqual([riserva.inviati, riserva.falliti, riserva.giaServiti], [[], [], 2]);
  assert.equal(mittente.inviati.length, 3);
});

test('una Provincia senza nulla di nuovo non riceve nulla', async (t) => {
  const db = await dbDiTest(t);
  await destinatario(db, 'separa@example.org', true);
  await interpello(db, 'BR');
  const mittente = new FakeMittente();
  await inviaRiepiloghi(db, mittente, preparazione('2026-09-24T04:40:00Z'));
  assert.deepEqual(mittente.inviati.map((m) => m.oggetto), ['Interpelli BR: 1 nuovo (A011) · 24 set 2026']);
});

test('un Riepilogo di Provincia rifiutato si ritenta da solo; quello senza Provincia già inviato non si ripete', async (t) => {
  const db = await dbDiTest(t);
  const separa = await destinatario(db, 'separa@example.org', true);
  const ba = await interpello(db, 'BA');
  const br = await interpello(db, 'BR');
  const senzaProvincia = await interpello(db, null);
  const mittente = new MittenteCheRifiuta();
  mittente.rifiutaOggetto = 'Interpelli BR';

  const primo = await inviaRiepiloghi(db, mittente, preparazione('2026-09-24T04:40:00Z'));
  assert.deepEqual(primo.inviati.map((p) => p.provincia), ['BA']);
  assert.deepEqual(primo.falliti.map((f) => f.pronto.provincia), ['BR']);
  assert.deepEqual((await db.select().from(schema.riepilogo)).map((r) => r.provincia), ['BA']);
  assert.deepEqual((await db.select().from(schema.invio)).map((i) => i.interpelloId).sort(), [ba, senzaProvincia].sort());
  // Chi ha un Riepilogo oggi, anche solo per una Provincia, non riceve l'email di solo Avviso.
  const avvisi = { avvisi: [{ fonte: 'usp-bari-post', genere: 'errore' as const, testo: 'USP Bari non consultabile da oggi.' }], daAnnunciare: true };
  assert.deepEqual(await preparaSoloAvvisi(db, { ...preparazione('2026-09-24T04:40:00Z'), avvisi }, new Set()), []);

  // Il job di riserva: parte solo BR, senza l'Interpello senza Provincia, già ricevuto con BA.
  mittente.rifiutaOggetto = null;
  const riserva = await inviaRiepiloghi(db, mittente, preparazione('2026-09-24T06:10:00Z'));
  assert.deepEqual([riserva.inviati.map((p) => p.provincia), riserva.falliti, riserva.giaServiti], [['BR'], [], 0]);
  assert.equal(mittente.inviati.length, 2);
  assert.equal(mittente.inviati[1]!.oggetto, 'Interpelli BR: 1 nuovo (A011) · 24 set 2026');
  assert.doesNotMatch(mittente.inviati[1]!.testo, /Da verificare/);
  const invii = await db.select().from(schema.invio).where(eq(schema.invio.destinatarioId, separa.id));
  assert.deepEqual(invii.map((i) => i.interpelloId).sort(), [ba, br, senzaProvincia].sort());
});

test('il primo Riepilogo è per Destinatario: chi ha già avuto quello di una Provincia non ha un «primo» per le altre', async (t) => {
  const db = await dbDiTest(t);
  const gia = await destinatario(db, 'gia@example.org', true);
  const nuovo = await destinatario(db, 'nuovo@example.org', true);
  await db.insert(schema.riepilogo).values({ destinatarioId: gia.id, giorno: '2026-09-23', provincia: 'BA', inviatoIl: new Date('2026-09-23T04:40:00Z') });
  // Un Interpello di Brindisi pubblicato ben prima che fossero aggiunti, ancora aperto.
  const aperto = await interpello(db, 'BR');
  await db.update(schema.interpello).set({ scadenza: new Date('2026-09-30T10:00:00Z') }).where(eq(schema.interpello.id, aperto));
  await db.update(schema.pubblicazione).set({ pubblicataIl: new Date('2026-09-01T08:00:00Z') });
  const mittente = new FakeMittente();

  await inviaRiepiloghi(db, mittente, preparazione('2026-09-24T04:40:00Z'));
  assert.deepEqual(mittente.inviati.map((m) => [m.a, m.oggetto]), [['nuovo@example.org', 'Interpelli BR: 1 nuovo (A011) · 24 set 2026']]);
  assert.deepEqual((await db.select().from(schema.invio)).map((i) => [i.destinatarioId, i.interpelloId]), [[nuovo.id, aperto]]);
});
