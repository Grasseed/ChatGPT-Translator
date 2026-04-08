// components/toast.js
// 簡單的 Toast 通知元件

const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        display: flex; flex-direction: column; gap: 8px;
      `;
      document.body.appendChild(this._container);
    }
    return this._container;
  },

  show(message, type = 'info', duration = 3000) {
    const container = this._getContainer();
    const toast = document.createElement('div');

    const colors = {
      success: { bg: '#f0fdf4', border: '#17a34a', text: '#15803d' },
      error: { bg: '#fef2f2', border: '#ef4444', text: '#dc2626' },
      info: { bg: '#f0f9ff', border: '#0072f5', text: '#0068d6' },
    };
    const c = colors[type] || colors.info;

    toast.style.cssText = `
      padding: 10px 16px; border-radius: 8px; font-size: 13px;
      font-family: 'Inter', -apple-system, sans-serif; font-weight: 500;
      background: ${c.bg}; color: ${c.text};
      box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 4px 12px rgba(0,0,0,0.1);
      border-left: 3px solid ${c.border};
      animation: slideIn 0.2s ease; max-width: 360px;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.Toast = Toast;
}
