#!/bin/sh -e

# full translation
gdal_translate -of GTiff m_3008501_ne_16_1_20171018.mrf original.tif 

# pull out first tile from mrf
gdal_translate -of GTiff -srcwin 0 0 512 512 m_3008501_ne_16_1_20171018.mrf m_3008501_ne_16_1_20171018.tif 