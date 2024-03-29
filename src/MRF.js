const crossFetch = require("cross-fetch");
const Lerc = require("lerc");
const groupBy = require("lodash.groupBy");
const acceptRanges = require("accept-ranges");
const xdim = require("xdim");
const geowarp = require("geowarp");
const typedArrayRanges = require("typed-array-ranges");

const hash = require("./utils/hash");

const cluster = require("./utils/cluster");
const isdef = require("./utils/isdef");
const parseMRF = require("./core/parse-mrf");
const parseIDX = require("./core/parse-idx");
const range = require("./utils/range");

const DATA_URL_RANGE_REQ_ERROR = "[mrf] Uh oh.  This library currently only supports data urls that support range requests";

class MRF {
  constructor({
    mrf_url,
    idx_url,
    data_url,

    mrf_xml,
    idx_buffer,
    data_buffer,
    fetch: inputFetch,

    // pre-processing step called before each fetch is made
    // useful for proxying requests through a cors server
    // prefetch is a function that receives an object { url, options }
    // url is equivalent to "resource"
    // options is the "init" object described here: https://developer.mozilla.org/en-US/docs/Web/API/fetch
    // options can include headers
    // this will pass to fetch as fetch(url, options)
    prefetch = undefined,

    // true: throw an error whenever we encounter a problem
    // false: try to process as many tiles as possible
    strict = false,

    // set multipart to true if the data url supports multipart ranges
    // however, as of writing this, Amazon Web Services does not support this
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests#multipart_ranges
    multipart = false,

    cache_tiles = true,

    // you can pass in a custom tile_cache if you want to share the cache
    // across MRF instances
    tile_cache = undefined
  } = {}) {
    this.strict = strict;
    this.multipart = multipart;
    this.data_url = data_url;
    this.fetch = inputFetch || crossFetch;
    this.cache_tiles = cache_tiles;
    this.tile_cache = tile_cache || {};
    this.prefetch = prefetch || (async _ => _);

    if (mrf_url) {
      this.meta = this.prefetch({ url: mrf_url })
        .then(({ url, options }) => this.fetch(url, options))
        .then(res => res.text())
        .then(parseMRF);
    } else if (mrf_xml) {
      // meta is a Promise
      this.meta = Promise.resolve(parseMRF(mrf_xml));
    } else {
      throw new Error("[mrf] Uh Oh. You didn't pass in a mrf_url or mrf_xml");
    }

    if (idx_url) {
      this.idx = this.prefetch({ url: idx_url })
        .then(({ url, options }) => this.fetch(url, options))
        .then(res => res.arrayBuffer())
        .then(parseIDX);
    } else if (idx_buffer) {
      this.idx = Promise.resolve(parseIDX(idx_buffer));
    } else {
      throw new Error("[mrf] Uh Oh. You didn't pass in a idx_url or idx_buffer");
    }

    if (data_url) {
      this.data_url = data_url;

      // this will be set to a promise
      this.data_url_supports_range_requests = this.prefetch({ url: this.data_url }).then(({ url, options }) =>
        acceptRanges(url, { fetch: this.fetch })
      );
    } else if (data_buffer) {
      this.data_buffer = data_buffer;
    } else {
      throw new Error("[mrf] Uh Oh. You didn't pass in a data_url or data_buffer");
    }
  }

  getCacheKeyForTile(tile) {
    return `b:${tile.b}  l:${tile.l}  x:${tile.x}  y:${tile.y}`;
  }

  /**
   *
   * @param {Array.<number>} bands - array of band indexes to get
   * @param {number} bottom - how much to skip/take off from the bottom
   * @param {boolean} debug - log intermediate values
   * @param {number} height - requested output height
   * @param {string} layout - layout of output data in xdim format (https://github.com/danieljdufour/xdim)
   * @param {number} left - how much to skip/take off from the left
   * @param {number} method - resampling method to use. see https://github.com/danieljdufour/geowarp
   * @param {boolean} overview - use overview with resolution same or higher than requested area
   * @param {boolean} round - round output pixel values to closest integer
   * @param {number} right - how much to skip/take off from the right
   * @param {number} top - how much to skip/take off from the top
   * @param {number} width - requested output width
   * @returns
   */
  async getValues({
    debug,
    bands,
    bottom,
    height,
    layout = "[band][row][column]",
    left,
    method = "median",
    overview: use_overview = true,
    round,
    theoretical_min,
    theoretical_max,
    top,
    right,
    width
  } = {}) {
    if (debug) console.log("[mrf] starting getValues with:\n" + JSON.stringify(Object.values(arguments), undefined, 2));

    const meta = await this.meta;

    if (!bands) bands = range(meta.numBands);

    const numBands = bands.length;

    if (!isdef(bottom)) bottom = 0;
    if (!isdef(left)) left = 0;
    if (!isdef(right)) right = 0;
    if (!isdef(top)) top = 0;

    if (debug) console.log("[mrf] meta.pageHeight:", meta.pageHeight);
    if (debug) console.log("[mrf] meta.pageWidth:", meta.pageWidth);

    // how many pixels tall is the requested box of values in the
    // pixel size of the highest-resolution level
    const realHeight = meta.height - bottom - top;
    if (debug) console.log("[mrf] real height of requested area is:", realHeight);

    const realWidth = meta.width - right - left;
    if (debug) console.log("[mrf] real width of requested area is:", realWidth);

    // how many actual pixels tall is the image that the user is requesting
    // if this is different than realHeight, a sampling will be performed later
    const requestedHeight = isdef(height) ? height : realHeight;
    if (debug) console.log("[mrf.getValues] requested height:", requestedHeight);

    const requestedWidth = isdef(width) ? width : realWidth;
    if (debug) console.log("[mrf.getValues] requested width:", requestedWidth);

    const requestedScaleWidth = realWidth / requestedWidth;
    if (debug) console.log("[mrf.getValues] ratio of real width to the requested width:", requestedScaleWidth);

    const requestedScaleHeight = realHeight / requestedHeight;
    if (debug) console.log("[mrf.getValues] ratio of real height to the requested height:", requestedScaleHeight);

    // want to choose lowest resolution that isn't coarser that the requested
    let level = {
      index: 0,
      height: meta.height,
      width: meta.width,
      scale: {
        height: 1,
        width: 1
      }
    };

    if (use_overview) {
      if (debug) console.log("[mrf] meta.overviews:", meta.overviews);
      for (let i = 0; i < meta.overviews.length; i++) {
        const ovr = meta.overviews[i];
        if (ovr.scale.height <= requestedScaleHeight && ovr.scale.width <= requestedScaleWidth) {
          level = { index: i + 1, ...ovr };
        } else {
          break;
        }
      }
      if (debug) console.log("[mrf.getValues] selected overview level:", level);
    }

    // percentage of selected height from top to skip
    const scaledTop = top / level.scale.height;
    if (debug) console.log("[mrf.getValues] scaledTop:", scaledTop);

    const scaledBottom = bottom / level.scale.height;
    if (debug) console.log("[mrf.getValues] scaledBottom:", scaledBottom);

    const scaledLeft = left / level.scale.width;
    if (debug) console.log("[mrf.getValues] scaledLeft:", scaledLeft);

    const scaledRight = right / level.scale.width;
    if (debug) console.log("[mrf.getValues] scaledRight:", scaledRight);

    const tileMinX = Math.floor(scaledLeft / meta.pageWidth);
    if (debug) console.log("[mrf.getValues] tileMinX:", tileMinX);

    // tileMaxX is the index number (zero-index) of column in tile
    const tileMaxX = Math.floor((level.width - scaledRight) / meta.pageWidth);
    if (debug) console.log("[mrf.getValues] tileMaxX:", tileMaxX);

    const tileMinY = Math.floor(scaledTop / meta.pageHeight);
    if (debug) console.log("[mrf.getValues] tileMinY:", tileMinY);

    const tileMaxY = Math.floor((level.height - scaledBottom) / meta.pageHeight);
    if (debug) console.log("[mrf.getValues] tileMaxY:", tileMaxY);

    const coords = [];
    for (let x = tileMinX; x <= tileMaxX; x++) {
      for (let y = tileMinY; y <= tileMaxY; y++) {
        coords.push({ l: level.index, x, y });
      }
    }

    const tiles = await this.getMultiBandTiles({ bands, coords, debug });
    if (debug) console.log("[mrf.getValues] got multiband tiles");

    if (!isdef(theoretical_min) || !isdef(theoretical_max)) {
      const setOfPixelTypes = new Set();
      tiles.forEach(tile => {
        tile.pixelTypes.forEach(pixelType => {
          setOfPixelTypes.add(pixelType);
        });
      });

      if (setOfPixelTypes.size === 1) {
        const pixelType = Array.from(setOfPixelTypes)[0];

        let typedArrayName;
        if (pixelType === "U8") typedArrayName = "Uint8Array";
        else if (pixelType === "S8") typedArrayName = "Int8Array";
        else if (pixelType === "U16") typedArrayName = "Uint16Array";
        else if (pixelType === "S16") typedArrayName = "Int16Array";
        else if (pixelType === "U32") typedArrayName = "Uint32Array";
        else if (pixelType === "S32") typedArrayName = "Int32Array";
        else if (pixelType === "F32") typedArrayName = "Float32Array";

        const [min, max] = typedArrayRanges.getRange(typedArrayName);
        if (!isdef(theoretical_min)) theoretical_min = min;
        if (!isdef(theoretical_max)) theoretical_max = max;
      }
    }

    // reformatting tile array into an index to make quicker look ups
    const tileIndex = {};
    tiles.forEach(tile => {
      const { x, y } = tile;
      if (!tileIndex.hasOwnProperty(y)) tileIndex[y] = {};
      tileIndex[y][x] = tile;
    });

    const noDataValue = meta.noDataValue ?? null;
    if (debug) console.log("[mrf.getValues] noDataValue:", noDataValue);

    const scaledTopSnapped = Math.floor(scaledTop);
    const scaledBottomSnapped = Math.floor(scaledBottom);
    const scaledLeftSnapped = Math.floor(scaledLeft);
    const scaledRightSnapped = Math.floor(scaledRight);
    const scaledHeightSnapped = level.height - scaledTopSnapped - scaledBottomSnapped;
    const scaledWidthSnapped = level.width - scaledLeftSnapped - scaledRightSnapped;

    const sizesClipped = { band: bands.length, row: scaledHeightSnapped, column: scaledWidthSnapped };
    const { data: dataClipped } = xdim.prepareData({ fill: noDataValue, layout, sizes: sizesClipped });
    const updateLevelClipping = xdim.prepareUpdate({ data: dataClipped, layout, sizes: sizesClipped });

    const { pageHeight: tileHeight, pageWidth: tileWidth } = meta;

    if (debug) console.time("collecting");
    // assuming pixels from getMultiBandTiles is [band][row,column]
    for (let b = 0; b < numBands; b++) {
      for (let y = scaledTopSnapped; y < level.height - scaledBottomSnapped; y++) {
        // how many tiles from the top
        // const tileY = Math.floor(y / level.height);
        const tileY = Math.floor(y / tileHeight);
        // if (debug) console.log("tileY:", {y, lh: level.height, tileY });

        // within the tile, how many pixels from the top
        const rowInTile = y % tileHeight;

        const tileRowFromCache = tileIndex[tileY];
        // console.log("tileRowFromCache:", tileRowFromCache);

        const rowOffset = rowInTile * tileWidth;

        for (let x = scaledLeftSnapped; x < level.width - scaledRightSnapped; x++) {
          const tileX = Math.floor(x / tileWidth);
          const colInTile = x % tileWidth;
          const tile = tileRowFromCache[tileX];

          // assuming pixels are in [row,column,band] layout
          const value = tile.pixels[b][rowOffset + colInTile];
          try {
            updateLevelClipping({
              point: { band: b, row: y - scaledTopSnapped, column: x - scaledLeftSnapped },
              value
            });
          } catch (error) {
            throw error;
          }
        }
      }
    }
    if (debug) console.timeEnd("collecting");

    // use geowarp to sample values into correct frame
    const bbox = [
      scaledLeftSnapped * level.scale.width, // xmin
      scaledBottomSnapped * level.scale.height, // ymin
      meta.width - scaledRightSnapped * level.scale.width, // xmax
      meta.height - scaledTopSnapped * level.scale.height // ymax
    ];
    if (debug) console.log("bbox:", bbox);

    if (debug) console.time("geowarping");
    const { data: out_data } = geowarp({
      debug_level: debug ? 1 : 0,
      in_data: dataClipped,
      in_bbox: bbox,
      in_layout: layout,
      in_height: scaledHeightSnapped,
      in_width: scaledWidthSnapped,
      in_no_data: noDataValue,
      out_bbox: bbox,
      out_layout: layout,
      out_width: width,
      out_height: requestedHeight,
      out_width: requestedWidth,
      method,
      round,
      theoretical_min,
      theoretical_max
    });
    if (debug) console.timeEnd("geowarping");

    if (debug) console.log("[mrf] finished getting values");

    return { data: out_data };
  }

  async fetchBytes(bytes, { debug = false } = { debug: false }) {
    console.log("[mrf] fetching bytes");
    if (bytes.replace("bytes=", "").trim() === "") {
      throw new Error("[mrf] called fetchBytes without a byte range");
    }
    if (this.data_url) {
      if (!(await this.data_url_supports_range_requests)) throw new Error(DATA_URL_RANGE_REQ_ERROR);
      const headers = { Range: `bytes=${bytes}` };
      if (debug) console.log("[mrf] headers:", headers);
      const { url, options } = await this.prefetch({ url: this.data_url, options: { headers } });
      if (debug) console.log("url (after prefetching):", url);
      if (debug) console.log("options (after prefetching):", JSON.stringify(options));
      const response = await this.fetch(url, options);
      if (debug && response === undefined) throw new Error("[mrf] uh oh. this.fetch returned undefined");
      const ab = await response.arrayBuffer();
      if (debug && ab.byteLength === 0) throw new Error("[mrf] uh oh. fetched zero bytes");
      return arrayBuffer;
    } else {
      throw new Error("[mrf] uh oh. tried to fetch bytes without a data url");
    }
  }

  // // takes in a byte range object { start: N, end: N, ... other stuff }
  // // and returns an array buffer representing that byte range from the data
  async fetchRange([start, end], { debug = false } = { debug: false }) {
    if (this.data_url) {
      if (!(await this.data_url_supports_range_requests)) throw new Error(DATA_URL_RANGE_REQ_ERROR);
      const headers = { Range: `bytes=${start}-${end}` };
      const { url, options } = await this.prefetch({ url: this.data_url, options: { headers } });
      if (debug) console.log(`[mrf] fetching ${url} with the following options:\n${JSON.stringify(options)}`);
      const response = await this.fetch(url, options);
      const arrayBuffer = await response.arrayBuffer();
      if (debug && Math.abs(arrayBuffer.byteLength - (end - start)) > 1) {
        throw new Error(`Uh Oh.  We fetched ${arrayBuffer.byteLength} bytes, but we expected ${end - start} bytes.`);
      }
      return arrayBuffer;
    } else {
      throw new Error("[mrf] can't fetch byte range without a data url");
    }
  }

  // coords are in format [ { b, x, y, l }]
  // l refers to level or which set of imagery tiles to pull from
  // the highest-resolution tiles are l = 0

  /**
   * @typedef BandAwareCoord
   * @type {object}
   * @property {number} b - band
   * @property {number} l - level (with zero as highest resolution and 1+ as overviews)
   * @property {number} x - column of tile (zero-index)
   * @property {number} y - row of tile (zero-index)
   */

  /**
   * @typedef Tile
   * @type {object}
   * @property {number} area - area of the tile in pixels
   * @property {number} b - band for the tile
   * @property {number} data - raw array buffer of tile
   * @property {number} end - where this tile end in data file (in bytes)
   * @property {number} height - height of the tile in pixels
   * @property {number} l - level (0 for highest resolution, 1+ for overviews)
   * @property {string} layout - layout of the pixels in xdim syntax
   * @property {Array.<Number>} pixels - array of numbers
   * @property {number} start - where this tile starts in data file (in bytes)
   * @property {Array.<Object>} stas - optional array of statistics per band
   * @property {number} x - tile column (zero-indexed)
   * @property {number} y - tile row (zero-indexed)
   * @property {number} width - width of the tile in pixels
   */

  /**
   * @param {Array.<BandAwareCoord>} coords - [{ b: band, l: level, x: tileColumn, y: tileRow }, ...]
   * @returns {Promise<Array.<Tile>}
   */
  async getTiles({ coords, debug } = {}) /*:: : Tile */ {
    try {
      if (debug) console.log("[mrf] starting getTiles with:", { coords });
      const meta = await this.meta;
      if (debug) console.log("[mrf.getTiles] meta:", meta);
      const idx = await this.idx;
      if (debug) console.log(`[mrf] idx.length: ${idx.length}`);

      const { numBands } = meta;
      if (debug) console.log(`[mrf] numBands: ${numBands}`);

      // get index numbers for files in idx
      // and get length and offset
      // if interleaved (as LERC requires)
      // https://en.wikipedia.org/wiki/Row-_and_column-major_order
      // basically adds start, end, length to coords

      // band is the index number of the band: R=0, G=1, B=2, A=3
      // level 0 is the highest resolution, level 1 is the next overview
      // x is the
      const tiles = coords.map(({ b, l: level, x, y }) => {
        const ovr = level >= 1 && meta.overviews[level - 1];
        const levelOffset = level === 0 ? 0 : ovr.offset;
        const levelWidth = level === 0 ? meta.widthInTiles : ovr.widthInPages;

        // this assumes it goes [R{0,0}, G{0,0}, B{0,0}, A{0,0}, R{1,0}, G{1,0}, B{1,0}, A{1,0}]
        // in xdim layout syntax, [row,column,band]
        const rowOffset = y * levelWidth * numBands;

        const i = levelOffset + rowOffset + x * numBands + b;

        // this assume it goes [R, R, R, R, ... G, G, G, B...]
        // if (debug) console.log(`[mrf] levelOffset: ${levelOffset}`);
        // const levelHeight = l === 0 ? meta.heightInTiles : ovr.heightInPages;
        // console.log("levelHeight:", levelHeight);
        // const levelWidth = l === 0 ? meta.widthInTiles : ovr.widthInPages;
        // const bandOffset = b * levelHeight * levelWidth;
        // console.log("bandOffset:", bandOffset);
        // const i = levelOffset + bandOffset + (y * levelWidth) + x;
        // console.log("idx i:", i);

        const { offset: start, length } = idx[i];

        // for example if the tile starts at position 0 and has a length of 10
        // the position of the end will be 9 (the 10th byte)
        const end = start + length - 1;
        // data will be assigned late
        return { b, i, l: level, x, y, start, end, length, data: undefined };
      });

      // check that two or more tiles aren't requesting the same bytes
      if (debug && new Set(tiles.map(t => t.start)).size !== tiles.length) {
        throw new Error("Uh Oh. We seem to be requesting the same block of bytes for different tiles");
      }

      // sort tiles by where they start in the data
      // in other words, sort by the byte offset
      tiles.sort((a, b) => Math.sign(a.start - b.start));

      // will assign array buffers to each tile
      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests#multipart_ranges
      if (this.multipart) {
        if (debug)
          console.log(
            "[mrf] we will try to use Multipart Range Requests: https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests#multipart_ranges"
          );
        if (!(await this.data_url_supports_range_requests)) throw new Error(DATA_URL_RANGE_REQ_ERROR);

        // look up tiles in tile cache
        if (this.cache_tiles) {
          tiles.forEach(tile => {
            const cache_key = getCacheKeyForTile(tile);
            console.log("cache_key:", cache_key);
            if (this.tile_cache[cache_key]) {
              if (debug) console.log(`[mrf] using cached tile "${cache_key}"`);
              // setting tile.data to the promise to resolve tile data
              tile.data = this.tile_cache[cache_key];
            }
          });
        }

        const tiles_without_data = tiles.filter(tile => !tile.data);

        // fetch the data
        if (this.data_url) {
          console.log("this.data_url exists");
          if (tiles_without_data.length > 0) {
            /// get large range
            // doesn't support combines ranges at the moment
            // byte_ranges would be like "0-50, 100-150"
            const byte_ranges = tiles_without_data.map(t => `${t.start}-${t.end}`).join(", ");
            console.log(tiles.length, "byte_ranges:", byte_ranges);

            if (debug) {
              console.log(`[mrf] will request a total of ${tiles_without_data.reduce((total, tile) => total + tile.length, 0)} bytes`);
            }

            // byte_ranges would be like "0-50, 100-150"
            const promise = this.fetchBytes(byte_ranges, { debug });

            // iterate through the tiles and assign data
            tiles_without_data.reduce((offset, tile) => {
              const byteLength = tile.length;
              if (debug && byteLength === 0) console.log("[mrf] uh oh.  tile's byte length is zero");
              if (this.cache_tiles) {
                const cache_key = getCacheKeyForTile(tile);
                this.tile_cache[cache_key] = tile.data = promise.then(arrayBuffer => {
                  if (debug) console.log(`[mrf] slicing range [${offset}, ${offset + byteLength}) from`, arrayBuffer);
                  return arrayBuffer.slice(offset, offset + byteLength);
                });
                if (debug) console.log(`[mrf] added ${cache_key} to tile cache`);
              }
              return offset + byteLength;
            }, 0);
          }
        }

        // force completion of all tile requests
        // replacing tile.data promises with actual resolved data
        await Promise.all(tiles.map(tile => tile.data.then(data => (tile.data = data))));
        if (debug) console.log("[mrf] tiles are", tiles);
      } else {
        if (debug)
          console.log(
            "[mrf] data url doesn't support fetching multiple byte ranges in the same request, so we're going to separately fetch each tile's data."
          );
        // range = { start: obj.start, end: obj.end, objs: [obj] };
        // ranges are like [ { start: #, end: #, objs: [tile1, tile2, ...] }, { start: #, end: #, objs: [ ... ] }]
        const clusters = cluster(tiles);
        if (debug) console.log("[mrf] tiles clustered by location in data:", clusters);

        // this line basically adds a data property to each cluster, which holds an array buffer
        const clustersWithData = await Promise.all(
          clusters.map(cluster => this.fetchRange([cluster.start, cluster.end], { debug }).then(ab => ({ ...cluster, data: ab })))
        );

        clustersWithData.forEach(range => {
          // double making sure tiles are sorted correctly
          range.objs.sort((a, b) => Math.sign(a.start - b.start));

          range.objs.forEach((tile, i) => {
            // tile.length is inclusive, e.g. length of 11 for [0,10]
            const offset = range.objs.slice(0, i).reduce((total, tile) => total + tile.length, 0);

            // for slice(start, end), end is exclusive, but that's okay
            // because tile.length adds +1
            tile.data = range.data.slice(offset, offset + tile.length);
          });
        });
      }

      if (debug) console.log(`[mrf] after fetching data, we have ${tiles.length} tiles`);

      // check if tiles have the same data
      // indicating an issue with fetching
      if (debug) {
        const uniques = new Set(tiles.map(t => hash(new DataView(t.data)))).size;
        if (uniques !== tiles.length) {
          if (debug) console.warn(`[mrf] uh oh.  we have ${tiles.length} tiles, but only ${uniques} unique array buffers.`);
        }
      }

      if (debug) console.log(`[mrf] metadata says we have "${meta.compression}" compression`);

      if (meta.compression === "LERC") {
        tiles.forEach((tile, i) => {
          try {
            if (!tile.data) throw new Error("[mrf] tile is without data!");
            const decoded = Lerc.decode(tile.data, {
              inputOffset: 0,
              pixelType: "F32",
              noDataValue: meta.noDataValue,
              returnPixelInterleavedDims: false
            });
            if (!decoded) {
              const msg = "[mrf] Lerc decoding failed";
              if (strict) throw new Error(msg);
              else console.warn(msg);
            }
            if (decoded) {
              const { height, mask, pixels, pixelType, statistics, width } = decoded;
              if (pixels.length !== meta.pageBands) {
                throw new Error(`[mrf] uh oh.  Lerc decoded ${pixels.length} bands, but we expected ${meta.pageBands}`);
              }
              if (pixels.length !== 1) {
                throw new Error(
                  `[mrf] uh oh. this library currently only supports 1-band tiles, but we encountered a tile with ${pixels.length} bands`
                );
              }
              tile.area = height * width;
              tile.height = height;
              tile.mask = mask;
              tile.layout = "[row,column,band]";
              tile.pixels = pixels[0]; // assuming only one band
              tile.pixelType = pixelType;
              tile.stats = statistics;
              tile.width = width;
            }
          } catch (error) {
            console.log(`[mrf] encountered the following error when trying to decode tile #${i}`);
            console.error(error);
            if (this.strict) throw error;
          }
        });
      }

      if (debug) {
        const uniques = new Set(tiles.map(t => hash(t.pixels))).size;
        if (uniques !== tiles.length) {
          if (debug) console.warn(`[mrf] uh oh.  we have ${tiles.length} tiles, but only ${uniques} unique pixel sets.`);
        }
      }

      if (debug) console.log("[mrf.getTiles] finished decoding tiles", tiles[0]);
      return tiles;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  // get tiles with full bands
  // return results with full bands

  /**
   * @typedef BandUnAwareCoord
   * @type {object}
   * @property {number} l - level (with zero as highest resolution and 1+ as overviews)
   * @property {number} x - column of tile (zero-index)
   * @property {number} y - row of tile (zero-index)
   */

  /**
   * @typedef MultiBandTile
   * @type {object}
   * @property {number} area - area of the tile in pixels
   * @property {number} b - band for the tile
   * @property {number} data - raw array buffer of tile
   * @property {number} end - where this tile end in data file (in bytes)
   * @property {number} height - height of the tile in pixels
   * @property {number} l - level (0 for highest resolution, 1+ for overviews)
   * @property {string} layout - layout of the pixels in xdim syntax
   * @property {Array.<Number>} pixels - multi-dimensional array of numbers
   * @property {number} start - where this tile starts in data file (in bytes)
   * @property {Array.<Object>} stas - optional array of statistics per band
   * @property {number} x - tile column (zero-indexed)
   * @property {number} y - tile row (zero-indexed)
   * @property {number} width - width of the tile in pixels
   */

  /**
   * @param {Array.<BandUnAwareCoord>} coords - an array of { l, x, y } tile coordinate objects
   * @param {Array.<number>} bands - an array of bands to get by zero-index
   * @returns {Promise<Array.<Tile>}
   */
  async getMultiBandTiles({ coords, debug, bands }) {
    if (debug) console.log("starting getMultiBandTiles with coords:", coords);

    if (!Array.isArray(coords)) throw new Error("[mrf] You did not pass in an array of coords instead you passed in ", coords);
    if (coords.length === 0) throw new Error("[mrf] You passed in an empty coords array");

    const meta = await this.meta;

    if (!bands) bands = range(meta.numBands);

    // expand tiles into one for each band
    const coordsXYB = [];
    coords.forEach(coord => {
      bands.forEach(band => {
        coordsXYB.push({ ...coord, b: band });
      });
    });

    const tilesXYB = await this.getTiles({ coords: coordsXYB, debug });
    if (debug) console.log("tilesXYB:", tilesXYB.slice(0, 5));

    // merge tiles back into multi-band tiles
    // can probably group using Map in the future
    const groups = groupBy(tilesXYB, t => [t.l, t.x, t.y]);
    if (debug) console.log("groups:", Object.keys(groups));

    const tilesXY = [];
    for (const [lxy, group] of Object.entries(groups)) {
      if (debug) console.log("lxy:", lxy);
      const [l, x, y] = lxy.split(",").map(n => Number.parseInt(n));

      // get tiles for each band
      const pixels = new Array(meta.numBands);

      // to-do: need to add support for mask through decoded.mask
      group.forEach(g => {
        if (g.pixels) {
          pixels[g.b] = g.pixels;
        }
      });
      tilesXY.push({
        height: group[0].height,
        x,
        l,
        layout: "[band][row,column]",
        y,
        pixels,
        pixelTypes: group.map(tile => tile.pixelType), // assuming in right band order
        stats: group.map(tile => tile.stats),
        width: group[0].width
      });
    }

    if (debug) {
      if (debug) {
        const uniques = new Set(tilesXY.map(t => hash(t.pixels.map(band => hash(band)).join(",")))).size;
        if (uniques !== tilesXY.length) {
          if (debug) console.warn(`[mrf] uh oh.  we have ${tilesXY.length} MultiBand Tiles, but only ${uniques} uniques.`);
        }
      }
    }

    return tilesXY;
  }
}

module.exports = MRF;
