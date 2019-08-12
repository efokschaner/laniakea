- [ ] Consider whether we should abandon component IDs and instead make kindId + entityId the only primary key.
      We can still have a ComponentId type to facilitate code that wants it, it should just be a kindId + entityId concatenated.
- [ ] ComponentKindId should be on the GenericComponent interface but should not be a stored member within the component impl itself, because it is redundant with the type of the object itself.
- [ ] Make Component wrapper class more like Entity wrapper class, the wrapper should not be our wire format, and possibly not our storage format. Reduces replication size.
      Relates to ComponentId changes.
- [ ] Make ComponentKindIds (possibly all TypeIDs) only 1 or 2 bytes on the wire, by sending a dictionary in a handshake.
- [ ] Rename OutgoingMessage which conflicts with a type in http module.
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
