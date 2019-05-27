export * from './bot-logic';
export * from './components';
export * from './inputs';
export * from './level-geometry-system';
export * from './systems';

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}`; }
export const simFPS = 20;

// This is just for testing, production should always be 1.0
export const globalSimulationRateMultiplier = 1.0;
