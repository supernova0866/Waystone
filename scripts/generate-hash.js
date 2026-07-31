import argon2 from 'argon2';
import readline from 'node:readline';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

async function main() {
  const username = await prompt('Admin username: ');
  const password = await prompt('Admin master password: ');
  if (!password || password.length < 8) {
    console.error('\nUse at least 8 characters.');
    process.exit(1);
  }
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 131072,
    timeCost: 3,
    parallelism: 1,
  });
  console.log('\nSEED_ADMIN_USERNAME=' + username);
  console.log('SEED_ADMIN_PASSWORD_HASH=' + hash);
  console.log('\nPaste both into Render\'s environment variables, then boot the server once.');
  console.log('You can remove SEED_ADMIN_PASSWORD_HASH afterward if you want; it is only read when no admin exists yet.');
}

main();
