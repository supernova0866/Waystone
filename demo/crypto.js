import { DEMO_PASSWORD } from '/demo/config.js';

let unlocked = false;

function checkPassword(password) {
  if (password !== DEMO_PASSWORD) throw new Error('Incorrect password');
}

async function unlockVault(password) {
  checkPassword(password);
  unlocked = true;
  return true;
}

async function deriveVaultKey(password) {
  checkPassword(password);
  return { demo: true };
}

function installVaultKey() {
  unlocked = true;
}

async function deriveAuthProof(password) {
  return password;
}

function lockVault() {
  unlocked = false;
}

function isUnlocked() {
  return unlocked;
}

async function encryptItemDataWithKey(key, dataObject) {
  return { dataEnc: JSON.stringify(dataObject), iv: 'demo' };
}

async function encryptItemData(dataObject) {
  if (!unlocked) throw new Error('Vault is locked');
  return encryptItemDataWithKey(null, dataObject);
}

async function decryptItemData({ dataEnc }) {
  if (!unlocked) throw new Error('Vault is locked');
  return JSON.parse(dataEnc);
}

export { unlockVault, deriveVaultKey, installVaultKey, deriveAuthProof, lockVault, isUnlocked, encryptItemData, encryptItemDataWithKey, decryptItemData };
