let active = null;

function closeAutofill() {
  active?.close();
}

function attachAutofill(input, { getSuggestions, onPick, anchor = input }) {
  let list = null;
  let items = [];
  let index = -1;
  let dismissed = false;

  input.autocomplete = 'off';
  input.spellcheck = false;

  const onScroll = (e) => { if (list && !list.contains(e.target)) close(); };

  function close() {
    if (list) {
      list.remove();
      list = null;
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
    }
    items = [];
    index = -1;
    if (active && active.owner === input) active = null;
  }

  function place() {
    const rect = anchor.getBoundingClientRect();
    list.style.minWidth = rect.width + 'px';
    list.style.left = rect.left + 'px';
    list.style.top = rect.bottom + 4 + 'px';
    const height = list.getBoundingClientRect().height;
    if (rect.bottom + 4 + height > window.innerHeight - 8) {
      list.style.top = Math.max(8, rect.top - height - 4) + 'px';
    }
  }

  function highlight() {
    [...list.children].forEach((opt, i) => opt.classList.toggle('active', i === index));
  }

  function pick(i) {
    const value = items[i];
    close();
    onPick(value);
  }

  function render() {
    if (!list) {
      list = document.createElement('div');
      list.className = 'autofill-list';
      document.body.appendChild(list);
      window.addEventListener('resize', close);
      document.addEventListener('scroll', onScroll, true);
    }
    list.innerHTML = '';
    items.forEach((text, i) => {
      const opt = document.createElement('div');
      opt.className = 'autofill-opt';
      opt.textContent = text;
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(i);
      });
      list.appendChild(opt);
    });
    place();
    highlight();
    active = { owner: input, close };
  }

  function refresh() {
    if (dismissed) return close();
    const found = getSuggestions(input.value);
    if (!found.length) return close();
    items = found;
    index = -1;
    render();
  }

  function move(delta) {
    index = index === -1
      ? (delta > 0 ? 0 : items.length - 1)
      : (index + delta + items.length) % items.length;
    highlight();
  }

  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => { dismissed = false; });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (!list) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'Enter' || e.key === 'Tab') && index >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      dismissed = true;
      close();
    }
  });

  return { close };
}

export { attachAutofill, closeAutofill };
