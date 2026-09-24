// PROTOTYPE — throwaway. Downloads the raw inputs into ./data (gitignored).
import { mkdir, writeFile } from 'node:fs/promises';
const dir = new URL('./data/', import.meta.url);
await mkdir(dir, { recursive: true });
const UA = { 'user-agent': 'Mozilla/5.0 interpels-prototype' };

const html = await (await fetch('https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze', { headers: UA })).text();
await writeFile(new URL('decreti.html', dir), html);

const posts = [];
for (let page = 1; ; page++) {
  const r = await fetch(`https://www.uspbari.it/usp/wp-json/wp/v2/posts?search=interpell&per_page=100&page=${page}&_fields=id,date,title,link,content,categories`, { headers: UA });
  if (!r.ok) break;
  const batch = await r.json();
  posts.push(...batch);
  if (page >= Number(r.headers.get('x-wp-totalpages'))) break;
}
await writeFile(new URL('posts.json', dir), JSON.stringify(posts));

const buf = await (await fetch('https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv', { headers: UA })).arrayBuffer();
await writeFile(new URL('comuni.csv', dir), new TextDecoder('latin1').decode(buf));
console.log(`decreti.html ${html.length} bytes, ${posts.length} posts, comuni.csv saved`);
