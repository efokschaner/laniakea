// A dirty buildscript which rewrites our build command output to help vscode problem matcher
const path = require('path');

let currPackagePath = '';

process.stdin.pipe(require('split')()).on('data', function (line) {
  if (line.startsWith('lerna ERR! execute npm ERR!')) {
    return;
  }
  if (line.startsWith('lerna ERR! execute ')) {
    if (line.startsWith('lerna ERR! execute   stack:')) {
      return;
    } else if (line.startsWith('lerna ERR! execute   stdout:')) {
      return;
    } else if (line.startsWith('lerna ERR! execute   stderr:')) {
      return;
    }
    line = line.replace('lerna ERR! execute ', '');
  }
  let packageBuildRegex = /> \S+@\S+ build (\S+)$/;
  let result = packageBuildRegex.exec(line);
  if (result) {
    currPackagePath = result[1];
    console.error(line);
    return;
  }

  let tsErrorRelativeFilepathRegex = /\S+\(\d+,\d+\):/;
  line = line.replace(tsErrorRelativeFilepathRegex, currPackagePath + '/$&');

  let webpackErrorRelativeFilepathRegex = /ERROR in (\S+)/;
  let webpackErrorRelativeFilepathRegexResult = webpackErrorRelativeFilepathRegex.exec(line);
  if (webpackErrorRelativeFilepathRegexResult) {
    line = 'ERROR in ' + path.resolve(currPackagePath, webpackErrorRelativeFilepathRegexResult[1]);
  }
  console.error(line);
});
