(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('rsj_theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    root.setAttribute('data-theme', savedTheme);
  }

  function applyProgressBars() {
    const bars = document.querySelectorAll('[data-progress]');
    bars.forEach((el) => {
      const val = Math.max(0, Math.min(100, Number(el.dataset.progress) || 0));
      el.style.width = val + '%';
    });
    const flexEls = document.querySelectorAll('[data-flex]');
    flexEls.forEach((el) => {
      el.style.flex = el.dataset.flex;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        localStorage.setItem('rsj_theme', next);
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        const searchInput = document.getElementById('global-search-input');
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    });

    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-open');
      });
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        document.body.classList.remove('sidebar-open');
      });
    }

    document.addEventListener('click', (e) => {
      const openDropdowns = document.querySelectorAll('details.dropdown-wrapper[open]');
      openDropdowns.forEach((details) => {
        if (!details.contains(e.target)) {
          details.removeAttribute('open');
        }
      });
    });

    applyProgressBars();

    const confirmForms = document.querySelectorAll('form[data-confirm]');
    for (const form of confirmForms) {
      form.addEventListener('submit', (e) => {
        const msg = form.getAttribute('data-confirm') || '정말 삭제하시겠습니까?';
        if (!window.confirm(msg)) {
          e.preventDefault();
        }
      });
    }
  });
})();
