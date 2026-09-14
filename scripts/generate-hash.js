import argon2 from 'argon2';
import readline from 'node:readline';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const PBKDF2_ITERATIONS = 600_000;

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

// Mirrors core/client/crypto.js's derivation exactly (PBKDF2 -> HKDF split)
// so the admin's stored hash matches what the browser will send at login.
async function deriveAuthProof(password, saltBytes) {
  const passwordKey = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    256
  );
  const hkdfKey = await subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits']);
  const authBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: new TextEncoder().encode('waystone-auth-v1') },
    hkdfKey,
    256
  );
  return bytesToBase64(new Uint8Array(authBits));
}

async function main() {
  const username = await prompt('Admin username: ');
  const password = await prompt('Admin master password: ');
  if (!password || password.length < 8) {
    console.error('\nUse at least 8 characters.');
    process.exit(1);
  }

  const saltBytes = webcrypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64(saltBytes);
  const authProof = await deriveAuthProof(password, saltBytes);

  const hash = await argon2.hash(authProof, {
    type: argon2.argon2id,
    memoryCost: 131072,
    timeCost: 3,
    parallelism: 1,
  });

  console.log('\nSEED_ADMIN_USERNAME=' + username);
  console.log('SEED_ADMIN_SALT=' + salt);
  console.log('SEED_ADMIN_PASSWORD_HASH=' + hash);
  console.log('\nPaste all three into Render\'s environment variables, then boot the server once.');
  console.log('You can remove SEED_ADMIN_PASSWORD_HASH afterward if you want; it is only read when no admin exists yet.');
}

main();
