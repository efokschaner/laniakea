Laniakea
========
## A multiplayer game engine for browsers, harnessing latest technologies and concepts.

#### Status: Unstable, under development.

### Planned Features
- Statically Typed. Built with TypeScript.
- Entity/Component/System architecture.
- Game state replication over webRTC Data Channels. Avoids Head of Line Blocking.
- Data bindings to game state that allow use of conventional web application frameworks for 2D UI.

### Demo/Development
This is a monorepo of multiple npm packages managed using [`lerna`](https://github.com/lerna/lerna).
We'll assume you have `node` and `npm` installed. I'm using `node v6.2.2` and `npm v3.9.5` in case it matters.

To get started:
```
npm run bootstrap
npm run build
# See it run
npm run demo
```
While it's running open <http://127.0.0.1:8080> to see the demo. Try opening 2 browser tabs!
