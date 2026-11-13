// Only 1320 is confirmed. Additional codes come from the official catalog, never guesses.
const CERTIFICATES = Object.freeze([
  Object.freeze({ jmCd: '1320', name: '정보처리기사', field: '정보통신', qualgbCd: 'T', verifiedCode: true }),
]);

function findCertificate(code, catalog = CERTIFICATES) {
  return catalog.find((item) => item.jmCd === String(code)) || null;
}

function searchStaticByName(query = '') {
  return CERTIFICATES.filter((item) => item.name.toLowerCase().includes(String(query).trim().toLowerCase()));
}

module.exports = { CERTIFICATES, findCertificate, findByCode: findCertificate, searchStaticByName };
