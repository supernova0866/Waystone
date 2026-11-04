import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

const IMPORT_MAP = JSON.stringify({
  imports: {
    '/core/client/api.js': '/demo/api.js',
    '/core/client/crypto.js': '/demo/crypto.js',
  },
});
const IMPORT_MAP_HASH = crypto.createHash('sha256').update(IMPORT_MAP).digest('base64');

const APP_SCRIPT = '<script type="module" src="/core/client/app.js"></script>';

function replaceOnce(html, from, to) {
  const first = html.indexOf(from);
  if (first === -1 || html.indexOf(from, first + 1) !== -1) {
    throw new Error(`The demo page needs exactly one occurrence of: ${from}`);
  }
  return html.replace(from, () => to);
}

async function buildDemoPage(indexPath) {
  let html = await fsp.readFile(indexPath, 'utf8');
  html = replaceOnce(
    html,
    APP_SCRIPT,
    `<script type="importmap">${IMPORT_MAP}</script>\n<script type="module" src="/demo/boot.js"></script>`
  );
  return replaceOnce(html, '</head>', '<link rel="stylesheet" href="/demo/demo.css" />\n</head>');
}

function demoCsp(baseCsp) {
  return baseCsp.replace("script-src 'self'", `script-src 'self' 'sha256-${IMPORT_MAP_HASH}'`);
}

export { buildDemoPage, demoCsp };
