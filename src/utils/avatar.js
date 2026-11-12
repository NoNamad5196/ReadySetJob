function companyLogoSrc(name, url) {
  const str = String(name || '').trim();
  if (!str) return '';
  let src = `/logos/company?name=${encodeURIComponent(str)}`;
  if (url) src += `&url=${encodeURIComponent(String(url))}`;
  return src;
}

function companyAvatar(name, opts = {}) {
  const str = String(name || '').trim();
  const initial = str ? Array.from(str)[0].toUpperCase() : '?';
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  const index = hash % 8;
  return {
    initial,
    index,
    tokenIndex: index,
    colorIndex: index,
    className: `avatar--${index}`,
    logoSrc: companyLogoSrc(str, opts && opts.url),
  };
}

module.exports = {
  companyAvatar,
  companyLogoSrc,
};
