import { buildIsel } from '/core/client/isel.js';

const TAG_SORTS = ['A–Z', 'Recently updated', 'By category'];

let activePopover = null;

function closePopover() {
  if (!activePopover) return;
  const { el, cleanup, onClose } = activePopover;
  activePopover = null;
  cleanup();
  el.remove();
  onClose?.();
}

function placePopover(el, anchor) {
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8));
  let top = a.bottom + 6;
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, a.top - r.height - 6);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.visibility = 'visible';
}

function openPopover(anchor, el, onClose) {
  closePopover();
  placePopover(el, anchor);

  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => { if (e.key === 'Escape') closePopover(); };
  const onScroll = (e) => { if (!el.contains(e.target)) closePopover(); };
  const onResize = () => closePopover();

  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);

  activePopover = {
    el,
    onClose,
    cleanup: () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    },
  };
}

function textEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function attachTagArea(card, { getTags, onOpenPicker, onShowAll, onChipClick }) {
  const footer = card.querySelector('.item-card-footer');
  if (!footer) return null;

  const wrap = document.createElement('div');
  wrap.className = 'item-card-tags';
  footer.insertBefore(wrap, footer.firstChild);

  function refresh() {
    wrap.innerHTML = '';
    const tags = getTags();

    for (const tag of tags.slice(0, 2)) {
      const chip = textEl('button', 'tag-chip', tag.name);
      chip.title = tag.name;
      chip.addEventListener('click', (e) => { e.stopPropagation(); onChipClick(tag); });
      wrap.appendChild(chip);
    }

    const add = textEl('button', 'tag-add-btn', '+');
    add.title = 'Add tag';
    add.addEventListener('click', (e) => { e.stopPropagation(); onOpenPicker(add); });
    wrap.appendChild(add);

    if (tags.length > 2) {
      const more = textEl('button', 'tag-more-btn', `+${tags.length - 2}`);
      more.title = `Show all ${tags.length} tags`;
      more.addEventListener('click', (e) => { e.stopPropagation(); onShowAll(more); });
      wrap.appendChild(more);
    }
  }

  refresh();
  return { refresh };
}

function openTagPicker(anchor, { tags, selectedIds, onToggle, onCreate, onClose }) {
  const pop = document.createElement('div');
  pop.className = 'tag-popover';

  const createRow = document.createElement('div');
  createRow.className = 'tag-popover-create';
  const input = document.createElement('input');
  input.className = 'input';
  input.maxLength = 32;
  input.placeholder = 'New tag…';
  const addBtn = textEl('button', 'btn btn-primary btn-sm', 'Add');
  createRow.appendChild(input);
  createRow.appendChild(addBtn);

  const errorEl = textEl('div', 'tag-popover-error', '');
  const list = document.createElement('div');
  list.className = 'tag-popover-list';
  const emptyEl = textEl('p', 'hint', 'No tags yet. Type a name above.');
  const boxes = new Map();

  function addOption(tag, checked) {
    const label = document.createElement('label');
    label.className = 'tag-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', async () => {
      errorEl.textContent = '';
      box.disabled = true;
      try {
        await onToggle(tag.id, box.checked);
      } catch (err) {
        box.checked = !box.checked;
        errorEl.textContent = err.message;
      } finally {
        box.disabled = false;
      }
    });
    label.appendChild(box);
    label.appendChild(textEl('span', '', tag.name));
    list.appendChild(label);
    boxes.set(tag.id, box);
    emptyEl.classList.add('hidden');
  }

  for (const tag of tags) addOption(tag, selectedIds.has(tag.id));
  list.appendChild(emptyEl);
  if (tags.length) emptyEl.classList.add('hidden');

  async function submit() {
    const name = input.value.trim();
    if (!name) return;
    errorEl.textContent = '';
    addBtn.disabled = true;
    try {
      const tag = await onCreate(name);
      const existing = boxes.get(tag.id);
      if (existing) existing.checked = true;
      else addOption(tag, true);
      input.value = '';
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      addBtn.disabled = false;
      input.focus();
    }
  }
  addBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  pop.appendChild(createRow);
  pop.appendChild(errorEl);
  pop.appendChild(list);
  openPopover(anchor, pop, onClose);
  input.focus();
}

function openTagList(anchor, { tags, onOpenTag, onRemove, onClose }) {
  const pop = document.createElement('div');
  pop.className = 'tag-popover';
  pop.appendChild(textEl('div', 'tag-popover-title', 'All tags'));
  const errorEl = textEl('div', 'tag-popover-error', '');
  const list = document.createElement('div');
  list.className = 'tag-popover-list';

  for (const tag of tags) {
    const row = document.createElement('div');
    row.className = 'tag-list-row';

    const name = textEl('button', 'tag-list-name', tag.name);
    name.title = `Show items tagged ${tag.name}`;
    name.addEventListener('click', () => {
      closePopover();
      onOpenTag(tag);
    });

    const remove = textEl('button', 'tag-list-remove', '✕');
    remove.title = 'Remove from this item';
    remove.addEventListener('click', async () => {
      errorEl.textContent = '';
      remove.disabled = true;
      try {
        await onRemove(tag);
        row.remove();
        if (!list.children.length) closePopover();
      } catch (err) {
        errorEl.textContent = err.message;
        remove.disabled = false;
      }
    });

    row.appendChild(name);
    row.appendChild(remove);
    list.appendChild(row);
  }

  pop.appendChild(list);
  pop.appendChild(errorEl);
  openPopover(anchor, pop, onClose);
}

function renderTagList(container, { tags, counts, onOpen, onRename, onDelete }) {
  container.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'tags-page';

  if (!tags.length) {
    page.appendChild(textEl('p', 'hint', 'No tags yet. Use "New tag" above, or add one from the + on any card.'));
  }

  const grid = document.createElement('div');
  grid.className = 'tag-grid';

  for (const tag of tags) {
    const card = document.createElement('div');
    card.className = 'tag-card';
    card.tabIndex = 0;
    card.addEventListener('click', () => onOpen(tag));
    card.addEventListener('keydown', (e) => {
      if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onOpen(tag);
      }
    });

    const main = document.createElement('div');
    main.className = 'tag-card-main';
    main.appendChild(textEl('div', 'tag-card-name', tag.name));
    const count = counts ? counts.get(tag.id) || 0 : null;
    main.appendChild(textEl('div', 'tag-card-count', count === null ? '…' : `${count} ${count === 1 ? 'item' : 'items'}`));
    card.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'tag-card-actions';
    const rename = textEl('button', 'btn btn-icon btn-ghost', '✎');
    rename.title = 'Rename';
    rename.addEventListener('click', (e) => { e.stopPropagation(); onRename(tag); });
    const remove = textEl('button', 'btn btn-icon btn-ghost', '🗑');
    remove.title = 'Delete tag';
    remove.addEventListener('click', (e) => { e.stopPropagation(); onDelete(tag); });
    actions.appendChild(rename);
    actions.appendChild(remove);
    card.appendChild(actions);

    grid.appendChild(card);
  }

  if (tags.length) page.appendChild(grid);
  container.appendChild(page);
}

function renderTagDetailShell(container, { tag, sort, onBack, onSort }) {
  container.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'tags-page';

  const head = document.createElement('div');
  head.className = 'tag-detail-head';
  const back = textEl('button', 'btn btn-ghost btn-sm', '← All tags');
  back.addEventListener('click', onBack);
  head.appendChild(back);
  head.appendChild(textEl('h2', 'tag-detail-title', tag.name));
  head.appendChild(textEl('div', 'tag-detail-spacer', ''));

  const sortWrap = document.createElement('div');
  sortWrap.className = 'tag-sort';
  sortWrap.appendChild(textEl('span', '', 'Sort'));
  const select = document.createElement('div');
  select.className = 'isel';
  buildIsel(select, TAG_SORTS, sort, onSort);
  sortWrap.appendChild(select);
  head.appendChild(sortWrap);

  const content = document.createElement('div');
  page.appendChild(head);
  page.appendChild(content);
  container.appendChild(page);
  return content;
}

function renderCardGrid(container, cards, emptyText) {
  container.innerHTML = '';
  if (!cards.length) {
    container.appendChild(textEl('p', 'hint', emptyText));
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  for (const card of cards) grid.appendChild(card);
  container.appendChild(grid);
}

export {
  TAG_SORTS,
  closePopover,
  attachTagArea,
  openTagPicker,
  openTagList,
  renderTagList,
  renderTagDetailShell,
  renderCardGrid,
};
