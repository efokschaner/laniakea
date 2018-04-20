// A dirty buildscript which rewrites our build command output to help vscode problem matcher
const path = require('path');

let currPackagePath = '';

process.stdin.pipe(require('split')()).on('data', function (line) {
  let packageBuildRegex = /.* Errored while running script in '(\S+)'$/;
  let result = packageBuildRegex.exec(line);
  if (result) {
    currPackagePath = path.join('packages', result[1]);
  }
  let tsErrorRelativeFilepathRegex = /\S+\(\d+,\d+\):/;
  line = line.replace(tsErrorRelativeFilepathRegex, currPackagePath + '/$&');
  console.log(line);
});
