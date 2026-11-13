const { calculateDday } = require('../../middleware/validation');
const { companyAvatar } = require('../../utils/avatar');
const qnet = require('./qnet');
const qnetCatalog = require('./qnetCatalog');
const dataq = require('./dataq');
const alio = require('./alio');
const work24 = require('./work24');
const aiVerified = require('./aiVerified');
const { SpecSourceError } = require('./common');

const ADAPTERS = { qnet, dataq, alio, work24, ai_verified: aiVerified };
const KIND_BADGES = {
  certificate: '자격증', bootcamp: '부트캠프·교육', contest: '공모전', activity: '대외활동', grad_school: '대학원', other: '공공기관 채용',
};
const SOURCE_BADGES = {
  qnet: '공식 데이터: Q-Net', dataq: '공식 데이터: 데이터자격', alio: '공식 데이터: 잡알리오',
  work24: '공식 데이터: 고용24', ai_verified: '자동 검증됨',
};

function sourceStatuses() {
  return Object.values(ADAPTERS).map((adapter) => ({
    id: adapter.id, label: adapter.label, enabled: adapter.isEnabled(), reason: adapter.isEnabled() ? '' : adapter.disabledReason(),
  }));
}

function plan(form) {
  switch (form.kind) {
    case 'certificate': return ['qnet'];
    case 'bootcamp': return work24.isEnabled() ? ['work24'] : ['work24', 'ai_verified'];
    case 'private_certificate':
      return ['SQLD', 'ADsP'].includes(form.private_cert) && dataq.isEnabled() ? ['dataq'] : ['dataq', 'ai_verified'];
    case 'contest':
    case 'activity':
    case 'grad_school': return ['ai_verified'];
    case 'public_job': return ['alio'];
    default: throw new SpecSourceError('스펙 종류를 올바르게 선택해 주세요.', 422, 'input');
  }
}

function keyDate(item) { return item.apply_end || item.event_date || item.apply_start || item.end_date || null; }

function decorateItem(item, token = '') {
  const date = keyDate(item);
  return {
    ...item, token, kind_label: KIND_BADGES[item.kind] || item.kind, source_label: SOURCE_BADGES[item.source] || item.source,
    source_tier: item.source === 'ai_verified' ? 'verified' : 'official', key_date: date,
    key_date_label: item.apply_end ? '접수 마감' : item.event_date ? (item.kind === 'bootcamp' ? '개강' : '시험·행사일') : '일정',
    dday: calculateDday(date), avatar: companyAvatar(item.organizer || item.title, { url: item.source_url }),
    can_watch: item.source === 'qnet' && Boolean(item.cert_code), is_job: item.category === 'job',
  };
}

async function runDiscover(form, context = {}) {
  const notices = [];
  const items = [];
  const report = { dropped: 0 };
  const sourceIds = plan(form);
  let params = form;
  if (form.kind === 'certificate') {
    const cert = await qnetCatalog.resolveCert({ cert_code: form.cert_code }, context);
    if (!cert) throw new SpecSourceError('카탈로그에서 자격증을 선택해 주세요.', 422, 'input');
    params = { ...form, cert_code: cert.jmCd, cert_name: cert.name, qualgbCd: cert.qualgbCd || 'T' };
  }
  for (const sourceId of sourceIds) {
    const adapter = ADAPTERS[sourceId];
    if (!adapter.isEnabled()) {
      notices.push({ source: sourceId, label: adapter.label, message: adapter.disabledReason() });
      continue;
    }
    const sourceParams = sourceId === 'dataq' ? { ...params, cert: params.private_cert }
      : sourceId === 'alio' ? { keyword: params.keyword } : params;
    if (sourceId === 'dataq' && !['SQLD', 'ADsP'].includes(params.private_cert)) continue;
    items.push(...await adapter.search(sourceParams, { ...context, report }));
  }
  const unique = new Map(items.map((item) => [`${item.source}:${item.source_ref}`, item]));
  const sorted = [...unique.values()].sort((a, b) => String(keyDate(a) || '9999').localeCompare(String(keyDate(b) || '9999')));
  return { items: sorted.slice(0, 60), notices, dropped: report.dropped, searched: sourceIds.filter((sourceId) => ADAPTERS[sourceId].isEnabled()) };
}

module.exports = { ADAPTERS, KIND_BADGES, SOURCE_BADGES, sourceStatuses, plan, decorateItem, runDiscover, keyDate };
