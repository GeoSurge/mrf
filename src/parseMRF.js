const findTagByName = require('xml-utils/src/find-tag-by-name');
const findTagByPath = require('xml-utils/src/find-tag-by-path');
const getAttribute = require('xml-utils/src/get-attribute');

const getAttributeAsFloat = (xml, key) => {
  const value = getAttribute(xml, key);
  if (value !== undefined) return Number.parseFloat(value);
};

const clean = string => {
  if (string.startsWith('<![CDATA[')) {
    string = string.slice(9, -3);
  }
  return string;
};

module.exports = input => {
  try {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
      input = input.toString();
    }

    const meta = findTagByName(input, 'MRF_META').inner;

    const rasterSize = findTagByPath(meta, ['Raster', 'Size']).outer;
    const rasterPageSize = findTagByPath(meta, ['Raster', 'PageSize']).outer;

    const height = getAttributeAsFloat(rasterSize, 'y');
    const width = getAttributeAsFloat(rasterSize, 'x');
    const area = height * width;
    const depth = getAttributeAsFloat(rasterSize, 'z') || 1;
    const numBands = getAttributeAsFloat(rasterSize, 'c');

    const pageHeight = getAttributeAsFloat(rasterPageSize, 'y');
    const pageWidth = getAttributeAsFloat(rasterPageSize, 'x');
    const pageDepth = getAttributeAsFloat(rasterPageSize, 'z') || 1;

    // This is the number of tiles across the number of bands
    // so 4 if have 4 separate tiles for each tile area
    const pageBands = getAttributeAsFloat(rasterPageSize, 'c');

    const result = {
      height,
      width,
      depth,
      numBands,

      pageHeight,
      pageWidth,
      pageDepth,
      pageBands,
    };

    // No data values
    const dataValues = findTagByName(meta, 'DataValues');
    if (dataValues) {
      const noDataValue = getAttribute(dataValues.outer, 'NoData');
      if (noDataValue !== undefined && noDataValue !== null) {
        result.noDataValue = Number.parseFloat(noDataValue);
      }
    }

    const compression = findTagByName(meta, 'Compression');
    if (compression) {
      result.compression = compression.inner;
    }

    const quality = findTagByName(meta, 'Quality');
    if (quality) {
      result.quality = Number.parseFloat(quality.inner);
    }

    // Pyramids
    const rsets = findTagByName(meta, 'Rsets');
    let scale = null;
    if (rsets) {
      result.rsets = {};
      model = getAttribute(rsets.outer, 'model');
      if (model) {
        result.rsets.model = model;
      }

      scale = getAttributeAsFloat(rsets.outer, 'scale');
      if (scale) {
        result.rsets.scale = scale;
      }

      if (rsets.inner) {
        const dataFileName = findTagByName(rsets.inner, 'DataFileName');
        if (dataFileName) {
          result.rsets.dataFileName = dataFileName.inner;
        }

        const indexFileName = findTagByName(rsets.inner, 'IndexFileName');
        if (indexFileName) {
          result.rsets.indexFileName = indexFileName.inner;
        }
      }
    }

    // Bounding box
    const bbox = findTagByPath(meta, ['GeoTags', 'BoundingBox']);
    if (bbox) {
      result.xmin = getAttributeAsFloat(bbox.outer, 'minx');
      result.ymin = getAttributeAsFloat(bbox.outer, 'miny');
      result.xmax = getAttributeAsFloat(bbox.outer, 'maxx');
      result.ymax = getAttributeAsFloat(bbox.outer, 'maxy');
    }

    const projection = findTagByName(meta, 'Projection');
    if (projection) {
      result.projection = clean(projection.inner);
    }

    // Twms
    const twms = findTagByName(meta, 'TWMS');
    if (twms) {
      result.twms = {};
      const levels = findTagByName(twms.inner, 'Levels');
      if (levels) {
        result.twms.levels = Number.parseFloat(levels.inner);
      }

      const empty = findTagByName(twms.inner, 'EmptyInfo');
      if (empty) {
        result.twms.empty = {};
        const offset = getAttributeAsFloat(empty.outer, 'offset');
        if (offset !== undefined && offset !== null) {
          result.twms.empty.offset = offset;
        }
      }

      // To-do handle multiple patterns like in https://github.com/nasa-gibs/onearth/blob/8fa97105681d79c62630b33b643dac78393b379e/src/test/mod_onearth_test_data/twms_cache_configs/snap_test_3aTTTTTTT_.mrf
      const pattern = findTagByName(twms.inner, 'Pattern');
      if (pattern) {
        result.twms.pattern = clean(pattern.inner);
      }

      // To-do
      // parse twms time
    }

    // To-do handle when order set in metadata
    result.order = numBands === pageBands ? 'pixel' : 'band';

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
          offset: overviews.reduce((total, {pages}) => total + pages, numberTotalPages), // starting offset within the idx array
          width: w, // width in pixels
          widthInPages: widthInPagesForOverview,
          scale: {
            height: height / h,
            width: width / w,
          },
        });
      }

      result.overviews = overviews;
    }

    const options = findTagByName(meta, 'Options');
    if (options) {
      const options_ = {};
      options.inner.split(' ').forEach(opt => {
        let [key, value] = opt.split('=');
        if (key === 'LERC_PREC') {
          value = Number.parseFloat(value);
        }
        options_[key] = value;
      });
      result.options = options_;
    }

    // to-do: parse Options like:
    // <Options>LERC_PREC=0.5 V2=ON</Options>

    return {...result, numBands, widthInTiles: numberPagesAcross, heightInTiles: numberPagesDown};
  } catch (error) {
    console.error('[mrf] failed to parse MRF file because', error);
    throw error;
  }
};
