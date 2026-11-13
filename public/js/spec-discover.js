(function () {
  'use strict';

  var root = document.querySelector('[data-sd-root]');
  var form = document.querySelector('[data-sd-form]');
  if (!root || !form) return;

  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrf = csrfMeta ? csrfMeta.getAttribute('content') : '';
  var panels = Array.prototype.slice.call(form.querySelectorAll('[data-sd-panel]'));
  var statusEl = form.querySelector('[data-sd-status]');
  var submitBtn = form.querySelector('[data-sd-submit]');
  var errorEl = root.querySelector('[data-sd-error]');
  var results = document.querySelector('[data-sd-results]');
  var list = document.querySelector('[data-sd-list]');
  var template = document.querySelector('[data-sd-template]');
  var catalogInput = form.querySelector('[data-sd-cert-query]');
  var catalogSelect = form.querySelector('[data-sd-cert-select]');
  var catalogStatus = form.querySelector('[data-sd-catalog-status]');
  var catalogTimer = null;
  var MAX_FIELDS = 3;

  function toggle(el, hidden) { if (el) el.classList.toggle('sd-hidden', hidden); }
  function selectedKind() {
    var checked = form.querySelector('[data-sd-kind]:checked');
    return checked ? checked.value : 'certificate';
  }

  function syncPanels() {
    var kind = selectedKind();
    panels.forEach(function (panel) {
      toggle(panel, panel.getAttribute('data-sd-panel').split(' ').indexOf(kind) === -1);
    });
  }

  function setText(scope, name, value) {
    var el = scope.querySelector('[data-field="' + name + '"]');
    if (el) el.textContent = value || '';
    return el;
  }
  function setValue(scope, name, value) {
    var el = scope.querySelector('[data-field="' + name + '"]');
    if (el) el.value = value || '';
  }
  function range(a, b) { return a && b && a !== b ? a + ' ~ ' + b : a || b || ''; }

  function renderCard(item) {
    var node = template.content.firstElementChild.cloneNode(true);
    node.classList.toggle('sd-card--urgent', item.dday && item.dday.state === 'urgent');
    var avatar = setText(node, 'avatar', item.avatar.initial);
    avatar.classList.add(item.avatar.className);
    if (item.avatar.logoSrc) {
      var img = document.createElement('img');
      img.className = 'avatar__logo';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = item.avatar.logoSrc;
      avatar.appendChild(img);
    }
    setText(node, 'title', item.title);
    setText(node, 'organizer', item.organizer);
    setText(node, 'dday', item.dday.label).classList.add('badge--dday-' + item.dday.state);
    setText(node, 'kind', item.kind_label);
    setText(node, 'source-label', item.source_label);
    node.querySelector('[data-field="source"]').classList.add('sd-source--' + item.source_tier);
    setText(node, 'apply', range(item.apply_start, item.apply_end));
    setText(node, 'event', range(item.event_date, item.end_date));
    setText(node, 'event-label', item.kind === 'bootcamp' ? '교육 기간' : '시험·행사');
    setText(node, 'result', item.result_date);
    toggle(node.querySelector('[data-row="apply"]'), !(item.apply_start || item.apply_end));
    toggle(node.querySelector('[data-row="event"]'), !(item.event_date || item.end_date));
    toggle(node.querySelector('[data-row="result"]'), !item.result_date);
    setText(node, 'memo', item.memo);
    node.querySelector('[data-field="url"]').href = item.source_url;
    setValue(node, 'f-token', item.token);
    setValue(node, 'f-cert', item.cert_code);
    setValue(node, 'f-company', item.organizer);
    setValue(node, 'f-title', item.title);
    setValue(node, 'f-deadline', item.apply_end);
    setValue(node, 'f-url', item.source_url);
    setValue(node, 'f-memo', item.memo);
    toggle(node.querySelector('[data-action="watch"]'), !item.can_watch);
    toggle(node.querySelector('[data-action="job"]'), !item.is_job);
    toggle(node.querySelector('[data-action="register"]'), item.is_job);
    return node;
  }

  function renderResults(data) {
    list.textContent = '';
    data.items.forEach(function (item) { list.appendChild(renderCard(item)); });
    results.querySelector('[data-sd-count]').textContent = String(data.items.length);
    var notices = results.querySelector('[data-sd-notices]');
    notices.textContent = '';
    data.notices.forEach(function (n) {
      var li = document.createElement('li');
      var strong = document.createElement('strong');
      strong.textContent = n.label;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(' ' + n.message));
      notices.appendChild(li);
    });
    toggle(notices, data.notices.length === 0);
    results.querySelector('[data-sd-dropped-count]').textContent = String(data.dropped || 0);
    toggle(results.querySelector('[data-sd-dropped]'), !data.dropped);
    toggle(results.querySelector('[data-sd-empty]'), data.items.length > 0);
    toggle(results, false);
  }

  function collect() {
    var data = new FormData(form);
    var kind = selectedKind();
    var payload = { kind: kind, mode: 'search' };
    ['cert_code', 'year', 'keyword', 'region', 'months', 'degree', 'private_cert', 'ncs', 'track'].forEach(function (key) {
      var value = data.get(key);
      if (typeof value === 'string') payload[key] = value;
    });
    payload.fields = data.getAll(kind === 'grad_school' ? 'grad_fields' : 'activity_fields');
    if (['contest', 'activity', 'grad_school'].indexOf(kind) === -1) payload.fields = [];
    return payload;
  }

  function showError(message) {
    errorEl.textContent = message || '';
    toggle(errorEl, !message);
  }

  form.addEventListener('submit', function (event) {
    var mode = event.submitter && event.submitter.value;
    event.preventDefault();
    if (mode === 'catalog') { loadCatalog(); return; }
    showError('');
    submitBtn.disabled = true;
    statusEl.textContent = '공식 데이터와 기관 공지를 확인하는 중입니다...';
    fetch('/api/specs/discover', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(collect()),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || '스펙 검색에 실패했습니다.');
        return body;
      });
    }).then(function (body) {
      renderResults(body);
      statusEl.textContent = body.items.length + '건을 찾았습니다.';
    }).catch(function (err) {
      statusEl.textContent = '';
      showError(err.message);
    }).finally(function () { submitBtn.disabled = false; });
  });

  function loadCatalog() {
    var query = catalogInput.value.trim();
    catalogStatus.textContent = '자격증 목록을 불러오는 중입니다...';
    fetch('/specs/discover/catalog?q=' + encodeURIComponent(query), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .then(function (body) {
        var current = catalogSelect.value;
        catalogSelect.textContent = '';
        body.items.forEach(function (entry) {
          var option = document.createElement('option');
          option.value = entry.jmCd;
          option.textContent = entry.name + ' · ' + entry.field;
          option.selected = entry.jmCd === current;
          catalogSelect.appendChild(option);
        });
        catalogStatus.textContent = body.items.length ? '' : '검색 결과가 없습니다. 다른 이름으로 검색해 보세요.';
      })
      .catch(function () { catalogStatus.textContent = '자격증 목록을 불러오지 못했습니다.'; });
  }

  if (catalogInput) {
    catalogInput.addEventListener('input', function () {
      clearTimeout(catalogTimer);
      catalogTimer = setTimeout(loadCatalog, 300);
    });
  }

  form.addEventListener('change', function (event) {
    if (event.target.matches('[data-sd-kind]')) syncPanels();
    if (event.target.matches('[data-sd-field]') && event.target.checked) {
      var group = form.querySelectorAll('input[name="' + event.target.name + '"]:checked');
      if (group.length > MAX_FIELDS) {
        event.target.checked = false;
        statusEl.textContent = '분야는 최대 ' + MAX_FIELDS + '개까지 선택할 수 있습니다.';
      }
    }
  });

  form.setAttribute('data-js-ready', '1');
  syncPanels();
})();
