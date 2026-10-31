// Vercel runs this as the build step (npm run build). It stamps every deploy with
// a build id so phones never mix old cached files with a new deploy:
//   index.html    ?v=<id> on app.js, decks.js and style.css, plus <meta name="build">
//   lib/build.js  the same id, which the server sends back with every reply so open
//                 tabs on an older build know to reload.
// Locally nothing runs, and everything says 'dev'.

import { readFileSync, writeFileSync } from 'node:fs';

const id = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 12);

const html = readFileSync('index.html', 'utf8')
  .replace(/(href|src)="(style\.css|decks\.js|app\.js)(\?v=[^"]*)?"/g, `$1="$2?v=${id}"`)
  .replace(/<meta name="build" content="[^"]*">/, `<meta name="build" content="${id}">`);
writeFileSync('index.html', html);
writeFileSync('lib/build.js', `export const BUILD = '${id}';\n`);

console.log(`Stamped build ${id}`);
