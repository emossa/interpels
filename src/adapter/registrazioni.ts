// Per i test degli adapter: un ClientHttp che serve risposte registrate da `fixtures/`, senza rete.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADICE_PROGETTO } from '../config.ts';
import { creaClientHttp, type ClientHttp } from '../http.ts';

/** Una risposta registrata: il corpo è JSON oppure testo (es. una pagina HTML). */
export type RispostaRegistrata = {
  url: string;
  stato: number;
  intestazioni: Record<string, string>;
  corpo: unknown;
};

export function leggiRegistrazioni(...percorso: string[]): RispostaRegistrata[] {
  return JSON.parse(readFileSync(join(RADICE_PROGETTO, 'fixtures', ...percorso), 'utf8'));
}

/** Serve ogni URL con la sua risposta registrata; un URL non registrato fa fallire il test. */
export function clientRegistrato(registrazioni: readonly RispostaRegistrata[]): ClientHttp & { richiesti: string[] } {
  const richiesti: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    richiesti.push(url);
    const registrata = registrazioni.find((r) => r.url === url);
    if (!registrata) throw new Error(`Nessuna risposta registrata per ${url}`);
    const corpo = typeof registrata.corpo === 'string' ? registrata.corpo : JSON.stringify(registrata.corpo);
    return new Response(corpo, { status: registrata.stato, headers: registrata.intestazioni });
  }) as typeof globalThis.fetch;
  return { ...creaClientHttp({ fetch, tentativi: 1, dormi: async () => {} }), richiesti };
}
