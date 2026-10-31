const PBKDF2_ITERATIONS = 600_000;

let unlockedKey = null;

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveMasterBits(masterPassword, saltBase64) {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltBase64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );
}

function importVaultKey(masterBits) {
  return crypto.subtle.importKey(
    'raw',
    masterBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// The raw PBKDF2 output is the vault key. deriveAuthProof runs it through an
// extra one-way HKDF step before it leaves the browser, so the server can't
// work backward from the proof to the key.
async function unlockVault(masterPassword, saltBase64) {
  unlockedKey = await importVaultKey(await deriveMasterBits(masterPassword, saltBase64));
  return true;
}

async function deriveVaultKey(masterPassword, saltBase64) {
  return importVaultKey(await deriveMasterBits(masterPassword, saltBase64));
}

function installVaultKey(key) {
  unlockedKey = key;
}

async function deriveAuthProof(masterPassword, saltBase64) {
  const masterBits = await deriveMasterBits(masterPassword, saltBase64);
  const hkdfKey = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits']);
  const authBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: base64ToBytes(saltBase64),
      info: new TextEncoder().encode('waystone-auth-v1'),
    },
    hkdfKey,
    256
  );
  return bytesToBase64(new Uint8Array(authBits));
}

function lockVault() {
  unlockedKey = null;
}

function isUnlocked() {
  return unlockedKey !== null;
}

async function encryptItemDataWithKey(key, dataObject) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(dataObject));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    dataEnc: bytesToBase64(new Uint8Array(ciphertextBuf)),
    iv: bytesToBase64(iv),
  };
}

async function encryptItemData(dataObject) {
  if (!unlockedKey) throw new Error('Vault is locked');
  return encryptItemDataWithKey(unlockedKey, dataObject);
}

async function decryptItemData({ dataEnc, iv }) {
  if (!unlockedKey) throw new Error('Vault is locked');

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    unlockedKey,
    base64ToBytes(dataEnc)
  );

  return JSON.parse(new TextDecoder().decode(plaintextBuf));
}

export { unlockVault, deriveVaultKey, installVaultKey, deriveAuthProof, lockVault, isUnlocked, encryptItemData, encryptItemDataWithKey, decryptItemData };
