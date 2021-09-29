const fs = require("fs");
const test = require("flug");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");
const toImageData = require("to-image-data");

const MRF = require("../src/MRF");
const serve = require("./serve");
const findAndReadImage = require("./utils/find-and-read-image");
const countInvalidPixels = require("./utils/count-invalid-pixels");
const writeImageToDisk = require("./utils/write-image-to-disk");

const PORT = 8085;
const server = serve(PORT);

const ERROR_THRESHOLD = 0.05;

let passed = 0;
const checkServer = () => {
  if ((process.env.TEST_NAME && passed === 1) || passed == 2) {
    setTimeout(() => process.exit(0), 500);
  }
  setTimeout(checkServer, 500);
};
checkServer();

const mrf_url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`;
const idx_url = mrf_url.replace(".mrf", ".idx");
const data_url = mrf_url.replace(".mrf", ".lrc");

test("thumb", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true });
  const meta = await mrf.meta;
  const height = Math.round(meta.height / 10);
  const width = Math.round(meta.width / 10);
  const { data: values } = await mrf.getValues({ debug: false, height, method: "near", round: true, width });
  console.log("got all values");
  eq(values.length, 4);
  eq(
    values.every(band => band.length === height),
    true
  );
  eq(
    values.every(band => band.every(row => row.length === width)),
    true
  );
  eq(countInvalidPixels(values), 0);
  console.log("zero invalid pixels");

  writeImageToDisk({ data: values, height, width }, "actual-thumb.jpg");
  passed++;
});

test("getting square half a tile from top and left edges", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true });
  const meta = await mrf.meta;
  const height = 512;
  const width = 512;
  const options = {
    debug: false,
    top: 256,
    left: 256,
    bottom: meta.height - (256 + height),
    right: meta.width - (256 + width),
    layout: "[band][row][column]"
  };
  const { data } = await mrf.getValues(options);

  eq(data.length, 4);
  eq(
    data.every(band => band.length === 512),
    true
  );
  eq(
    data.every(band => band.every(row => row.length === 512)),
    true
  );
  eq(countInvalidPixels(data), 0);

  const imageData = toImageData({ data, width, height });
  const expectedImageData = await findAndReadImage("m_3008501_ne_16_1_20171018_halfway.png");
  const { height: imageHeight, width: imageWidth } = expectedImageData;

  const diff = new Uint8ClampedArray(4 * imageHeight * imageWidth);
  const count = pixelmatch(imageData.data, expectedImageData.data, diff, imageWidth, imageHeight, { threshold: 0.1 });
  const percentage = count / (imageHeight * imageWidth);
  writeImageToDisk(imageData, "actual-half.jpg");
  writeImageToDisk({ data: diff, height: imageHeight, width: imageWidth }, "diff-half.jpg");
  writeImageToDisk(expectedImageData, "expected-half.jpg");
  eq(percentage < ERROR_THRESHOLD, true);
  passed++;
});

test("getting some values scaled down by 50%", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true });
  const meta = await mrf.meta;
  const width = 256;
  const height = 256;
  const options = {
    debug: false,
    top: 256,
    left: 256,
    bottom: meta.height - (256 + 512),
    right: meta.width - (256 + 512),
    height,
    width,
    layout: "[band][row][column]"
  };
  const { data: values } = await mrf.getValues(options);

  eq(values.length, 4);
  eq(
    values.every(band => band.length === height),
    true
  );
  eq(
    values.every(band => band.every(row => row.length === width)),
    true
  );
  eq(countInvalidPixels(values), 0);

  const expectedImageData = await findAndReadImage("m_3008501_ne_16_1_20171018_halfway.png");

  writeImageToDisk({ data: values.slice(0, 3), width, height }, "actual-scaled-by-half.png");
  writeImageToDisk(expectedImageData, "expected-scaled-by-half.jpg");
  passed++;
});

test("getting some values scaled down from 512x512 to 100x100", async ({ eq }) => {
  const mrf = new MRF({ mrf_url, idx_url, data_url, strict: true });
  const meta = await mrf.meta;
  const requestedHeight = 100;
  const requestedWidth = 100;
  const options = {
    debug: false,
    top: 256,
    left: 256,
    bottom: meta.height - (256 + 512),
    right: meta.width - (256 + 512),
    height: requestedHeight,
    width: requestedWidth,
    layout: "[band][row][column]"
  };
  const { data } = await mrf.getValues(options);

  eq(data.length, 4);
  eq(
    data.every(band => band.length === requestedHeight),
    true
  );
  eq(
    data.every(band => band.every(row => row.length === requestedWidth)),
    true
  );
  eq(countInvalidPixels(data), 0);

  const imageData = toImageData({ data, width: requestedWidth, height: requestedHeight });
  const expectedImageData = await findAndReadImage("scaled_100x100.png");
  const { height: imageHeight, width: imageWidth } = expectedImageData;

  const diff = new Uint8ClampedArray(4 * imageHeight * imageWidth);
  const count = pixelmatch(imageData.data, expectedImageData.data, diff, imageWidth, imageHeight, { threshold: 0.1 });
  const percentage = count / (imageHeight * imageWidth);
  writeImageToDisk(imageData, "actual-100x100.jpg");
  writeImageToDisk({ data: diff, height: imageHeight, width: imageWidth }, "diff-100x100.jpg");
  writeImageToDisk(expectedImageData, "expected-100x100.jpg");
  if (percentage >= ERROR_THRESHOLD) console.log("[mrf] percentage:", percentage);
  eq(percentage < ERROR_THRESHOLD, true);
  passed++;
});
