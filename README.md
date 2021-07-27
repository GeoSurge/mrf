# mrf
Read Meta Raster Format Files (e.g. .mrf, .idx, .lrc, .data)

# install
```bash
npm install mrf
```

# Usage
## loading the library
You can load the library in three different ways.
### CommonJS Require
If you are using CommonJS, you can require the library like so:
```js
const mrf = require("mrf");
```
Or import a specific function like so:
```js
const { parseIDX } = require("mrf");
```
### ES6 Modules
If you are using ES6 Modules, you can import like so:
```js
import mrf from 'mrf';
```
Or import a specific function like so:
```js
import { parseIDX } from "mrf";
```
### Script Tag
```html
<script src="https://unpkg.com/mrf"></script>
```

## parsing .mrf files
The .mrf file includes the metadata about your project.  You can parse it by calling parseMRF, as in the example below:
```js
import { readFileSync } from 'fs';
import { parseMRF } from 'mrf';

const buffer = readFileSync("./example.mrf");
const result = parseMRF(buffer);
```
result is a JSON serializable object that looks like the following:
```javascript
{
  "area": 50362506,
  "height": 7587,
  "width": 6638,
  "depth": 1,
  "numBands": 4,
  "pageHeight": 512,
  "pageWidth": 512,
  "pageDepth": 1,
  "pageBands": 1,
  "compression": "LERC",
  "rsets": {
    "model": "uniform",
    "scale": 2
  },
  "xmin": 601135,
  "ymin": 3422859,
  "xmax": 607773,
  "ymax": 3430446,
  "projection": "PROJCS[\"NAD83 / UTM zone 16N\",GEOGCS[...]]",
  "order": "band",
  "overviews": [
    {
      "height": 3794,
      "heightInPages": 8,
      "pages": 224,
      "offset": 780,
      "width": 3319,
      "widthInPages": 7,
      "scale": {
        "height": 1.999736425935688,
        "width": 2
      }
    },
    /*
    .
    .
    .
    */
  ]
}
```
There are other properties available that deal with time and build options.  Please see the [examples](https://github.com/GeoSurge/mrf/tree/master/examples).

## parsing .idx files
Index files list the offset and length of each tile in binary format.  You can parse this information like so:
```javascript
import { readFileSync } from 'fs';
import { parseIDX } from 'mrf';

const buffer = readFileSync("test.idx");
const result = parseIDX(buffer);
```
result is an array of objects that looks like the following:
```js
[
  { "offset": 0, "length": 181646 },
  { "offset": 35326744, "length": 178797 },
  { "offset": 70080116, "length": 171538 },
  // 1085 more items
]
```

# Known Limitations
- Currently only supports LERC Compression and .lrc data files

# References:
- [Meta Raster Format (MRF) User Guide](https://github.com/nasa-gibs/mrf/blob/master/doc/MUG.md)
- [MRF WMS Client Mini Driver for GDAL](https://github.com/OSGeo/gdal/blob/master/gdal/frmts/wms/minidriver_mrf.cpp)
