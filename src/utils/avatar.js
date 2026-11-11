function companyAvatar(name) {
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
  };
}

module.exports = {
  companyAvatar,
};
