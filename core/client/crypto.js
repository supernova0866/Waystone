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

async function unlockVault(masterPassword, saltBase64) {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  unlockedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltBase64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return true;
}

function lockVault() {
  unlockedKey = null;
}

function isUnlocked() {
  return unlockedKey !== null;
}

async function encryptItemData(dataObject) {
  if (!unlockedKey) throw new Error('Vault is locked');

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(dataObject));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    unlockedKey,
    plaintext
  );

  return {
    dataEnc: bytesToBase64(new Uint8Array(ciphertextBuf)),
    iv: bytesToBase64(iv),
  };
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

export { unlockVault, lockVault, isUnlocked, encryptItemData, decryptItemData };
