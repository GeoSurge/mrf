module.exports = values => {
  let invalid = 0;
  for (let bandIndex = 0; bandIndex < values.length; bandIndex++) {
    const band = values[bandIndex];
    for (let rowIndex = 0; rowIndex < band.length; rowIndex++) {
      const row = band[rowIndex];
      for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
        const value = row[columnIndex];
        const valid = value !== null && value !== undefined && value >= 0 && value <= 255;
        if (!valid) invalid++;
      }
    }
  }
  return invalid;
};
