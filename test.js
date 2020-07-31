const fs = require('fs')
const test = require('ava')
const jpeg = require('jpeg-js');

const serveStatic = require('serve-static')
const http = require('http');
const finalhandler = require('finalhandler')

const MRF = require('./src/MRF')
const parseMRF = require('./src/parseMRF')
const parseIDX = require('./src/parseIDX')
const getRange = require('./src/getRange')
const cluster = require('./src/cluster')

const PORT = 8080

const serve = serveStatic('.', {
  acceptRanges: true
})

const server = http.createServer(function onRequest (req, res) {
  serve(req, res, finalhandler(req, res))
})

server.listen(PORT)

// const AWS = require('aws-sdk');

// // // const S3 = require('aws-sdk/clients/s3');

// // console.log("AWS_ACCESS_KEY_ID:", process.env.AWS_ACCESS_KEY_ID);

// // // AWS.config.update({
// // //     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
// // //     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
// // // });

// // // // const s3 = new AWS.S3({region: 'us-west-2'});

// test('parsing .mrf', async t => {
//     t.timeout(20000);
//     try {
//         console.log("parseMRF:", parseMRF);
//         const params = {
//             Bucket: 'naip-analytic',
//             Key: 'al/2017/100cm/rgbir/30085/m_3008501_ne_16_1_20171018.mrf',
//             RequestPayer: 'Requester'
//         };
//         // const promise = s3.getObject(params).promise();
//         // console.log("promise:", promise);
//         return new Promise((resolve, reject) => {
//             s3.getObject(params,
//                 function (error, data) {
//                   if (error != null) {
//                     console.log("Failed to retrieve an object: " + error);
//                   } else {
//                     console.log("Loaded " + data.ContentLength + " bytes");
//                     // do something with data.Body
//                   }
//                 }
//             );
//         });

//     } catch (error) {
//         console.error("error:", error);
//     }
// });

test('clustering', async t => {
  const objs = [
    { start: 10, end: 15 },
    { start: 16, end: 52 },
    { start: 3, end: 7 }
  ];
  const ranges = cluster(objs);
  t.deepEqual(ranges, [
    {
      end: 7,
      objs: [
        {
          end: 7,
          start: 3,
        },
      ],
      start: 3,
    },
    {
      end: 52,
      objs: [
        {
          end: 15,
          start: 10,
        },
        {
          end: 52,
          start: 16,
        },
      ],
      start: 10,
    },
  ]);
});

test('getting multiband tiles', async t => {
  const url = 'http://localhost:8080/data/m_3008501_ne_16_1_20171018.mrf'
  const data = url.replace(".mrf", ".lrc");
  const mrf = new MRF({ url, data })
  const meta = await mrf.metadata
  const coords = []
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      coords.push({ x, y, l: 0 });
    }
  }
  const tiles = await mrf.getMultiBandTiles({ debug: true, coords });
  t.is(tiles.length, 4);
  console.log("erorred tile is", tiles.find(t => !t.pixels));
  console.log(tiles.filter(t => !t.decoded).length);
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
    const url = 'http://localhost:8080/data/m_3008501_ne_16_1_20171018.mrf'
    const data = url.replace(".mrf", ".lrc");
    const mrf = new MRF({ url, data })
    const meta = await mrf.metadata
    const coords = []
    for (let i = 0; i < 2; i++) {
      for (let b = 0; b <= 3; b++) {
        coords.push({ b, x: i, y: i, l: 0 });
      }
    }
    const tiles = await mrf.getTiles({ debug: true, coords });
    t.is(tiles.length, 8);
    console.log("erorred tile is", tiles.find(t => !t.pixels));
    console.log(tiles.filter(t => !t.decoded).length);
    t.true(tiles.every(t => !t.decoded || t.decoded.height === 512 && t.decoded.width === 512));
    t.true(tiles.every(t => !t.decoded || t.decoded.dimCount === 1));
});

test('initializing MRF with url', async t => {
  const url = `http://localhost:${PORT}/data/m_3008501_ne_16_1_20171018.mrf`
  const mrf = new MRF({ url })
  const metadata = await mrf.metadata
  t.is(metadata.compression, 'LERC')
  const idx = await mrf.idx
  const { numBands, pageHeight, pageWidth } = metadata

  const tiles = [{ height: metadata.height, width: metadata.width }].concat(metadata.overviews)

  const numberTiles = tiles.reduce((total, t) => total + (Math.ceil(t.width / pageWidth) * Math.ceil(t.height / pageHeight) * numBands), 0)
  t.is(idx.length, 1088)
  t.is(numberTiles, 1088)
})

test('parsing downloaded .mrf file', async t => {
  const buffer = fs.readFileSync('data/m_3008501_ne_16_1_20171018.mrf')
  const mrf = parseMRF(buffer)
  t.is(mrf.width, 6638)
  t.is(mrf.height, 7587)
  t.is(mrf.depth, 1)

  t.is(mrf.pageWidth, 512)
  t.is(mrf.pageHeight, 512)
  t.is(mrf.pageDepth, 1)
  t.is(mrf.pageBands, 1)
  t.is(mrf.numBands, 4)

  t.is(mrf.compression, 'LERC')
  t.is(mrf.options.LERC_PREC, 0.5)

  // Bounding box
  t.is(mrf.xmin, 601135)
  t.is(mrf.xmax, 607773)
  t.is(mrf.ymin, 3422859)
  t.is(mrf.ymax, 3430446)

  // Projection
  t.is(mrf.projection, 'PROJCS["NAD83 / UTM zone 16N",GEOGCS["NAD83",DATUM["North_American_1983",SPHEROID["GRS 1980",6378137,298.2572221010042,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4269"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-87],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","26916"]]')

  // Calculate order
  t.is(mrf.order, 'band')
  
  const total = mrf.overviews.reduce((total, ovr) => total + ovr.pages, mrf.widthInTiles * mrf.heightInTiles * mrf.numBands);
  t.is(total, 1088);
  

  t.deepEqual(mrf.overviews,  [
    {
      height: 3794,
      heightInPages: 8,
      offset: 780,
      pages: 224,
      scale: { height: 1.999736425935688, width: 2 },
      width: 3319,
      widthInPages: 7
    },
    {
      height: 1897,
      heightInPages: 4,
      offset: 1004,
      pages: 64,
      scale: { height: 3.999472851871376, width: 3.9987951807228916 },
      width: 1660,
      widthInPages: 4
    },
    {
      height: 949,
      heightInPages: 2,
      offset: 1068,
      pages: 16,
      scale: { height: 7.994731296101159, width: 7.997590361445783 },
      width: 830,
      widthInPages: 2
    },
    {
      height: 475,
      heightInPages: 1,
      offset: 1084,   
      pages: 4,
      scale: { height: 15.972631578947368, width: 15.995180722891567 },
      width: 415,
      widthInPages: 1
    }
  ]);
})

test('parsing another downloaded .mrf file', async t => {
  const buffer = fs.readFileSync('data/snap_test_3dTTTTTTT_.mrf')
  const mrf = parseMRF(buffer)
  t.is(mrf.width, 8192)
  t.is(mrf.height, 4096)

  t.is(mrf.compression, 'JPEG')
  t.is(mrf.quality, 80)
  t.is(mrf.rsets.dataFileName, '{cache_path}/snap_test_3d/snap_test_3dTTTTTTT_.pjg')
  t.is(mrf.rsets.indexFileName, '{cache_path}/snap_test_3d/snap_test_3dTTTTTTT_.idx')

  // Bounding box
  t.is(mrf.xmin, -180)
  t.is(mrf.xmax, 180)
  t.is(mrf.ymin, -90)
  t.is(mrf.ymax, 90)

  // Projection
  t.is(mrf.projection, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]')

  // TWMS
  t.is(mrf.twms.levels, 3)
  t.is(mrf.twms.empty.offset, 0)
  t.is(mrf.twms.pattern, 'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=snap_test_3d&STYLE=(default)?&TILEMATRIXSET=EPSG4326_16km&TILEMATRIX=[0-9]*&TILEROW=[0-9]*&TILECOL=[0-9]*&FORMAT=image%2Fjpeg')
})

test('parsing no data values from .mrf file', async t => {
  const buffer = fs.readFileSync('data/test_weekly_jpg2012060_.mrf')
  const mrf = parseMRF(buffer)
  t.is(mrf.width, 2560)
  t.is(mrf.height, 1280)
  t.is(mrf.noDataValue, 0)
})

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

test('cutting up .lrc file', async t => {
  const buffer = fs.readFileSync('data/m_3008501_ne_16_1_20171018.idx')
  const idx = parseIDX(buffer, { debug: false })
  t.is(idx.length, 1088)
  // Shred the .lrc file into multiple files
  // console.log("idx:", idx);
  idx.forEach(({ offset, length }) => {
    // Console.log("offset:", offset);
    // console.log("length:", length);
  })
})
