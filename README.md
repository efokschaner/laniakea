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
due to the [Head-of-line blocking](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/#the-problem) that comes with HTTP/WebSocket-based communication.
It's likely that these engines have not been able to ship a networking solution for the browser that would be on par with other platforms that have access to
unordered, unreliable networking layers.

Given the potential of WebRTC DataChannels to fulfill a similar role to UDP in traditional Game Engine architecture, and [support for WebRTC being relatively widespread](https://caniuse.com/#feat=rtcpeerconnection), I thought it would be interesting to explore whether WebRTC could improve this situation.

In [this insightful article](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/#what-about-webrtc) the game networking veteran Glenn Fiedler specifically criticises WebRTC as "extremely complex", stemming from its focus on peer-to-peer networking, and states that:

> game developers appreciate simplicity and desire a "WebSockets for UDP"-like approach over the complexity of WebRTC

He goes on to propose a new UDP-based protocol [netcode.io](https://github.com/networkprotocol/netcode.io) with a view to it perhaps being accepted in to browser implementations.

While I entirely agree with Glenn on WebRTC having a lot of baggage beyond what is required for an unreliable channel between a game client and server, I wish to examine whether its possible create a system on top of WebRTC, that hides enough of that complexity, and allows us to build and deploy browser games that can get the advantages of this unreliable data channel and works in browser implementations today, rather than introducing a new standard and waiting for another round of browser standardisation and implementation.

In order to prove that a game networking solution is effective for development and deployment, it is prudent to actually use it in a few example games that benefit from the networking solution. To support building these examples, I'm implementing a full runtime for organising game state and simulation, named **Laniakea**, in addition to the networking subsystem. Thus this codebase is a "game engine" rather than just a "game networking library".

Games shall implement their state and their logic in terms of this runtime, and as a result, will get out-of-the-box state replication between server and client.
Games will be able to control networking where it intersects with things like "visibility" in a game, in order to achieve both security and performance objectives.
**Laniakea** will provide a more "bring your own" approach to everything outside of State, Simulation, and Networking.

### Key Features
- Statically typed. Built with TypeScript.
- Game state replication over webRTC Data Channels. Avoids [Head-of-line blocking](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/#the-problem).

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