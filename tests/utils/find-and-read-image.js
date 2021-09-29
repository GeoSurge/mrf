const findAndRead = require("find-and-read");
const readim = require("readim");

// returns { height, width, data }
module.exports = async filename => {
  const buffer = findAndRead(filename);
  const { height, width, pixels } = await readim({ data: buffer });
  return { data: pixels, height, width };
};
