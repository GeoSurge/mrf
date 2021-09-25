const fixBuffer = require("fix-buffer");
const toTextString = require("to-text-string");
const findTagByName = require("xml-utils/find-tag-by-name");
const findTagsByName = require("xml-utils/find-tags-by-name");
const findTagByPath = require("xml-utils/find-tag-by-path");
const getAttribute = require("xml-utils/get-attribute");
const isdef = require("../utils/isdef");

const getAttributeAsFloat = (xml, key) => {
  const value = getAttribute(xml, key);
  if (value !== undefined) return Number.parseFloat(value);
};

const clean = str => {
  if (str.startsWith("<![CDATA[")) {
    str = str.slice(9, -3);
  }
  str = str.replace(/\&quot\;/g, `"`);
  return str;
};

module.exports = function parseMRF(data) {
  try {
    // does nothing if it's not a broken buffer
    data = fixBuffer(data);

    // convert to a string (if it's not already)
    data = toTextString(data);

    const meta = findTagByName(data, "MRF_META").inner;

    const rasterSize = findTagByPath(meta, ["Raster", "Size"]).outer;
    const rasterPageSize = findTagByPath(meta, ["Raster", "PageSize"]).outer;

    const height = getAttributeAsFloat(rasterSize, "y");
    const width = getAttributeAsFloat(rasterSize, "x");
    const area = height * width;
    const depth = getAttributeAsFloat(rasterSize, "z") ?? 1;
    const numBands = getAttributeAsFloat(rasterSize, "c");

    const pageHeight = getAttributeAsFloat(rasterPageSize, "y");
    const pageWidth = getAttributeAsFloat(rasterPageSize, "x");
    const pageDepth = getAttributeAsFloat(rasterPageSize, "z") ?? 1;

    // This is the number of tiles across the number of bands
    // so 4 if have 4 separate tiles for each tile area
    const pageBands = getAttributeAsFloat(rasterPageSize, "c");

    const result = {
      area,
      height,
      width,
      depth,
      numBands,

      pageHeight,
      pageWidth,
      pageDepth,
      pageBands
    };

    // No data values
    const dataValues = findTagByName(meta, "DataValues");
    if (dataValues) {
      const noDataValue = getAttribute(dataValues.outer, "NoData");
      if (isdef(noDataValue)) {
        result.noDataValue = Number.parseFloat(noDataValue);
      }
    }

    const compression = findTagByName(meta, "Compression");
    if (compression) {
      result.compression = compression.inner;
    }

    const quality = findTagByName(meta, "Quality");
    if (quality) {
      result.quality = Number.parseFloat(quality.inner);
    }

    // Pyramids
    const rsets = findTagByName(meta, "Rsets");
    let scale = null;
    if (rsets) {
      result.rsets = {};
      model = getAttribute(rsets.outer, "model");
      if (model) {
        result.rsets.model = model;
      }

      scale = getAttributeAsFloat(rsets.outer, "scale");
      if (scale) {
        result.rsets.scale = scale;
      }

      if (rsets.inner) {
        const dataFileName = findTagByName(rsets.inner, "DataFileName");
        if (dataFileName) {
          result.rsets.dataFileName = dataFileName.inner;
        }

        const indexFileName = findTagByName(rsets.inner, "IndexFileName");
        if (indexFileName) {
          result.rsets.indexFileName = indexFileName.inner;
        }
      }
    }

    // Bounding box
    const bbox = findTagByPath(meta, ["GeoTags", "BoundingBox"]);
    if (bbox) {
      result.xmin = getAttributeAsFloat(bbox.outer, "minx");
      result.ymin = getAttributeAsFloat(bbox.outer, "miny");
      result.xmax = getAttributeAsFloat(bbox.outer, "maxx");
      result.ymax = getAttributeAsFloat(bbox.outer, "maxy");
    }

    const projection = findTagByName(meta, "Projection");
    if (projection) {
      result.projection = clean(projection.inner);
    }

    // Twms
    const twms = findTagByName(meta, "TWMS");
    if (twms) {
      result.twms = {};
      const levels = findTagByName(twms.inner, "Levels");
      if (levels) {
        result.twms.levels = Number.parseFloat(levels.inner);
      }

      const empty = findTagByName(twms.inner, "EmptyInfo");
      if (empty) {
        result.twms.empty = {};
        const offset = getAttributeAsFloat(empty.outer, "offset");
        if (offset !== undefined && offset !== null) {
          result.twms.empty.offset = offset;
        }
      }

      const patterns = findTagsByName(twms.inner, "Pattern");
      if (patterns.length > 0) {
        result.twms.patterns = patterns.map(pattern => clean(pattern.inner));
      }

      // https://docs.geoserver.org/master/en/user/services/wms/time.html
      const time = findTagByName(twms.inner, "Time");
      if (time) {
        if (time.inner.match(/^([^\/]+)\/([^\/]+)\/(P\d[A-Z])$/)) {
          const match = time.inner.match(/^([^\/]+)\/([^\/]+)\/(P\d[A-Z])$/);
          const [_, start, end, periodicity] = match;
          result.twms.time = { start, end, periodicity };
        }
      }
    }

    // To-Do: handle when order set in metadata
    result.order = numBands === pageBands ? "pixel" : "band";

    const numberPagesAcross = Math.ceil(width / pageWidth);
    const numberPagesDown = Math.ceil(height / pageHeight);
    const numberPagesDeep = Math.ceil(depth / pageDepth);
    const numberTotalPages = numberPagesAcross * numberPagesDown * numberPagesDeep * (numBands / pageBands);

    // Overviews
    if (rsets && scale) {
      const overviews = [];
      let w = width;
      let h = height;
      while (w > pageWidth || h > pageHeight) {
        w = Math.round(w / scale);
        h = Math.round(h / scale);

        const widthInPagesForOverview = Math.ceil(w / pageWidth);
        const heightInPagesForOverview = Math.ceil(h / pageHeight);
        const numPagesForOverview = widthInPagesForOverview * heightInPagesForOverview * numberPagesDeep * (numBands / pageBands);

        overviews.push({
          height: h, // height in pixels
          heightInPages: heightInPagesForOverview,
          pages: numPagesForOverview,
          offset: overviews.reduce((total, { pages }) => total + pages, numberTotalPages), // starting offset within the idx array
          width: w, // width in pixels
          widthInPages: widthInPagesForOverview,
          scale: {
            height: height / h,
            width: width / w
          }
        });
      }

      result.overviews = overviews;
    }

    const options = findTagByName(meta, "Options");
    if (options) {
      result.options = options.inner.split(" ");
    }

    return {
      ...result,
      numBands,
      widthInTiles: numberPagesAcross,
      heightInTiles: numberPagesDown
    };
  } catch (error) {
    console.error("[mrf] failed to parse MRF file because of the following error:\n", error);
    throw error;
  }
};
