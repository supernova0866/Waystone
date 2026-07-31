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

export { renderSidebarList, newFieldId, newCategoryId, FIELD_TYPES, SECRET_SUBTYPES };
