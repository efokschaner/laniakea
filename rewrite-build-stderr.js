// A dirty buildscript which rewrites our build command output to help vscode problem matcher
const path = require('path');

let curPackagePath = '';

process.stdin.pipe(require('split')()).on('data', function (line) {
  let packageBuildRegex = /.* exited \d+ in '(\S+)'$/;
  let packageBuildRegexResult = packageBuildRegex.exec(line);
  if (packageBuildRegexResult) {
    let demoPackageRegex = /lk-demo-(\S+)-(\S+)$/;
    let demoPackageRegexResult = demoPackageRegex.exec(
      packageBuildRegexResult[1]
    );
    if (demoPackageRegexResult) {
      curPackagePath = path.join(
        'demos',
        demoPackageRegexResult[1],
        demoPackageRegexResult[2]
      );
    } else {
      let testPackageRegex = /\S+-test$/;
      let testPackageRegexResult = testPackageRegex.exec(
        packageBuildRegexResult[1]
      );
      if (testPackageRegexResult) {
        curPackagePath = path.join('tests', packageBuildRegexResult[1]);
      } else {
        // Otherwise we assume its in packages
        curPackagePath = path.join('packages', packageBuildRegexResult[1]);
      }
    }
  }
  let tsErrorRelativeFilepathRegex = /\S+\(\d+,\d+\):/;
  line = line.replace(tsErrorRelativeFilepathRegex, curPackagePath + '/$&');
  console.log(line);
});
