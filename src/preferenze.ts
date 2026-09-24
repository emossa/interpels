import type { Configurazione } from './config.ts';
import { normalizzaClasse, normalizzaProvincia } from './normalizza.ts';

/**
 * Le Classi di concorso e/o i Gruppi di classi, e le Province, che un Destinatario vuole.
 * I Gruppi restano nomi: si espandono nelle loro Classi solo al momento del confronto.
 */
export type Preferenze = {
  classi: string[];
  gruppi: string[];
  province: string[];
};

/** Un input rifiutato; `problemi` elenca ogni motivo, uno per riga. */
export class ErroreValidazione extends Error {
  readonly problemi: string[];

  constructor(problemi: string[]) {
    super(problemi.join('\n'));
    this.name = 'ErroreValidazione';
    this.problemi = problemi;
  }
}

/** Normalizza e valida le Preferenze contro la configurazione; lancia ErroreValidazione se non vanno. */
export function validaPreferenze(grezze: Preferenze, configurazione: Configurazione): Preferenze {
  const problemi: string[] = [];

  const classi = unici(grezze.classi, normalizzaClasse);
  for (const classe of classi) {
    if (!configurazione.classi.has(classe)) problemi.push(`Classe di concorso sconosciuta: "${classe}"`);
  }

  const gruppiPerNome = new Map([...configurazione.gruppi.keys()].map((nome) => [nome.toLowerCase(), nome]));
  const gruppi = unici(grezze.gruppi, (nome) => {
    const canonico = gruppiPerNome.get(nome.trim().toLowerCase());
    if (!canonico) {
      problemi.push(
        `Gruppo di classi sconosciuto: "${nome.trim()}" (disponibili: ${[...configurazione.gruppi.keys()].join(', ')})`,
      );
    }
    return canonico ?? nome.trim();
  });

  const province = unici(grezze.province, (grafia) => {
    const sigla = normalizzaProvincia(grafia);
    if (!configurazione.province.has(sigla)) problemi.push(`Provincia non valida: "${grafia.trim()}"`);
    return sigla;
  });

  if (classi.length === 0 && gruppi.length === 0) {
    problemi.push('serve almeno una Classe di concorso o un Gruppo di classi');
  }
  if (province.length === 0) problemi.push('serve almeno una Provincia');

  if (problemi.length > 0) throw new ErroreValidazione(problemi);
  return { classi, gruppi, province };
}

/** Normalizza i valori non vuoti e toglie i doppioni, mantenendo l'ordine. */
function unici(valori: readonly string[], normalizza: (valore: string) => string): string[] {
  const visti = new Set<string>();
  for (const valore of valori) {
    if (valore.trim() === '') continue;
    visti.add(normalizza(valore));
  }
  return [...visti];
}
