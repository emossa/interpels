// PROTOTYPE — throwaway. Loads ./data and runs extraction over every entry.
import { readFileSync } from 'node:fs';
import { parseDecretiPage, parseWpPosts, buildGazetteer, extract } from './extract.mjs';
const d = (f) => readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8');
export const gaz = buildGazetteer(d('comuni.csv'));
export const entries = [
  ...parseDecretiPage(d('decreti.html'), 'https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze'),
  ...parseWpPosts(JSON.parse(d('posts.json'))),
];
export const run = (opts) => entries.map((e) => extract(e, gaz, opts));
export const records = run({});
