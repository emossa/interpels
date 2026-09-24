// Destinatari e le loro Preferenze nel database: l'unica fonte di verità dell'elenco.
// Il CLI `pnpm destinatari` e, più avanti, l'iscrizione pubblica scrivono queste righe.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Configurazione } from './config.ts';
import { type Db, schema } from './db/index.ts';
import type { GenerePreferenza } from './db/schema.ts';
import { normalizzaEmail } from './normalizza.ts';
import { ErroreValidazione, type Preferenze, validaPreferenze } from './preferenze.ts';

const { destinatario, preferenza, riepilogo } = schema;

export type Destinatario = {
  id: number;
  email: string;
  attivo: boolean;
  creatoIl: Date;
  disattivatoIl: Date | null;
  /** Riceve un Riepilogo per Provincia invece di uno solo. */
  separaProvince: boolean;
  preferenze: Preferenze;
};

export type NuovoDestinatario = {
  email: string;
  preferenze: Preferenze;
  /** Un Riepilogo per Provincia; di norma no. */
  separaProvince?: boolean;
};

/** Ciò che `modifica` cambia; i campi assenti restano come sono. */
export type Modifiche = Partial<Preferenze> & { email?: string; separaProvince?: boolean };

export async function aggiungiDestinatario(
  db: Db,
  configurazione: Configurazione,
  nuovo: NuovoDestinatario,
): Promise<Destinatario> {
  const email = validaEmail(nuovo.email);
  const preferenze = validaPreferenze(nuovo.preferenze, configurazione);
  const id = await db.transaction(async (tx) => {
    await verificaEmailLibera(tx, email);
    const [riga] = await tx.insert(destinatario).values({ email, separaProvince: nuovo.separaProvince ?? false }).returning({ id: destinatario.id });
    if (!riga) throw new Error('inserimento del Destinatario fallito');
    await scriviPreferenze(tx, riga.id, preferenze);
    return riga.id;
  });
  return leggi(db, id);
}

/** Tutti i Destinatari, attivi e disattivati, in ordine di email. */
export async function elencaDestinatari(db: Db): Promise<Destinatario[]> {
  const righe = await db.select().from(destinatario).orderBy(asc(destinatario.email));
  const preferenzePerId = await leggiPreferenze(
    db,
    righe.map((r) => r.id),
  );
  return righe.map((r) => ({ ...r, preferenze: preferenzePerId.get(r.id) ?? vuote() }));
}

export async function modificaDestinatario(
  db: Db,
  configurazione: Configurazione,
  email: string,
  modifiche: Modifiche,
): Promise<Destinatario> {
  const attuale = await trova(db, email);
  const nuovaEmail = modifiche.email === undefined ? attuale.email : validaEmail(modifiche.email);
  const preferenze = validaPreferenze(
    {
      classi: modifiche.classi ?? attuale.preferenze.classi,
      gruppi: modifiche.gruppi ?? attuale.preferenze.gruppi,
      province: modifiche.province ?? attuale.preferenze.province,
    },
    configurazione,
  );
  await db.transaction(async (tx) => {
    if (nuovaEmail !== attuale.email) {
      await verificaEmailLibera(tx, nuovaEmail, attuale.id);
      await tx.update(destinatario).set({ email: nuovaEmail }).where(eq(destinatario.id, attuale.id));
    }
    if (modifiche.separaProvince !== undefined && modifiche.separaProvince !== attuale.separaProvince) {
      await tx.update(destinatario).set({ separaProvince: modifiche.separaProvince }).where(eq(destinatario.id, attuale.id));
    }
    await tx.delete(preferenza).where(eq(preferenza.destinatarioId, attuale.id));
    await scriviPreferenze(tx, attuale.id, preferenze);
  });
  return leggi(db, attuale.id);
}

/** Disattiva il Destinatario (`attivo = false` con la data); non cancella mai nulla. */
export async function disattivaDestinatario(db: Db, email: string, adesso: Date = new Date()): Promise<Destinatario> {
  const attuale = await trova(db, email);
  if (!attuale.attivo) {
    throw new ErroreValidazione([`il Destinatario "${attuale.email}" è già disattivato`]);
  }
  await db
    .update(destinatario)
    .set({ attivo: false, disattivatoIl: adesso })
    .where(eq(destinatario.id, attuale.id));
  return leggi(db, attuale.id);
}

/**
 * Dimentica i Riepiloghi già inviati al Destinatario (e, a cascata, i suoi `invio`): il prossimo job
 * gli manda di nuovo un primo Riepilogo, con ogni Interpello aperto che corrisponde alle Preferenze,
 * anche se già ricevuto. Restituisce quanti Riepiloghi ha dimenticato.
 */
export async function ricominciaDestinatario(db: Db, email: string): Promise<{ destinatario: Destinatario; riepiloghi: number }> {
  const attuale = await trova(db, email);
  const cancellati = await db
    .delete(riepilogo)
    .where(eq(riepilogo.destinatarioId, attuale.id))
    .returning({ id: riepilogo.id });
  return { destinatario: attuale, riepiloghi: cancellati.length };
}

// Una transazione espone le stesse query del database.
type Esecutore = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

function validaEmail(grezza: string): string {
  const email = normalizzaEmail(grezza);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErroreValidazione([`email non valida: "${grezza.trim()}"`]);
  }
  return email;
}

async function verificaEmailLibera(db: Esecutore, email: string, tranneId?: number): Promise<void> {
  const stessaEmail = eq(sql`lower(${destinatario.email})`, email.toLowerCase());
  const [esistente] = await db
    .select({ id: destinatario.id })
    .from(destinatario)
    .where(tranneId === undefined ? stessaEmail : and(stessaEmail, ne(destinatario.id, tranneId)));
  if (esistente) throw new ErroreValidazione([`esiste già un Destinatario con email "${email}"`]);
}

async function scriviPreferenze(db: Esecutore, destinatarioId: number, preferenze: Preferenze): Promise<void> {
  const righe = [
    ...preferenze.classi.map((valore) => ({ destinatarioId, genere: 'classe' as const, valore })),
    ...preferenze.gruppi.map((valore) => ({ destinatarioId, genere: 'gruppo' as const, valore })),
    ...preferenze.province.map((valore) => ({ destinatarioId, genere: 'provincia' as const, valore })),
  ];
  if (righe.length > 0) await db.insert(preferenza).values(righe);
}

async function leggiPreferenze(db: Esecutore, ids: number[]): Promise<Map<number, Preferenze>> {
  const perId = new Map<number, Preferenze>();
  if (ids.length === 0) return perId;
  const righe = await db
    .select()
    .from(preferenza)
    .where(inArray(preferenza.destinatarioId, ids))
    .orderBy(asc(preferenza.valore));
  const campo: Record<GenerePreferenza, keyof Preferenze> = { classe: 'classi', gruppo: 'gruppi', provincia: 'province' };
  for (const riga of righe) {
    const preferenze = perId.get(riga.destinatarioId) ?? vuote();
    preferenze[campo[riga.genere]].push(riga.valore);
    perId.set(riga.destinatarioId, preferenze);
  }
  return perId;
}

async function trova(db: Db, email: string): Promise<Destinatario> {
  const cercata = normalizzaEmail(email);
  const [riga] = await db
    .select({ id: destinatario.id })
    .from(destinatario)
    .where(eq(sql`lower(${destinatario.email})`, cercata));
  if (!riga) throw new ErroreValidazione([`nessun Destinatario con email "${cercata}"`]);
  return leggi(db, riga.id);
}

async function leggi(db: Db, id: number): Promise<Destinatario> {
  const [riga] = await db.select().from(destinatario).where(eq(destinatario.id, id));
  if (!riga) throw new Error(`Destinatario ${id} non trovato`);
  const preferenze = (await leggiPreferenze(db, [id])).get(id) ?? vuote();
  return { ...riga, preferenze };
}

function vuote(): Preferenze {
  return { classi: [], gruppi: [], province: [] };
}
