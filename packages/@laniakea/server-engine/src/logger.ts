import * as util from 'util';
import * as R from 'ramda';
import * as winston from 'winston';

const { combine, timestamp, printf } = winston.format;

function padStart(text: string, max: number, fillString?: string) {
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

const humanFormat = printf(
  (info) =>
    // info.timestamp from winston is `any`
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    `${info.timestamp} - ${padStart(info.level.toUpperCase(), 6)}: ${
      info.message
    }`
);

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      format: combine(timestamp(), humanFormat),
    }),
  ],
});

function hookConsoleWithLogger(): void {
  const formatArgs = util.format.bind(util);
  console.error = R.compose<any, string, winston.Logger>(
    logger.error.bind(logger),
    formatArgs
  );
  console.log = R.compose<any, string, winston.Logger>(
    logger.info.bind(logger),
    formatArgs
  ); // Intentionally bound to info, winston.log != console.log
  console.info = R.compose<any, string, winston.Logger>(
    logger.info.bind(logger),
    formatArgs
  );
  console.debug = R.compose<any, string, winston.Logger>(
    logger.debug.bind(logger),
    formatArgs
  );
  console.warn = R.compose<any, string, winston.Logger>(
    logger.warn.bind(logger),
    formatArgs
  );
}

export { logger, hookConsoleWithLogger };
