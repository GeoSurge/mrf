#!/bin/sh -e

# download NAIP data
wget https://mrf.s3.amazonaws.com/m_3008501_ne_16_1_20171018.idx
wget https://mrf.s3.amazonaws.com/m_3008501_ne_16_1_20171018.lrc
wget https://mrf.s3.amazonaws.com/m_3008501_ne_16_1_20171018.mrf

# full translation to PNG
gdal_translate -of PNG m_3008501_ne_16_1_20171018.mrf m_3008501_ne_16_1_20171018.png

# pull out a test tile that is half-a-tile from the top edge and half-a-tile from the left edge
gdal_translate -of PNG -srcwin 256 256 512 512 m_3008501_ne_16_1_20171018.mrf m_3008501_ne_16_1_20171018_halfway.png

# scale tile by 50%
gdal_translate -of PNG -srcwin 256 256 512 512 -outsize 256 256 m_3008501_ne_16_1_20171018.mrf scaled_by_half.png

# scale tile down from 512x512 to 100x100
gdal_translate -of PNG -srcwin 256 256 512 512 -outsize 100 100 m_3008501_ne_16_1_20171018.mrf scaled_100x100.png

# other test files
wget https://mrf.s3.amazonaws.com/snap_test_3dTTTTTTT_.mrf
wget https://mrf.s3.amazonaws.com/test_weekly_jpg2012060_.mrf