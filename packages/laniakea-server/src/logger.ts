import * as util from 'util';
import * as R from 'ramda';
import * as winston from 'winston';

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      timestamp: function() {
        return (new Date()).toString();
      },
      formatter: function(options: any) {
        return options.timestamp() +' '+ options.level.toUpperCase() +' '+ (undefined !== options.message ? options.message : '') +
          (options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
      }
    })
  ]
});

const formatArgs = util.format.bind(util);
console.error = R.compose(logger.error.bind(logger), formatArgs);
console.log = R.compose(logger.info.bind(logger), formatArgs); // Intentionally bound to info, winston.log != console.log
console.info = R.compose(logger.info.bind(logger), formatArgs);
console.debug = R.compose(logger.debug.bind(logger), formatArgs);
console.warn = R.compose(logger.warn.bind(logger), formatArgs);

export default logger;