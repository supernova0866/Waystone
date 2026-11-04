document.title = 'WayStone — Demo';
document.body.classList.add('demo-page');

const banner = document.createElement('div');
banner.id = 'demo-banner';
banner.className = 'demo-banner hidden';
banner.textContent = 'You are using the read-only demo. Nothing here is saved.';
document.querySelector('.main-area')?.prepend(banner);

await import('/core/client/app.js');
