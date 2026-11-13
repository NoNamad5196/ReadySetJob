const { SpecSourceError, isRecord } = require('./common');

function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : whole;
  });
}

function xmlField(xml, name) {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}\\s*>`, 'i'));
  return match ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()) : '';
}

function parsePayload(raw) {
  const value = String(raw).trim();
  if (value.startsWith('<')) {
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new SpecSourceError('허용되지 않은 XML 응답입니다.', 502, 'schema');
    const code = xmlField(value, 'resultCode') || xmlField(value, 'returnReasonCode');
    if ((code && !['00', '0000', '0', 'NORMAL_SERVICE'].includes(code)) || /<(?:[\w-]+:)?(?:OpenAPI_ServiceResponse|cmmMsgHeader)\b/i.test(value)) {
      throw new SpecSourceError('공식 데이터 요청이 거부되었습니다. 인증과 활용신청 상태를 확인해 주세요.');
    }
    return value;
  }
  let data;
  try { data = JSON.parse(value); }
  catch { throw new SpecSourceError('외부 데이터 응답을 읽을 수 없습니다.', 502, 'schema'); }
  if (!isRecord(data) && !Array.isArray(data)) throw new SpecSourceError('외부 데이터 응답 형식이 올바르지 않습니다.', 502, 'schema');
  const header = data.response && data.response.header;
  if (data.resultCode != null && !['00', '0000', '0', '200', 'NORMAL_SERVICE'].includes(String(data.resultCode))) {
    throw new SpecSourceError('공식 데이터 요청이 거부되었습니다. 인증과 활용신청 상태를 확인해 주세요.');
  }
  if (header && header.resultCode != null && !['00', '0000', '0', 'NORMAL_SERVICE'].includes(String(header.resultCode))) {
    throw new SpecSourceError('공식 데이터 요청이 거부되었습니다. 인증과 활용신청 상태를 확인해 주세요.');
  }
  if (data.error || (data.code != null && ![0, '0', '00', 200, '200'].includes(data.code))) {
    throw new SpecSourceError('공식 데이터 요청이 거부되었습니다. 인증과 활용신청 상태를 확인해 주세요.');
  }
  return data;
}

function xmlRows(xml, limit = 1000) {
  const rows = [];
  const matches = xml.matchAll(/<(?:[\w-]+:)?item\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?item\s*>/gi);
  for (const match of matches) {
    const row = Object.create(null);
    for (const child of match[1].matchAll(/<(?:[\w-]+:)?([a-z][\w]*)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>/gi)) {
      row[child[1]] = decodeEntities(child[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
    }
    rows.push(row);
    if (rows.length >= limit) break;
  }
  if (!rows.length && !/<(?:[\w-]+:)?(?:response|items)\b/i.test(xml)) {
    throw new SpecSourceError('외부 데이터 목록 형식이 올바르지 않습니다.', 502, 'schema');
  }
  return rows;
}

function rowsFrom(data, paths, limit = 100) {
  if (typeof data === 'string') return xmlRows(data, limit);
  for (const path of paths) {
    let rows = data;
    for (const key of path.split('.').filter(Boolean)) rows = rows && rows[key];
    if (rows === '' || rows === null || (isRecord(rows) && Object.keys(rows).length === 0)) return [];
    if (Array.isArray(rows)) return rows.filter(isRecord).slice(0, limit);
    if (isRecord(rows) && !('item' in rows) && !('scn_list' in rows)) return [rows];
  }
  throw new SpecSourceError('외부 데이터 목록 형식이 올바르지 않습니다.', 502, 'schema');
}

module.exports = { decodeEntities, xmlField, parsePayload, xmlRows, rowsFrom };
