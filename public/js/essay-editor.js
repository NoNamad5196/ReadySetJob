(function () {
  const getCsrfToken = () => document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    children.forEach((c) => c && node.appendChild(c));
    return node;
  };

  function formatCounterText(text, limit) {
    const withSpace = text.length;
    const withoutSpace = text.replace(/\s/g, '').length;
    return limit && Number(limit) > 0
      ? `${withSpace} / ${Number(limit)}자 (공백 포함) · ${withoutSpace}자 (공백 제외)`
      : `${withSpace}자 (공백 포함) · ${withoutSpace}자 (공백 제외)`;
  }

  function createQuestionInitRow(idx, qText = '', charLimit = '1000', answer = '') {
    return el('div', { className: 'essay-question-init-row' }, [
      el('div', { className: 'form-field essay-question-init-row__text' }, [
        el('label', { textContent: `문항 ${idx + 1} 질문 *` }),
        el('input', { type: 'text', name: 'question', className: 'input', placeholder: '문항 질문을 입력해 주세요.', value: qText || '' }),
      ]),
      el('div', { className: 'form-field essay-question-init-row__limit' }, [
        el('label', { textContent: '글자수 제한 (선택)' }),
        el('input', { type: 'number', name: 'char_limit', className: 'input', min: '1', max: '50000', value: charLimit !== null && charLimit !== undefined ? String(charLimit) : '' }),
      ]),
      el('input', { type: 'hidden', name: 'answer', value: answer || '' }),
    ]);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const addQuestionBtn = document.getElementById('add-new-question-row');
    const newQuestionsContainer = document.getElementById('new-questions-container');
    if (addQuestionBtn && newQuestionsContainer) {
      addQuestionBtn.addEventListener('click', () => {
        const idx = newQuestionsContainer.querySelectorAll('.essay-question-init-row').length;
        newQuestionsContainer.appendChild(createQuestionInitRow(idx));
      });
    }

    const extractRoot = document.querySelector('[data-ai-essay-extract-root]');
    if (extractRoot && newQuestionsContainer) {
      const extractForm = extractRoot.querySelector('[data-ai-essay-extract-form]');
      const extractText = extractRoot.querySelector('[data-ai-essay-extract-text]');
      const extractBtn = extractRoot.querySelector('[data-ai-essay-extract-btn]');
      const extractStatus = extractRoot.querySelector('[data-ai-essay-extract-status]');
      const extractError = extractRoot.querySelector('[data-ai-essay-extract-error]');
      const showExtractErr = (msg) => {
        if (!extractError) return;
        extractError.textContent = msg || '';
        extractError.classList.toggle('ai-hidden', !msg);
      };
      if (extractForm && extractText && extractBtn) {
        extractForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          showExtractErr('');
          if (extractStatus) extractStatus.textContent = '';
          const text = (extractText.value || '').trim();
          if (!text) return showExtractErr('추출할 채용 공고 텍스트를 입력해 주세요.');
          const origLabel = extractBtn.textContent;
          extractBtn.disabled = true;
          extractBtn.textContent = 'AI 문항 추출 중...';
          try {
            const res = await fetch('/api/essays/extract-questions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': getCsrfToken() },
              body: JSON.stringify({ text }),
            });
            const body = await res.json();
            if (!res.ok) return showExtractErr(body.error || 'AI 문항 추출에 실패했습니다.');
            const questions = Array.isArray(body.questions) ? body.questions : [];
            if (questions.length > 0) {
              newQuestionsContainer.querySelectorAll('.essay-question-init-row').forEach((r) => r.remove());
              questions.forEach((q, i) => newQuestionsContainer.appendChild(createQuestionInitRow(i, q.question, q.char_limit ?? '', '')));
              if (extractStatus) extractStatus.textContent = `${questions.length}개 문항이 자동으로 채워졌습니다.`;
            }
          } catch {
            showExtractErr('네트워크 오류로 문항을 추출하지 못했습니다.');
          } finally {
            extractBtn.disabled = false;
            extractBtn.textContent = origLabel;
          }
        });
      }
    }

    const draftForm = document.getElementById('essay-draft-form');
    if (!draftForm) return;

    const essayId = draftForm.getAttribute('data-essay-id');
    const statusBadge = document.getElementById('draft-save-status');
    const textareas = Array.from(document.querySelectorAll('.essay-answer-textarea'));
    const titleInput = document.querySelector('input[name="title"][form="essay-draft-form"]');
    let activeTextarea = textareas[0] || null;
    let isDirty = false;
    let isSaving = false;

    const setDirtyState = (dirty, savedAtText) => {
      isDirty = dirty;
      if (!statusBadge) return;
      statusBadge.textContent = dirty ? '저장 안 됨' : `저장됨 · ${savedAtText || new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
      statusBadge.className = dirty ? 'badge badge--dday-soon' : 'badge badge--result-passed';
    };

    const updateCounterForTextarea = (ta) => {
      const qid = ta.getAttribute('data-question-id');
      const limit = ta.getAttribute('data-char-limit') ? Number(ta.getAttribute('data-char-limit')) : null;
      const val = ta.value || '';
      const over = Boolean(limit && val.length > limit);
      ta.classList.toggle('essay-answer-textarea--over', over);
      const counterEl = document.querySelector(`[data-counter-for="${qid}"]`);
      if (counterEl) {
        counterEl.textContent = formatCounterText(val, limit);
        counterEl.classList.toggle('essay-char-counter--over', over);
      }
      const warnEl = document.querySelector(`[data-warning-for="${qid}"]`);
      if (warnEl) warnEl.classList.toggle('essay-overlimit-warning--hidden', !over);
    };

    textareas.forEach((ta) => {
      updateCounterForTextarea(ta);
      ta.addEventListener('focus', () => { activeTextarea = ta; });
      ta.addEventListener('input', () => { updateCounterForTextarea(ta); setDirtyState(true); });
    });
    if (titleInput) titleInput.addEventListener('input', () => setDirtyState(true));

    async function saveDraftAjax() {
      if (isSaving || !essayId) return;
      isSaving = true;
      try {
        const answers = textareas.map((ta) => ({ question_id: Number(ta.getAttribute('data-question-id')), answer: ta.value }));
        const res = await fetch(`/api/essays/${encodeURIComponent(essayId)}/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({ title: titleInput ? titleInput.value : undefined, answers }),
        });
        if (res.ok) setDirtyState(false, (await res.json()).saved_at);
      } finally {
        isSaving = false;
      }
    }

    draftForm.addEventListener('submit', (e) => { e.preventDefault(); saveDraftAjax(); });
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraftAjax(); } });
    window.addEventListener('beforeunload', (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } });

    const tabs = Array.from(document.querySelectorAll('.essay-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-tab-target');
        tabs.forEach((t) => {
          t.classList.toggle('essay-tab--active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        document.querySelectorAll('.essay-tab-panel').forEach((p) => p.classList.toggle('essay-tab-panel--hidden', p.id !== targetId));
      });
    });

    const renderEmptyState = (container, text) => container.replaceChildren(el('div', { className: 'empty-state' }, [el('p', { textContent: text })]));

    const searchForm = document.getElementById('past-essay-search-form');
    const searchInput = document.getElementById('past-essay-search-input');
    const resultsContainer = document.getElementById('past-essay-results');
    if (searchForm && searchInput && resultsContainer) {
      searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await fetch(`/api/essays/search?q=${encodeURIComponent(searchInput.value)}&exclude_essay_id=${encodeURIComponent(essayId)}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data.results) ? data.results : [];
        if (items.length === 0) return renderEmptyState(resultsContainer, '검색된 다른 자기소개서 문항이 없습니다.');
        resultsContainer.replaceChildren(...items.map((item) =>
          el('article', { className: 'essay-ref-item' }, [
            el('div', { className: 'essay-ref-item__meta' }, [
              el('strong', { textContent: item.essay_title }),
              item.company_name ? el('span', { className: 'badge', textContent: item.company_name }) : null,
            ]),
            el('div', { className: 'essay-ref-item__question', textContent: `Q${item.sort_order}. ${item.question}` }),
            el('p', { className: 'essay-ref-item__snippet', textContent: item.snippet || item.answer || '(답변 없음)' }),
            el('a', { href: `/essays/${item.essay_id}`, className: 'btn btn-sm', textContent: '원문 보기' }),
          ])
        ));
      });
    }

    const libSearchForm = document.getElementById('library-ref-search-form');
    const libSearchInput = document.getElementById('library-ref-search-input');
    const libTagInput = document.getElementById('library-ref-tag-input');
    const libResults = document.getElementById('library-ref-results');

    if (libResults) {
      libResults.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-library-insert-btn]');
        const targetTa = activeTextarea || textareas[0];
        const bodyText = btn ? btn.getAttribute('data-library-body') || '' : '';
        if (!btn || !targetTa || !bodyText) return;
        targetTa.value = targetTa.value.trim() ? `${targetTa.value}\n\n${bodyText}` : bodyText;
        updateCounterForTextarea(targetTa);
        setDirtyState(true);
        targetTa.focus();
      });
    }

    async function runLibrarySearch(q = '', tag = '') {
      if (!libResults) return;
      const res = await fetch(`/api/library/search?q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data.results) ? data.results : [];
      if (items.length === 0) return renderEmptyState(libResults, '검색된 라이브러리 항목이 없습니다.');
      libResults.replaceChildren(...items.map((item) => {
        const insBtn = el('button', { type: 'button', className: 'btn btn-sm btn-primary', textContent: '답변에 불러오기' });
        insBtn.setAttribute('data-library-insert-btn', '');
        insBtn.setAttribute('data-library-body', item.body || '');
        return el('article', { className: 'essay-ref-item' }, [
          el('div', { className: 'essay-ref-item__meta' }, [
            el('strong', { textContent: item.title }),
            item.tags ? el('span', { className: 'badge', textContent: item.tags }) : null,
          ]),
          item.question ? el('div', { className: 'essay-ref-item__question', textContent: item.question }) : null,
          el('p', { className: 'essay-ref-item__snippet', textContent: item.snippet || item.body || '' }),
          insBtn,
        ]);
      }));
    }

    if (libSearchForm) {
      libSearchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        runLibrarySearch(libSearchInput ? libSearchInput.value : '', libTagInput ? libTagInput.value : '');
      });
    }

    document.querySelectorAll('[data-save-to-library-form]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[data-save-to-library-btn]');
        if (!btn) return;
        const qid = btn.getAttribute('data-question-id');
        const ta = document.querySelector(`textarea[data-question-id="${qid}"]`);
        const statusEl = document.querySelector(`[data-save-to-library-status="${qid}"]`);
        const bodyText = ta ? ta.value.trim() : '';
        if (!bodyText) {
          if (statusEl) statusEl.textContent = '답변 내용을 먼저 입력해 주세요.';
          return;
        }
        const res = await fetch(form.getAttribute('action'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({ answer: bodyText }),
        });
        if (res.ok) {
          if (statusEl) statusEl.textContent = '라이브러리에 저장됨';
          runLibrarySearch(libSearchInput ? libSearchInput.value : '', libTagInput ? libTagInput.value : '');
        }
      });
    });
  });
})();
