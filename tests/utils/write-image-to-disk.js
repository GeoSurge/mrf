const fs = require("fs");
const path = require("path");
const writeImage = require("write-image");

module.exports = function writeImageToDisk(data, filepath) {
  let height, width;
  if (data.height || data.width) {
    ({ data, height, width } = data);
  }
  const format = filepath.split(".").slice(-1)[0];
  const { data: buf } = writeImage({ data, format, height, width });

  if (!path.isAbsolute(filepath)) {
    filepath = path.resolve(process.cwd(), filepath);
  }
  console.log("[write-image-to-disk] wrote to " + filepath);
  fs.writeFileSync(filepath, buf);
};
