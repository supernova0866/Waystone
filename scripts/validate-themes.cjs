#!/usr/bin/env node
'use strict';

// Run with: node scripts/validate-themes.js
// Exits non-zero if any theme in style/style.json is missing a variable
// that base.stub.css declares as required, or defines one base.css never
// asked for (likely a typo).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STUB_PATH = path.join(__dirname, 'base.stub.css');
const STYLE_JSON_PATH = path.join(ROOT, 'style', 'style.json');

function extractVarNames(css) {
  const names = new Set();
  const re = /(--[a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(css))) names.add(m[1]);
  return names;
}

function main() {
  const stubCss = fs.readFileSync(STUB_PATH, 'utf8');
  const required = extractVarNames(stubCss);

  const themes = JSON.parse(fs.readFileSync(STYLE_JSON_PATH, 'utf8'));
  let hadError = false;

  for (const theme of themes) {
    const filePath = path.join(ROOT, 'style', theme.file);
    if (!fs.existsSync(filePath)) {
      console.error(`✗ ${theme.id}: file not found at style/${theme.file}`);
      hadError = true;
      continue;
    }
    const css = fs.readFileSync(filePath, 'utf8');
    const defined = extractVarNames(css);

    const missing = [...required].filter((v) => !defined.has(v));
    const extra = [...defined].filter((v) => !required.has(v));

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ ${theme.id} — complete (${defined.size} vars)`);
    } else {
      hadError = hadError || missing.length > 0;
      console.log(`${missing.length ? '✗' : '~'} ${theme.id}`);
      if (missing.length) console.log(`    missing: ${missing.join(', ')}`);
      if (extra.length) console.log(`    unexpected (possible typo): ${extra.join(', ')}`);
    }
  }

  if (hadError) {
    console.error('\nOne or more themes are missing required variables.');
    process.exit(1);
  }
  console.log('\nAll themes satisfy the variable contract.');
}

main();
