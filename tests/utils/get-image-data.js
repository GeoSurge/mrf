module.exports = values => {
  const imageHeight = values[0].length;
  const imageWidth = values[0][0].length;
  const frameData = Buffer.alloc(imageHeight * imageWidth * 4);

  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const i = y * imageWidth * 4 + x * 4;
      frameData[i] = values[0][y][x];
      frameData[i + 1] = values[1][y][x];
      frameData[i + 2] = values[2][y][x];
      frameData[i + 3] = values[3][y][x];
    }
  }

  return frameData;
};
