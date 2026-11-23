(function () {
  'use strict';

  var board = document.getElementById('spec-board');
  if (!board) return;

  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
  var toast = document.getElementById('spec-toast');
  var dragged = null;

  var stageTabsEl = document.getElementById('spec-stage-tabs');
  if (stageTabsEl) {
    var TAB_STORAGE_KEY = 'rsj.specs.activeColumn';
    var tabButtons = Array.prototype.slice.call(stageTabsEl.querySelectorAll('[data-column-tab]'));
    var specColumns = Array.prototype.slice.call(board.querySelectorAll('.spec-column'));
    var columnKeys = specColumns.map(function (col) {
      return col.getAttribute('data-column');
    });

    function activateMobileColumn(colKey, shouldScroll) {
      if (!colKey) return;
      tabButtons.forEach(function (btn) {
        var isActive = btn.getAttribute('data-column-tab') === colKey;
        btn.classList.toggle('spec-stage-tab--active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive && shouldScroll && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      });
      specColumns.forEach(function (col) {
        col.classList.toggle('spec-column--mobile-active', col.getAttribute('data-column') === colKey);
      });
      try {
        window.sessionStorage.setItem(TAB_STORAGE_KEY, colKey);
      } catch (_err) {
        return;
      }
    }

    board.classList.add('spec-board--mobile-tabs');
    var savedCol = null;
    try {
      savedCol = window.sessionStorage.getItem(TAB_STORAGE_KEY);
    } catch (_err) {
      savedCol = null;
    }
    if (savedCol && columnKeys.indexOf(savedCol) !== -1) {
      activateMobileColumn(savedCol, false);
    }

    stageTabsEl.addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('[data-column-tab]');
      if (!btn) return;
      activateMobileColumn(btn.getAttribute('data-column-tab'), true);
    });
  }

  function showError(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
  }

  // Multi-status columns need one concrete target status for a drop.
  function targetStatus(column, card) {
    var key = column.getAttribute('data-column');
    var resultKind = card.getAttribute('data-kind') === 'certificate' || card.getAttribute('data-kind') === 'contest';
    if (key === 'done') return resultKind ? 'passed' : 'completed';
    if (key === 'closed') return resultKind ? 'failed' : 'dropped';
    return key;
  }

  function moveCard(card, column) {
    var status = targetStatus(column, card);
    if (status === card.getAttribute('data-status')) return;
    if (status === 'dropped' && !window.confirm('중단하면 남은 일정과 할 일이 삭제됩니다. 계속할까요?')) return;

    fetch('/api/specs/' + encodeURIComponent(card.getAttribute('data-spec-id')) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'same-origin',
      body: JSON.stringify({ status: status }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.error) || '상태를 변경하지 못했습니다.');
          window.location.reload();
        });
      })
      .catch(function (err) {
        showError(err.message || '상태를 변경하지 못했습니다.');
      });
  }

  board.addEventListener('dragstart', function (event) {
    var card = event.target.closest && event.target.closest('.spec-card');
    if (!card) return;
    dragged = card;
    card.classList.add('spec-card--dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.getAttribute('data-spec-id'));
  });

  board.addEventListener('dragend', function () {
    if (dragged) dragged.classList.remove('spec-card--dragging');
    dragged = null;
    board.querySelectorAll('.spec-column--drag-over').forEach(function (col) {
      col.classList.remove('spec-column--drag-over');
    });
  });

  board.addEventListener('dragover', function (event) {
    var column = event.target.closest && event.target.closest('.spec-column');
    if (!column || !dragged) return;
    event.preventDefault();
    column.classList.add('spec-column--drag-over');
  });

  board.addEventListener('dragleave', function (event) {
    var column = event.target.closest && event.target.closest('.spec-column');
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('spec-column--drag-over');
  });

  board.addEventListener('drop', function (event) {
    var column = event.target.closest && event.target.closest('.spec-column');
    if (!column || !dragged) return;
    event.preventDefault();
    column.classList.remove('spec-column--drag-over');
    moveCard(dragged, column);
  });
})();
