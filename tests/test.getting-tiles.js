const fs = require("fs");
const test = require("ava");
const jpeg = require('jpeg-js');
const MRF = require('../src/MRF');
const serve = require('./serve');

const PORT = 8081

serve(PORT);

const mrf_url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`;
const idx_url = mrf_url.replace(".mrf", ".idx");
const data_url = mrf_url.replace(".mrf", ".lrc");

test('getting multiband tiles', async t => {
    const mrf = new MRF({ mrf_url, idx_url, data_url })
    const meta = await mrf.metadata
    const coords = []
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        coords.push({ x, y, l: 0 });
      }
    }
    const tiles = await mrf.getMultiBandTiles({ debug: false, coords });
    t.is(tiles.length, 4);
    console.log("erorred tile is", tiles.find(t => !t.pixels));
    t.true(tiles.filter(t => !t.pixels).length <= 1);
    t.true(tiles.every(t => !t.decoded || t.decoded.height === 512 && t.decoded.width === 512));
    t.true(tiles.every(t => !t.decoded || t.decoded.dimCount === 1));
  
    // inspect a tile
    const tile = tiles.find(t => t.x === 0 && t.y === 0);
    
    t.is(tile.height, 512);
    t.is(tile.width, 512);
    t.is(tile.mask, undefined);
    t.is(tile.pixels.length, meta.numBands);
    t.true(tile.pixels.every(band => band.length === 512 * 512))
    t.true(tile.pixels.every(band => band.every(value => value !== null && value !== undefined && value >= 0 && value <= 255)));
    t.is(new Set(tile.pixels.map(band => JSON.stringify(band.slice(0, 100)))).size, 4)
  
    // writing tiles out to PNG file for visual testing
    tiles.forEach((tile, ti) => {
      const frameData = Buffer.alloc(512 * 512 * 4);
      for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
            const i = y * 512 * 4 + x * 4;
            const pixi = y * 512 + x;
            frameData[i ] = tile.pixels[0][pixi];
            frameData[i+1] = tile.pixels[1][pixi];
            frameData[i+2] = tile.pixels[2][pixi];
            frameData[i+3] = tile.pixels[3][pixi]; // half opaque
        }
      }
      var jpegImageData = jpeg.encode({ width: 512, height: 512, data: frameData }, 85);
      fs.writeFileSync(`test-${ti}.jpg`, jpegImageData.data);
    });
  });
  
  test('getting tiles', async t => {
      const mrf = new MRF({ mrf_url, idx_url, data_url })
      const meta = await mrf.metadata
      const coords = []
      for (let i = 0; i < 2; i++) {
        for (let b = 0; b <= 3; b++) {
          coords.push({ b, x: i, y: i, l: 0 });
        }
      }
      const tiles = await mrf.getTiles({ debug: false, coords });
      t.is(tiles.length, 8);
      console.log("erorred tile is", tiles.find(t => !t.pixels));
      t.true(tiles.filter(t => !t.pixels).length <= 1);
      t.true(tiles.every(t => !t.decoded || t.decoded.height === 512 && t.decoded.width === 512));
      t.true(tiles.every(t => !t.decoded || t.decoded.dimCount === 1));
  });