const findAndRead = require("find-and-read");
const readim = require("readim");

// returns { height, width, pixels }
module.exports = filename => readim({ data: findAndRead(filename) });
