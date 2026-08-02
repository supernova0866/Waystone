function renderSidebarList(container, categories, activeId, onSelect) {
  container.innerHTML = '';
  for (const cat of categories) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (cat.id === activeId ? ' active' : '');
    el.innerHTML = `
      <span class="tab-icon">${cat.icon || '📁'}</span>
      <span class="tab-label"></span>
      <span class="tab-count"></span>
    `;
    el.querySelector('.tab-label').textContent = cat.name;
    el.querySelector('.tab-count').textContent = cat.itemCount ?? '';
    el.addEventListener('click', () => onSelect(cat.id));
    container.appendChild(el);
  }
}

function newFieldId() {
  return 'f' + Math.random().toString(36).slice(2, 8);
}

function newCategoryId() {
  return 'c' + Math.random().toString(36).slice(2, 10);
}

const FIELD_TYPES = ['text', 'integer', 'rich-text', 'secret'];
const SECRET_SUBTYPES = ['password', 'totp', 'backup-codes'];

/**
 * There's no separate "Title"/"Subtitle" input anymore — an item's card
 * title and subtitle are just the first two non-secret schema fields, in
 * schema order (e.g. a Characters category with Name, Age, Allegiance
 * uses Name as the title and Age as the subtitle). Centralized here since
 * both the item editor (app.js) and the card renderer (items.js) need to
 * agree on which fields those are.
 */
function pickTitleFields(fields) {
  const displayable = (fields || []).filter(f => f.type !== 'secret');
  const titleField = displayable[0] || null;
  const subtitleField = displayable.find(f => f !== titleField) || null;
  return { titleField, subtitleField };
}

export { renderSidebarList, newFieldId, newCategoryId, FIELD_TYPES, SECRET_SUBTYPES, pickTitleFields };
