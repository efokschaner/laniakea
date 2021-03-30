let path = require('path');

let postcssPresetEnv = require('postcss-preset-env');
let nested = require('postcss-nested');

module.exports = {
  devtool: 'source-map',
  entry: {
    app: ['./src/ts/app.ts'],
  },
  output: {
    path: path.resolve('dist'),
    publicPath: '/',
    filename: 'bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
            },
          },
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [nested, postcssPresetEnv({ stage: 2 })],
              },
            },
          },
        ],
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
      },
    ],
  },
  plugins: [],
  resolve: {
    extensions: ['.js', '.ts'],
    fallback: {
      buffer: require.resolve('buffer'),
    },
  },
};
