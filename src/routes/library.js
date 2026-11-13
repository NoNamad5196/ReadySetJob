const path = require('node:path');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { parseId, safeRedirectPath } = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const {
  validateLibraryEntryInput, listLibraryEntries, listLibraryTags,
  getLibraryEntryById, createLibraryEntry, createLibraryEntriesBulk,
  updateLibraryEntry, deleteLibraryEntry,
} = require('../services/libraryService');
const { extractTextFromFile, splitTextIntoLibraryEntries } = require('../services/libraryImportService');

const toArray = (val) => (val === undefined || val === null ? [] : Array.isArray(val) ? val : [val]);
const wantsJson = (req) => req.originalUrl.startsWith('/api/') || Boolean(req.get('Accept')?.includes('application/json'));

function parseEntryFormBody(body = {}) {
  const title = String(body.title ?? '').trim();
  const question = String(body.question ?? body.source_question ?? '').trim();
  const rawBody = body.body !== undefined && body.body !== null ? body.body : body.content;
  const bodyText = String(rawBody ?? '').trim();
  const tags = String(body.tags ?? '').trim();
  return { title, question, body: bodyText, content: bodyText, tags };
}

function parseBulkEntriesFromBody(body = {}) {
  if (Array.isArray(body.entries)) return body.entries.map((item) => parseEntryFormBody(item || {}));
  const titles = toArray(body.title);
  const questions = toArray(body.question ?? body.source_question);
  const bodies = toArray(body.body !== undefined ? body.body : body.content);
  const tagsArr = toArray(body.tags);
  const count = Math.max(titles.length, bodies.length);
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const title = String(titles[i] ?? '').trim();
    const question = String(questions[i] ?? '').trim();
    const text = String(bodies[i] ?? '').trim();
    const tags = String(tagsArr[i] ?? '').trim();
    if (title || text || question) list.push({ title, question, body: text, content: text, tags });
  }
  return list;
}

async function handleImportUpload(req, res) {
  const isJson = wantsJson(req);
  try {
    const extractedText = await extractTextFromFile({
      originalname: req.file && req.file.originalname,
      buffer: req.file && req.file.buffer,
      fileTooLarge: Boolean(req.fileTooLarge),
    });
    const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname)) || '가져온 자소서';
    const previewEntries = splitTextIntoLibraryEntries(extractedText, { defaultTitlePrefix: baseName });
    if (isJson) return res.status(200).json({ ok: true, filename: req.file.originalname, rawText: extractedText, entries: previewEntries });
    return res.status(200).render('library/import', {
      title: '과거 자소서 파일 가져오기', error: null, filename: req.file.originalname, rawText: extractedText, previewEntries,
    });
  } catch (err) {
    const status = err.status || 422;
    const message = err.message || '파일 처리 중 오류가 발생했습니다.';
    if (isJson) return res.status(status).json({ error: message });
    return res.status(status).render('library/import', {
      title: '과거 자소서 파일 가져오기', error: message, filename: '', rawText: '', previewEntries: null,
    });
  }
}

function handleImportSave(db, req, res) {
  const userId = req.session.user.id;
  const isJson = wantsJson(req);
  const entries = parseBulkEntriesFromBody(req.body);
  const fail = (msg, preview = entries) =>
    isJson
      ? res.status(422).json({ error: msg })
      : res.status(422).render('library/import', {
          title: '과거 자소서 파일 가져오기', error: msg, filename: String(req.body.filename || ''), rawText: '', previewEntries: preview,
        });

  if (entries.length === 0) return fail('저장할 항목을 1개 이상 입력해 주세요.', [{ title: '', question: '', body: '', content: '', tags: '' }]);
  for (const item of entries) {
    const errMsg = validateLibraryEntryInput(item);
    if (errMsg) return fail(errMsg);
  }
  const created = createLibraryEntriesBulk(db, userId, entries);
  if (isJson) return res.status(201).json({ ok: true, savedCount: created.length, entries: created });
  req.setFlash('success', `${created.length}개의 자소서 항목이 라이브러리에 등록되었습니다.`);
  return res.redirect('/library');
}

function createLibraryRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const userId = req.session.user.id;
    const q = String(req.query.q || '').trim();
    const tag = String(req.query.tag || '').trim();
    return res.render('library/index', {
      title: '자소서 라이브러리',
      entries: listLibraryEntries(db, userId, { q, tag }),
      tags: listLibraryTags(db, userId),
      filters: { q, tag },
    });
  });

  router.get('/new', (req, res) =>
    res.render('library/form', {
      title: '라이브러리 항목 등록', isEdit: false, error: null,
      entry: { title: '', question: '', body: '', content: '', tags: '' },
    })
  );

  router.post('/', (req, res) => {
    const userId = req.session.user.id;
    const isJson = wantsJson(req);
    const formValues = parseEntryFormBody(req.body);
    const validationError = validateLibraryEntryInput(formValues);
    if (validationError) {
      if (isJson) return res.status(422).json({ error: validationError });
      return res.status(422).render('library/form', { title: '라이브러리 항목 등록', isEdit: false, error: validationError, entry: formValues });
    }
    const created = createLibraryEntry(db, userId, formValues);
    if (isJson) return res.status(201).json({ ok: true, entry: created });
    req.setFlash('success', '라이브러리에 저장되었습니다.');
    return res.redirect(safeRedirectPath(req.body.redirect_to, `/library/${created.id}`));
  });

  router.get('/import', (req, res) =>
    res.render('library/import', { title: '과거 자소서 파일 가져오기', error: null, filename: '', rawText: '', previewEntries: null })
  );
  router.post('/import', handleImportUpload);
  router.post('/import/save', (req, res) => handleImportSave(db, req, res));

  router.get('/:id', (req, res, next) => {
    const id = parseId(req.params.id);
    const entry = id ? getLibraryEntryById(db, req.session.user.id, id) : null;
    if (!entry) return next(createHttpError(404, '요청한 라이브러리 항목을 찾을 수 없습니다.'));
    return res.render('library/detail', { title: `${entry.title} — 자소서 라이브러리`, entry });
  });

  router.get('/:id/edit', (req, res, next) => {
    const id = parseId(req.params.id);
    const entry = id ? getLibraryEntryById(db, req.session.user.id, id) : null;
    if (!entry) return next(createHttpError(404, '요청한 라이브러리 항목을 찾을 수 없습니다.'));
    return res.render('library/form', { title: `${entry.title} — 라이브러리 수정`, isEdit: true, error: null, entry });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const id = parseId(req.params.id);
    const existing = id ? getLibraryEntryById(db, userId, id) : null;
    if (!existing) return next(createHttpError(404, '요청한 라이브러리 항목을 찾을 수 없습니다.'));
    const formValues = { id: existing.id, ...parseEntryFormBody(req.body) };
    const validationError = validateLibraryEntryInput(formValues);
    if (validationError) {
      return res.status(422).render('library/form', { title: '라이브러리 수정', isEdit: true, error: validationError, entry: formValues });
    }
    updateLibraryEntry(db, userId, existing.id, formValues);
    req.setFlash('success', '라이브러리 항목이 수정되었습니다.');
    return res.redirect(`/library/${existing.id}`);
  });

  router.delete('/:id', (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id || !deleteLibraryEntry(db, req.session.user.id, id)) {
      return next(createHttpError(404, '요청한 라이브러리 항목을 찾을 수 없습니다.'));
    }
    req.setFlash('success', '라이브러리 항목이 삭제되었습니다.');
    return res.redirect('/library');
  });

  return router;
}

function createLibraryApiRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  const handleSearch = (req, res) => {
    const q = String(req.query.q || '').trim();
    const tag = String(req.query.tag || '').trim();
    const entries = listLibraryEntries(db, req.session.user.id, { q, tag });
    const results = entries.map((e) => ({ ...e, snippet: e.body.length > 160 ? `${e.body.slice(0, 160)}...` : e.body }));
    return res.json({ ok: true, entries: results, results });
  };

  router.get('/', handleSearch);
  router.get('/search', handleSearch);

  router.post('/', (req, res) => {
    const formValues = parseEntryFormBody(req.body);
    const validationError = validateLibraryEntryInput(formValues);
    if (validationError) return res.status(422).json({ error: validationError });
    return res.status(201).json({ ok: true, entry: createLibraryEntry(db, req.session.user.id, formValues) });
  });

  router.post('/import', handleImportUpload);
  router.post('/import/save', (req, res) => handleImportSave(db, req, res));

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const entry = id ? getLibraryEntryById(db, req.session.user.id, id) : null;
    if (!entry) return res.status(404).json({ error: '요청한 라이브러리 항목을 찾을 수 없습니다.' });
    return res.json({ ok: true, entry });
  });

  router.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const existing = id ? getLibraryEntryById(db, req.session.user.id, id) : null;
    if (!existing) return res.status(404).json({ error: '요청한 라이브러리 항목을 찾을 수 없습니다.' });
    const formValues = parseEntryFormBody(req.body);
    const validationError = validateLibraryEntryInput(formValues);
    if (validationError) return res.status(422).json({ error: validationError });
    return res.json({ ok: true, entry: updateLibraryEntry(db, req.session.user.id, existing.id, formValues) });
  });

  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !deleteLibraryEntry(db, req.session.user.id, id)) {
      return res.status(404).json({ error: '요청한 라이브러리 항목을 찾을 수 없습니다.' });
    }
    return res.json({ ok: true, deleted: true });
  });

  return router;
}

module.exports = { createLibraryRouter, createLibraryApiRouter };
