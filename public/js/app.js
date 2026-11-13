(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('rsj_theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    root.setAttribute('data-theme', savedTheme);
  }

  function fallbackAvatarLogo(img) {
    if (!img || !img.classList || !img.classList.contains('avatar__logo')) return;
    img.classList.remove('is-loaded');
    const parent = img.parentElement;
    if (parent && parent.classList && parent.classList.contains('avatar')) {
      parent.classList.add('avatar--fallback');
    }
    img.remove();
  }

  function settleLogo(img) {
    if (!img || !img.classList || !img.classList.contains('avatar__logo')) return;
    if (img.naturalWidth > 1) {
      img.classList.add('is-loaded');
    } else if (img.complete) {
      fallbackAvatarLogo(img);
    }
  }

  function bindLogoElement(img) {
    if (!img || !img.classList || !img.classList.contains('avatar__logo') || img.dataset.logoBound === '1') return;
    img.dataset.logoBound = '1';
    img.onerror = () => fallbackAvatarLogo(img);
    img.onload = () => settleLogo(img);
    if (img.complete) settleLogo(img);
  }

  document.addEventListener('load', (e) => settleLogo(e.target), true);
  document.addEventListener('error', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('avatar__logo')) {
      fallbackAvatarLogo(e.target);
    }
  }, true);

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

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function flattenSearchResults(data) {
    const items = [];
    const companies = Array.isArray(data && data.companies) ? data.companies : [];
    companies.forEach((c) => {
      if (c && c.href && c.name) {
        items.push({
          category: '기업',
          title: c.name,
          sub: c.industry || '',
          href: c.href,
          kind: 'company',
        });
      }
    });
    const jobs = Array.isArray(data && data.jobs) ? data.jobs : [];
    jobs.forEach((j) => {
      if (j && j.href && j.title) {
        items.push({
          category: '채용 공고',
          title: j.title,
          sub: j.company_name || '',
          href: j.href,
          kind: 'job',
        });
      }
    });
    const apps = Array.isArray(data && data.applications) ? data.applications : [];
    apps.forEach((a) => {
      if (a && a.href && a.company_name) {
        items.push({
          category: '지원',
          title: a.company_name + (a.job_title ? ' — ' + a.job_title : ''),
          sub: a.stage_label || '',
          href: a.href,
          kind: 'application',
        });
      }
    });
    const essays = Array.isArray(data && data.essays) ? data.essays : [];
    essays.forEach((e) => {
      if (e && e.href && e.title) {
        items.push({
          category: '자기소개서',
          title: e.title,
          sub: e.company_name || '',
          href: e.href,
          kind: 'essay',
        });
      }
    });
    const materials = Array.isArray(data && data.materials) ? data.materials : [];
    materials.forEach((m) => {
      if (m && m.href && m.title) {
        items.push({
          category: '자료',
          title: m.title,
          sub: m.kind_label || '',
          href: m.href,
          kind: 'material',
        });
      }
    });
    return items;
  }

  function renderQuickSearchResults(container, data, query) {
    if (!container) return [];
    clearChildren(container);
    const items = flattenSearchResults(data);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'notification-empty';
      empty.textContent = '"' + query + '" 검색 결과가 없습니다.';
      container.appendChild(empty);
      container.classList.remove('ai-hidden');
      return [];
    }

    let lastCategory = '';
    const linkNodes = [];
    items.forEach((item, idx) => {
      if (item.category !== lastCategory) {
        lastCategory = item.category;
        const header = document.createElement('div');
        header.className = 'dropdown-header';
        header.textContent = item.category;
        container.appendChild(header);
      }
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'dropdown-item' + (idx === 0 ? ' dropdown-item--active' : '');
      a.setAttribute('role', 'option');
      a.setAttribute('data-quick-result-item', item.kind);

      const titleSpan = document.createElement('span');
      titleSpan.textContent = item.title;
      a.appendChild(titleSpan);

      if (item.sub) {
        const subSpan = document.createElement('span');
        subSpan.className = 'text-muted text-sm';
        subSpan.textContent = item.sub;
        a.appendChild(subSpan);
      }

      container.appendChild(a);
      linkNodes.push(a);
    });

    container.classList.remove('ai-hidden');
    return linkNodes;
  }

  function bindQuickSearchBox(inputEl, resultsEl, { navigateOnEnter = false } = {}) {
    if (!inputEl || !resultsEl) return;
    let timer = null;
    let activeIndex = 0;
    let currentLinks = [];
    let requestSeq = 0;

    function hideResults() {
      resultsEl.classList.add('ai-hidden');
      clearChildren(resultsEl);
      currentLinks = [];
      activeIndex = 0;
    }

    function updateHighlight(nextIndex) {
      if (!currentLinks.length) return;
      activeIndex = (nextIndex + currentLinks.length) % currentLinks.length;
      currentLinks.forEach((el, i) => {
        el.classList.toggle('dropdown-item--active', i === activeIndex);
      });
    }

    function runQuery() {
      const q = (inputEl.value || '').trim();
      if (!q) {
        hideResults();
        return;
      }
      const seq = ++requestSeq;
      fetch('/api/search?q=' + encodeURIComponent(q), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (seq !== requestSeq || !body) return;
          currentLinks = renderQuickSearchResults(resultsEl, body, q);
          activeIndex = 0;
        })
        .catch(() => {});
    }

    inputEl.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(runQuery, 120);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideResults();
        return;
      }
      if (!currentLinks.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateHighlight(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateHighlight(activeIndex - 1);
      } else if (e.key === 'Enter' && (navigateOnEnter || activeIndex > 0 || currentLinks[0].getAttribute('data-quick-result-item') === 'company')) {
        const target = currentLinks[activeIndex] || currentLinks[0];
        if (target && target.getAttribute('href')) {
          e.preventDefault();
          window.location.href = target.getAttribute('href');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('img.avatar__logo').forEach(bindLogoElement);
    if (typeof MutationObserver === 'function' && document.body) {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((node) => {
            if (!node || node.nodeType !== 1) return;
            if (node.classList && node.classList.contains('avatar__logo')) bindLogoElement(node);
            if (typeof node.querySelectorAll === 'function') {
              node.querySelectorAll('img.avatar__logo').forEach(bindLogoElement);
            }
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    const globalSearchInput = document.getElementById('global-search-input');
    const globalSearchResults = document.getElementById('global-search-results');
    bindQuickSearchBox(globalSearchInput, globalSearchResults, { navigateOnEnter: false });

    const quickLaunchDropdown = document.getElementById('quick-launch-dropdown');
    const quickLaunchInput = document.getElementById('quick-launch-search-input');
    const quickLaunchResults = document.getElementById('quick-launch-results');
    bindQuickSearchBox(quickLaunchInput, quickLaunchResults, { navigateOnEnter: true });

    if (quickLaunchDropdown && quickLaunchInput) {
      quickLaunchDropdown.addEventListener('toggle', () => {
        if (quickLaunchDropdown.open) {
          quickLaunchInput.focus();
        }
      });
    }

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
      if (globalSearchResults && globalSearchInput && !globalSearchInput.closest('form').contains(e.target)) {
        globalSearchResults.classList.add('ai-hidden');
      }
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

    const avatarFileInput = document.querySelector('[data-avatar-file-input]');
    const avatarDataInput = document.querySelector('[data-avatar-data-input]');
    const avatarPreview = document.querySelector('[data-avatar-preview]');
    const avatarStatus = document.querySelector('[data-avatar-status]');
    if (avatarFileInput && avatarDataInput) {
      avatarFileInput.addEventListener('change', () => {
        const file = avatarFileInput.files && avatarFileInput.files[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          avatarDataInput.value = '';
          if (avatarStatus) avatarStatus.textContent = 'PNG, JPEG, WebP 이미지만 선택할 수 있습니다.';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const maxDim = 256;
            const scale = Math.min(1, maxDim / img.width, maxDim / img.height);
            const width = Math.max(1, Math.round(img.width * scale));
            const height = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx2d = canvas.getContext('2d');
            ctx2d.drawImage(img, 0, 0, width, height);
            let dataUrl = canvas.toDataURL('image/webp', 0.85);
            if (!dataUrl.startsWith('data:image/webp')) {
              dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            }
            avatarDataInput.value = dataUrl;
            if (avatarPreview) {
              clearChildren(avatarPreview);
              const previewImg = document.createElement('img');
              previewImg.className = 'avatar__photo';
              previewImg.src = dataUrl;
              previewImg.alt = '프로필 사진 미리보기';
              avatarPreview.appendChild(previewImg);
            }
            if (avatarStatus) {
              avatarStatus.textContent = `리사이즈 완료 (${width}×${height}). '사진 저장'을 눌러 반영하세요.`;
            }
          };
          img.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });
    }
  });
})();

