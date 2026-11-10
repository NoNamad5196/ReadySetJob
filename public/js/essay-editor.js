(function () {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function formatCounterText(text, limit) {
    const withSpace = text.length;
    const withoutSpace = text.replace(/\s/g, '').length;
    if (limit && Number(limit) > 0) {
      return `${withSpace} / ${Number(limit)}자 (공백 포함) · ${withoutSpace}자 (공백 제외)`;
    }
    return `${withSpace}자 (공백 포함) · ${withoutSpace}자 (공백 제외)`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const addQuestionBtn = document.getElementById('add-new-question-row');
    const newQuestionsContainer = document.getElementById('new-questions-container');
    if (addQuestionBtn && newQuestionsContainer) {
      addQuestionBtn.addEventListener('click', () => {
        const idx = newQuestionsContainer.querySelectorAll('.essay-question-init-row').length;
        const row = document.createElement('div');
        row.className = 'essay-question-init-row';

        const textWrap = document.createElement('div');
        textWrap.className = 'form-field essay-question-init-row__text';
        const textLabel = document.createElement('label');
        textLabel.textContent = `문항 ${idx + 1} 질문 *`;
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.name = 'question';
        textInput.className = 'input';
        textInput.placeholder = '문항 질문을 입력해 주세요.';
        textWrap.append(textLabel, textInput);

        const limitWrap = document.createElement('div');
        limitWrap.className = 'form-field essay-question-init-row__limit';
        const limitLabel = document.createElement('label');
        limitLabel.textContent = '글자수 제한 (선택)';
        const limitInput = document.createElement('input');
        limitInput.type = 'number';
        limitInput.name = 'char_limit';
        limitInput.className = 'input';
        limitInput.min = '1';
        limitInput.max = '50000';
        limitInput.value = '1000';
        limitWrap.append(limitLabel, limitInput);

        const ansHidden = document.createElement('input');
        ansHidden.type = 'hidden';
        ansHidden.name = 'answer';
        ansHidden.value = '';

        row.append(textWrap, limitWrap, ansHidden);
        newQuestionsContainer.appendChild(row);
      });
    }

    const draftForm = document.getElementById('essay-draft-form');
    if (!draftForm) return;

    const essayId = draftForm.getAttribute('data-essay-id');
    const statusBadge = document.getElementById('draft-save-status');
    const textareas = Array.from(document.querySelectorAll('.essay-answer-textarea'));
    const titleInput = document.querySelector('input[name="title"][form="essay-draft-form"]');
    let isDirty = false;
    let isSaving = false;

    function setDirtyState(dirty, savedAtText) {
      isDirty = dirty;
      if (!statusBadge) return;
      if (dirty) {
        statusBadge.textContent = '저장 안 됨';
        statusBadge.className = 'badge badge--dday-soon';
      } else {
        statusBadge.textContent = `저장됨 · ${savedAtText || new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
        statusBadge.className = 'badge badge--result-passed';
      }
    }

    function updateCounterForTextarea(ta) {
      const qid = ta.getAttribute('data-question-id');
      const limitRaw = ta.getAttribute('data-char-limit');
      const limit = limitRaw ? Number(limitRaw) : null;
      const val = ta.value || '';
      const over = Boolean(limit && val.length > limit);

      ta.classList.toggle('essay-answer-textarea--over', over);
      const counterEl = document.querySelector(`[data-counter-for="${qid}"]`);
      if (counterEl) {
        counterEl.textContent = formatCounterText(val, limit);
        counterEl.classList.toggle('essay-char-counter--over', over);
      }
      const warnEl = document.querySelector(`[data-warning-for="${qid}"]`);
      if (warnEl) {
        warnEl.classList.toggle('essay-overlimit-warning--hidden', !over);
      }
    }

    textareas.forEach((ta) => {
      updateCounterForTextarea(ta);
      ta.addEventListener('input', () => {
        updateCounterForTextarea(ta);
        setDirtyState(true);
      });
    });

    if (titleInput) {
      titleInput.addEventListener('input', () => setDirtyState(true));
    }

    async function saveDraftAjax() {
      if (isSaving || !essayId) return;
      isSaving = true;
      try {
        const answers = textareas.map((ta) => ({
          question_id: Number(ta.getAttribute('data-question-id')),
          answer: ta.value,
        }));
        const payload = {
          title: titleInput ? titleInput.value : undefined,
          answers,
        };
        const res = await fetch(`/api/essays/${encodeURIComponent(essayId)}/draft`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          setDirtyState(false, data.saved_at);
        }
      } finally {
        isSaving = false;
      }
    }

    draftForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveDraftAjax();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDraftAjax();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    const tabs = Array.from(document.querySelectorAll('.essay-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-tab-target');
        tabs.forEach((t) => {
          const active = t === tab;
          t.classList.toggle('essay-tab--active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.essay-tab-panel').forEach((panel) => {
          panel.classList.toggle('essay-tab-panel--hidden', panel.id !== targetId);
        });
      });
    });

    const searchForm = document.getElementById('past-essay-search-form');
    const searchInput = document.getElementById('past-essay-search-input');
    const resultsContainer = document.getElementById('past-essay-results');

    async function runPastSearch(q) {
      if (!resultsContainer) return;
      const url = `/api/essays/search?q=${encodeURIComponent(q)}&exclude_essay_id=${encodeURIComponent(essayId)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data.results) ? data.results : [];
      resultsContainer.replaceChildren();

      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const p = document.createElement('p');
        p.textContent = '검색된 다른 자기소개서 문항이 없습니다.';
        empty.appendChild(p);
        resultsContainer.appendChild(empty);
        return;
      }

      items.forEach((item) => {
        const article = document.createElement('article');
        article.className = 'essay-ref-item';

        const meta = document.createElement('div');
        meta.className = 'essay-ref-item__meta';
        const strong = document.createElement('strong');
        strong.textContent = item.essay_title;
        meta.appendChild(strong);
        if (item.company_name) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = item.company_name;
          meta.appendChild(badge);
        }

        const qDiv = document.createElement('div');
        qDiv.className = 'essay-ref-item__question';
        qDiv.textContent = `Q${item.sort_order}. ${item.question}`;

        const snip = document.createElement('p');
        snip.className = 'essay-ref-item__snippet';
        snip.textContent = item.snippet || item.answer || '(답변 없음)';

        const link = document.createElement('a');
        link.href = `/essays/${item.essay_id}`;
        link.className = 'btn btn-sm';
        link.textContent = '원문 보기';

        article.append(meta, qDiv, snip, link);
        resultsContainer.appendChild(article);
      });
    }

    if (searchForm && searchInput) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        runPastSearch(searchInput.value);
      });
    }
  });
})();
