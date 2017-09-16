var path = require('path');
var webpack = require('webpack');
var ExtractTextPlugin = require("extract-text-webpack-plugin");

var cssnext = require('postcss-cssnext');
var nested = require('postcss-nested');
var doiuse = require('doiuse');
var wordwrap = require('wordwrap');

var colors = require('colors');

var postCSSPlugins = [
  nested,
  cssnext(),
  doiuse({
    browsers: ['> 1%'],
    ignore: ['kerning-pairs-ligatures'],
    onFeatureUsage: function (info) {
      var source = info.usage.source;
      // file is whole require path, joined with !'s.. we want the last part
      var sourceFile = path.relative('.', source.input.file.split('!').pop())
      var sourceLine = sourceFile + ':' + source.start.line;
      // take out location info in message itself
      var message = info.message.split(': ').slice(1).join(': ')
      console.log('[doiuse]'.red + ' ' + sourceLine + ': ' + info.featureData.title + '\n');
      console.log(wordwrap(4, process.stdout.columns - 1)(message) + '\n');
    }
  }),
];

module.exports = {
  devtool: 'source-map',
  entry: {
    app: ['./src/ts/app.ts']
  },
  output: {
    path: require('path').resolve('dist'),
    publicPath: '/',
    filename: 'bundle.js'
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
              importLoaders: 1
            }
          },
          {
            loader: 'postcss-loader',
            options: {
              plugins: function () {
                return postCSSPlugins;
              }
            }
          }
        ]
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader'
      }
    ]
  },
  plugins: [
    new ExtractTextPlugin('styles.css'),
  ],
  resolve: {
    extensions: ['.js']
  }
};
