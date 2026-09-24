/**
 * Legge un CSV con separatore configurabile (ISTAT usa `;`), con celle tra
 * virgolette che possono contenere separatori, `""` e a capo. Righe vuote ignorate.
 */
export function leggiCsv(testo: string, separatore = ';'): string[][] {
  const righe: string[][] = [];
  let riga: string[] = [];
  let cella = '';
  let traVirgolette = false;
  const chiudiRiga = () => {
    riga.push(cella.replace(/\r$/, ''));
    if (riga.length > 1 || riga[0] !== '') righe.push(riga);
    riga = [];
    cella = '';
  };
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (traVirgolette) {
      if (c === '"' && testo[i + 1] === '"') {
        cella += '"';
        i++;
      } else if (c === '"') traVirgolette = false;
      else cella += c;
    } else if (c === '"') traVirgolette = true;
    else if (c === separatore) {
      riga.push(cella);
      cella = '';
    } else if (c === '\n') chiudiRiga();
    else cella += c;
  }
  if (cella !== '' || riga.length > 0) chiudiRiga();
  return righe;
}
