// tslint:disable-next-line:no-var-requires
const present = require('present');

export interface PeriodicCallbackHandle {
  stop(): void;
}

// TODO maybe add a typesafe typedef in the style of our Id's in order to prevent mixing of Milliseconds and Seconds

/**
 * Scheduled a callback repeatedly at `periodMS` milliseconds after the start of each callback call.
 * Avoids the period being dependent on execution time. This is not guaranteed if the callback takes longer than `periodMS`
 * or if the executor is hogged by other code.
 * @param callback
 * @param periodMS
 * @param cosmeticName Name of the callback used in errors and warnings.
 */
export function periodicCallback(callback: () => void, periodMS: number, cosmeticName: string): PeriodicCallbackHandle {
  let nextTimeoutHandle: NodeJS.Timer;
  let callbackWrapper = () => {
    let startTimeMS = present();
    try {
      callback();
    } catch (e) {
      console.error(`Exception from ${cosmeticName} callback`);
      console.error(e, e.stack);
    }
    let endTimeMS = present();
    let durationMS = endTimeMS - startTimeMS;
    let timeToNextCallMS = periodMS - durationMS;
    if (timeToNextCallMS < 0) {
      console.warn(`${cosmeticName} callback took longer than period. periodMS=${periodMS} durationMS=${durationMS}`);
      timeToNextCallMS = 0;
    }
    nextTimeoutHandle = setTimeout(callbackWrapper, timeToNextCallMS);
  };
  nextTimeoutHandle = setTimeout(callbackWrapper, 0);
  return {
    stop() {
      clearTimeout(nextTimeoutHandle);
    },
  };
}
