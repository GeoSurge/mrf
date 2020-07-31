const binarize = require('fast-bin/binarize');

// To-do
// add in check when bits used to convert to number
// are more than or equal to 53 (which would exceed max safe number)
// (I think)

module.exports = (input, options) => {
  const debug = options && options.debug || false;

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    input = new Uint8Array(input);
  }

  if (input instanceof ArrayBuffer) {
    input = new Uint8Array(input);
  }

  // Normalize array
  const nums = Array.from(input);

  // Console.log("input:", input);
  const {data: bits} = binarize({data: nums, nbits: 8});
  // Console.log("bits", bits.slice(0, 200));
  // console.log("bits.length:", bits.length);
  if (debug) {
    // Print out chunked result
    // let chunked = '';
    // for (let i = 0; i < bits.length; i += 64) {
    //   chunked += bits.slice(i, i + 64) + '\n';
    // }
    // Console.log("chunked:");
    // console.log(chunked);
  }

  const results = [];
  const nbits = 64;
  for (let i = 0; i < bits.length; i += nbits * 2) {
    const offset = Number.parseInt(bits.substr(i, nbits), 2);
    const length = Number.parseInt(bits.substr(i + nbits, nbits), 2);
    results.push({offset, length});
  }

  // Console.log("results:", results);
  // console.log("results.length:", results.length);
  return results;
};
