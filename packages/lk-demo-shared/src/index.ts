import * as ballsDemoImport from './balls-demo';
export const ballsDemo = ballsDemoImport;

import * as pongDemoImport from './pong-demo';
export const pongDemo = ballsDemoImport;

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}` };
export const simFPS = 20;
