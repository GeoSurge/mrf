const binarize = require("fast-bin/binarize");
const isBuffer = require("../utils/is-buffer");

const MAX_SAFE_BITS = 64 - 53;

const parseInteger = bits => {
  const i = bits.indexOf("1");
  if (i >= 0 && i < MAX_SAFE_BITS) {
    console.warn(`[mrf] cannot reliably parse: "${bits}" to an integer because it uses more than ${MAX_SAFE_BITS} bits.`);
  }
  return Number.parseInt(bits, 2);
};

module.exports = function parseIDX(input, { debug = false } = { debug: false }) {
  if (input instanceof ArrayBuffer || isBuffer(input)) {
    if (debug) console.log("[mrf] input to parseIDX is an ArrayBuffer or a Buffer");
    input = new Uint8Array(input);
  }

  // normalize array
  const nums = Array.from(input);

  // convert 8-bit numbers to bit string like '000001010011100...'
  const { data: bits } = binarize({ data: nums, nbits: 8 });

  const results = [];
  const nbits = 64;
  for (let i = 0; i < bits.length; i += nbits * 2) {
    const offset = parseInteger(bits.substr(i, nbits));
    const length = parseInteger(bits.substr(i + nbits, nbits));
    results.push({ offset, length });
  }

  if (debug) console.log("[mrf] parseIDX will return the following results:\n", results);
  return results;
};
