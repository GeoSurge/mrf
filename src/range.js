module.exports = num => {
  if (typeof num === 'undefined') return undefined;
  else if (num === null) return null;
  else return [...Array(num).keys()];
};
