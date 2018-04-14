import * as ballsDemoImport from './balls-demo';
export const ballsDemo = ballsDemoImport;

import * as pongDemoImport from './pong-demo';
export const pongDemo = pongDemoImport;

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}` };
export const simFPS = 20;

export enum GameButtons { UP, LEFT, DOWN, RIGHT }