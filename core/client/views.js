const PINNED = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'tags', icon: '🏷️', label: 'Tags' },
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

function hintLine(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function renderFilterChips(chipsEl, filters, onRemove) {
  chipsEl.innerHTML = '';
  filters.forEach((filter, index) => {
    const chip = document.createElement('span');
    chip.className = 'search-chip';
    chip.appendChild(document.createTextNode(`${filter.kind}: ${filter.value}`));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Remove filter';
    remove.textContent = '✕';
    remove.addEventListener('click', () => onRemove(index));
    chip.appendChild(remove);
    chipsEl.appendChild(chip);
  });
}

function renderHomeView(container, { categories, loginCount, commit, stats, query, filters, onSearch, onRemoveFilter }) {
  container.innerHTML = '';

  const home = document.createElement('div');
  home.className = 'home';

  const searchBox = document.createElement('div');
  searchBox.className = 'home-search-box';
  searchBox.title = 'Secrets are never searched';
  const chipsEl = document.createElement('span');
  chipsEl.className = 'search-chips';
  const searchInput = document.createElement('input');
  searchInput.className = 'home-search-input';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search, or filter with service: email: tag:';
  searchInput.value = query || '';
  searchInput.addEventListener('input', () => onSearch(searchInput.value));
  searchBox.appendChild(chipsEl);
  searchBox.appendChild(searchInput);
  home.appendChild(searchBox);

  const refreshChips = () => renderFilterChips(chipsEl, filters, onRemoveFilter);
  refreshChips();

  const bodyEl = document.createElement('div');
  bodyEl.className = 'home-body';

  const grid = document.createElement('div');
  grid.className = 'home-stats';
  const total = stats ? Object.values(stats).reduce((sum, n) => sum + n, 0) : '…';
  grid.appendChild(statCard('Categories', categories.length));
  grid.appendChild(statCard('Saved secrets', total, stats && [
    ['Passwords', stats.password],
    ['Multiline', stats.multiline],
    ['TOTP', stats.totp],
    ['Backup codes', stats['backup-codes']],
  ]));
  grid.appendChild(statCard('Times logged in', loginCount));
  grid.appendChild(statCard('Deployed commit', commit || '—'));
  bodyEl.appendChild(grid);

  const section = document.createElement('div');
  section.className = 'home-section';
  const title = document.createElement('h3');
  title.textContent = 'Favorites';
  const favoritesEl = document.createElement('div');
  section.appendChild(title);
  section.appendChild(favoritesEl);
  bodyEl.appendChild(section);
  home.appendChild(bodyEl);

  const resultsEl = document.createElement('div');
  resultsEl.className = 'home-results hidden';
  home.appendChild(resultsEl);

  container.appendChild(home);

  if (query || filters.length) {
    searchInput.focus();
    const end = searchInput.value.length;
    searchInput.setSelectionRange?.(end, end);
  }

  return { bodyEl, favoritesEl, resultsEl, searchBox, searchInput, refreshChips };
}

function renderFavoriteGroups(container, { loading = false, groups = [], hasCategories = true, emptyText = null }) {
  container.innerHTML = '';

  if (loading || !groups.length) {
    const text = loading
      ? 'Loading favorites…'
      : hasCategories
        ? (emptyText || 'Star an item to pin it here.')
        : 'No categories yet — create one to get started.';
    container.appendChild(hintLine('hint', text));
    return;
  }

  for (const { category, cards } of groups) {
    const group = document.createElement('div');
    group.className = 'favorite-group';

    const heading = document.createElement('div');
    heading.className = 'favorite-group-title';
    const name = document.createElement('span');
    name.textContent = `${category.icon || '📁'} ${category.name}`;
    const count = document.createElement('span');
    count.className = 'badge';
    count.textContent = String(cards.length);
    heading.appendChild(name);
    heading.appendChild(count);

    const cardGrid = document.createElement('div');
    cardGrid.className = 'card-grid';
    for (const card of cards) cardGrid.appendChild(card);

    group.appendChild(heading);
    group.appendChild(cardGrid);
    container.appendChild(group);
  }
}

function renderSearchResults(container, { query, ready, results, total, categoriesById, onView, onEdit }) {
  container.innerHTML = '';

  if (!ready) {
    container.appendChild(hintLine('search-note', 'Still loading your vault…'));
    return;
  }
  if (!results.length) {
    container.appendChild(hintLine('search-note', `No matches for "${query}".`));
    return;
  }

  for (const entry of results) {
    const category = categoriesById.get(entry.categoryId);

    const row = document.createElement('div');
    row.className = 'search-result';
    row.tabIndex = 0;
    row.addEventListener('click', () => onView(entry));
    row.addEventListener('keydown', (e) => {
      if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onView(entry);
      }
    });

    const main = document.createElement('div');
    main.className = 'search-result-main';
    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = entry.title || 'Untitled';
    main.appendChild(title);
    if (entry.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'search-result-sub';
      sub.textContent = entry.subtitle;
      main.appendChild(sub);
    }
    row.appendChild(main);

    if (category) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${category.icon || '📁'} ${category.name}`;
      row.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'search-result-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-icon btn-ghost';
    viewBtn.title = 'View all fields';
    viewBtn.textContent = '👁';
    viewBtn.addEventListener('click', (e) => { e.stopPropagation(); onView(entry); });

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-icon btn-ghost';
    editBtn.title = 'Edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); onEdit(entry); });

    actions.appendChild(viewBtn);
    actions.appendChild(editBtn);
    row.appendChild(actions);
    container.appendChild(row);
  }

  if (total > results.length) {
    container.appendChild(hintLine('search-note', `Showing the first ${results.length} of ${total} matches.`));
  }
}

function attachFavoriteButton(card, isFavorite, onToggle) {
  const footer = card.querySelector('.item-card-footer');
  if (!footer) return;

  const btn = document.createElement('button');
  btn.className = 'btn btn-icon btn-ghost item-card-icon-btn favorite-btn';

  const setState = (on) => {
    btn.classList.toggle('active', on);
    btn.textContent = on ? '★' : '☆';
    btn.title = on ? 'Remove from favorites' : 'Add to favorites';
  };
  setState(isFavorite);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      const next = await onToggle();
      if (typeof next === 'boolean') setState(next);
    } catch (err) {
      alert('Could not update favorite: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  footer.insertBefore(btn, footer.firstChild);
}

export { renderPinnedList, renderHomeView, renderFavoriteGroups, renderSearchResults, attachFavoriteButton };
