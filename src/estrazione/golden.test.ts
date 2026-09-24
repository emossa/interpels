// Test golden dell'estrazione dall'intestazione sul corpus reale dei post USP Bari
// (404 post fino al 24/09/2026, dai dati del prototipo, issue #5).
// Dopo un cambiamento voluto alle regole: `node --test --test-update-snapshots src/estrazione/golden.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pubblicazioneDaPost, type PostWordpress } from '../adapter/wordpress.ts';
import { RADICE_PROGETTO } from '../config.ts';
import { estraiDaIntestazione } from './intestazione.ts';
import { caricaLuoghi } from './luoghi.ts';

const luoghi = caricaLuoghi();
const post: PostWordpress[] = JSON.parse(readFileSync(join(RADICE_PROGETTO, 'fixtures', 'estrazione', 'usp-bari-post.json'), 'utf8'));
const estratti = post.map((p) => {
  const grezza = pubblicazioneDaPost(p);
  return { grezza, dati: estraiDaIntestazione({ intestazione: grezza.intestazione, etichetteDocumenti: grezza.documenti.map((d) => d.etichetta) }, luoghi) };
});
const didattici = estratti.filter(({ dati }) => dati.tipo === 'interpello' && dati.personale === 'docente');

const quota = (conta: (d: (typeof didattici)[number]['dati']) => unknown) =>
  didattici.filter(({ dati }) => conta(dati)).length / didattici.length;

test('sul corpus i tassi di riuscita sono quelli del prototipo (Classi ≈97%, Provincia ≈75%)', () => {
  assert.equal(estratti.length, 404);
  assert.equal(didattici.length, 289);
  assert.equal(didattici.filter(({ dati }) => dati.classi.length > 0).length, 279); // 96,5%
  assert.equal(didattici.filter(({ dati }) => dati.provincia).length, 216); // 74,7%
  assert.ok(quota((d) => d.classi.length > 0) >= 0.96);
  assert.ok(quota((d) => d.provincia) >= 0.74);
  assert.ok(quota((d) => d.comune) >= 0.72);
  assert.ok(quota((d) => d.protocollo) >= 0.45);
});

test('sul corpus Tipo e Personale sono classificati come nel prototipo', () => {
  const conteggi: Record<string, number> = {};
  for (const { dati } of estratti) conteggi[`${dati.tipo}/${dati.personale}`] = (conteggi[`${dati.tipo}/${dati.personale}`] ?? 0) + 1;
  assert.deepEqual(conteggi, {
    'interpello/docente': 289,
    'interpello/ata-dsga': 69,
    'esito/ata-dsga': 21,
    'esito/docente': 1,
    'annullamento/docente': 9,
    'rettifica/docente': 2,
    'rettifica/ata-dsga': 4,
    'riapertura/ata-dsga': 9,
  });
});

test('estrazione di ogni post del corpus (golden)', (t) => {
  const righe = estratti.map(({ grezza, dati }) =>
    [
      grezza.chiave,
      grezza.intestazione,
      `  ${dati.tipo} · ${dati.personale} · classi ${dati.classi.join(',') || '—'}${dati.classiDedotte.length ? ` (${dati.classiDedotte.join('; ')})` : ''}`,
      `  ${dati.scuola ?? '—'} · ${dati.comune ?? '—'} · ${dati.provincia ?? '—'}${dati.provinciaDa ? ` (${dati.provinciaDa})` : ''}`,
      `  prot. ${dati.protocollo ?? '—'}${dati.dataProtocollo ? ` del ${dati.dataProtocollo}` : ''}${dati.protocolloRiferito ? ` · riferito ${dati.protocolloRiferito}` : ''} · ore ${dati.ore ?? '—'} · fino al ${dati.finoAl ?? '—'} · documenti ${grezza.documenti.length}`,
    ].join('\n'),
  );
  t.assert.snapshot(righe, { serializers: [(r: string[]) => `\n${r.join('\n\n')}\n`] });
});
