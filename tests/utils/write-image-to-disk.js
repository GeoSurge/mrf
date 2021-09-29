const fs = require("fs");
const writeImage = require("write-image");

module.exports = function writeImageToDisk(data, filepath) {
  let height, width;
  if (data.height || data.width) {
    ({ data, height, width } = data);
  }
  const format = filepath.split(".").slice(-1)[0];
  const { data: buf } = writeImage({ data, format, height, width });
  fs.writeFileSync(filepath, buf);
};
