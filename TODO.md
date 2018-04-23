- [ ] Strategy for pong AI:
      Find nearest ball with net velocity in direction of ai, intersect ball velocity with base line,
      move in direction of intersect. If no balls match, move to centre.
- [ ] Add paddle acceleration so that shorter movement taps produce less movement.
- [ ] Add leading underscores to private members (for JavaScript consumers' sake).
- [ ] Make Component wrapper class more like Entity wrapper class, the wrapper should not be our wire format, and possibly not our storage format. Reduces replication size.
- [ ] MTU/bandwidth aware replication (currently sends all state every frame).
- [ ] Use inter-frame times to send more state sync packets. This ties in with above.
- [ ] Automatic reconnection (as our connection is over UDP this is more about flushing and re-syncing simulation).
- [ ] Explore capnproto ts as a networking + gamestate option. As evident from Button replication, ideal network format is quite likely not the ideal memory format.
      Therefore it may still be desirable to have separate representations even if capnproto makes sense for either of them.
- [ ] Explore use of conventional web frameworks for 2D UI, with databindings to game state.
- [ ] Maybe eliminate BufferedRTCDataChannel if we just have handlers ready before the connection attempt?
- [ ] Maybe eliminate reliable RTCDataChannel as reliable can be implemented on top of unreliable with our protocol.
- [ ] Graphs / stats from network. Maybe expose for use by other systems.
- [ ] Review and move xxhashjs.d.ts typings to xxhashjs or DefinitelyTyped.
- [ ] Review and move box-intersect.d.ts typings to box-intersect or DefinitelyTyped.
- [ ] Figure out which of demo-client's dependencies are actually devDependencies.
- Other TODO's still in the source code
