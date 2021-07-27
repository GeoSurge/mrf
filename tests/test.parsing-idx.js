const fs = require("fs");
const test = require("flug");
const parseIDX = require("../src/core/parse-idx");
const getRange = require("../src/getRange");
const { exit } = require("process");

test("parsing .idx file", async ({ eq }) => {
  const filepath = "data/m_3008501_ne_16_1_20171018.idx";
  const buffer = fs.readFileSync(filepath);
  const idx = parseIDX(buffer, { debug: false });
  const jsonpath = filepath + ".json";
  if (!fs.existsSync(jsonpath)) {
    fs.writeFileSync(jsonpath, JSON.stringify(idx, undefined, 2));
  }
  const expected = JSON.parse(fs.readFileSync(jsonpath, "utf-8"));
  eq(idx, expected);
  eq(idx.length, 1088);
  const data = fs.readFileSync("data/m_3008501_ne_16_1_20171018.lrc");
  const byteLength = new Uint8Array(data).length;
  idx.forEach(({ offset, length }) => {
    eq(offset < byteLength, true);
    eq(length < byteLength, true);
  });

  // Check that no byte ranges overlap
  const ranges = idx
    .map((record, i) => getRange({ idx, i }))
    .sort((a, b) => Math.sign(a.start - b.start));

  for (let i = 1; i < ranges.length; i++) {
    const current = ranges[i];
    const previous = ranges[i - 1];
    eq(current.start, previous.end + 1);
  }

  eq(ranges.length, 1088);
});
