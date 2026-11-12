(function () {
  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute('content')) {
      return meta.getAttribute('content');
    }
    var input = document.querySelector('input[name="_csrf"]');
    return input ? input.value : '';
  }

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function showError(errEl, message) {
    if (!errEl) return;
    if (!message) {
      errEl.textContent = '';
      errEl.classList.add('ai-hidden');
      return;
    }
    errEl.textContent = String(message);
    errEl.classList.remove('ai-hidden');
  }

  function renderEssayFeedback(root, data) {
    var panel = root.querySelector('[data-ai-feedback-panel]');
    if (!panel || !data) return;

    var fb = data.feedback && data.feedback.result ? data.feedback.result : data;
    var summaryEl = panel.querySelector('[data-ai-fb-summary]');
    if (summaryEl) summaryEl.textContent = fb.summary || '';

    var metaEl = panel.querySelector('[data-ai-fb-meta]');
    if (metaEl) {
      var modelName = (data.feedback && data.feedback.model) || data.model || '';
      var createdAt = (data.feedback && data.feedback.created_at) || '';
      metaEl.textContent = [modelName, createdAt].filter(Boolean).join(' · ');
    }

    var scores = fb.scores || {};
    var specEl = panel.querySelector('[data-ai-score-specificity]');
    if (specEl) specEl.textContent = (scores.specificity || '-') + ' / 5';
    var relEl = panel.querySelector('[data-ai-score-relevance]');
    if (relEl) relEl.textContent = (scores.relevance || '-') + ' / 5';
    var structEl = panel.querySelector('[data-ai-score-structure]');
    if (structEl) structEl.textContent = (scores.structure || '-') + ' / 5';
    var lenFitEl = panel.querySelector('[data-ai-score-length-fit]');
    if (lenFitEl) lenFitEl.textContent = (scores.length_fit || '-') + ' / 5';

    var strengthsList = panel.querySelector('[data-ai-fb-strengths]');
    if (strengthsList) {
      clearChildren(strengthsList);
      var strengths = Array.isArray(fb.strengths) ? fb.strengths : [];
      strengths.forEach(function (st) {
        var li = document.createElement('li');
        li.textContent = String(st);
        strengthsList.appendChild(li);
      });
    }

    var improvementsList = panel.querySelector('[data-ai-fb-improvements]');
    if (improvementsList) {
      clearChildren(improvementsList);
      var improvements = Array.isArray(fb.improvements) ? fb.improvements : [];
      improvements.forEach(function (imp) {
        var li = document.createElement('li');
        li.className = 'ai-improvement-item';

        var issueDiv = document.createElement('div');
        issueDiv.className = 'ai-improvement-item__issue';
        issueDiv.textContent = imp && imp.issue ? String(imp.issue) : '';
        li.appendChild(issueDiv);

        var sugDiv = document.createElement('div');
        sugDiv.className = 'ai-improvement-item__suggestion';
        sugDiv.textContent = imp && imp.suggestion ? String(imp.suggestion) : '';
        li.appendChild(sugDiv);

        if (imp && imp.quote) {
          var quoteEl = document.createElement('blockquote');
          quoteEl.className = 'ai-improvement-item__quote';
          quoteEl.textContent = String(imp.quote);
          li.appendChild(quoteEl);
        }

        improvementsList.appendChild(li);
      });
    }

    var lenNoteEl = panel.querySelector('[data-ai-fb-length-note]');
    if (lenNoteEl) lenNoteEl.textContent = fb.length_note || '';

    panel.classList.remove('ai-hidden');
  }

  function bindEssayFeedbackButtons() {
    var buttons = document.querySelectorAll('[data-ai-feedback-btn]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var essayId = btn.getAttribute('data-essay-id');
        var questionId = btn.getAttribute('data-question-id');
        var root = btn.closest('[data-ai-feedback-root]') || document;
        var errEl = root.querySelector('[data-ai-feedback-error]');
        showError(errEl, '');

        var textarea = document.querySelector(
          'textarea[data-question-id="' + questionId + '"]'
        );
        var payload = {};
        if (textarea) {
          payload.answer = textarea.value;
        }

        var origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'AI 피드백 분석 중...';

        fetch('/api/essays/' + encodeURIComponent(essayId) + '/questions/' + encodeURIComponent(questionId) + '/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              showError(errEl, (result.body && result.body.error) || 'AI 피드백 생성에 실패했습니다.');
              return;
            }
            renderEssayFeedback(root, result.body);
          })
          .catch(function () {
            showError(errEl, '네트워크 오류로 AI 피드백을 불러오지 못했습니다.');
          })
          .finally(function () {
            btn.disabled = false;
            btn.textContent = origLabel;
          });
      });
    });
  }

  function applyParsedJobToForm(parsed, root) {
    if (!parsed) return;
    var form = document.querySelector('form[action*="/jobs"]') || document;

    var companySelect = form.querySelector('select[name="company_id"]');
    var newCompanyInput = form.querySelector('input[name="new_company_name"]');
    if (parsed.company_name) {
      var matchedOption = null;
      if (companySelect) {
        Array.prototype.forEach.call(companySelect.options, function (opt) {
          if (!opt.value) return;
          var label = (opt.textContent || '').trim();
          if (label === parsed.company_name || label.indexOf(parsed.company_name + ' (') === 0) {
            matchedOption = opt;
          }
        });
      }
      if (matchedOption && companySelect) {
        companySelect.value = matchedOption.value;
      } else if (newCompanyInput) {
        if (companySelect) companySelect.value = '';
        newCompanyInput.value = parsed.company_name;
      }
    }

    var titleInput = form.querySelector('input[name="title"]');
    if (titleInput && parsed.title) {
      titleInput.value = parsed.title;
    }

    var positionInput = form.querySelector('input[name="position"]');
    if (positionInput && parsed.position) {
      positionInput.value = parsed.position;
    }

    var typeSelect = form.querySelector('select[name="employment_type"]');
    if (typeSelect && parsed.employment_type) {
      var hasOption = Array.prototype.some.call(typeSelect.options, function (opt) {
        return opt.value === parsed.employment_type;
      });
      if (hasOption) {
        typeSelect.value = parsed.employment_type;
      }
    }

    var deadlineInput = form.querySelector('input[name="deadline"]');
    if (deadlineInput && parsed.deadline) {
      deadlineInput.value = parsed.deadline;
    }

    var urlInput = form.querySelector('input[name="url"]');
    if (urlInput && parsed.url) {
      urlInput.value = parsed.url;
    }

    var memoTextarea = form.querySelector('textarea[name="memo"]');
    if (memoTextarea && parsed.memo) {
      memoTextarea.value = parsed.memo;
    }

    var qPanel = root ? root.querySelector('[data-ai-job-questions-panel]') : null;
    var qList = root ? root.querySelector('[data-ai-job-questions-list]') : null;
    if (qPanel && qList) {
      clearChildren(qList);
      var questions = Array.isArray(parsed.essay_questions) ? parsed.essay_questions : [];
      if (questions.length > 0) {
        questions.forEach(function (q, idx) {
          var li = document.createElement('li');
          var limitSuffix = q.char_limit ? ' (' + q.char_limit + '자)' : '';
          li.textContent = '문항 ' + (idx + 1) + ': ' + q.question + limitSuffix;
          qList.appendChild(li);
        });
        qPanel.classList.remove('ai-hidden');
      } else {
        qPanel.classList.add('ai-hidden');
      }
    }
  }

  function bindJobParse() {
    var roots = document.querySelectorAll('[data-ai-job-parse-root]');
    roots.forEach(function (root) {
      var btn = root.querySelector('[data-ai-job-parse-btn]');
      var textEl = root.querySelector('[data-ai-job-text]');
      var errEl = root.querySelector('[data-ai-job-error]');
      var statusEl = root.querySelector('[data-ai-job-status]');
      if (!btn || !textEl) return;

      btn.addEventListener('click', function () {
        showError(errEl, '');
        if (statusEl) statusEl.textContent = '';

        var text = (textEl.value || '').trim();
        if (!text) {
          showError(errEl, '추출할 채용 공고 텍스트를 입력해 주세요.');
          return;
        }

        var origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'AI 분석 중...';

        fetch('/api/jobs/parse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify({ text: text }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              showError(errEl, (result.body && result.body.error) || 'AI 공고 분석에 실패했습니다.');
              return;
            }
            var parsed = (result.body && result.body.parsed) || result.body;
            applyParsedJobToForm(parsed, root);
            if (statusEl) {
              statusEl.textContent = '추출 완료! 아래 입력 폼의 값을 확인 후 저장하세요.';
            }
          })
          .catch(function () {
            showError(errEl, '네트워크 오류로 공고 분석을 완료하지 못했습니다.');
          })
          .finally(function () {
            btn.disabled = false;
            btn.textContent = origLabel;
          });
      });
    });
  }

  function renderStarDraft(root, data) {
    var panel = root.querySelector('[data-ai-star-panel]');
    if (!panel || !data) return;
    var star = data.draft && data.draft.result ? data.draft.result : data;
    var fields = {
      '[data-ai-star-oneliner]': star.one_liner,
      '[data-ai-star-situation]': star.situation,
      '[data-ai-star-task]': star.task,
      '[data-ai-star-action]': star.action,
      '[data-ai-star-result]': star.result,
    };
    Object.keys(fields).forEach(function (sel) {
      var el = panel.querySelector(sel);
      if (el) el.textContent = fields[sel] || '';
    });
    var missing = panel.querySelector('[data-ai-star-missing]');
    if (missing) {
      clearChildren(missing);
      var items = Array.isArray(star.missing_info) ? star.missing_info : [];
      if (!items.length) {
        var empty = document.createElement('li');
        empty.textContent = '추가로 보완할 누락 정보가 없습니다.';
        missing.appendChild(empty);
      } else {
        items.forEach(function (info) {
          var li = document.createElement('li');
          li.textContent = String(info);
          missing.appendChild(li);
        });
      }
    }
    var applyForm = panel.querySelector('[data-ai-star-apply-form]');
    var draftId = data.draft && data.draft.id;
    var materialId = root.getAttribute('data-material-id');
    if (applyForm && draftId && materialId) {
      applyForm.setAttribute('action', '/materials/' + materialId + '/star-draft/' + draftId + '/apply');
      var applyBtn = applyForm.querySelector('[data-ai-star-apply-btn]');
      if (applyBtn) applyBtn.disabled = false;
    }
    panel.classList.remove('ai-hidden');
  }

  function bindStarDraft() {
    document.querySelectorAll('[data-ai-star-form]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var root = form.closest('[data-ai-star-root]') || document;
        var errEl = root.querySelector('[data-ai-star-error]');
        var btn = form.querySelector('[data-ai-star-btn]');
        var materialId = form.getAttribute('data-material-id');
        showError(errEl, '');
        if (btn) btn.disabled = true;
        fetch('/api/materials/' + encodeURIComponent(materialId) + '/star-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify({}),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              showError(errEl, (result.body && result.body.error) || 'AI STAR 초안 생성에 실패했습니다.');
              return;
            }
            renderStarDraft(root, result.body);
          })
          .catch(function () {
            showError(errEl, '네트워크 오류로 STAR 초안을 만들지 못했습니다.');
          })
          .finally(function () {
            if (btn) btn.disabled = false;
          });
      });
    });
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: JSON.stringify(payload || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, status: res.status, body: body || {} };
      });
    });
  }

  function setField(card, name, value) {
    var el = card.querySelector('[data-field="' + name + '"]');
    if (el) el.textContent = value == null ? '' : String(value);
    return el;
  }

  function setInput(card, name, value) {
    var el = card.querySelector('[data-field="' + name + '"]');
    if (el) el.value = value == null ? '' : String(value);
  }

  function isHttpUrl(value) {
    try {
      var parsed = new URL(String(value));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function buildDiscoverCard(template, item) {
    var fragment = template.content.cloneNode(true);
    var card = fragment.querySelector('[data-ai-discover-item]');
    if (!card || !isHttpUrl(item.url)) return null;

    var isGrad = item.purpose === 'grad_school';
    var avatar = setField(card, 'avatar', item.avatar && item.avatar.initial);
    if (avatar && item.avatar && /^avatar--[0-7]$/.test(item.avatar.className)) {
      avatar.classList.add(item.avatar.className);
    }
    if (avatar && item.avatar && typeof item.avatar.logoSrc === 'string' && item.avatar.logoSrc.indexOf('/logos/company?') === 0) {
      var logo = document.createElement('img');
      logo.className = 'avatar__logo';
      logo.src = item.avatar.logoSrc;
      logo.alt = '';
      logo.loading = 'lazy';
      logo.decoding = 'async';
      avatar.appendChild(logo);
    }
    setField(card, 'title', item.title);
    setField(card, 'company', item.company_name);
    var dday = setField(card, 'dday', item.dday && item.dday.label);
    if (dday && item.dday && /^[a-z]+$/.test(item.dday.state)) {
      dday.classList.add('badge--dday-' + item.dday.state);
    }
    setField(card, 'employment', item.employment_label);
    setField(card, 'org-label', item.org_label || (isGrad ? '학교/프로그램' : '기업/직무'));
    setField(card, 'position', item.position);
    setField(card, 'location', item.location);
    var deadlineText =
      item.deadline_text ||
      (item.deadline
        ? item.deadline + (isGrad ? ' 원서 마감' : ' 마감')
        : isGrad
          ? '원서 마감 미확인'
          : '마감일 미확인');
    setField(card, 'deadline', deadlineText);
    setField(card, 'summary', item.summary);
    var link = card.querySelector('[data-field="url"]');
    if (link) link.setAttribute('href', item.url);

    setInput(card, 'f-company', item.company_name);
    setInput(card, 'f-title', item.title);
    setInput(card, 'f-position', item.position);
    setInput(card, 'f-employment', item.register_employment_type || 'other');
    setInput(card, 'f-deadline', item.deadline || '');
    setInput(card, 'f-url', item.url);
    setInput(card, 'f-memo', item.register_memo || item.summary || '');
    return card;
  }

  function renderDiscoverResults(root, body) {
    var card = document.querySelector('[data-ai-discover-results-card]');
    var list = document.querySelector('[data-ai-discover-list]');
    var template = document.querySelector('template[data-ai-discover-template]');
    var countEl = document.querySelector('[data-ai-discover-count]');
    var emptyEl = document.querySelector('[data-ai-discover-empty]');
    var sourcesBox = document.querySelector('[data-ai-discover-sources]');
    var sourcesList = document.querySelector('[data-ai-discover-sources-list]');
    if (!card || !list || !template) return;

    clearChildren(list);
    var results = Array.isArray(body.results) ? body.results : [];
    var rendered = 0;
    results.forEach(function (item) {
      var node = buildDiscoverCard(template, item || {});
      if (node) {
        list.appendChild(node);
        rendered += 1;
      }
    });
    if (countEl) countEl.textContent = String(rendered);
    if (emptyEl) emptyEl.classList.toggle('ai-hidden', rendered > 0);

    if (sourcesBox && sourcesList) {
      clearChildren(sourcesList);
      var citations = Array.isArray(body.citations) ? body.citations : [];
      citations.forEach(function (c) {
        if (!c || !isHttpUrl(c.url)) return;
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.setAttribute('href', c.url);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.textContent = c.title || c.url;
        li.appendChild(a);
        sourcesList.appendChild(li);
      });
      sourcesBox.classList.toggle('ai-hidden', sourcesList.children.length === 0);
    }
    card.classList.remove('ai-hidden');
  }

  function bindJobDiscover() {
    var form = document.querySelector('[data-ai-discover-form]');
    if (!form) return;
    form.setAttribute('data-js-ready', '1');
    var root = form.closest('[data-ai-discover-root]') || document;
    var errEl = root.querySelector('[data-ai-discover-error]');
    var statusEl = root.querySelector('[data-ai-discover-status]');
    var btn = form.querySelector('[data-ai-discover-btn]');
    var fieldsHint = form.querySelector('[data-discover-fields-hint]');
    var purposeInputs = form.querySelectorAll('[data-discover-purpose]');
    var fieldGroups = form.querySelectorAll('[data-field-group]');
    var purposeOnlyBlocks = form.querySelectorAll('[data-purpose-only]');
    var fieldInputs = form.querySelectorAll('[data-discover-field]');

    function getSelectedPurpose() {
      var checked = form.querySelector('[data-discover-purpose]:checked');
      return checked ? checked.value : 'new_grad';
    }

    function getActiveCheckedFields() {
      var values = [];
      fieldInputs.forEach(function (inp) {
        if (!inp.disabled && inp.checked) values.push(inp.value);
      });
      return values;
    }

    function updateFieldsHint() {
      if (!fieldsHint) return;
      var count = getActiveCheckedFields().length;
      fieldsHint.textContent = count > 0 ? '선택됨 ' + count + '/3개 (필수)' : '1~3개 선택 (필수)';
    }

    function syncPurposeSections() {
      var purpose = getSelectedPurpose();
      fieldGroups.forEach(function (groupEl) {
        var allowed = (groupEl.getAttribute('data-field-purposes') || '').split(',');
        var isMatch = allowed.indexOf(purpose) !== -1;
        groupEl.classList.toggle('ai-hidden', !isMatch);
        groupEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
          cb.disabled = !isMatch;
          if (!isMatch) cb.checked = false;
        });
      });

      purposeOnlyBlocks.forEach(function (blockEl) {
        var target = blockEl.getAttribute('data-purpose-only');
        var isMatch = target === purpose;
        blockEl.classList.toggle('ai-hidden', !isMatch);
        blockEl.querySelectorAll('input').forEach(function (inp) {
          inp.disabled = !isMatch;
          if (!isMatch) inp.checked = false;
        });
      });

      updateFieldsHint();
    }

    purposeInputs.forEach(function (radio) {
      radio.addEventListener('change', function () {
        showError(errEl, '');
        syncPurposeSections();
      });
    });

    fieldInputs.forEach(function (cb) {
      cb.addEventListener('change', function () {
        showError(errEl, '');
        var active = getActiveCheckedFields();
        if (active.length > 3) {
          cb.checked = false;
          showError(errEl, '분야는 최대 3개까지 선택할 수 있습니다.');
        }
        updateFieldsHint();
      });
    });

    syncPurposeSections();

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      showError(errEl, '');

      var purpose = getSelectedPurpose();
      var fields = getActiveCheckedFields();
      var regionEl = form.querySelector('[data-discover-region]:checked');
      var degreeEl = form.querySelector('[data-discover-degree]:checked:not(:disabled)');
      var scheduleEl = form.querySelector('[data-discover-schedule]:checked:not(:disabled)');
      var keywordEl = form.querySelector('[data-discover-keyword]');

      var payload = {
        purpose: purpose,
        fields: fields,
        region: regionEl ? regionEl.value : '',
        degree: degreeEl ? degreeEl.value : '',
        schedule: scheduleEl ? scheduleEl.value : '',
        keyword: keywordEl ? (keywordEl.value || '').trim() : '',
      };

      if (!payload.purpose) {
        showError(errEl, '찾으시는 목적(무엇을 찾나요?)을 올바르게 선택해 주세요.');
        return;
      }
      if (payload.fields.length < 1 || payload.fields.length > 3) {
        showError(errEl, '분야를 1개 이상 선택해 주세요 (최대 3개).');
        return;
      }
      if (!payload.region) {
        showError(errEl, '지역을 올바르게 선택해 주세요.');
        return;
      }

      var origLabel = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = '웹에서 공고 검색 중...';
      }
      if (statusEl) statusEl.textContent = '웹 검색에는 30초 이상 걸릴 수 있습니다.';

      postJson('/api/jobs/search', payload)
        .then(function (result) {
          if (!result.ok) {
            showError(errEl, result.body.error || 'AI 공고 검색에 실패했습니다.');
            return;
          }
          renderDiscoverResults(root, result.body);
        })
        .catch(function () {
          showError(errEl, '네트워크 오류로 공고 검색을 완료하지 못했습니다.');
        })
        .finally(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = origLabel;
          }
          if (statusEl) statusEl.textContent = '';
        });
    });
  }

  function renderBriefing(root, briefing) {
    if (!briefing || !briefing.result) return;
    var br = briefing.result;
    var q = function (sel) { return root.querySelector(sel); };
    if (q('[data-ai-briefing-headline]')) q('[data-ai-briefing-headline]').textContent = br.headline || '';
    if (q('[data-ai-briefing-summary]')) q('[data-ai-briefing-summary]').textContent = br.summary || '';
    if (q('[data-ai-briefing-encouragement]')) q('[data-ai-briefing-encouragement]').textContent = br.encouragement || '';
    if (q('[data-ai-briefing-meta]')) {
      q('[data-ai-briefing-meta]').textContent = [briefing.model, briefing.created_at].filter(Boolean).join(' · ');
    }

    var pList = q('[data-ai-briefing-priorities]');
    if (pList) {
      clearChildren(pList);
      (Array.isArray(br.priorities) ? br.priorities : []).forEach(function (p) {
        var li = document.createElement('li');
        li.className = 'ai-briefing__priority';
        var safeHref = typeof p.href === 'string' && /^\/[A-Za-z0-9\-_/]*(#[A-Za-z0-9\-_]+)?$/.test(p.href) && p.href.indexOf('//') !== 0;
        var titleEl = document.createElement(safeHref ? 'a' : 'span');
        if (safeHref) titleEl.setAttribute('href', p.href);
        titleEl.className = 'ai-briefing__priority-title';
        titleEl.textContent = p.title || '';
        var reasonEl = document.createElement('span');
        reasonEl.className = 'ai-briefing__priority-reason';
        reasonEl.textContent = p.reason || '';
        li.appendChild(titleEl);
        li.appendChild(reasonEl);
        pList.appendChild(li);
      });
    }

    var dList = q('[data-ai-briefing-deadlines]');
    if (dList) {
      clearChildren(dList);
      (Array.isArray(br.deadlines) ? br.deadlines : []).forEach(function (d) {
        var li = document.createElement('li');
        li.className = 'ai-briefing__deadline';
        var label = document.createElement('span');
        label.className = 'ai-briefing__deadline-label';
        label.textContent = d.label || '';
        var date = document.createElement('span');
        date.className = 'badge num';
        date.textContent = d.date || '';
        li.appendChild(label);
        li.appendChild(date);
        dList.appendChild(li);
      });
    }

    var body = q('[data-ai-briefing-body]');
    if (body) body.classList.remove('ai-hidden');
    var placeholder = q('[data-ai-briefing-placeholder]');
    if (placeholder) placeholder.classList.add('ai-hidden');
    var gen = q('[data-ai-briefing-generate]');
    if (gen) gen.classList.add('ai-hidden');
    var refresh = q('[data-ai-briefing-refresh]');
    if (refresh) refresh.classList.remove('ai-hidden');
  }

  function bindBriefing() {
    var root = document.querySelector('[data-ai-briefing-root]');
    if (!root) return;
    var errEl = root.querySelector('[data-ai-briefing-error]');
    var genBtn = root.querySelector('[data-ai-briefing-generate]');
    var refreshBtn = root.querySelector('[data-ai-briefing-refresh]');
    var placeholder = root.querySelector('[data-ai-briefing-placeholder]');
    var busy = false;

    function waitForInflight(attempt) {
      if (attempt > 20) {
        showError(errEl, 'AI 브리핑 생성이 지연되고 있습니다. 잠시 후 새로고침해 주세요.');
        return;
      }
      setTimeout(function () {
        fetch('/api/briefing', { headers: { Accept: 'application/json' } })
          .then(function (res) { return res.json(); })
          .then(function (body) {
            if (body && body.briefing) renderBriefing(root, body.briefing);
            else waitForInflight(attempt + 1);
          })
          .catch(function () { waitForInflight(attempt + 1); });
      }, 3000);
    }

    function request(force) {
      if (busy) return;
      busy = true;
      showError(errEl, '');
      [genBtn, refreshBtn].forEach(function (b) { if (b) b.disabled = true; });
      if (placeholder && !force) placeholder.textContent = 'AI가 이번 주 브리핑을 작성하고 있습니다...';
      postJson('/api/briefing', force ? { force: 1 } : {})
        .then(function (result) {
          if (result.status === 409) {
            waitForInflight(0);
            return;
          }
          if (!result.ok) {
            showError(errEl, result.body.error || 'AI 브리핑 생성에 실패했습니다.');
            if (placeholder) placeholder.textContent = '이번 주 마감·일정·할 일을 바탕으로 우선순위 브리핑을 준비합니다.';
            return;
          }
          renderBriefing(root, result.body.briefing);
        })
        .catch(function () {
          showError(errEl, '네트워크 오류로 AI 브리핑을 불러오지 못했습니다.');
          if (placeholder) placeholder.textContent = '이번 주 마감·일정·할 일을 바탕으로 우선순위 브리핑을 준비합니다.';
        })
        .finally(function () {
          busy = false;
          [genBtn, refreshBtn].forEach(function (b) { if (b) b.disabled = false; });
        });
    }

    if (genBtn) genBtn.addEventListener('click', function () { request(false); });
    if (refreshBtn) refreshBtn.addEventListener('click', function () { request(true); });
    if (root.getAttribute('data-ai-briefing-autoload') === '1') request(false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindEssayFeedbackButtons();
    bindJobParse();
    bindStarDraft();
    bindJobDiscover();
    bindBriefing();
  });
})();
