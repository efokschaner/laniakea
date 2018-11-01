import * as R from 'ramda';
import * as util from 'util';
import * as winston from 'winston';

const { combine, timestamp, printf } = winston.format;

function padStart (text: string, max: number, fillString?: string) {
  const cur = text.length;
  if (max <= cur) {
    return text;
  }
  const masked = max - cur;
  let filler = fillString || ' ';
  while (filler.length < masked) {
    filler += filler;
  }
  const fillerSlice = filler.slice(0, masked);
  return fillerSlice + text;
}

const humanFormat = printf(info => {
  return `${info.timestamp} - ${padStart(info.level.toUpperCase(), 6)}: ${info.message}`;
});

const logger = winston.createLogger({
  transports: [
    new (winston.transports.Console)({
      format: combine(
        timestamp(),
        humanFormat
      )
    }),
  ],
});

const formatArgs = util.format.bind(util);
console.error = R.compose(logger.error.bind(logger), formatArgs);
console.log = R.compose(logger.info.bind(logger), formatArgs); // Intentionally bound to info, winston.log != console.log
console.info = R.compose(logger.info.bind(logger), formatArgs);
console.debug = R.compose(logger.debug.bind(logger), formatArgs);
console.warn = R.compose(logger.warn.bind(logger), formatArgs);

export default logger;
