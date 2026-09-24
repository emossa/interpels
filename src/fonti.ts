// Le Fonti: configurazione committata in `config/fonti.json` (id, nome, adapter, impostazioni).
// Una Fonte non dice nulla sul territorio delle sue Scuole.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTER, type LettoreFonte } from './adapter/index.ts';
import { RADICE_PROGETTO } from './config.ts';

export type Fonte = {
  id: string;
  /** Il nome da mostrare, es. nel Riepilogo accanto al link alla Pubblicazione. */
  nome: string;
  adapter: string;
  lettore: LettoreFonte;
};

export function caricaFonti(radice: string = RADICE_PROGETTO): Fonte[] {
  const file = 'config/fonti.json';
  const voci: unknown = JSON.parse(readFileSync(join(radice, file), 'utf8'));
  if (!Array.isArray(voci)) throw new Error(`${file}: atteso un elenco di Fonti`);
  const fonti: Fonte[] = [];
  for (const voce of voci as Record<string, unknown>[]) {
    const { id, nome, adapter, impostazioni } = voce ?? {};
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
      throw new Error(`${file}: ogni Fonte deve avere un "id" fatto di minuscole, cifre e trattini`);
    }
    if (fonti.some((f) => f.id === id)) throw new Error(`${file}: la Fonte "${id}" compare due volte`);
    if (typeof nome !== 'string' || nome === '') throw new Error(`${file}: la Fonte "${id}" deve avere un "nome"`);
    const famiglia = typeof adapter === 'string' ? ADAPTER[adapter] : undefined;
    if (!famiglia) {
      throw new Error(`${file}: la Fonte "${id}" usa un adapter sconosciuto (disponibili: ${Object.keys(ADAPTER).join(', ')})`);
    }
    let lettore: LettoreFonte;
    try {
      lettore = famiglia.crea(impostazioni);
    } catch (errore) {
      throw new Error(`${file}: la Fonte "${id}": ${(errore as Error).message}`, { cause: errore });
    }
    fonti.push({ id, nome, adapter: adapter as string, lettore });
  }
  return fonti;
}
