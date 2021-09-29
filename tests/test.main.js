const test = require("flug");
const serve = require("./serve");

const MRF = require("../src/MRF");

const PORT = 8080;

const server = serve(PORT);

const mrf_url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`;
const idx_url = mrf_url.replace(".mrf", ".idx");
const data_url = mrf_url.replace(".mrf", ".lrc");

test("initializing MRF with url", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true });
  const meta = await mrf.meta;
  eq(meta.compression, "LERC");
  const idx = await mrf.idx;
  const { numBands, pageHeight, pageWidth } = meta;

  const tiles = [{ height: meta.height, width: meta.width }].concat(meta.overviews);

  const numberTiles = tiles.reduce((total, t) => total + Math.ceil(t.width / pageWidth) * Math.ceil(t.height / pageHeight) * numBands, 0);
  eq(idx.length, 1088);
  eq(numberTiles, 1088);
  server.close();
});
