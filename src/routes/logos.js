const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { TRANSPARENT_PNG, resolveLogoDomains, getLogoForDomain } = require('../services/logoService');

function sendTransparent(res) {
  res.set({
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.status(200).send(TRANSPARENT_PNG);
}

function createLogosRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/company', async (req, res) => {
    try {
      const name = typeof req.query.name === 'string' ? req.query.name.slice(0, 200) : '';
      const url = typeof req.query.url === 'string' ? req.query.url.slice(0, 2048) : '';
      const domains = resolveLogoDomains(db, req.session.user.id, { name, url });
      for (const domain of domains) {
        const logo = await getLogoForDomain(db, domain);
        if (logo && logo.data) {
          res.set({
            'Content-Type': logo.contentType,
            'Cache-Control': 'private, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.status(200).send(Buffer.from(logo.data));
        }
      }
      return sendTransparent(res);
    } catch (e) {
      return sendTransparent(res);
    }
  });

  return router;
}

module.exports = { createLogosRouter };
