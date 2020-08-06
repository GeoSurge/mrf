const fs = require("fs");
const test = require("ava");
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const MRF = require('../src/MRF');
const serve = require('./serve');
const getImageData = require('./getImageData');
const getImageDataFromPath = require('./getImageDataFromPath');
const countInvalidPixels = require('./countInvalidPixels');

const PORT = 8085;
serve(PORT);

const mrf_url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`;
const idx_url = mrf_url.replace(".mrf", ".idx");
const data_url = mrf_url.replace(".mrf", ".lrc");
  
test('getting all the values', async t => {
    t.timeout(240 * 1000);
    const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true })
    const meta = await mrf.metadata;
    const { height, width } = meta;
    const values = await mrf.getValues({ debug: false });

    t.timeout(240 * 1000);
    t.is(values.length, 4);
    t.true(values.every(band => band.length === meta.height));
    t.true(values.every(band => band.every(row => row.length === meta.width)));
    t.is(countInvalidPixels(values), 0);
    console.log("zero invalid pixels");
  
    const imageData = getImageData(values);
    const expectedImageData = getImageDataFromPath('./data/m_3008501_ne_16_1_20171018.png');
    const diff = new PNG({width, height});
    
    const count = pixelmatch(imageData, expectedImageData.data, diff.data, width, height, { threshold: 0.1 });
    t.is(count, 0);
  });
  
  
  test('getting square half a tile from top and left edges', async t => {
    const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true })
    const meta = await mrf.metadata;
    const options = {
      debug: false,
      top: 256,
      left: 256,
      bottom: meta.height - (256 + 512),
      right: meta.width - (256 + 512)
    };
    const values = await mrf.getValues(options);
  
    t.timeout(60 * 1000);
    t.is(values.length, 4);
    t.true(values.every(band => band.length === 512));
    t.true(values.every(band => band.every(row => row.length === 512)));
    t.is(countInvalidPixels(values), 0);
  
    const imageData = getImageData(values);
    const expectedImageData = getImageDataFromPath('./data/m_3008501_ne_16_1_20171018_halfway.png');
    const { height: imageHeight, width: imageWidth } = expectedImageData;

    const diff = new PNG({height: imageHeight, width: imageWidth});    
    const count = pixelmatch(imageData, expectedImageData.data, diff.data, imageWidth, imageHeight, { threshold: 0.1 });
    t.is(count, 0);
  });
  
  test('getting some values scaled down by 50%', async t => {
    const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true })
    const meta = await mrf.metadata;
    const width = 256;
    const height = 256;
    const options = {
      debug: false,
      top: 256,
      left: 256,
      bottom: meta.height - (256 + 512),
      right: meta.width - (256 + 512),
      height: 256,
      width: 256
    };
    const values = await mrf.getValues(options);
  
    t.timeout(60 * 1000);
    t.is(values.length, 4);
    t.true(values.every(band => band.length === height));
    t.true(values.every(band => band.every(row => row.length === width)));
    t.is(countInvalidPixels(values), 0);

    const imageData = getImageData(values);
    const expectedImageData = getImageDataFromPath('./data/scaled_by_half.png');
    const { height: imageHeight, width: imageWidth } = expectedImageData;

    const diff = new PNG({height: imageHeight, width: imageWidth});    
    const count = pixelmatch(imageData, expectedImageData.data, diff.data, imageWidth, imageHeight, { threshold: 0.1 });
    t.is(count, 0);
});


test('getting some values scaled down from 512x512 to 100x100', async t => {
    const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true })
    const meta = await mrf.metadata;
    const requestedHeight = 100;
    const requestedWidth = 100;
    const options = {
      debug: false,
      top: 256,
      left: 256,
      bottom: meta.height - (256 + 512),
      right: meta.width - (256 + 512),
      height: requestedHeight,
      width: requestedWidth
    };
    const values = await mrf.getValues(options);
  
    t.timeout(60 * 1000);
    t.is(values.length, 4);
    t.true(values.every(band => band.length === requestedHeight));
    t.true(values.every(band => band.every(row => row.length === requestedWidth)));
    t.is(countInvalidPixels(values), 0);

    const imageData = getImageData(values);
    const expectedImageData = getImageDataFromPath('./data/scaled_100x100.png');
    const { height: imageHeight, width: imageWidth } = expectedImageData;

    const diff = new PNG({height: imageHeight, width: imageWidth});    
    const count = pixelmatch(imageData, expectedImageData.data, diff.data, imageWidth, imageHeight, { threshold: 0.25 });
    if (count !== 0) {
        console.log(count, "pixels off");
        const actual = new PNG({height: imageHeight, width: imageWidth});
        actual.data = imageData;
        fs.writeFileSync('actual-100x100.png', PNG.sync.write(actual));
        fs.writeFileSync('diff-100x100.png', PNG.sync.write(diff));
    }

    // less than 1 percent of pixels wrong
    t.is(count, 0);
});