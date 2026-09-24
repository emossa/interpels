import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientRegistrato, leggiRegistrazioni } from '../adapter/registrazioni.ts';
import { wordpress } from '../adapter/wordpress.ts';
import { schema } from '../db/index.ts';
import { creaDbDiTest } from '../db/test-db.ts';
import { caricaLuoghi } from '../estrazione/luoghi.ts';
import { caricaFonti, type Fonte } from '../fonti.ts';
import { eseguiJob, type AmbienteJob } from './comandi-job.ts';

const luoghi = caricaLuoghi();
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
  const uscita: string[] = [];
  const errori: string[] = [];
  const ambiente: AmbienteJob = {
    db,
    fonti: [uspBariPost, rotta],
    http: clientRegistrato(registrazioni),
    luoghi,
    adesso: new Date('2026-09-24T00:00:00Z'),
    scrivi: (testo) => uscita.push(testo),
    scriviErrore: (testo) => errori.push(testo),
  };
  return { db, ambiente, uscita, errori };
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

test('una Fonte sconosciuta o un\'opzione errata sono errori di uso', async (t) => {
  const { ambiente, errori } = await ambienteDiTest(t);
  assert.equal(await eseguiJob(['--fonte', 'nessuna'], ambiente), 2);
  assert.match(errori[0]!, /Fonte sconosciuta "nessuna" \(Fonti configurate: usp-bari-post, rotta\)/);
  assert.equal(await eseguiJob(['--boh'], ambiente), 2);
  assert.match(errori[1]!, /Uso:/);
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
