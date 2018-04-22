export * from './components';
export * from './inputs';
export * from './systems';

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}`; }
export const simFPS = 20;
