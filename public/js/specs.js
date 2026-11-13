(function () {
  'use strict';

  var board = document.getElementById('spec-board');
  if (!board) return;

  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
  var toast = document.getElementById('spec-toast');
  var dragged = null;

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
