import { checkInviteCode, acceptInvite } from '/core/client/api.js';
import { deriveAuthProof } from '/core/client/crypto.js';
import { initParticles } from '/core/client/particles.js';

initParticles();

let validatedCode = null;
let validatedSalt = null;

const codeForm = document.getElementById('code-form');
const codeInput = document.getElementById('invite-code');
const codeError = document.getElementById('code-error');
const codeSubmit = document.getElementById('code-submit');

const accountForm = document.getElementById('account-form');
const usernameInput = document.getElementById('new-username');
const passwordInput = document.getElementById('new-password');
const accountError = document.getElementById('account-error');
const accountSubmit = document.getElementById('account-submit');

const successBlock = document.getElementById('success-block');

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase();
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = codeInput.value.trim();
  if (!code) return;

  codeError.textContent = '';
  codeSubmit.disabled = true;
  codeSubmit.textContent = 'Checking…';

  try {
    const result = await checkInviteCode(code);
    validatedCode = code;
    validatedSalt = result.salt;
    codeForm.style.display = 'none';
    accountForm.style.display = 'flex';
    usernameInput.focus();
  } catch (err) {
    codeError.textContent = err.status === 410 ? 'That code has already been used.' : 'Invalid invite code.';
  } finally {
    codeSubmit.disabled = false;
    codeSubmit.textContent = 'Continue';
  }
});

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) return;
  if (password.length < 8) {
    accountError.textContent = 'Use at least 8 characters.';
    return;
  }

  accountError.textContent = '';
  accountSubmit.disabled = true;
  accountSubmit.textContent = 'Creating…';

  try {
    const authProof = await deriveAuthProof(password, validatedSalt);
    await acceptInvite(validatedCode, username, authProof);
    accountForm.style.display = 'none';
    successBlock.style.display = 'block';
  } catch (err) {
    accountError.textContent = err.message || 'Something went wrong.';
    accountSubmit.disabled = false;
    accountSubmit.textContent = 'Create account';
  }
});

// Runs after the submit handler is attached
const inviteCodeFromPath = window.location.pathname.match(/^\/invite\/([^/]+)$/);
if (inviteCodeFromPath) {
  try {
    codeInput.value = decodeURIComponent(inviteCodeFromPath[1]).trim().toUpperCase();
  } catch (e) {
    codeInput.value = '';
  }
  if (codeInput.value) codeForm.requestSubmit();
}

// here lay dragons
