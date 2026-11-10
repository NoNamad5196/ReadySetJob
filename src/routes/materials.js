const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { MATERIAL_KINDS } = require('../middleware/validation');
const { createHttpError } = require('../middleware/error');
const {
  listMaterials,
  getMaterialById,
  getMaterialWithEssays,
  createMaterial,
  updateMaterial,
  deleteMaterial,
} = require('../services/materialsService');

function validateMaterialInput({ title, kind, period, content }) {
  if (!title) {
    return '제목을 입력해 주세요.';
  }
  if (title.length > 120) {
    return '제목은 120자 이하여야 합니다.';
  }
  if (!MATERIAL_KINDS.includes(kind)) {
    return '올바른 자료 구분을 선택해 주세요.';
  }
  if (period && period.length > 60) {
    return '활동 기간은 60자 이하여야 합니다.';
  }
  if (content && content.length > 5000) {
    return '내용은 5000자 이하여야 합니다.';
  }
  return null;
}

function createMaterialsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const userId = req.session.user.id;
    const kind = String(req.query.kind || '').trim();
    const q = String(req.query.q || '').trim();
    const materials = listMaterials(db, userId, { kind, q });
    return res.render('materials/index', {
      title: '자료함 (경험·이력 관리)',
      materials,
      filters: { kind, q },
    });
  });

  router.get('/new', (req, res) => {
    return res.render('materials/form', {
      title: '새 자료 등록',
      isEdit: false,
      error: null,
      material: { kind: 'experience', title: '', period: '', content: '', tags: '' },
    });
  });

  router.post('/', (req, res) => {
    const userId = req.session.user.id;
    const title = String(req.body.title || '').trim();
    const kind = String(req.body.kind || 'experience').trim();
    const period = String(req.body.period || '').trim();
    const content = String(req.body.content || '').trim();
    const tags = String(req.body.tags || '').trim();
    const formValues = { title, kind, period, content, tags };

    const validationError = validateMaterialInput(formValues);
    if (validationError) {
      return res.status(422).render('materials/form', {
        title: '새 자료 등록',
        isEdit: false,
        error: validationError,
        material: formValues,
      });
    }

    const created = createMaterial(db, userId, formValues);
    req.setFlash('success', '자료가 등록되었습니다.');
    return res.redirect(`/materials/${created.id}`);
  });

  router.get('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const material = getMaterialWithEssays(db, userId, req.params.id);
    if (!material) {
      return next(createHttpError(404, '요청한 자료를 찾을 수 없습니다.'));
    }
    return res.render('materials/detail', {
      title: `${material.title} — 자료 상세`,
      material,
    });
  });

  router.get('/:id/edit', (req, res, next) => {
    const userId = req.session.user.id;
    const material = getMaterialById(db, userId, req.params.id);
    if (!material) {
      return next(createHttpError(404, '요청한 자료를 찾을 수 없습니다.'));
    }
    return res.render('materials/form', {
      title: `${material.title} — 자료 수정`,
      isEdit: true,
      error: null,
      material,
    });
  });

  router.put('/:id', (req, res, next) => {
    const userId = req.session.user.id;
    const existing = getMaterialById(db, userId, req.params.id);
    if (!existing) {
      return next(createHttpError(404, '요청한 자료를 찾을 수 없습니다.'));
    }

    const title = String(req.body.title || '').trim();
    const kind = String(req.body.kind || existing.kind).trim();
    const period = String(req.body.period || '').trim();
    const content = String(req.body.content || '').trim();
    const tags = String(req.body.tags || '').trim();
    const formValues = { id: existing.id, title, kind, period, content, tags };

    const validationError = validateMaterialInput(formValues);
    if (validationError) {
      return res.status(422).render('materials/form', {
        title: '자료 수정',
        isEdit: true,
        error: validationError,
        material: formValues,
      });
    }

    updateMaterial(db, userId, existing.id, formValues);
    req.setFlash('success', '자료 정보가 수정되었습니다.');
    return res.redirect(`/materials/${existing.id}`);
  });

  router.delete('/:id', (req, res, next) => {
    const deleted = deleteMaterial(db, req.session.user.id, req.params.id);
    if (!deleted) {
      return next(createHttpError(404, '요청한 자료를 찾을 수 없습니다.'));
    }
    req.setFlash('success', '자료가 삭제되었습니다.');
    return res.redirect('/materials');
  });

  return router;
}

module.exports = { createMaterialsRouter };
