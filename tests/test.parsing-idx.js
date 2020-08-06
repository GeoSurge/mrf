const fs = require("fs");
const test = require("ava");
const parseIDX = require('../src/parseIDX');
const getRange = require('../src/getRange');

test('parsing .idx file', async t => {
    const buffer = fs.readFileSync('data/m_3008501_ne_16_1_20171018.idx')
    const idx = parseIDX(buffer, { debug: false })
    t.is(idx.length, 1088)
    const data = fs.readFileSync('data/m_3008501_ne_16_1_20171018.lrc')
    const numberBytes = new Uint8Array(data).length
    idx.forEach(({ offset, length }) => {
      t.true(offset < numberBytes)
      t.true(length < numberBytes)
    })
  
    // Check that no byte ranges overlap
    const ranges = idx
      .map((record, i) => getRange({ idx, i }))
      .sort((a, b) => Math.sign(a.start - b.start))
  
    for (let i = 1; i < ranges.length; i++) {
      const current = ranges[i]
      const previous = ranges[i - 1]
      t.is(current.start, previous.end + 1)
    }
  
    t.is(ranges.length, 1088)
  })
  
  