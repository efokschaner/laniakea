import * as THREE from 'three';

import * as lk from 'laniakea-server';

import {
  BallMovementSystem,
  BallSpawnerSystem,
  EntityScheduledDeletion,
  EntityScheduledDeletionProcessor,
  Lerp2D,
  Lerp2DProcessor,
  PlayerInfo,
  registerComponents,
  SerializableVector2,
  WallVertex
} from 'lk-demo-pong-shared';

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

// Draft Strategy for pong AI
// Find nearest ball with net velocity in direction of ai, intersect ball velocity with base line,
// move in direction of intersect. If no balls match, move to centre.

// Quick and dirty seedable PRNG to get deterministic results.
// From https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
class DeterministicPRNG {
  // seed may be any number other than zero or a multiple of PI
  constructor(public seed: number) {
  }
  public getRandomNumberZeroInclusiveToOneExclusive() {
    let x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
  public getRandomInt(maxValExclusive: number) {
    return Math.floor(this.getRandomNumberZeroInclusiveToOneExclusive() * maxValExclusive);
  }
}

function playerIndexToPersistentVertexIndex(playerIndex: number): number {
  if(playerIndex === 0) {
    return 0;
  }
  if(playerIndex === 1) {
    return 2;
  }
  if(playerIndex === 2) {
    return 1;
  }
  return playerIndex;
}

function calculatePersistentVertexIndices(numPlayers: number): number[] {
  // default with 4 sides in fixed clockwise order to prevent them experiencing
  // a swapping as the shape grows / contracts between the random regime and this one
  let persistentIndices = [0, 1, 2, 3];
  let prng = new DeterministicPRNG(1);
  for (let i = 4; i < numPlayers; ++i) {
    // Insert the sides in a scrambled but deterministic order that
    // ensures existing sides are not reordered
    let targetIndex = prng.getRandomInt(persistentIndices.length);
    persistentIndices.splice(targetIndex, 0, i);
  }
  return persistentIndices;
}

function calculateShapeForNumPlayers(numPlayers: number) {
  let scaleFactor = 10;
  // Create a classic pong board
  if (numPlayers < 3) {
    let boxMax = new THREE.Vector2(0.9 * scaleFactor, 0.5 * scaleFactor);
    let box = new THREE.Box2(
      boxMax.clone().multiplyScalar(-1),
      boxMax,
    );
    return [
      // Order matters here, we start in the top right so its not far
      // from the top vertex that is usually the start off wall 0 in the polygon
      new THREE.Vector2(box.max.x, box.max.y),
      new THREE.Vector2(box.max.x, box.min.y),
      new THREE.Vector2(box.min.x, box.min.y),
      new THREE.Vector2(box.min.x, box.max.y),
    ];
  }
  // Arrange players around a circle to create a polygon
  let vertices = new Array<THREE.Vector2>(numPlayers);
  for (let i = 0; i < vertices.length; ++i) {
    let angle = 2 * Math.PI * i / numPlayers;
    let vert = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    vert.multiplyScalar(scaleFactor);
    vertices[i] = vert;
  }
  return vertices;
}

function doUpdateLevelGemoetry(currentFrame: lk.SimluationFrameData) {
  let state = currentFrame.state;
  let players = Array.from(state.getComponents(PlayerInfo));
  let numPlayersEverAlive = players.length;
  let alivePlayers = players.filter((pi) => pi.getData().alive);
  let numPlayersAlive = alivePlayers.length;

  // This is a multi phase process, we add required new vertices, we start lerping the vertices to where they need to go, then we delete unneeded vertices.
  // Added vertices originate from whichever existing persistentIndex comes after them.
  // All vertices lerp towards the target position of their persistentIndex or the target position of the next existing persistentIndex
  // On completion of lerps we delete persistentIndices which are not meant to exist any more and we re-assign visualIndices.

  let targetShape = calculateShapeForNumPlayers(numPlayersAlive);
  let persistentIndices = calculatePersistentVertexIndices(numPlayersEverAlive);
  // Represents all the persistent indices that shouldn't exist.
  let alivePersistentIndicesSet = new Set<number>(alivePlayers.map((pi) => playerIndexToPersistentVertexIndex(pi.getData().playerIndex)));
  if(numPlayersAlive <= 2) {
    // These should exist regardless
    alivePersistentIndicesSet.add(0);
    alivePersistentIndicesSet.add(1);
    alivePersistentIndicesSet.add(2);
    alivePersistentIndicesSet.add(3);
  }
  for(let player of players) {
    let playerData = player.getData();
    if(playerData.alive) {
      alivePersistentIndicesSet.add(playerIndexToPersistentVertexIndex(playerData.playerIndex));
    }
  }

  // Remove indices of dead vertices, building interpolation targets as we go.
  let alivePersistentIndices: number[] = [];
  // Describes the index in the target shape to which each persistentvertex should interpolate to.
  let interpolationTargetIndex = new Array<number>(persistentIndices.length);
  let numAliveIndicesPassed = 0;
  for(let i = 0; i < persistentIndices.length; ++i) {
    let persistentIndex = persistentIndices[i];
    interpolationTargetIndex[i] = numAliveIndicesPassed % targetShape.length;
    if(alivePersistentIndicesSet.has(persistentIndex)) {
      // Effectively "consumes" this vertex on the shape and we start sending vertices to the next one.
      numAliveIndicesPassed += 1;
      alivePersistentIndices.push(persistentIndex);
    }
  }

  let existingVertices = Array.from(state.getComponents(WallVertex)!);
  let existingPersistentIndices = new Set<number>(existingVertices.map((v) => v.getData().persistentIndex));
  let persistentIndicesToCreate = Array.from(alivePersistentIndicesSet).filter((i) => !existingPersistentIndices.has(i));
  let persistentIndicesToDelete = Array.from(existingPersistentIndices).filter((i) => !alivePersistentIndicesSet.has(i));

  for(let persistentIndex of persistentIndicesToCreate) {
    let vertexToInsert = new WallVertex();
    vertexToInsert.persistentIndex = persistentIndex;
    state.createEntity([
      vertexToInsert,
    ]);
  }

  // After insertions, fix the visual indices of all the vertices and fix the positions of the ones we've just created.
  // refetch this collection
  existingVertices = Array.from(state.getComponents(WallVertex)!);
  let existingVerticesMap = new Map(existingVertices.map((value) => [value.getData().persistentIndex, value] as [number, lk.Component<WallVertex>]));

  // In lieu of a "generalised" approach for sequencing / scheduling work, we'll just do the lerp and the deletion on the same timeout.
  // TODO we need to fixup visual indices when these are deleted.
  let lerpStartDelayS = 0.5;
  let lerpDurationS = 1;
  let entityDeletionTime = currentFrame.simulationTimeS + lerpStartDelayS + lerpDurationS;
  for(let persistentIndex of persistentIndicesToDelete) {
    // It MUST be in here based on prior logic
    let vert = existingVerticesMap.get(persistentIndex)!;
    let scheduledDeletion = new EntityScheduledDeletion();
    scheduledDeletion.deletionTimeS = entityDeletionTime;
    state.addComponent(vert.getOwnerId(), scheduledDeletion);
  }

  // Sort them by the order of their appearance in the total ordering.
  let sortedExistingVertices = new Array<lk.Component<WallVertex>>();
  for(let persistentIndex of persistentIndices) {
    let maybeObj = existingVerticesMap.get(persistentIndex);
    if(maybeObj !== undefined) {
      sortedExistingVertices.push(maybeObj);
    }
  }

  // Run through them in reverse order because the the origination positions apply from the successive
  // vertex that exists (the prior in reverse order).
  // We need to iterate a bit more than once because we can't start setting positions until we've encountered
  // one that isn't new.
  let lastExistingPos = {x: 0, y: 0};
  let firstPriorlyExistingIndex: number|undefined = undefined;
  for(let i = sortedExistingVertices.length - 1; i !== firstPriorlyExistingIndex; i = mod(i - 1, sortedExistingVertices.length)) {
    let vertexData = sortedExistingVertices[i].getData();
    vertexData.visualIndex = i;
    let alreadyExisted = existingPersistentIndices.has(vertexData.persistentIndex);
    if(firstPriorlyExistingIndex === undefined) {
      // existingPersistentIndices.size === 0 handles case where we havent created any at all yet
      // and we'd never set the firstPriorlyExistingIndex otherwise.
      if(alreadyExisted || existingPersistentIndices.size === 0) {
        firstPriorlyExistingIndex = i;
      }
    }
    if(alreadyExisted) {
      // This one is not new, the next new one gets its position
      lastExistingPos = {x: vertexData.position.x, y: vertexData.position.y};
    } else {
      vertexData.position.x = lastExistingPos.x;
      vertexData.position.y = lastExistingPos.y;
    }
  }

  // Begin Lerps
  for(let i = 0; i < persistentIndices.length; ++i) {
    let persistentIndex = persistentIndices[i];
    let maybeObj = existingVerticesMap.get(persistentIndex);
    if(maybeObj !== undefined) {
      let currentPos = maybeObj.getData().position;
      let lerp = new Lerp2D();
      lerp.originalPosition.copy(currentPos);
      // Note the typecast on the next line is just to get around the quirks of threejs' "this" typings limitations.
      lerp.targetPosition.copy(targetShape[interpolationTargetIndex[i]] as SerializableVector2);
      lerp.startTimeS = currentFrame.simulationTimeS + lerpStartDelayS;
      lerp.durationS = lerpDurationS;
      state.addComponent(maybeObj.getOwnerId(), lerp);
    }
  }

  // TODO Fixup Paddles!
  /*
  if(numPlayersPriorToAddition < 1) {
    // not enough players to start yet
    return;
  }
  let paddles = Array.from(serverEngine.currentFrame.state.getComponents(pongDemo.Paddle));
  */
}

export function initialiseServer(serverEngine: lk.ServerEngine) {
  registerComponents(serverEngine.engine);

  serverEngine.engine.addSystem(new Lerp2DProcessor());
  serverEngine.engine.addSystem(new EntityScheduledDeletionProcessor());
  serverEngine.engine.addSystem(new BallSpawnerSystem());
  serverEngine.engine.addSystem(new BallMovementSystem());

  serverEngine.onPlayerConnected.attach((playerId) => {
    let state = serverEngine.currentFrame.state;
    let players = Array.from(state.getComponents(PlayerInfo));
    let newPlayerInfo = new PlayerInfo();
    newPlayerInfo.playerIndex = players.length;
    newPlayerInfo.playerId = playerId;
    state.createEntity([newPlayerInfo]);
    doUpdateLevelGemoetry(serverEngine.currentFrame);
  });
}
