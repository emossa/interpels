// Configurazione committata: Classi di concorso (config/classi.json),
// Gruppi di classi (config/gruppi.json) e Province (data/province.csv).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leggiCsv } from './csv.ts';
import { normalizzaClasse } from './normalizza.ts';

export const RADICE_PROGETTO = fileURLToPath(new URL('..', import.meta.url));

export type Configurazione = {
  /** Codice normalizzato della Classe di concorso → nome. */
  classi: ReadonlyMap<string, string>;
  /** Nome del Gruppo di classi → codici delle sue Classi. */
  gruppi: ReadonlyMap<string, readonly string[]>;
  /** Sigla della Provincia → nome. */
  province: ReadonlyMap<string, string>;
};

export function caricaConfigurazione(radice: string = RADICE_PROGETTO): Configurazione {
  const leggi = (...percorso: string[]) => readFileSync(join(radice, ...percorso), 'utf8');

  const classi = new Map<string, string>();
  for (const [codice, nome] of Object.entries(leggiOggetto(leggi('config', 'classi.json'), 'config/classi.json'))) {
    if (typeof nome !== 'string' || normalizzaClasse(codice) !== codice) {
      throw new Error(`config/classi.json: la Classe "${codice}" deve avere un codice normalizzato e un nome`);
    }
    classi.set(codice, nome);
  }

  const gruppi = new Map<string, readonly string[]>();
  for (const [nome, membri] of Object.entries(leggiOggetto(leggi('config', 'gruppi.json'), 'config/gruppi.json'))) {
    if (!Array.isArray(membri) || membri.length === 0) {
      throw new Error(`config/gruppi.json: il Gruppo "${nome}" deve elencare almeno una Classe`);
    }
    const sconosciute = membri.filter((classe) => typeof classe !== 'string' || !classi.has(classe));
    if (sconosciute.length > 0) {
      throw new Error(`config/gruppi.json: il Gruppo "${nome}" nomina Classi sconosciute: ${sconosciute.join(', ')}`);
    }
    gruppi.set(nome, membri as string[]);
  }

  const province = new Map<string, string>();
  const [, ...righe] = leggiCsv(leggi('data', 'province.csv'));
  for (const [sigla, nome] of righe) {
    if (!sigla || !nome) throw new Error('data/province.csv: ogni riga deve avere sigla e nome');
    province.set(sigla, nome);
  }

  return { classi, gruppi, province };
}

function leggiOggetto(testo: string, file: string): Record<string, unknown> {
  const valore: unknown = JSON.parse(testo);
  if (typeof valore !== 'object' || valore === null || Array.isArray(valore)) {
    throw new Error(`${file}: atteso un oggetto JSON`);
  }
  return valore as Record<string, unknown>;
}
