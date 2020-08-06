module.exports = ({idx, i}) => {
  const {offset, length} = idx[i];
  return {start: offset, end: offset + length - 1};
};
