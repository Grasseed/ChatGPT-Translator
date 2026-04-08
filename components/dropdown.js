// components/dropdown.js
// 自訂下拉選單元件 — Vercel Design System

class CustomDropdown {
  constructor(container, options = {}) {
    this.container = container;
    this.options = [];
    this.filteredOptions = [];
    this.selectedValue = options.value || null;
    this.placeholder = options.placeholder || '請選擇...';
    this.searchable = options.searchable || false;
    this.onChange = options.onChange || (() => {});
    this.isOpen = false;
    this.highlightIndex = -1;

    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';

    // 觸發器
    this.trigger = document.createElement('button');
    this.trigger.className = 'dropdown-trigger';
    this.trigger.type = 'button';
    this.container.appendChild(this.trigger);
    this.updateTriggerText();

    // 下拉面板
    this.panel = document.createElement('div');
    this.panel.className = 'dropdown-panel hidden';

    if (this.searchable) {
      this.searchInput = document.createElement('input');
      this.searchInput.className = 'dropdown-search';
      this.searchInput.placeholder = '搜尋...';
      this.panel.appendChild(this.searchInput);
    }

    this.listEl = document.createElement('div');
    this.listEl.className = 'dropdown-list';
    this.panel.appendChild(this.listEl);

    this.container.appendChild(this.panel);
  }

  setOptions(options) {
    this.options = options;
    this.filteredOptions = [...options];
    this.renderList();
    this.updateTriggerText();
  }

  renderList() {
    this.listEl.innerHTML = '';
    let lastGroup = null;

    this.filteredOptions.forEach((opt, i) => {
      // 群組分隔
      if (opt.group && opt.group !== lastGroup) {
        if (lastGroup !== null) {
          const divider = document.createElement('div');
          divider.className = 'dropdown-divider';
          this.listEl.appendChild(divider);
        }
        lastGroup = opt.group;
      }

      const item = document.createElement('button');
      item.className = 'dropdown-item';
      item.type = 'button';
      if (opt.value === this.selectedValue) item.classList.add('selected');
      if (i === this.highlightIndex) item.classList.add('highlighted');

      item.innerHTML = `
        <span class="dropdown-item-check">${opt.value === this.selectedValue ? '✓' : ''}</span>
        <span class="dropdown-item-label">${opt.label}</span>
        ${opt.description ? `<span class="dropdown-item-desc">${opt.description}</span>` : ''}
      `;

      item.addEventListener('click', () => this.select(opt.value));
      this.listEl.appendChild(item);
    });
  }

  select(value) {
    this.selectedValue = value;
    this.updateTriggerText();
    this.close();
    this.onChange(value);
    this.renderList();
  }

  updateTriggerText() {
    const selected = this.options.find(o => o.value === this.selectedValue);
    this.trigger.textContent = selected ? selected.label : this.placeholder;
  }

  open() {
    this.isOpen = true;
    this.panel.classList.remove('hidden');
    this.filteredOptions = [...this.options];
    this.highlightIndex = -1;
    this.renderList();
    if (this.searchInput) {
      this.searchInput.value = '';
      this.searchInput.focus();
    }
  }

  close() {
    this.isOpen = false;
    this.panel.classList.add('hidden');
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  filter(query) {
    const q = query.toLowerCase();
    this.filteredOptions = this.options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.description && o.description.toLowerCase().includes(q)) ||
      (o.value && o.value.toLowerCase().includes(q))
    );
    this.highlightIndex = this.filteredOptions.length > 0 ? 0 : -1;
    this.renderList();
  }

  bindEvents() {
    this.trigger.addEventListener('click', () => this.toggle());

    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => this.filter(e.target.value));
    }

    // 鍵盤導航
    this.container.addEventListener('keydown', (e) => {
      if (!this.isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.open();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.highlightIndex = Math.min(this.highlightIndex + 1, this.filteredOptions.length - 1);
          this.renderList();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
          this.renderList();
          break;
        case 'Enter':
          e.preventDefault();
          if (this.highlightIndex >= 0) {
            this.select(this.filteredOptions[this.highlightIndex].value);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
      }
    });

    // 點擊外部關閉
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) this.close();
    });
  }

  getValue() { return this.selectedValue; }
  setValue(value) { this.selectedValue = value; this.updateTriggerText(); this.renderList(); }
}

if (typeof globalThis !== 'undefined') {
  globalThis.CustomDropdown = CustomDropdown;
}
