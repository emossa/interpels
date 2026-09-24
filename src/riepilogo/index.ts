// Dai dati salvati ai Riepiloghi: per ogni Destinatario attivo, cosa ha di nuovo e il messaggio da inviare.
import { eq, gte, inArray, min, or } from 'drizzle-orm';
import type { Configurazione } from '../config.ts';
import { schema, type Db } from '../db/index.ts';
import { elencaDestinatari } from '../destinatari.ts';
import type { Messaggio } from '../mittente.ts';
import type { AvvisiDelGiorno } from '../stato-fonti.ts';
import { componi, GIORNI_ANTERIORI, type Candidato, type ContenutoRiepilogo, type PossibileDuplicato } from './componi.ts';
import { giornoDiRoma, rendiRiepilogo } from './rendi.ts';

export { giornoDiRoma } from './rendi.ts';

const GIORNO = 24 * 60 * 60 * 1000;
const { interpello, invio, possibileDuplicato, pubblicazione, pubblicazioneInterpello } = schema;

export type RiepilogoPronto = {
  destinatarioId: number;
  /** Gli Interpelli che il Riepilogo contiene: quelli da registrare in `invio` a invio riuscito. */
  interpelli: number[];
  contenuto: ContenutoRiepilogo;
  messaggio: Messaggio;
};

export type Preparazione = {
  configurazione: Configurazione;
  /** Id della Fonte → nome da mostrare. */
  nomiFonti: ReadonlyMap<string, string>;
  /** I nomi delle Fonti lette in questa esecuzione, per il piè di pagina. */
  fontiLette: string[];
  /** Gli Avvisi sulle Fonti: in cima a ogni Riepilogo, e se oggi vanno anche in email di solo Avviso. */
  avvisi: AvvisiDelGiorno;
  adesso: Date;
};

/** I Riepiloghi di oggi, uno per Destinatario attivo con qualcosa di nuovo. Non scrive nulla. */
export async function preparaRiepiloghi(db: Db, preparazione: Preparazione): Promise<RiepilogoPronto[]> {
  const destinatari = (await elencaDestinatari(db)).filter((d) => d.attivo);
  if (destinatari.length === 0) return [];

  const piuVecchio = Math.min(...destinatari.map((d) => d.creatoIl.getTime()));
  const candidati = await caricaCandidati(db, new Date(piuVecchio - GIORNI_ANTERIORI * GIORNO), preparazione.nomiFonti);
  const contesto = {
    classi: preparazione.configurazione.classi,
    gruppi: preparazione.configurazione.gruppi,
    giorno: giornoDiRoma(preparazione.adesso),
    adesso: preparazione.adesso,
    fontiLette: preparazione.fontiLette,
    avvisi: preparazione.avvisi.avvisi,
  };

  const pronti: RiepilogoPronto[] = [];
  for (const destinatario of destinatari) {
    const inviati = await giaInviati(db, destinatario.id);
    const contenuto = componi(destinatario, candidati, inviati, contesto);
    if (!contenuto) continue;
    const interpelli = [...contenuto.gruppi.flatMap((g) => g.voci), ...contenuto.daVerificare].map((v) => v.id);
    pronti.push({ destinatarioId: destinatario.id, interpelli, contenuto, messaggio: { a: destinatario.email, ...rendiRiepilogo(contenuto) } });
  }
  return pronti;
}

/** Gli Interpelli la cui prima Pubblicazione è dal `dal` in poi, con tutte le loro Pubblicazioni. */
export async function caricaCandidati(db: Db, dal: Date, nomiFonti: ReadonlyMap<string, string>): Promise<Candidato[]> {
  const recenti = db
    .select({ id: pubblicazioneInterpello.interpelloId })
    .from(pubblicazioneInterpello)
    .innerJoin(pubblicazione, eq(pubblicazione.id, pubblicazioneInterpello.pubblicazioneId))
    .groupBy(pubblicazioneInterpello.interpelloId)
    .having(gte(min(pubblicazione.pubblicataIl), dal));
  const righe = await db
    .select({ i: interpello, p: pubblicazione })
    .from(interpello)
    .innerJoin(pubblicazioneInterpello, eq(pubblicazioneInterpello.interpelloId, interpello.id))
    .innerJoin(pubblicazione, eq(pubblicazione.id, pubblicazioneInterpello.pubblicazioneId))
    .where(inArray(interpello.id, recenti))
    .orderBy(interpello.id, pubblicazione.pubblicataIl, pubblicazione.id);

  const perId = new Map<number, Candidato & { pubblicazioni: Candidato['pubblicazioni'][number][] }>();
  for (const { i, p } of righe) {
    let c = perId.get(i.id);
    if (!c) {
      c = {
        id: i.id,
        tipo: i.tipo,
        personale: i.personale,
        classi: i.classi,
        scuola: i.scuola,
        comune: i.comune,
        provincia: i.provincia,
        documentoNonLeggibile: i.documentoNonLeggibile,
        ore: i.ore,
        finoAl: i.finoAl,
        // La scadenza non si estrae ancora: arriverà con la lettura dei documenti.
        scadenza: null,
        pubblicazioni: [],
      };
      perId.set(i.id, c);
    }
    c.pubblicazioni.push({ fonte: nomiFonti.get(p.fonte) ?? p.fonte, url: p.url, pubblicataIl: p.pubblicataIl, documenti: p.documenti });
  }
  const duplicati = await possibiliDuplicati(db, [...perId.keys()], nomiFonti);
  return [...perId.values()].map((c) => ({ ...c, possibiliDuplicati: duplicati.get(c.id) ?? [] }));
}

/** Per ogni Interpello dato, gli Interpelli di cui è un Possibile duplicato, con il link alla loro prima Pubblicazione. */
async function possibiliDuplicati(db: Db, ids: number[], nomiFonti: ReadonlyMap<string, string>): Promise<Map<number, PossibileDuplicato[]>> {
  const perId = new Map<number, PossibileDuplicato[]>();
  if (ids.length === 0) return perId;
  const coppie = await db
    .select()
    .from(possibileDuplicato)
    .where(or(inArray(possibileDuplicato.interpelloA, ids), inArray(possibileDuplicato.interpelloB, ids)))
    .orderBy(possibileDuplicato.interpelloA, possibileDuplicato.interpelloB);
  if (coppie.length === 0) return perId;
  const altri = [...new Set(coppie.flatMap((c) => [c.interpelloA, c.interpelloB]))];
  const righe = await db
    .select({ id: pubblicazioneInterpello.interpelloId, p: pubblicazione })
    .from(pubblicazioneInterpello)
    .innerJoin(pubblicazione, eq(pubblicazione.id, pubblicazioneInterpello.pubblicazioneId))
    .where(inArray(pubblicazioneInterpello.interpelloId, altri))
    .orderBy(pubblicazione.pubblicataIl, pubblicazione.id);
  const dove = new Map<number, PossibileDuplicato>();
  for (const { id, p } of righe) {
    if (dove.has(id)) continue;
    // Il primo documento della sua prima Pubblicazione, altrimenti la Pagina.
    const url = p.documenti[0]?.url ?? p.url;
    dove.set(id, { id, url, fonte: nomiFonti.get(p.fonte) ?? p.fonte, pubblicataIl: p.pubblicataIl });
  }
  for (const { interpelloA, interpelloB } of coppie) {
    for (const [questo, altro] of [[interpelloA, interpelloB], [interpelloB, interpelloA]] as const) {
      const d = dove.get(altro);
      if (d) perId.set(questo, [...(perId.get(questo) ?? []), d]);
    }
  }
  return perId;
}

async function giaInviati(db: Db, destinatarioId: number): Promise<Set<number>> {
  const righe = await db.select({ id: invio.interpelloId }).from(invio).where(eq(invio.destinatarioId, destinatarioId));
  return new Set(righe.map((r) => r.id));
}
