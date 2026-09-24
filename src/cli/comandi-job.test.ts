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
import { FakeMittente } from '../mittente.ts';
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
  const cartellaUscita = mkdtempSync(join(tmpdir(), 'interpellevole-out-'));
  t.after(async () => rmSync(cartellaUscita, { recursive: true, force: true }));
  const uscita: string[] = [];
  const errori: string[] = [];
  const mittente = new FakeMittente();
  const ambiente: AmbienteJob = {
    db,
    fonti: [uspBariPost, rotta],
    http: clientRegistrato(registrazioni),
    luoghi,
    configurazione,
    cartellaUscita,
    creaMittente: () => mittente,
    adesso: new Date('2026-09-24T00:00:00Z'),
    scrivi: (testo) => uscita.push(testo),
    scriviErrore: (testo) => errori.push(testo),
  };
  return { db, ambiente, uscita, errori, cartellaUscita, mittente };
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

test('--dry-run scrive una coppia di file per ogni Riepilogo di Provincia', async (t) => {
  const { db, ambiente, uscita, cartellaUscita } = await ambienteDiTest(t);
  const d = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'primaria@example.org', { classi: ['ADEE'], province: ['BA', 'BR'] });
  await db.update(schema.destinatario).set({ separaProvince: true }).where(eq(schema.destinatario.id, d.id));
  // Nel registrato ci sono solo scuole di Bari: un Interpello ADEE a Brindisi, da un'altra Fonte.
  const [p] = await db
    .insert(schema.pubblicazione)
    .values({ fonte: 'usp-brindisi', chiave: '1', url: 'https://www.istruzionebrindisi.it/1/', intestazione: 'Interpello ADEE', pubblicataIl: new Date('2026-09-23T08:00:00Z'), documenti: [] })
    .returning();
  const [i] = await db
    .insert(schema.interpello)
    .values({ tipo: 'interpello', personale: 'docente', classi: ['ADEE'], scuola: 'I.C. Brindisi', provincia: 'BR', provinciaDa: 'sigla' })
    .returning();
  await db.insert(schema.pubblicazioneInterpello).values({ pubblicazioneId: p!.id, interpelloId: i!.id });

  assert.equal(await eseguiJob(['--dry-run', '--fonte', 'usp-bari-post'], ambiente), 0);
  const cartella = join(cartellaUscita, '2026-09-24');
  assert.deepEqual(readdirSync(cartella).sort(), [
    'primaria@example.org.BA.html',
    'primaria@example.org.BA.txt',
    'primaria@example.org.BR.html',
    'primaria@example.org.BR.txt',
  ]);
  assert.match(readFileSync(join(cartella, 'primaria@example.org.BA.txt'), 'utf8'), /^Oggetto: Interpelli BA: 7 nuovi \(ADEE\) · 24 set 2026\n/);
  assert.match(readFileSync(join(cartella, 'primaria@example.org.BR.txt'), 'utf8'), /^Oggetto: Interpelli BR: 1 nuovo \(ADEE\) · 24 set 2026\n/);
  assert.match(uscita.at(-1)!, /^Prova: 2 Riepiloghi scritti in /);
  assert.deepEqual(await db.select().from(schema.riepilogo), []);
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

test('senza opzioni invia il Riepilogo e lo registra; un secondo job lo stesso giorno non invia più nulla', async (t) => {
  const { db, ambiente, uscita, errori, mittente } = await ambienteDiTest(t);
  const primaria = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'primaria@example.org', { classi: ['ADEE'], province: ['BA'] });
  // Nulla gli corrisponde: nessuna email per lui.
  await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'secondaria@example.org', { classi: ['A011'], gruppi: ['Sostegno secondaria'], province: ['BR'] });

  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(errori, []);
  assert.deepEqual(mittente.inviati.map((m) => [m.a, m.oggetto]), [['primaria@example.org', 'Interpelli: 7 nuovi (ADEE) · 24 set 2026']]);
  assert.equal(uscita.at(-1), 'Invio: 1 Riepilogo inviato.');
  const riepiloghi = await db.select().from(schema.riepilogo);
  assert.deepEqual(riepiloghi.map((r) => [r.destinatarioId, r.giorno]), [[primaria.id, '2026-09-24']]);
  const invii = await db.select().from(schema.invio);
  assert.equal(invii.length, 7);
  assert.ok(invii.every((i) => i.destinatarioId === primaria.id && i.riepilogoId === riepiloghi[0]!.id));

  // Il job di riserva, più tardi lo stesso giorno: nessun nuovo invio.
  ambiente.adesso = new Date('2026-09-24T06:10:00Z');
  uscita.length = 0;
  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.equal(mittente.inviati.length, 1);
  assert.equal(uscita.at(-1), 'Invio: 0 Riepiloghi inviati.');
  assert.equal((await db.select().from(schema.riepilogo)).length, 1);
  assert.equal((await db.select().from(schema.invio)).length, 7);
});

test('lo stesso giorno, chi ha già il Riepilogo non ne riceve un secondo anche se ci sono Interpelli nuovi', async (t) => {
  const { db, ambiente, uscita, mittente } = await ambienteDiTest(t);
  const primaria = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'primaria@example.org', { classi: ['ADEE'], province: ['BA'] });
  // Un Riepilogo di stamattina che non conteneva nulla di quanto raccolto ora.
  await db.insert(schema.riepilogo).values({ destinatarioId: primaria.id, giorno: '2026-09-24', inviatoIl: new Date('2026-09-24T04:40:00Z') });

  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(mittente.inviati, []);
  assert.equal(uscita.at(-1), 'Invio: 0 Riepiloghi inviati, 1 già inviato oggi.');
  assert.deepEqual(await db.select().from(schema.invio), []);
});

test('un invio rifiutato non registra nulla per quel Destinatario, e il job successivo ritenta solo lui', async (t) => {
  const { db, ambiente, uscita, errori, mittente } = await ambienteDiTest(t);
  const uno = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'uno@example.org', { classi: ['ADEE'], province: ['BA'] });
  const due = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'due@example.org', { classi: ['ADEE'], province: ['BA'] });
  mittente.rifiuta.add('uno@example.org');

  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 1);
  // Nei log (pubblici su GitHub Actions) il Destinatario compare per id, mai per email.
  assert.deepEqual(errori, [`  Destinatario ${uno.id}: invio fallito: 550 rifiutato: <Destinatario ${uno.id}>`]);
  assert.ok(uscita.every((riga) => !riga.includes('@')));
  assert.equal(uscita.at(-1), 'Invio: 1 Riepilogo inviato, 1 fallito (da ritentare).');
  assert.deepEqual(mittente.inviati.map((m) => m.a), ['due@example.org']);
  assert.deepEqual((await db.select().from(schema.riepilogo)).map((r) => r.destinatarioId), [due.id]);
  assert.ok((await db.select().from(schema.invio)).every((i) => i.destinatarioId === due.id));

  // Il job di riserva: SMTP ora accetta, parte solo il Riepilogo mancante.
  mittente.rifiuta.clear();
  errori.length = 0;
  ambiente.adesso = new Date('2026-09-24T06:10:00Z');
  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(errori, []);
  assert.deepEqual(mittente.inviati.map((m) => m.a), ['due@example.org', 'uno@example.org']);
  assert.equal(mittente.inviati[0]!.oggetto, mittente.inviati[1]!.oggetto);
  assert.equal(uscita.at(-1), 'Invio: 1 Riepilogo inviato.');
  assert.deepEqual((await db.select().from(schema.riepilogo)).map((r) => r.destinatarioId).sort(), [uno.id, due.id].sort());
  assert.equal((await db.select().from(schema.invio)).length, 14);
});

test('i giorni senza Interpelli nuovi non inviano nulla', async (t) => {
  const { db, ambiente, uscita, mittente } = await ambienteDiTest(t);
  await destinatarioAggiuntoIl(db, '2026-10-10T08:00:00Z', 'tardi@example.org', { classi: ['ADEE'], province: ['BA'] });
  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(mittente.inviati, []);
  assert.equal(uscita.at(-1), 'Invio: 0 Riepiloghi inviati.');
  assert.deepEqual(await db.select().from(schema.riepilogo), []);
});

test('un Interpello già in invio non si rinvia mai, neppure un altro giorno', async (t) => {
  const { db, ambiente, mittente } = await ambienteDiTest(t);
  const primaria = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'primaria@example.org', { classi: ['ADEE'], province: ['BA'] });
  assert.equal(await eseguiJob(['--solo-raccolta', '--fonte', 'usp-bari-post'], ambiente), 0);
  // Ieri gli è già stato inviato uno degli Interpelli ADEE.
  const [ieri] = await db.insert(schema.riepilogo).values({ destinatarioId: primaria.id, giorno: '2026-09-23' }).returning();
  const adee = (await db.select().from(schema.interpello)).filter((i) => i.classi.includes('ADEE') && i.provincia === 'BA');
  const giaInviato = adee[0]!;
  await db.insert(schema.invio).values({ destinatarioId: primaria.id, interpelloId: giaInviato.id, riepilogoId: ieri!.id });

  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.equal(mittente.inviati.length, 1);
  assert.match(mittente.inviati[0]!.oggetto, /^Interpelli: 6 nuovi \(ADEE\)/);
  const invii = await db.select().from(schema.invio);
  assert.equal(invii.filter((i) => i.interpelloId === giaInviato.id).length, 1);
  assert.equal(invii.find((i) => i.interpelloId === giaInviato.id)!.riepilogoId, ieri!.id);

  // Il giorno dopo, niente di nuovo: nessun Riepilogo, e nessun Interpello rinviato.
  ambiente.adesso = new Date('2026-09-25T04:40:00Z');
  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 0);
  assert.equal(mittente.inviati.length, 1);
});

test('senza credenziali Gmail il job raccoglie, poi fallisce l\'invio con un messaggio chiaro', async (t) => {
  const { db, ambiente, errori } = await ambienteDiTest(t);
  ambiente.creaMittente = () => {
    throw new Error('GMAIL_UTENTE non impostata: vedi .env.example');
  };
  assert.equal(await eseguiJob(['--fonte', 'usp-bari-post'], ambiente), 1);
  assert.deepEqual(errori, ['Invio: impossibile preparare il Mittente: GMAIL_UTENTE non impostata: vedi .env.example']);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 20);
  // Raccolta e prova non chiedono il Mittente.
  errori.length = 0;
  assert.equal(await eseguiJob(['--dry-run', '--fonte', 'usp-bari-post'], ambiente), 0);
  assert.deepEqual(errori, []);
});

test('--rileggi ricava di nuovo gli Interpelli salvati senza leggere le Fonti', async (t) => {
  const { db, ambiente, uscita, errori } = await ambienteDiTest(t);
  await eseguiJob(['--solo-raccolta', '--fonte', 'usp-bari-post'], ambiente);
  await db.update(schema.interpello).set({ classi: [] });
  uscita.length = 0;
  const http = ambiente.http as ReturnType<typeof clientRegistrato>;
  const richieste = http.richiesti.length;

  assert.equal(await eseguiJob(['--rileggi'], ambiente), 0);
  assert.deepEqual(uscita, ['Rilette 20 Pubblicazioni dal testo salvato.']);
  assert.equal(http.richiesti.length, richieste);
  assert.ok((await db.select().from(schema.interpello)).some((i) => i.classi.length > 0));
  assert.equal(await eseguiJob(['--rileggi', '--fonte', 'usp-bari-post'], ambiente), 2);
  assert.match(errori[0]!, /--rileggi non si combina/);
});

test('una Fonte che fallisce non ferma i Riepiloghi: il riquadro è in cima, e il job esce con 1 dopo aver inviato', async (t) => {
  const { db, ambiente, errori, mittente } = await ambienteDiTest(t);
  const primaria = await destinatarioAggiuntoIl(db, '2026-09-20T08:00:00Z', 'primaria@example.org', { classi: ['ADEE'], province: ['BA'] });

  assert.equal(await eseguiJob([], ambiente), 1);
  assert.deepEqual(errori, ['rotta: errore: sito irraggiungibile']);
  assert.equal(mittente.inviati.length, 1);
  const [riepilogo] = mittente.inviati;
  assert.equal(riepilogo!.oggetto, 'Interpelli: 7 nuovi (ADEE) · 24 set 2026');
  const avviso = 'Rotta non consultabile da oggi: eventuali interpelli da questa fonte arriveranno appena torna disponibile.';
  assert.ok(riepilogo!.testo.startsWith(`⚠ ${avviso}\n\n── `));
  assert.ok(riepilogo!.html.includes(avviso));
  assert.ok(riepilogo!.html.indexOf(avviso) < riepilogo!.html.indexOf('<h2'));
  assert.match(riepilogo!.testo, /Fonti lette: USP Bari$/m);
  // Il Riepilogo è registrato come sempre: gli Interpelli di Rotta arriveranno quando torna.
  assert.deepEqual((await db.select().from(schema.riepilogo)).map((r) => r.destinatarioId), [primaria.id]);
  assert.equal((await db.select().from(schema.invio)).length, 7);
  const [stato] = await db.select().from(schema.statoFonte).where(eq(schema.statoFonte.fonte, 'rotta'));
  assert.equal(stato!.problema, 'errore');
});

test('le email di solo Avviso partono quando il problema comincia, ogni 3 giorni e alla ripresa; mai due lo stesso giorno', async (t) => {
  const { db, ambiente, uscita, mittente } = await ambienteDiTest(t);
  // Nessun Interpello gli corrisponde mai: riceve solo Avvisi.
  const tardi = await destinatarioAggiuntoIl(db, '2026-10-10T08:00:00Z', 'tardi@example.org', { classi: ['ADEE'], province: ['BA'] });
  let giu = true;
  const intermittente: Fonte = {
    id: 'rotta',
    nome: 'Rotta',
    adapter: 'finto',
    lettore: {
      leggi: async () => {
        if (giu) throw new Error('Risposta 503');
        const intestazione = 'Interpello A011 - Liceo "Fermi", Bari';
        return [{ chiave: 'r1', url: 'https://rotta.example/1', intestazione, pubblicataIl: ambiente.adesso, documenti: [] }];
      },
    },
  };
  ambiente.fonti = [uspBariPost, intermittente];
  const giorno = (n: number, ora = '04:40') => new Date(`2026-09-${24 + n}T${ora}:00Z`);
  const esegui = async (quando: Date) => {
    ambiente.adesso = quando;
    const prima = mittente.inviati.length;
    const codice = await eseguiJob([], ambiente);
    return { codice, nuovi: mittente.inviati.slice(prima) };
  };

  // Il problema comincia: un'email di solo Avviso, e il job esce con 1.
  let { codice, nuovi } = await esegui(giorno(0, '00:00')); // l'ora delle risposte registrate
  assert.equal(codice, 1);
  assert.deepEqual(nuovi.map((m) => [m.a, m.oggetto]), [['tardi@example.org', 'Interpelli: avviso sulle fonti · 24 set 2026']]);
  assert.equal(
    nuovi[0]!.testo.split('\n—\n')[0],
    '⚠ Rotta non consultabile da oggi: eventuali interpelli da questa fonte arriveranno appena torna disponibile.\n\nOggi nessun interpello nuovo per le tue preferenze.\n',
  );
  assert.match(nuovi[0]!.html, /non consultabile da oggi/);
  assert.equal(uscita.at(-1), 'Avvisi: 1 email di solo avviso inviata.');
  assert.ok(uscita.every((riga) => !riga.includes('@')));
  assert.deepEqual((await db.select().from(schema.avviso)).map((a) => [a.destinatarioId, a.giorno]), [[tardi.id, '2026-09-24']]);

  // Il job di riserva lo stesso giorno: niente doppione.
  ({ codice, nuovi } = await esegui(giorno(0, '06:10')));
  assert.equal(codice, 1);
  assert.deepEqual(nuovi, []);

  // Il problema dura: niente nei due giorni seguenti, un promemoria il terzo, una volta sola.
  for (const n of [1, 2]) assert.deepEqual((await esegui(giorno(n))).nuovi, [], `giorno ${n}`);
  ({ nuovi } = await esegui(giorno(3)));
  assert.equal(nuovi.length, 1);
  assert.match(nuovi[0]!.testo, /^⚠ Rotta non consultabile da 3 giorni: /);
  assert.deepEqual((await esegui(giorno(3, '06:10'))).nuovi, []);

  // Torna disponibile: un'email di ripresa, e il job esce con 0; poi più nulla.
  giu = false;
  ({ codice, nuovi } = await esegui(giorno(4)));
  assert.equal(codice, 0);
  assert.equal(nuovi.length, 1);
  assert.match(nuovi[0]!.testo, /^✓ Rotta di nuovo disponibile\.\n/);
  assert.deepEqual((await esegui(giorno(4, '06:10'))).nuovi, []);
  assert.deepEqual((await esegui(giorno(5))).nuovi, []);
  assert.equal((await db.select().from(schema.avviso)).length, 3);
});

test('--dry-run scrive anche le email di solo Avviso, senza segnarle come annunciate', async (t) => {
  const { db, ambiente, uscita, cartellaUscita, mittente } = await ambienteDiTest(t);
  await destinatarioAggiuntoIl(db, '2026-10-10T08:00:00Z', 'tardi@example.org', { classi: ['ADEE'], province: ['BA'] });
  assert.equal(await eseguiJob(['--dry-run'], ambiente), 1);
  assert.deepEqual(readdirSync(join(cartellaUscita, '2026-09-24')).sort(), ['tardi@example.org.html', 'tardi@example.org.txt']);
  assert.match(uscita.at(-1)!, /^Prova: 1 email di solo avviso scritta in /);
  assert.deepEqual(await db.select().from(schema.avviso), []);
  const [stato] = await db.select().from(schema.statoFonte).where(eq(schema.statoFonte.fonte, 'rotta'));
  assert.equal(stato!.ultimoAvvisoIl, null);
  // L'invio vero dopo la prova lo annuncia ancora.
  assert.equal(await eseguiJob([], ambiente), 1);
  assert.equal(mittente.inviati.length, 1);
});
