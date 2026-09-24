// Normalizzazione condivisa: la usano il CLI dei Destinatari e, più avanti,
// l'estrazione dagli Interpelli, così che `A11`, `A-11` e `A011` siano la stessa Classe.

/**
 * Porta una grafia di Classe di concorso al suo codice normalizzato:
 * `A11`, `A-11`, `a - 11` → `A011`; `B-17` → `B017`; `am12` → `AM12`.
 */
export function normalizzaClasse(grafia: string): string {
  const compatta = grafia.toUpperCase().replace(/[\s-]/g, '');
  const breve = compatta.match(/^([AB])(\d{2})$/);
  return breve ? `${breve[1]}0${breve[2]}` : compatta;
}

/** Porta una Provincia alla sua sigla in maiuscolo (`ba` → `BA`); la validità si controlla a parte. */
export function normalizzaProvincia(grafia: string): string {
  return grafia.trim().toUpperCase();
}

/** Gli indirizzi email si confrontano senza distinguere maiuscole e minuscole. */
export function normalizzaEmail(indirizzo: string): string {
  return indirizzo.trim().toLowerCase();
}
