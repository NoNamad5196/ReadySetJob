const { CACHE_TTL_MS, queryHash } = require('./common');

function getSpecsService(override) {
  if (override) return override;
  let path;
  try { path = require.resolve('../specsService'); }
  catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
  return require(path);
}

async function cachedSearch(source, params, context, load, parse, ttlMs = CACHE_TTL_MS) {
  const { db, cacheService } = context;
  const service = db ? getSpecsService(cacheService) : null;
  const hash = queryHash(params);
  const cached = service ? service.readExternalCache(db, source, hash, ttlMs) : null;
  if (cached != null) return parse(cached);
  const payload = await load();
  const result = await parse(payload);
  if (service && db.open !== false) service.writeExternalCache(db, source, hash, payload);
  return result;
}

async function withCache(db, source, params, ttlMs, load) {
  const service = db ? getSpecsService() : null;
  const hash = queryHash(params);
  const cached = service ? service.readExternalCache(db, source, hash, ttlMs) : null;
  if (cached != null) return { payload: cached, cached: true };
  const payload = await load();
  if (service && db.open !== false) service.writeExternalCache(db, source, hash, payload);
  return { payload, cached: false };
}

module.exports = { cachedSearch, getSpecsService, withCache, DEFAULT_TTL_MS: CACHE_TTL_MS, CATALOG_TTL_MS: 24 * 60 * 60 * 1000 };
