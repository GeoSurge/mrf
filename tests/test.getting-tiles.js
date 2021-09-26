const fs = require("fs");
const test = require("flug");
const jpeg = require("jpeg-js");
const MRF = require("../src/MRF");
const serve = require("./serve");

const PORT = 8081;

const server = serve(PORT);

const mrf_url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`;
const idx_url = mrf_url.replace(".mrf", ".idx");
const data_url = mrf_url.replace(".mrf", ".lrc");

let passed = 0;
const checkServer = () => {
  if ((process.env.TEST_NAME && passed === 1) || passed == 2) {
    setTimeout(() => process.exit(0), 500);
  }
  setTimeout(checkServer, 500);
};
checkServer();

test("getting multiband tiles", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url });
  const meta = await mrf.meta;
  const coords = [];
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      coords.push({ x, y, l: 0 });
    }
  }
  const tiles = await mrf.getMultiBandTiles({ bands: undefined, debug: false, coords });
  eq(tiles.length, 4);
  const firstTileWithoutPixels = tiles.find(t => !t.pixels);
  if (firstTileWithoutPixels) console.log("first tile without pixels is", firstTileWithoutPixels);
  eq(firstTileWithoutPixels, undefined);
  eq(
    tiles.every(t => !t.decoded || (t.decoded.height === 512 && t.decoded.width === 512)),
    true
  );
  eq(
    tiles.every(t => !t.decoded || t.decoded.dimCount === 1),
    true
  );

  // inspect a tile
  const tile = tiles.find(t => t.x === 0 && t.y === 0);

  eq(tile.height, 512);
  eq(tile.width, 512);
  eq(tile.mask, undefined);
  eq(tile.pixels.length, meta.numBands);
  eq(
    tile.pixels.every(band => band.length === 512 * 512),
    true
  );
  eq(
    tile.pixels.every(band => band.every(value => value !== null && value !== undefined && value >= 0 && value <= 255)),
    true
  );
  eq(new Set(tile.pixels.map(band => JSON.stringify(band.slice(0, 100)))).size, 4);

  // writing tiles out to PNG file for visual testing
  tiles.forEach((tile, ti) => {
    const frameData = Buffer.alloc(512 * 512 * 4);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const i = y * 512 * 4 + x * 4;
        const pixi = y * 512 + x;
        frameData[i] = tile.pixels[0][pixi];
        frameData[i + 1] = tile.pixels[1][pixi];
        frameData[i + 2] = tile.pixels[2][pixi];
        frameData[i + 3] = tile.pixels[3][pixi]; // half opaque
      }
    }
    var jpegImageData = jpeg.encode({ width: 512, height: 512, data: frameData }, 85);
    fs.writeFileSync(`test-${ti}.jpg`, jpegImageData.data);
  });
  passed++;
});

test("getting tiles", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url });
  const coords = [];
  for (let i = 0; i < 2; i++) {
    for (let b = 0; b <= 3; b++) {
      coords.push({ b, x: i, y: i, l: 0 });
    }
  }
  const tiles = await mrf.getTiles({ debug: false, coords });

  const firstTileWithoutPixels = tiles.find(t => !t.pixels);
  if (firstTileWithoutPixels) console.log("first tile without pixels is", firstTileWithoutPixels);
  eq(firstTileWithoutPixels, undefined);
  eq(tiles.length, 8);
  eq(
    tiles.every(t => !t.decoded || (t.decoded.height === 512 && t.decoded.width === 512)),
    true
  );
  eq(
    tiles.every(t => !t.decoded || t.decoded.dimCount === 1),
    true
  );
  passed++;
});
