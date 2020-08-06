const fs = require("fs");
const test = require("ava");
const parseMRF = require("../src/parseMRF");

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
});

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
});
  
test('parsing no data values from .mrf file', async t => {
    const buffer = fs.readFileSync('data/test_weekly_jpg2012060_.mrf')
    const mrf = parseMRF(buffer)
    t.is(mrf.width, 2560)
    t.is(mrf.height, 1280)
    t.is(mrf.noDataValue, 0)
});
