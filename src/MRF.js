const fetch = require('cross-fetch');
const fs = require('fs');
const Lerc = require("lerc");
const groupBy = require('lodash.groupBy');

const cluster = require('./cluster');
const parseMRF = require('./parseMRF');
const parseIDX = require('./parseIDX');
const range = require('./range');

class MRF {

    constructor({ xml, s3, url, awsAccessKeyId, awsSecretAccessKey, data } = {}) {
        if (url) {
            this.url = url;
            this.data = data;
            this.metadata = fetch(url).then(response => response.text()).then(parseMRF);
            this.idx = fetch(url.replace(/.mrf$/, '.idx')).then(response => response.arrayBuffer()).then(parseIDX);
        } else if (s3) {

        } else if (xml && idx) {
            this.metadata = Promise.resolve(parseMRF(xml));
            this.idx = Promise.resolve(parseIDX(idx));
        }
    }

    acquire(uri) {

    }

    async getValues({ debug, top, left, bottom, right, width, height } = {}) {
        console.log("starting getValues with:", { top, left, bottom, right, width, height });

        const meta = await this.metadata;

        const { pageHeight, pageWidth } = meta;

        const realHeight = (meta.height - bottom) - top;
        if (debug) console.log("[mrf.getValues] realHeight:", realHeight);

        const realWidth = (meta.width - right) - left;
        if (debug) console.log("[mrf.getValues] realWidth:", realWidth);

        const requestedHeight = typeof height !== "undefined" || height !== null ? height : realHeight;
        if (debug) console.log("[mrf.getValues] requestedHeight:", requestedHeight);

        const requestedWidth = typeof width !== "undefined" || width !== null ? width : realWidth;
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
                height: meta.scale,
                width: meta.width
            }
        };
        for (let i = 0; i < meta.overviews.length + 1; i++) {
            const ovr = meta.overviews[i];
            if (requestedScaleHeight <= ovr.scale.height && requestedScaleWidth <= ovr.scale.width) {
                selection = { index: i, ...ovr };
            } else {
                break;
            }
        }
        if (debug) console.log("[mrf.getValues] selected overview level:", selection);

        // scale top, left, bottom, right by selected overview level
        const scaledTop = top / selection.scale.height;
        if (debug) console.log("[mrf.getValues] scaledTop:", scaledTop);

        const scaledBottom = top / selection.scale.height;
        if (debug) console.log("[mrf.getValues] scaledBottom:", scaledBottom);

        const scaledLeft = left / selection.scale.width;
        if (debug) console.log("[mrf.getValues] scaledLeft:", scaledLeft);

        const scaledRight = right / selection.scale.width;
        if (debug) console.log("[mrf.getValues] scaledRight:", scaledRight);
       
        // need to determine indexes of tiles to fetch based on params and selection
        // in tile coordinate space
        // with x0, y0 being the top left corner and x1,y1 being the bottom right corner
        const tileMinX = Math.floor(scaledLeft / pageWidth);
        if (debug) console.log("[mrf.getValues] tileMinX:", tileMinX);

        const tileMaxX = Math.floor((selection.width - scaledRight) / pageWidth);
        if (debug) console.log("[mrf.getValues] tileMaxX:", tileMaxX);

        const tileMinY = Math.floor(scaledTop / pageHeight);
        if (debug) console.log("[mrf.getValues] tileMinY:", tileMinY);

        const tileMaxY = Math.floor((selection.height - scaledBottom) / pageHeight);
        if (debug) console.log("[mrf.getValues] tileMaxY:", tileMaxY);

        const tiles = [];
        for (let x = tileMinX; x <= tileMaxX; x++) {
            for (let y = tileMaxX; y <= tileMaxY; y++) {
                tiles.push({ l: selection.index, x, y, })
            }
        }
        console.log("tiles:", tiles);
    }

    async getRange(range, { debug } = {}) {
        const { data } = this;
        const result = { ...range };
        if (typeof data === "string" && data.startsWith("http")) {
            console.log(data);
            // checking if the server supports range requests
            const head = await fetch(data, { method: 'HEAD' });
            const header = head.headers.get('Accept-Ranges') || head.headers.get('accept-ranges');
            // we run toString in case it's an array of one
            if (!header || header.toString() !== 'bytes') {
                throw new Error("Uh Oh.  Looks like the server doesn't support range requests");
            }
            
            const headers = { Range: `bytes=${range.start}-${range.end}` };
            console.log("headers:", headers);
            const response = await fetch(data, { headers });
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

    // tiles are in format [ { x, y, l }]
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
            // goes row by column by pixel/band
            console.log("coords:", coords);

            // https://en.wikipedia.org/wiki/Row-_and_column-major_order
            const tiles = coords.map(({ b, l, x, y }) => {
                if (debug) console.log("[mrf]", { b, l, x, y });
                const ovr = l >= 1 && meta.overviews[l - 1];
                const levelOffset = l === 0 ? 0 : ovr.offset;
                const lw = l === 0 ? meta.widthInTiles : ovr.widthInPages;
                console.log("lw:", lw);
                // const i = (l === 0 ? 0 : ovr.offset) + meta.numBands * (y * x + x) + b;
                // this assumes it goes [R{0,0}, G{0,0}, B{0,0}, A{0,0}, R{1,0}, G{1,0}, B{1,0}, A{1,0}]
                const rowOffset = (y * lw * numBands);
                console.log("rowOffset:", rowOffset);
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
                const end = start + length;
                return { b, i, l, x, y, start, end, length };
            });
            // console.log("tiles:", tiles);
            // check that aren't requesting the same byte block
            if (new Set(tiles.map(t => t.start)).size !== tiles.length) {
                throw new Error("Uh Oh. We seem to be requesting the same block of bytes for different tiles");
            }

            const ranges = cluster(tiles);
            // console.log("ranges:", ranges);

            const rangesWithData = await Promise.all(ranges.map(r => this.getRange(r, { debug: true })));

            // assign array buffers to each tile
            const datatiles = [];
            rangesWithData.forEach(range => {
                range.objs.forEach((tile, i) => {
                    console.log("range.objs.length;", range.objs.length);
                    const offset = range.objs.slice(0, i).reduce((total, tile) => total + tile.length, 0);
                    console.log("offset:", offset);
                    const data = range.data.slice(offset, tile.length);
                    datatiles.push({ ...tile, data });
                });
            });
            if (debug) console.log("datatiles;", datatiles);

            // need to decode the data
            if (debug) console.log(`compression is ${meta.compression}`);

            // check if datatiles have the same data
            // indicating an issue with fetching
            if (debug) {
                if (new Set(datatiles.map(t => JSON.stringify(new Uint8Array(t.data)))).size !== datatiles.length) {
                    throw new Error("Uh Oh. It seems that some data tiles share the same data");
                }
            }

            if (meta.compression === 'LERC') {
                datatiles.forEach((tile, i) => {
                    try {
                        const fp = `/tmp/lerc-${i}`;
                        fs.writeFileSync(fp, new DataView(tile.data));
                        console.log("wrote to ", fp);
                        const decoded = Lerc.decode(tile.data);
                        if (decoded) {
                            const { height, mask, pixels, width } = decoded;
                            if (pixels.length !== meta.pageBands) {
                                throw new Error("Uh Oh.  LERC decoded an unexpected number of bands");
                            }
                            // const rows = [];
                            // for (let r = 0; r <= height; r++) {
                            //     const row = [];
                            //     for (let c = 0; c < width; r++) {
                            //         row.push(pixels[r * width + c]);
                            //     }
                            //     rows.push(row);
                            // }
                            console.log("pixels:", pixels.slice(0, 10));
                            tile.height = height;
                            tile.mask = mask;
                            tile.pixels = pixels[0]; // assuming only one band
                            tile.width = width;
                            if (debug) console.log(`successfully decoded tile ${i}`);
                        }
                    } catch (error) {
                        console.error(`failed to decode tile ${i}`);
                        console.error(error);
                    }
                });
            }
            if (debug) console.log("datatiles:", datatiles);
            return datatiles;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    // get tiles with full bands
    // return results with full bands
    async getMultiBandTiles({ coords, debug, bands }) {
        console.log("starting getMultiBandTiles with coords:", coords);
        const meta = await this.metadata;
        // const groups = groupBy(coords, coord => `${coord.x}-${coord.y}`);
        // console.log("groups.length:", groups);
        
        if (!bands) bands = range(meta.numBands);
        // console.log("bands:", bands);

        // expand tiles into one for each band
        const coordsXYB = [];
        coords.forEach(coord => {
            bands.forEach(band => {
                coordsXYB.push({ ...coord, b: band })
            })
        });

        const tilesXYB = await this.getTiles({ coords: coordsXYB, debug: true })
        // console.log("tilesXYB:", tilesXYB);

        // merge tiles back into multi-band tiles
        // can probably group using Map in the future
        const groups = groupBy(tilesXYB, t => [t.l, t.x, t.y]);

        // console.log("groups:", groups);
        const tilesXY = [];
        for (const [lxy, group] of Object.entries(groups)) {
            // console.log("lxy:", lxy);
            const [l, x, y] = lxy.split(",").map(n => Number.parseInt(n));
            // get tiles for each band
            const pixels = new Array(meta.numBands);
            // to-do: need to add support for mask through decoded.mask
            group.forEach(g => {
                if (g.pixels) {
                    console.log("g.b:", g.b);
                    console.log("g.pixels.length:", g.pixels.length);
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

        console.log("tilesXY:", tilesXY);
        return tilesXY;
    }
}

module.exports = MRF;
