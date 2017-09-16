Laniakea
========
### A multiplayer game engine for browsers.

**Status: Unstable, under development.**

### Planned Features
- Statically Typed. Built with TypeScript.
- Entity/Component/System architecture.
- Game state replication over webRTC Data Channels. Avoids Head of Line Blocking.
- Data bindings to game state that allow use of conventional web application frameworks for 2D UI.

### Demo/Development
This is a monorepo of multiple npm packages managed using [`lerna`](https://github.com/lerna/lerna) and [`yarn`'s workspaces feature](https://yarnpkg.com/en/docs/workspaces).
We'll assume you have `node` and `yarn` installed. I'm using `node v6.2.2` and `yarn v1.0.2` in case it matters.

To get started:
```
yarn run bootstrap
yarn run build
# See it run
yarn run demo
```
While it's running open <http://127.0.0.1:8080> to see the demo. Try opening 2 browser tabs!
