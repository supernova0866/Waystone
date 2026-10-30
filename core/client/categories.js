let reorderHandler = null;

function setReorderHandler(fn) {
  reorderHandler = fn;
}

function currentOrder(container) {
  return [...container.children].map(c => c.dataset.id);
}

function emitReorder(container, before) {
  const after = currentOrder(container);
  if (after.join('|') !== before.join('|')) reorderHandler?.(after);
}

function attachGrip(grip, el, container) {
  grip.addEventListener('click', (e) => e.stopPropagation());
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const before = currentOrder(container);
    const pointerId = e.pointerId;
    container.setPointerCapture(pointerId);
    el.classList.add('dragging');

    const onMove = (ev) => {
      const siblings = [...container.children].filter(c => c !== el);
      const next = siblings.find(s => {
        const r = s.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      container.insertBefore(el, next || null);
    };
    const onEnd = () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onEnd);
      container.removeEventListener('pointercancel', onEnd);
      if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
      el.classList.remove('dragging');
      emitReorder(container, before);
    };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onEnd);
    container.addEventListener('pointercancel', onEnd);
  });
}

function renderSidebarList(container, categories, activeId, onSelect) {
  container.innerHTML = '';
  for (const cat of categories) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (cat.id === activeId ? ' active' : '');
    el.dataset.id = cat.id;
    el.tabIndex = 0;
    el.innerHTML = `
      <span class="tab-grip" title="Drag to reorder" aria-hidden="true">⠿</span>
      <span class="tab-icon"></span>
      <span class="tab-label"></span>
      <span class="tab-count"></span>
    `;
    el.querySelector('.tab-icon').textContent = cat.icon || '📁';
    el.querySelector('.tab-label').textContent = cat.name;
    el.querySelector('.tab-count').textContent = cat.itemCount ?? '';
    el.addEventListener('click', () => onSelect(cat.id));

    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(cat.id);
        return;
      }
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const before = currentOrder(container);
      if (e.key === 'ArrowUp' && el.previousElementSibling) {
        container.insertBefore(el, el.previousElementSibling);
      } else if (e.key === 'ArrowDown' && el.nextElementSibling) {
        container.insertBefore(el.nextElementSibling, el);
      }
      el.focus();
      emitReorder(container, before);
    });

    attachGrip(el.querySelector('.tab-grip'), el, container);
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
 * An item's card title and subtitle are the first two non-secret schema
 * fields, in schema order. Shared by the item editor (app.js) and the card
 * renderer (items.js).
 */
function pickTitleFields(fields) {
  const displayable = (fields || []).filter(f => f.type !== 'secret');
  const titleField = displayable[0] || null;
  const subtitleField = displayable.find(f => f !== titleField) || null;
  return { titleField, subtitleField };
}

export { renderSidebarList, setReorderHandler, newFieldId, newCategoryId, FIELD_TYPES, SECRET_SUBTYPES, pickTitleFields };
