module.exports = function hash(data) {
  const length = data.length || data.byteLength;
  if (length === 0) throw new Error("[mrf] trying to hash empty data");
  let hash = 0;
  for (let i = 0; i < length; i++) {
    const chars = "," + (data.getUint8 ? data.getUint8(i) : data[i]).toString();
    for (let c = 0; c < chars.length; c++) {
      const char = chars[c].charCodeAt(0);

      hash = (hash << 5) - hash + char;

      // this converts the hash to a 32-bit integer
      // from https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
      hash = hash & hash;
    }
  }
  return hash;
};
