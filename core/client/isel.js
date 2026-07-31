function buildIsel(container, options, selected, onPick) {
  container.innerHTML = '';
  const trigger = document.createElement('div');
  trigger.className = 'isel-trigger';
  trigger.innerHTML = `<span>${selected}</span><span class="isel-arrow">▼</span>`;
  const menu = document.createElement('div');
  menu.className = 'isel-menu';
  menu.innerHTML = options.map(o => `<div class="isel-opt ${o === selected ? 'selected' : ''}" data-v="${o}">${o}</div>`).join('');

  trigger.addEventListener('click', () => {
    document.querySelectorAll('.isel-menu.open').forEach(m => {
      if (m !== menu) { m.classList.remove('open'); m.previousElementSibling.classList.remove('open'); }
    });
    menu.classList.toggle('open');
    trigger.classList.toggle('open');
  });

  menu.querySelectorAll('.isel-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      menu.querySelectorAll('.isel-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      trigger.querySelector('span').textContent = opt.dataset.v;
      menu.classList.remove('open');
      trigger.classList.remove('open');
      onPick && onPick(opt.dataset.v);
    });
  });

  container.appendChild(trigger);
  container.appendChild(menu);
  return { trigger, menu };
}

let globalListenerAttached = false;

function ensureGlobalDismissListener() {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.isel')) {
      document.querySelectorAll('.isel-menu.open').forEach(m => {
        m.classList.remove('open');
        m.previousElementSibling.classList.remove('open');
      });
    }
  });
}

ensureGlobalDismissListener();

export { buildIsel };
