const PINNED = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'tags', icon: '🏷', label: 'Tags' },
];

function renderPinnedList(container, activeView, onSelect) {
  container.innerHTML = '';
  for (const entry of PINNED) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (entry.id === activeView ? ' active' : '');
    el.tabIndex = 0;
    el.innerHTML = `
      <span class="tab-grip spacer" aria-hidden="true">⠿</span>
      <span class="tab-icon"></span>
      <span class="tab-label"></span>
    `;
    el.querySelector('.tab-icon').textContent = entry.icon;
    el.querySelector('.tab-label').textContent = entry.label;
    el.addEventListener('click', () => onSelect(entry.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(entry.id);
      }
    });
    container.appendChild(el);
  }
}

function renderMessage(container, icon, text) {
  container.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const iconEl = document.createElement('div');
  iconEl.className = 'es-icon';
  iconEl.textContent = icon;
  empty.appendChild(iconEl);
  empty.appendChild(document.createTextNode(text));
  container.appendChild(empty);
}

function statCard(label, value, breakdown = null) {
  const card = document.createElement('div');
  card.className = 'stat-card';

  const labelEl = document.createElement('div');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'stat-value';
  valueEl.textContent = value;

  card.appendChild(labelEl);
  card.appendChild(valueEl);

  if (breakdown) {
    const list = document.createElement('div');
    list.className = 'stat-breakdown';
    for (const [name, count] of breakdown) {
      const row = document.createElement('div');
      row.className = 'stat-breakdown-row';
      const nameEl = document.createElement('span');
      nameEl.textContent = name;
      const countEl = document.createElement('span');
      countEl.textContent = count;
      row.appendChild(nameEl);
      row.appendChild(countEl);
      list.appendChild(row);
    }
    card.appendChild(list);
  }

  return card;
}

function renderHomeView(container, { categories, loginCount, commit, stats }) {
  container.innerHTML = '';

  const home = document.createElement('div');
  home.className = 'home';

  const grid = document.createElement('div');
  grid.className = 'home-stats';
  const total = stats ? stats.password + stats.totp + stats['backup-codes'] : '…';
  grid.appendChild(statCard('Categories', categories.length));
  grid.appendChild(statCard('Saved secrets', total, stats && [
    ['Passwords', stats.password],
    ['TOTP', stats.totp],
    ['Backup codes', stats['backup-codes']],
  ]));
  grid.appendChild(statCard('Times logged in', loginCount));
  grid.appendChild(statCard('Deployed commit', commit || '—'));
  home.appendChild(grid);

  const section = document.createElement('div');
  section.className = 'home-section';
  const title = document.createElement('h3');
  title.textContent = 'Favorites';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = categories.length
    ? 'Items you favorite will appear here, grouped by category.'
    : 'No categories yet — create one to get started.';
  section.appendChild(title);
  section.appendChild(hint);
  home.appendChild(section);

  container.appendChild(home);
}

function renderTagsPlaceholder(container) {
  renderMessage(container, '🏷', 'Tags will live here.');
}

export { renderPinnedList, renderHomeView, renderTagsPlaceholder };
