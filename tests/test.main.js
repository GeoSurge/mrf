const fs = require('fs')
const test = require('ava')
const jpeg = require('jpeg-js');
const pngjs = require('pngjs');
const serve = require('./serve');

const MRF = require('../src/MRF')

const PORT = 8080

serve(PORT);

const mrf_url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`;
const idx_url = mrf_url.replace(".mrf", ".idx");
const data_url = mrf_url.replace(".mrf", ".lrc");

test('initializing MRF with url', async t => {
  const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true })
  const metadata = await mrf.metadata
  t.is(metadata.compression, 'LERC')
  const idx = await mrf.idx
  const { numBands, pageHeight, pageWidth } = metadata

  const tiles = [{ height: metadata.height, width: metadata.width }].concat(metadata.overviews)

  const numberTiles = tiles.reduce((total, t) => total + (Math.ceil(t.width / pageWidth) * Math.ceil(t.height / pageHeight) * numBands), 0)
  t.is(idx.length, 1088)
  t.is(numberTiles, 1088)
})
