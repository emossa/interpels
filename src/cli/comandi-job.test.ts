import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { clientRegistrato, leggiRegistrazioni } from '../adapter/registrazioni.ts';
import { wordpress } from '../adapter/wordpress.ts';
import { caricaConfigurazione } from '../config.ts';
import { schema, type Db } from '../db/index.ts';
import { aggiungiDestinatario, disattivaDestinatario } from '../destinatari.ts';
import { creaDbDiTest } from '../db/test-db.ts';
import { caricaLuoghi } from '../estrazione/luoghi.ts';
import { caricaFonti, type Fonte } from '../fonti.ts';
import { eseguiJob, type AmbienteJob } from './comandi-job.ts';

const luoghi = caricaLuoghi();
const configurazione = caricaConfigurazione();
// Le risposte registrate da uspbari.it: la prima lettura (30 giorni) e quella incrementale.
const registrazioni = [
  ...leggiRegistrazioni('wordpress', 'usp-bari-post.json'),
  ...leggiRegistrazioni('wordpress', 'usp-bari-post-incrementale.json'),
];
const uspBariPost: Fonte = {
  id: 'usp-bari-post',
  nome: 'USP Bari',
  adapter: 'wordpress',
  lettore: wordpress.crea({ api: 'https://www.uspbari.it/usp/wp-json/wp/v2/posts', cerca: 'interpell', perPagina: 10 }),
};
const rotta: Fonte = {
  id: 'rotta',
  nome: 'Rotta',
  adapter: 'finto',
  lettore: { leggi: () => Promise.reject(new Error('sito irraggiungibile')) },
};

async function ambienteDiTest(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  const cartellaUscita = mkdtempSync(join(tmpdir(), 'interpels-out-'));
  t.after(async () => rmSync(cartellaUscita, { recursive: true, force: true }));
  const uscita: string[] = [];
  const errori: string[] = [];
  const ambiente: AmbienteJob = {
    db,
    fonti: [uspBariPost, rotta],
    http: clientRegistrato(registrazioni),
    luoghi,
    configurazione,
    cartellaUscita,
    adesso: new Date('2026-09-24T00:00:00Z'),
    scrivi: (testo) => uscita.push(testo),
    scriviErrore: (testo) => errori.push(testo),
  };
  return { db, ambiente, uscita, errori, cartellaUscita };
}

test('--solo-raccolta --fonte usp-bari-post salva Pubblicazioni e Interpelli; rieseguirlo non crea duplicati', async (t) => {
  const { db, ambiente, uscita, errori } = await ambienteDiTest(t);

  assert.equal(await eseguiJob(['--solo-raccolta', '--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(uscita, ['usp-bari-post: 20 lette, 20 nuove, 0 aggiornate']);
  assert.deepEqual(errori, []);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 20);
  const interpelli = await db.select().from(schema.interpello);
  assert.equal(interpelli.length, 20);
  assert.deepEqual(
    Object.fromEntries(['docente', 'ata-dsga', 'altro'].map((p) => [p, interpelli.filter((i) => i.personale === p).length])),
    { docente: 14, 'ata-dsga': 6, altro: 0 },
  );

  // La seconda lettura riparte da 7 giorni prima dell'ultima Pubblicazione e non duplica nulla.
  uscita.length = 0;
  assert.equal(await eseguiJob(['--solo-raccolta', '--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(uscita, ['usp-bari-post: 8 lette, 0 nuove, 0 aggiornate']);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 20);
  assert.equal((await db.select().from(schema.interpello)).length, 20);
});

test('senza --fonte legge tutte le Fonti; una che fallisce dà codice 1 ma non ferma le altre', async (t) => {
  const { db, ambiente, uscita, errori } = await ambienteDiTest(t);
  assert.equal(await eseguiJob(['--solo-raccolta'], ambiente), 1);
  assert.deepEqual(uscita, ['usp-bari-post: 20 lette, 20 nuove, 0 aggiornate']);
  assert.deepEqual(errori, ['rotta: errore: sito irraggiungibile']);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 20);
});

/** Aggiunge un Destinatario come se fosse stato aggiunto in quel momento. */
async function destinatarioAggiuntoIl(db: Db, creatoIl: string, email: string, preferenze: { classi?: string[]; gruppi?: string[]; province: string[] }) {
  const d = await aggiungiDestinatario(db, configurazione, { email, preferenze: { classi: [], gruppi: [], ...preferenze } });
  await db.update(schema.destinatario).set({ creatoIl: new Date(creatoIl) }).where(eq(schema.destinatario.id, d.id));
  return d;
}

test('--dry-run scrive HTML e testo per chi ha Interpelli nuovi, niente per gli altri, e non registra nulla', async (t) => {
  const { db, ambiente, uscita, errori, cartellaUscita } = await ambienteDiTest(t);
  // Nel registrato: sostegno primaria (ADEE) in provincia di Bari, e un avviso docente a Bari senza Classe.
  await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'primaria@example.org', { classi: ['ADEE'], province: ['BA'] });
  // Vuole il Gruppo Sostegno secondaria a Brindisi: nulla gli corrisponde (ci sono solo avvisi ATA senza Provincia).
  await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'secondaria@example.org', { classi: ['A011'], gruppi: ['Sostegno secondaria'], province: ['BR'] });
  const disattivato = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'ex@example.org', { classi: ['ADEE'], province: ['BA'] });
  await disattivaDestinatario(db, disattivato.email);

  assert.equal(await eseguiJob(['--dry-run', '--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(errori, []);

  const cartella = join(cartellaUscita, '2026-09-24');
  assert.deepEqual(readdirSync(cartella).sort(), ['primaria@example.org.html', 'primaria@example.org.txt']);
  const testo = readFileSync(join(cartella, 'primaria@example.org.txt'), 'utf8');
  const html = readFileSync(join(cartella, 'primaria@example.org.html'), 'utf8');
  assert.match(testo, /^Oggetto: Interpelli: 7 nuovi \(ADEE\) · 24 set 2026\n/);
  // Sei ADEE dal 17/09 in poi (3 giorni prima dell'aggiunta), e l'avviso senza Classe da verificare in fondo.
  assert.equal(testo.match(/^• /gm)?.length, 7);
  assert.match(testo, /── Da verificare ─+\n\n• [^\n]+\n  ⚠ classe di concorso non specificata\n/);
  assert.doesNotMatch(testo, /Palo del Colle/); // ADAA non voluta, ADEE del 16/09 troppo vecchia
  assert.match(testo, /Fonti lette: USP Bari$/m);
  assert.match(html, /^<!doctype html>/);
  assert.match(uscita.at(-1)!, /^Prova: 1 Riepilogo scritto in .*2026-09-24 \(nulla inviato né registrato\)\.$/);

  assert.deepEqual(await db.select().from(schema.riepilogo), []);
  assert.deepEqual(await db.select().from(schema.invio), []);
});

test('--dry-run senza Interpelli nuovi non scrive file', async (t) => {
  const { db, ambiente, uscita, cartellaUscita } = await ambienteDiTest(t);
  // Aggiunto molto dopo le Pubblicazioni registrate: il limite dei 3 giorni le esclude tutte.
  await destinatarioAggiuntoIl(db, '2026-10-10T08:00:00Z', 'tardi@example.org', { classi: ['ADEE'], province: ['BA'] });
  assert.equal(await eseguiJob(['--dry-run', '--fonte', 'usp-bari-post'], ambiente), 0);
  assert.equal(existsSync(join(cartellaUscita, '2026-09-24')), false);
  assert.equal(uscita.at(-1), 'Prova: nessun Riepilogo, nessun Destinatario ha Interpelli nuovi.');
});

test('una Fonte sconosciuta o un\'opzione errata sono errori di uso', async (t) => {
  const { ambiente, errori } = await ambienteDiTest(t);
  assert.equal(await eseguiJob(['--fonte', 'nessuna'], ambiente), 2);
  assert.match(errori[0]!, /Fonte sconosciuta "nessuna" \(Fonti configurate: usp-bari-post, rotta\)/);
  assert.equal(await eseguiJob(['--boh'], ambiente), 2);
  assert.match(errori[1]!, /Uso:/);
  assert.equal(await eseguiJob(['--dry-run', '--solo-raccolta'], ambiente), 2);
  assert.match(errori[2]!, /non vanno insieme/);
});

test('config/fonti.json configura le Fonti usp-bari-post (WordPress) e usp-bari-decreti (pagina Decreti)', () => {
  const fonti = Object.fromEntries(caricaFonti().map((f) => [f.id, f.adapter]));
  assert.equal(fonti['usp-bari-post'], 'wordpress');
  assert.equal(fonti['usp-bari-decreti'], 'pagina-decreti');
});

test('--solo-raccolta --fonte usp-bari-decreti, configurata solo in config/fonti.json, salva Pubblicazioni e Interpelli senza duplicati', async (t) => {
  const { db, ambiente, uscita, errori } = await ambienteDiTest(t);
  // La Fonte come la carica il job; la pagina registrata ha 122 voci negli ultimi 30 giorni.
  ambiente.fonti = caricaFonti();
  ambiente.http = clientRegistrato(leggiRegistrazioni('pagina-decreti', 'usp-bari-decreti.json'));

  assert.equal(await eseguiJob(['--solo-raccolta', '--fonte', 'usp-bari-decreti'], ambiente), 0);
  assert.deepEqual(errori, []);
  assert.deepEqual(uscita, ['usp-bari-decreti: 122 lette, 122 nuove, 0 aggiornate']);
  const pubblicazioni = await db.select().from(schema.pubblicazione);
  assert.equal(pubblicazioni.length, 122);
  assert.ok(pubblicazioni.every((p) => p.fonte === 'usp-bari-decreti'));
  const interpelli = await db.select().from(schema.interpello);
  assert.equal(interpelli.length, 122);
  // Interpelli da tutta Italia: la Provincia viene dall'intestazione, come per ogni Fonte.
  assert.ok(interpelli.some((i) => i.provincia === 'BR'));
  assert.ok(interpelli.some((i) => i.provincia === 'PZ'));

  // Rileggere la stessa pagina non crea duplicati.
  uscita.length = 0;
  assert.equal(await eseguiJob(['--solo-raccolta', '--fonte', 'usp-bari-decreti'], ambiente), 0);
  assert.match(uscita[0]!, /^usp-bari-decreti: \d+ lette, 0 nuove, 0 aggiornate$/);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 122);
  assert.equal((await db.select().from(schema.interpello)).length, 122);
});
