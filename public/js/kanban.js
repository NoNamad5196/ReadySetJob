(function () {
  const board = document.getElementById('kanban-board');
  if (!board) return;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
  const toastEl = document.getElementById('kanban-toast');
  const stages = (board.getAttribute('data-stages') || 'document,coding_test,assignment,interview1,interview2,final')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const placeholder = document.createElement('div');
  placeholder.className = 'kanban-drop-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');

  let draggedCard = null;
  let dragSnapshot = null;
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3500);
  }

  function getColumnBody(stage) {
    return board.querySelector(`[data-column-body="${stage}"]`);
  }

  function getCardsInBody(bodyEl) {
    return Array.from(bodyEl.querySelectorAll('.kanban-card'));
  }

  function updateColumnCounts() {
    for (const stage of stages) {
      const bodyEl = getColumnBody(stage);
      const countEl = board.querySelector(`[data-column-count="${stage}"]`);
      const tabCountEl = document.querySelector(`[data-tab-count="${stage}"]`);
      if (bodyEl) {
        const cards = getCardsInBody(bodyEl);
        if (countEl) countEl.textContent = String(cards.length);
        if (tabCountEl) tabCountEl.textContent = String(cards.length);
        cards.forEach((c, idx) => {
          c.setAttribute('data-board-order', String(idx));
        });
      }
    }
  }

  const stageTabsEl = document.getElementById('kanban-stage-tabs');
  if (stageTabsEl) {
    const TAB_STORAGE_KEY = 'rsj.kanban.activeStage';
    const tabButtons = Array.from(stageTabsEl.querySelectorAll('[data-stage-tab]'));
    const columns = Array.from(board.querySelectorAll('.kanban-column'));

    function activateMobileStage(stageKey, shouldScroll) {
      if (!stageKey) return;
      for (const btn of tabButtons) {
        const isActive = btn.getAttribute('data-stage-tab') === stageKey;
        btn.classList.toggle('board-stage-tab--active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive && shouldScroll && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }
      for (const col of columns) {
        col.classList.toggle('kanban-column--mobile-active', col.getAttribute('data-stage') === stageKey);
      }
      try {
        window.sessionStorage.setItem(TAB_STORAGE_KEY, stageKey);
      } catch (_err) {
        return;
      }
    }

    board.classList.add('kanban-board--mobile-tabs');
    let savedStage = null;
    try {
      savedStage = window.sessionStorage.getItem(TAB_STORAGE_KEY);
    } catch (_err) {
      savedStage = null;
    }
    if (savedStage && stages.includes(savedStage)) {
      activateMobileStage(savedStage, false);
    }

    stageTabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stage-tab]');
      if (!btn) return;
      activateMobileStage(btn.getAttribute('data-stage-tab'), true);
    });
  }

  function syncCardStageAttrs(card, stage) {
    card.setAttribute('data-stage', stage);
    const select = card.querySelector('select[name="stage"]');
    if (select) {
      select.value = stage;
    }
  }

  function revertMove(card, snapshot) {
    if (!card || !snapshot || !snapshot.originBody) return;
    if (snapshot.originNextSibling && snapshot.originNextSibling.parentElement === snapshot.originBody) {
      snapshot.originBody.insertBefore(card, snapshot.originNextSibling);
    } else {
      snapshot.originBody.appendChild(card);
    }
    syncCardStageAttrs(card, snapshot.originStage);
    updateColumnCounts();
  }

  async function commitMove(card, toStage, toIndex, snapshot) {
    const appId = card.getAttribute('data-application-id');
    syncCardStageAttrs(card, toStage);
    updateColumnCounts();

    try {
      const res = await fetch(`/api/applications/${encodeURIComponent(appId)}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ stage: toStage, index: toIndex }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok === false) {
        revertMove(card, snapshot);
        showToast((data && data.error) || '단계 이동에 실패하여 원래 위치로 되돌렸습니다.');
        return false;
      }

      updateColumnCounts();
      return true;
    } catch {
      revertMove(card, snapshot);
      showToast('네트워크 오류로 카드 위치를 원래대로 되돌렸습니다.');
      return false;
    }
  }

  function getDragAfterElement(container, mouseY) {
    const cards = Array.from(
      container.querySelectorAll('.kanban-card:not(.kanban-card--dragging)')
    );
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

    for (const child of cards) {
      const box = child.getBoundingClientRect();
      const offset = mouseY - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: child };
      }
    }
    return closest.element;
  }

  board.addEventListener('dragstart', (e) => {
    if (e.target.closest('form, select, button, input')) {
      e.preventDefault();
      return;
    }
    const card = e.target.closest('.kanban-card');
    if (!card) return;

    draggedCard = card;
    dragSnapshot = {
      originBody: card.parentElement,
      originNextSibling: card.nextElementSibling,
      originStage: card.getAttribute('data-stage'),
    };

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-application-id') || '');
    }

    card.classList.add('kanban-card--dragging');
  });

  board.addEventListener('dragend', () => {
    if (draggedCard) {
      draggedCard.classList.remove('kanban-card--dragging');
    }
    if (placeholder.parentElement) {
      placeholder.parentElement.removeChild(placeholder);
    }
    for (const col of board.querySelectorAll('.kanban-column--drag-over')) {
      col.classList.remove('kanban-column--drag-over');
    }
    draggedCard = null;
    dragSnapshot = null;
  });

  for (const column of board.querySelectorAll('.kanban-column')) {
    const bodyEl = column.querySelector('.kanban-column__body');

    column.addEventListener('dragover', (e) => {
      if (!draggedCard || !bodyEl) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      column.classList.add('kanban-column--drag-over');

      const afterElement = getDragAfterElement(bodyEl, e.clientY);
      if (!afterElement) {
        bodyEl.appendChild(placeholder);
      } else {
        bodyEl.insertBefore(placeholder, afterElement);
      }
    });

    column.addEventListener('dragleave', (e) => {
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove('kanban-column--drag-over');
      }
    });

    column.addEventListener('drop', (e) => {
      if (!draggedCard || !bodyEl) return;
      e.preventDefault();
      column.classList.remove('kanban-column--drag-over');

      const toStage = column.getAttribute('data-stage');
      if (placeholder.parentElement === bodyEl) {
        bodyEl.insertBefore(draggedCard, placeholder);
        bodyEl.removeChild(placeholder);
      } else {
        const afterElement = getDragAfterElement(bodyEl, e.clientY);
        if (!afterElement) {
          bodyEl.appendChild(draggedCard);
        } else {
          bodyEl.insertBefore(draggedCard, afterElement);
        }
      }

      const cards = getCardsInBody(bodyEl);
      const toIndex = Math.max(0, cards.indexOf(draggedCard));
      const snapshot = dragSnapshot;
      const cardRef = draggedCard;
      cardRef.classList.remove('kanban-card--dragging');
      draggedCard = null;
      dragSnapshot = null;

      commitMove(cardRef, toStage, toIndex, snapshot);
    });
  }

  board.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const validKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!validKeys.includes(e.key)) return;

    const card = e.target.closest('.kanban-card');
    if (!card) return;

    e.preventDefault();
    const currentStage = card.getAttribute('data-stage');
    const stageIdx = stages.indexOf(currentStage);
    const originBody = card.parentElement;
    if (!originBody || stageIdx === -1) return;

    const snapshot = {
      originBody,
      originNextSibling: card.nextElementSibling,
      originStage: currentStage,
    };

    const currentCards = getCardsInBody(originBody);
    const currentIdx = currentCards.indexOf(card);

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const targetStageIdx = e.key === 'ArrowLeft' ? stageIdx - 1 : stageIdx + 1;
      if (targetStageIdx < 0 || targetStageIdx >= stages.length) return;
      const targetStage = stages[targetStageIdx];
      const targetBody = getColumnBody(targetStage);
      if (!targetBody) return;

      targetBody.appendChild(card);
      card.focus();
      const toIndex = getCardsInBody(targetBody).indexOf(card);
      commitMove(card, targetStage, toIndex, snapshot);
    } else if (e.key === 'ArrowUp') {
      if (currentIdx <= 0) return;
      originBody.insertBefore(card, currentCards[currentIdx - 1]);
      card.focus();
      commitMove(card, currentStage, currentIdx - 1, snapshot);
    } else if (e.key === 'ArrowDown') {
      if (currentIdx === -1 || currentIdx >= currentCards.length - 1) return;
      const nextAfter = currentCards[currentIdx + 1].nextElementSibling;
      originBody.insertBefore(card, nextAfter);
      card.focus();
      commitMove(card, currentStage, currentIdx + 1, snapshot);
    }
  });
})();
