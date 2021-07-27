const binarize = require("fast-bin/binarize");

const MAX_SAFE_BITS = 64 - 53;

const parseInteger = bits => {
  const i = bits.indexOf("1");
  if (i >= 0 && i < MAX_SAFE_BITS) {
    console.warn(
      `[mrf] cannot reliably parse: "${bits}" to an integer because it uses more than ${MAX_SAFE_BITS} bits.`
    );
  }
  return Number.parseInt(bits, 2);
};

module.exports = (input, { debug = false } = { debug: false }) => {
  if (
    input instanceof ArrayBuffer ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(input))
  ) {
    input = new Uint8Array(input);
  }

  if (input instanceof ArrayBuffer) {
    input = new Uint8Array(input);
  }

  // normalize array
  const nums = Array.from(input);

  // convert 8-bit numbers to bit string like '000001010011100...'
  const { data: bits } = binarize({ data: nums, nbits: 8 });

  // if (debug) {
  //   // Print out chunked result
  //   let chunked = '';
  //   for (let i = 0; i < bits.length; i += 64) {
  //     chunked += bits.slice(i, i + 64) + '\n';
  //   }
  //   console.log("chunked:");
  //   console.log(chunked);
  // }

  const results = [];
  const nbits = 64;
  for (let i = 0; i < bits.length; i += nbits * 2) {
    const offset = parseInteger(bits.substr(i, nbits));
    const length = parseInteger(bits.substr(i + nbits, nbits));
    results.push({ offset, length });
  }

  // console.log("results:", results);
  // console.log("results.length:", results.length);
  return results;
};
