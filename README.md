Laniakea
========
### An experimental multiplayer game engine for browsers.

**Status: Unstable, under development.**

### Motivation (for Yet Another Javascript Game Engine)
There are many game engines that target browsers these days. To give just a few examples:
- [Unity's WebGL target](https://docs.unity3d.com/Manual/webgl-gettingstarted.html)
- [Unreal's HTML5 target](https://docs.unrealengine.com/en-us/Platforms/HTML5/GettingStarted)
- [Godot's HTML5 target](http://docs.godotengine.org/en/3.0/getting_started/workflow/export/exporting_for_web.html)
- [Phaser](https://phaser.io/)

The support for multiplayer with a browser client offered by most established engines, ranges from "severely limited" to "non-existent".
Relatedly, certain kinds of games &mdash; or game mechanics &mdash; are typically problematic or avoided entirely in a browser-based game,
due to the [Head-of-line blocking](https://en.wikipedia.org/wiki/Head-of-line_blocking) that comes with HTTP/WebSocket-based communication.
It's likely that these engines have not been able to ship a networking solution for the browser that would be on par with other platforms that have access to
unordered (unreliable) networking layers.
Given the potential of WebRTC DataChannels to fulfil a similar role to UDP in traditional Game Engine architecture, and [support for WebRTC being relatively widespread](https://caniuse.com/#feat=rtcpeerconnection), I thought it would be interesting to explore whether WebRTC could improve this situation. Most of the experiments I've seen, explore WebRTC for its peer-to-peer qualities but I am more interested in its viability as a Client - Server connection.

Given that game networking efficiency benefits from relatively tight coupling to the organisation of game state and its serialisation / deserialisation mechanisms, and it interacts heavily with clock synchronisation and distributed simulation, I'm implementing a full runtime for organising game state and simulation, named **Laniakea**, in addition to the networking subsystem. Thus this is a "game engine" rather than just a "game networking library".

Games shall implement their state and their logic in terms of this runtime, and as a result, will get out-of-the-box state replication between server and client.
Games will be able to control networking where it intersects with things like "visibility" in a game, in order to achieve both security and performance objectives.
**Laniakea** will provide a more "bring your own" approach to everything outside of State, Simulation, and Networking.


### Planned Features
- Statically Typed. Built with TypeScript.
- Entity/Component/System architecture.
- Game state replication over webRTC Data Channels. Avoids [Head-of-line blocking](https://en.wikipedia.org/wiki/Head-of-line_blocking).
- Data bindings to game state that allow use of conventional web application frameworks for 2D UI.

### Demo/Development
This is a monorepo of multiple npm packages managed using [`lerna`](https://github.com/lerna/lerna), and [`yarn`'s workspaces feature](https://yarnpkg.com/en/docs/workspaces).
We'll assume you have `node` and `yarn` installed. I'm using `node v8.9.3` and `yarn v1.3.2` in case it matters.

To get started:
```
yarn run bootstrap
yarn run build
# See it run
yarn run demo
```
While it's running open <http://127.0.0.1:8080> to see the demo. Try opening 2 browser tabs!

#### VS Code Development Notes
Note that tasks defined in tasks.json assume bash. You can have VS evaluate them in bash using the user setting:
```
"terminal.integrated.shell.windows": "C:\\Program Files\\Git\\bin\\bash.exe"
```