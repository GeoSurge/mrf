const path = require('path');
const { readFileSync } = require('fs');

const mode = process.env.NODE_ENV;

module.exports = {
  mode,
  devtool: 'eval',
  entry: './src/index.js',
  output: {
    filename: (mode === "production" ? 'mrf.min.js' : 'mrf.js'),
    path: path.resolve(__dirname, 'dist'),
  },
  watch: mode === "development",
  module: {
    rules: [
      {
        test: /\.m?js$/,
        use: {
          loader: 'babel-loader',
          options: JSON.parse(readFileSync(".babelrc.json", 'utf-8'))
        }
      }
    ]    
  },
  externals: {
    'fs': 'fs'
  },
  node: {
    'fs': 'empty'
  }
};
