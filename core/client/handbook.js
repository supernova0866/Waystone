import { DEMO_USERNAME, DEMO_PASSWORD } from '/demo/config.js';
import { initParticles } from '/core/client/particles.js';

initParticles();

function wireCopy(button, value) {
  button.addEventListener('click', () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 900);
  });
}

document.getElementById('demo-username').textContent = DEMO_USERNAME;
document.getElementById('demo-password').textContent = DEMO_PASSWORD;
wireCopy(document.getElementById('demo-copy-username'), DEMO_USERNAME);
wireCopy(document.getElementById('demo-copy-password'), DEMO_PASSWORD);

if (window.location.hash === '#demo') document.getElementById('demo').scrollIntoView();
