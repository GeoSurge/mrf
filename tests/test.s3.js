const test = require("flug");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");
const toImageData = require("to-image-data");

const serve = require("./serve");
const countInvalidPixels = require("./utils/count-invalid-pixels");
const findAndReadImage = require("./utils/find-and-read-image");
const writeImageToDisk = require("./utils/write-image-to-disk");

const ERROR_THRESHOLD = 0.05;

const MRF = require("../src/MRF");

const PORT = 8088;

const server = serve(PORT);

const AWS = require("aws-sdk");
if (!process.env.AWS_ACCESS_KEY_ID) throw "Must set AWS_ACCESS_KEY_ID";

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();

const sign = key =>
  s3.getSignedUrlPromise("getObject", {
    Bucket: "naip-analytic",
    Key: key,
    Expires: 60 * 60, // 1 hr,
    RequestPayer: "requester"
  });

test("initializing MRF with url", async ({ eq }) => {
  const mrf = new MRF({
    mrf_url: await sign("al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.mrf"),
    idx_url: await sign("al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.idx"),
    data_url: await sign("al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.lrc")
  });

  const meta = await mrf.meta;
  eq(meta.compression, "LERC");
  const idx = await mrf.idx;
  const { numBands, pageHeight, pageWidth } = meta;

  const tiles = [{ height: meta.height, width: meta.width }].concat(meta.overviews);

  const numberTiles = tiles.reduce((total, t) => total + Math.ceil(t.width / pageWidth) * Math.ceil(t.height / pageHeight) * numBands, 0);
  eq(idx.length, 1088);
  eq(numberTiles, 1088);

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
  const { data: values } = await mrf.getValues(options);

  eq(values.length, 4);
  eq(
    values.every(band => band.length === requestedHeight),
    true
  );
  eq(
    values.every(band => band.every(row => row.length === requestedWidth)),
    true
  );
  eq(countInvalidPixels(values), 0);

  const imageData = toImageData(values);
  writeImageToDisk(imageData, "s3-actual.png");
  const expectedImageData = await findAndReadImage("scaled_100x100.png");
  const { height: imageHeight, width: imageWidth } = expectedImageData;

  const diff = new Uint8ClampedArray(4 * imageHeight * imageWidth);
  const count = pixelmatch(imageData.data, expectedImageData.data, diff, imageWidth, imageHeight, { threshold: 0.25 });
  eq(count / (imageHeight * imageWidth) < ERROR_THRESHOLD, true);
  server.close();
});
