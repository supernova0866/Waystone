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

function renderHomePlaceholder(container, categories) {
  renderMessage(
    container,
    '🏠',
    categories.length
      ? 'Favorites, stats and search will live here.'
      : 'No categories yet — create one to get started.'
  );
}

function renderTagsPlaceholder(container) {
  renderMessage(container, '🏷', 'Tags will live here.');
}

export { renderPinnedList, renderHomePlaceholder, renderTagsPlaceholder };
