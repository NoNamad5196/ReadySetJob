(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('rsj_theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    root.setAttribute('data-theme', savedTheme);
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
