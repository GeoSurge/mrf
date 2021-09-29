function range(n) {
  if (n === undefined || n === null) {
    return n;
  } else {
    const result = [];
    for (let i = 0; i < n; i++) result.push(i);
    return result;
  }
}

module.exports = range;
