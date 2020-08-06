const fs = require('fs');
const { PNG } = require('pngjs');

module.exports = path => PNG.sync.read(fs.readFileSync(path));
