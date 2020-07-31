#!/bin/sh -e

# over-ride old ESRI files
curl https://raw.githubusercontent.com/Esri/lerc/master/OtherLanguages/js/LercDecode.js -o ./node_modules/lerc/LercDecode.js

cd ./node_modules/lerc/
npm install
npm run build
