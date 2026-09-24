// Gli adapter disponibili, per nome come compare in `config/fonti.json`.
// Una nuova famiglia di siti è un modulo in questa cartella e una riga qui.
import type { Adapter } from './adapter.ts';
import { paginaDecreti } from './pagina-decreti.ts';
import { wordpress } from './wordpress.ts';

export type { Adapter, DocumentoGrezzo, LettoreFonte, Lettura, PubblicazioneGrezza } from './adapter.ts';

export const ADAPTER: Readonly<Record<string, Adapter>> = {
  wordpress,
  'pagina-decreti': paginaDecreti,
};
