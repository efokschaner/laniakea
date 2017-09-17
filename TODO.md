- [ ] Input handling (interactive games are supposedly more fun!)
- [ ] Time synchronisation using RTT estimate.
- [ ] Time aware replication using rewind-replay.
- [ ] MTU/bandwidth aware replication (currently sends all state every frame).
- [ ] Decouple packet send/receive rate from simulation rate.
- [ ] Make network engine time delta driven from engine (maybe?)
- [ ] Automatic reconnection.
- [ ] Explore capnproto ts as a networking + gamestate option.
- [ ] Avoid divergence from quantisation when replicating data. (Quantise all data after simulation step?)
- [ ] Maybe eliminate BufferedRTCDataChannel if we just have handlers ready before the connection attempt?
- [ ] Graphs / stats from network. Maybe expose for use by other systems.
- [ ] Review and move xxhashjs.d.ts typings to xxhashjs or DefinitelyTyped.
- [ ] Review and move box-intersect.d.ts typings to box-intersect or DefinitelyTyped.
- [ ] Figure out which of lk-demo-client's dependencies are actually devDependencies.

- [ ] Other TODO's still in the source code (some small TODO's are better in context of source)

- [ ] Fix build problem matchers for yarn / lerna / webpack
```
{
  "owner": "webpack",
  "severity": "error",
  "fileLocation": "relative",
  "pattern": [
    {
      "regexp": "(ERROR|WARNING) in (.+)$",
      "severity" : 1,
      "file": 2
    },
    {
      "regexp": "\\[(\\d+), (\\d+)\\]: (.+)$",
      "line": 1,
      "column": 2,
      "message": 3,
      "loop": true
    }
  ],
  "background": {
    "activeOnStart": false,
    "beginsPattern": "Time: \\d+ms",
    "endsPattern": "webpack: bundle is now VALID."
  }
}
```