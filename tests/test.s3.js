const fs = require('fs')
const test = require('ava')
const jpeg = require('jpeg-js');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');
const serve = require('./serve');
const countInvalidPixels = require('./countInvalidPixels');
const getImageData = require('./getImageData');
const getImageDataFromPath = require('./getImageDataFromPath');

const MRF = require('../src/MRF')

const PORT = 8088

serve(PORT);

const AWS = require('aws-sdk');
if (!process.env.AWS_ACCESS_KEY_ID) throw "Must set AWS_ACCESS_KEY_ID";

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();

const sign = key => s3.getSignedUrlPromise('getObject', {
  Bucket: 'naip-analytic',
  Key: key,
  Expires: 60 * 60, // 1 hr,
  RequestPayer: 'requester'    
});

test('initializing MRF with url', async t => {
  const mrf = new MRF({
    mrf_url: await sign('al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.mrf'),
    idx_url: await sign('al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.idx'),
    data_url: await sign('al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.lrc')
  });

  const metadata = await mrf.metadata
  t.is(metadata.compression, 'LERC')
  const idx = await mrf.idx
  const { numBands, pageHeight, pageWidth } = metadata

  const tiles = [{ height: metadata.height, width: metadata.width }].concat(metadata.overviews)

  const numberTiles = tiles.reduce((total, t) => total + (Math.ceil(t.width / pageWidth) * Math.ceil(t.height / pageHeight) * numBands), 0)
  t.is(idx.length, 1088)
  t.is(numberTiles, 1088)

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

  // less than 1 percent of pixels wrong
  t.is(count, 0);
})
