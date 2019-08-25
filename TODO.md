- [ ] Invulnerability mode which consumes your paddle width as a resource. The invuln zone grows from your paddle while used.
- [ ] Rename OutgoingMessage which conflicts with a type in http module.
- [ ] Evaluate the need for `withDeletedStateHidden()`, now that we can purge deleted state every frame.
- [ ] Reduce extrapolation for objects that can't be so safely extrapolated. Potentially by completing "local perception filters" rendering strategy.
- [ ] Automatic / manual bandwidth control. WebRTC has congestion control built-in. However we can potentially use more bandwidth than we do currently,
      and if bandwidth does get restricted, we can potentially save doing unnecessary network work in the application if a packet isnt able to be sent.
- [ ] Use inter-frame times to send more state sync packets. This ties in with above.
- [ ] Add leading underscores to private members (for JavaScript consumers' sake).
- [ ] Automatic reconnection (as our connection is over UDP this is more about flushing and re-syncing simulation).
- [ ] Explore capnproto ts as a networking + gamestate option. As evident from Button replication, ideal network format is quite likely not the ideal memory format.
      Therefore it may still be desirable to have separate representations even if capnproto makes sense for either of them.
- [ ] Explore use of conventional web frameworks for 2D UI, with databindings to game state.
- [ ] Graphs / stats from network. Maybe expose for use by other systems.
- [ ] Review and move xxhashjs.d.ts typings to xxhashjs or DefinitelyTyped.
- [ ] Review and move box-intersect.d.ts typings to box-intersect or DefinitelyTyped.
- [ ] Figure out which of demo-client's dependencies are actually devDependencies.
- Other TODO's still in the source code
