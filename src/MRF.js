const crossFetch = require('cross-fetch');
const Lerc = require("lerc");
const groupBy = require('lodash.groupBy');

const cluster = require('./cluster');
const defined = require('./defined');
const parseMRF = require('./parseMRF');
const parseIDX = require('./parseIDX');
const range = require('./range');

class MRF {
    constructor({
        mrf_url,
        idx_url,
        data_url,

        mrf_xml,
        idx_buffer,
        data_buffer,
        fetch: inputFetch,

        strict = false
    } = {}) {

        this.strict = strict;
        this.data_url = data_url;

        this.fetch = inputFetch || crossFetch;

        if (mrf_url) {
            this.metadata = this.fetch(mrf_url).then(response => response.text()).then(parseMRF);
        } else if (mrf_xml) {
            this.metadata = Promise.resolve(parseMRF(mrf_xml));
        } else {
            throw new Error("[mrf] Uh Oh. You didn't pass in a mrf_url or mrf_xml");
        }

        if (idx_url) {
            this.idx = this.fetch(idx_url).then(response => response.arrayBuffer()).then(parseIDX);
        } else if (idx_buffer) {
            this.idx = Promise.resolve(parseIDX(idx_buffer));
        } else {
            throw new Error("[mrf] Uh Oh. You didn't pass in a idx_url or idx_buffer");
        }

        if (data_url) {
            this.data_url = data_url;
        } else if (data_buffer) {
            this.data_buffer = data_buffer;
        } else {
            throw new Error("[mrf] Uh Oh. You didn't pass in a data_url or data_buffer");
        }
    }

    async getValues({ debug, top, left, bottom, right, width, height } = { }) {
        if (debug) console.log("starting getValues with:", { debug, top, left, bottom, right, width, height });

        const meta = await this.metadata;

        if (!defined(bottom)) bottom = 0;
        if (!defined(left)) left = 0;
        if (!defined(right)) right = 0;
        if (!defined(top)) top = 0;

        if (debug) console.log("[meta.pageHeight:", meta.pageHeight);
        if (debug) console.log("[meta.pageWidth:", meta.pageWidth);

        // how many pixels tall is the requested box of values in the
        // pixel size of the highest-resolution level
        const realHeight = (meta.height - bottom) - top;
        if (debug) console.log("[mrf.getValues] realHeight:", realHeight);

        const realWidth = (meta.width - right) - left;
        if (debug) console.log("[mrf.getValues] realWidth:", realWidth);

        // how many actual pixels tall is the image that the user is requesting
        // if this is different than realHeight, a sampling will be performed later
        const requestedHeight = height ?? realHeight;
        if (debug) console.log("[mrf.getValues] requestedHeight:", requestedHeight);

        const requestedWidth = width ?? realWidth;
        if (debug) console.log("[mrf.getValues] requestedWidth:", requestedWidth);

        const requestedScaleWidth = realWidth / requestedWidth;
        if (debug) console.log("[mrf.getValues] requestedScaleWidth:", requestedScaleWidth);

        const requestedScaleHeight = realHeight / requestedHeight;
        if (debug) console.log("[mrf.getValues] requestedScaleHeight:", requestedScaleHeight);

        // want to choose lowest resolution that isn't coarser that the requested
        let selection = {
            index: 0,
            height: meta.height,
            width: meta.width,
            scale: {
                height: 1,
                width: 1
            }
        };
        if (debug) console.log("[mrf] meta.overviews:", meta.overviews);
        for (let i = 0; i < meta.overviews.length; i++) {
            const ovr = meta.overviews[i];
            if (ovr.scale.height <= requestedScaleHeight && ovr.scale.width <= requestedScaleWidth) {
                selection = { index: i + 1, ...ovr };
            } else {
                break;
            }
        }
        if (debug) console.log("[mrf.getValues] selected overview level:", selection);

        const scaledTop = top / selection.scale.height;
        if (debug) console.log("[mrf.getValues] scaledTop:", scaledTop);

        const scaledBottom = bottom / selection.scale.height;
        if (debug) console.log("[mrf.getValues] scaledBottom:", scaledBottom);

        const scaledLeft = left / selection.scale.width;
        if (debug) console.log("[mrf.getValues] scaledLeft:", scaledLeft);

        const scaledRight = right / selection.scale.width;
        if (debug) console.log("[mrf.getValues] scaledRight:", scaledRight);

        const tileMinX = Math.floor(scaledLeft / meta.pageWidth);
        if (debug) console.log("[mrf.getValues] tileMinX:", tileMinX);

        const tileMaxX = Math.floor((selection.width - scaledRight) / meta.pageWidth);
        if (debug) console.log("[mrf.getValues] tileMaxX:", tileMaxX);

        const tileMinY = Math.floor(scaledTop / meta.pageHeight);
        if (debug) console.log("[mrf.getValues] tileMinY:", tileMinY);

        const tileMaxY = Math.floor((selection.height - scaledBottom) / meta.pageHeight);
        if (debug) console.log("[mrf.getValues] tileMaxY:", tileMaxY);

        const coords = [];
        for (let x = tileMinX; x <= tileMaxX; x++) {
            for (let y = tileMinX; y <= tileMaxY; y++) {
                coords.push({ l: selection.index, x, y, })
            }
        }

        const tiles = await this.getMultiBandTiles({ coords, debug });
        if (debug) console.log("[mrf.getValues] got multiband tiles");

        // reformatting tile array into an index to make quicker look ups
        const tileIndex = {};
        tiles.forEach(tile => {
            const { x, y } = tile;
            if (!tileIndex.hasOwnProperty(y)) tileIndex[y] = {};
            tileIndex[y][x] = tile;
        });

        const noDataValue = meta.noDataValue ?? null;
        if (debug) console.log("[mrf.getValues] noDataValue:", noDataValue);

        // copy values from tiles into the output array
        // assuming using all bands at the moment
        const bands = range(meta.numBands)
            .map(b => range(requestedHeight).map(r => new Array(requestedWidth).fill(noDataValue)));

        const heightInLevelPixels = selection.height - (scaledTop + scaledBottom);
        if (debug) console.log("heightInLevelPixels:", heightInLevelPixels);

        const widthInLevelPixels = selection.width - (scaledLeft+ scaledRight);
        if (debug) console.log("widthInLevelPixels:", widthInLevelPixels);

        const heightScaleRelativeToLevelPixels = heightInLevelPixels / requestedHeight;
        if (debug) console.log("heightScaleRelativeToLevelPixels:", heightScaleRelativeToLevelPixels);

        const widthScaleRelativeToLevelPixels = widthInLevelPixels / requestedWidth;
        if (debug) console.log("widthScaleRelativeToLevelPixels:", widthScaleRelativeToLevelPixels);        

        // don't want to iterate though tiles because our method of sampling
        // is iterating through samples and selecting correct tile for each sample
        if (debug) console.log("[mrf.getValues] requestedHeight:", requestedHeight);
        for (let rowIndex = 0; rowIndex < requestedHeight; rowIndex++) {
            const yInLevelPixels = scaledTop + (rowIndex * heightScaleRelativeToLevelPixels);
            
            const tileY = Math.floor(yInLevelPixels / meta.pageHeight);
            if (debug) console.log("tileY:", tileY);

            const yInTilePixels = Math.round(yInLevelPixels % meta.pageHeight);
            if (debug) console.log("[mrf] yInTilePixels:", yInTilePixels);

            for (let columnIndex = 0; columnIndex < requestedWidth; columnIndex++) {
                const xInLevelPixels = scaledLeft + (columnIndex * widthScaleRelativeToLevelPixels);

                const tileX = Math.floor(xInLevelPixels / meta.pageWidth);

                const tile = tileIndex[tileY][tileX];
                if (!tile) {
                    console.error("tileIndex:", tileIndex);
                    throw `Uh Oh. Couldn't find tile at x:${tileX} and y:${tileY} with tileIndex:`;
                }

                // how many pixels into the image is the offset
                // assuming row-major order
                const pixelOffset = yInTilePixels * tile.width;

                const xInTilePixels = Math.round(xInLevelPixels % meta.pageWidth);

                const pixelIndex = pixelOffset + xInTilePixels;

                // pull out values from tile
                for (let bandIndex = 0; bandIndex < meta.numBands; bandIndex++) {
                    bands[bandIndex][rowIndex][columnIndex] = tile.pixels[bandIndex][pixelIndex];
                }
            }    
        }
        if (debug) console.log("[mrf.getValues] finished tiles");

        return bands;
    }

    async getRange(range, { debug } = {}) {
        const result = { ...range };
        if (this.data_url) {
            // checking if the server supports range requests
            // aws s3 supports byte range requets,
            // but sometimes doesn't send Accept-Ranges header
            if (!this.data_url.includes('.amazonaws.')) {
                const head = await this.fetch(this.data_url, { method: 'HEAD' });
                const header = head.headers.get('Accept-Ranges') || head.headers.get('accept-ranges');

                // we run toString in case it's an array of one
                if (!header || header.toString() !== 'bytes') {
                    console.log("[mrf.getRange] head.headers:", head.headers);
                    throw new Error("Uh Oh.  Looks like the server doesn't support range requests");
                }    
            }

            const headers = { Range: `bytes=${range.start}-${range.end}` };
            const response = await this.fetch(this.data_url, { headers });
            const arrayBuffer = await response.arrayBuffer();
            if (debug && Math.abs(arrayBuffer.byteLength - (range.end - range.start)) > 1) {
                console.log("arrayBuffer.byteLength:", arrayBuffer.byteLength);
                console.log("expected", range.end - range.start);
                throw new Error("Uh Oh.  We didn't fetch the same amount of bytes we requested");
            }
            result.data = arrayBuffer;
        }
        return result;
    }

    // coords are in format [ { x, y, l }]
    // l refers to level or which set of imagery tiles to pull from
    // the highest-resolution tiles are l = 0
    async getTiles({ coords, debug } = {}) {
        try {
            if (debug) console.log("starting getTiles with:", { coords });
            const meta = await this.metadata;
            const idx = await this.idx;
            if (debug) console.log(`[mrf] idx.length: ${idx.length}`);

            const { numBands } = meta;
            if (debug) console.log(`[mrf] numBands: ${numBands}`);
            
            // get index numbers for files in idx
            // and get length and offset
            // if interleaved (as LERC requires)
            // https://en.wikipedia.org/wiki/Row-_and_column-major_order
            const tiles = coords.map(({ b, l, x, y }) => {
                const ovr = l >= 1 && meta.overviews[l - 1];
                const levelOffset = l === 0 ? 0 : ovr.offset;
                const lw = l === 0 ? meta.widthInTiles : ovr.widthInPages;

                // this assumes it goes [R{0,0}, G{0,0}, B{0,0}, A{0,0}, R{1,0}, G{1,0}, B{1,0}, A{1,0}]
                const rowOffset = (y * lw * numBands);

                const i = levelOffset + rowOffset + (x * numBands) + b;

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
                return { b, i, l, x, y, start, end, length };
            });

            // check that aren't requesting the same byte block
            if (debug && new Set(tiles.map(t => t.start)).size !== tiles.length) {
                throw new Error("Uh Oh. We seem to be requesting the same block of bytes for different tiles");
            }

            const ranges = cluster(tiles);
            if (debug) console.log("[mrf.getTiles] ranges:", ranges);

            const rangesWithData = await Promise.all(ranges.map(r => this.getRange(r, { debug })));

            // assign array buffers to each tile
            const datatiles = [];
            rangesWithData.forEach(range => {
                range.objs.forEach((tile, i) => {
                    // assuming that range.objs is sorted by start position
                    // which is a good assumption to make
                    const offset = range.objs.slice(0, i).reduce((total, tile) => total + tile.length, 0);
                    const data = range.data.slice(offset, offset + tile.length);
                    datatiles.push({ ...tile, data });
                });
            });
            if (debug) console.log("datatiles.length", datatiles.length);

            // check if datatiles have the same data
            // indicating an issue with fetching
            if (debug && typeof hash32 !== 'undefined') {
                const uniques = new Set(datatiles.map(t => hash32(new DataView(t.data)))).size;
                if (uniques !== datatiles.length) {
                    if (debug) console.log("[mrf.getTiles] datatiles.length:", datatiles.length);
                    if (debug) console.log("[mrf.getTiles] uniques:", uniques);
                    throw new Error(`Uh Oh. It seems that some data tiles share the same data`);
                } else {
                    console.log("[mrf] passed tile data uniquess check");
                }
            }

            if (debug) console.log(`[mrf.getTiles] compression: ${meta.compression}`);

            if (meta.compression === 'LERC') {
                datatiles.forEach((tile, i) => {
                    try {
                        const decoded = Lerc.decode(tile.data);
                        if (decoded) {
                            const { height, mask, pixels, width } = decoded;
                            if (pixels.length !== meta.pageBands) {
                                throw new Error("Uh Oh.  LERC decoded an unexpected number of bands");
                            }
                            tile.height = height;
                            tile.mask = mask;
                            tile.pixels = pixels[0]; // assuming only one band
                            tile.width = width;
                        }
                    } catch (error) {
                        console.error(`failed to decode tile ${i}`);
                        console.error(error);
                        if (this.strict) throw error;
                    }
                });
            }
            if (debug) console.log("[mrf.getTiles] finished decoding tiles");
            return datatiles;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    // get tiles with full bands
    // return results with full bands
    async getMultiBandTiles({ coords, debug, bands }) {
        if (debug) console.log("starting getMultiBandTiles with coords:", coords);
        const meta = await this.metadata;
        
        if (!bands) bands = range(meta.numBands);

        // expand tiles into one for each band
        const coordsXYB = [];
        coords.forEach(coord => {
            bands.forEach(band => {
                coordsXYB.push({ ...coord, b: band })
            })
        });

        const tilesXYB = await this.getTiles({ coords: coordsXYB, debug })
        if (debug) console.log("tilesXYB:", tilesXYB);

        // merge tiles back into multi-band tiles
        // can probably group using Map in the future
        const groups = groupBy(tilesXYB, t => [t.l, t.x, t.y]);
        if (debug) console.log("groups:", groups);

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
                y,
                pixels,
                width: group[0].width,
            });
        }

        return tilesXY;
    }
}

module.exports = MRF;
