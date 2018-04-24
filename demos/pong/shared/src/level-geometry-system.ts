import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  EntityScheduledDeletion,
  Lerp2D,
  Orientation,
  Paddle,
  PlayerInfo,
  Position2,
  SerializableVector2,
  WallVertex,
  Final2Players,
} from './components';

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

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

function getOrCreateFinal2Players(state: lk.EntityComponentState): lk.Component<Final2Players> {
  let components = Array.from(state.getComponents(Final2Players));
  let component = components[0];
  if (component !== undefined) {
    return component;
  }
  let newComponent = new Final2Players();
  let newEntity = state.createEntity([newComponent]);
  return newEntity.getComponent(Final2Players)!;
}

function playerIndexToPersistentVertexIndex(playerIndex: number): number {
  // Indices 1 and 3 are reserved for the playerless walls that are injected into the 2 player board
  if (playerIndex === 0) {
    return 0;
  }
  if (playerIndex === 1) {
    return 2;
  }
  return playerIndex + 2;
}

function calculatePersistentVertexIndices(numPlayers: number): number[] {
  // default with 2 sides in fixed clockwise order to prevent them experiencing
  // a swapping as the shape grows / contracts between the random regime and this one
  let persistentIndices = [0, 2];
  let prng = new DeterministicPRNG(1);
  for (let i = 2; i < numPlayers; ++i) {
    // Insert the sides in a scrambled but deterministic order that
    // ensures existing sides are not reordered
    let targetIndex = prng.getRandomInt(persistentIndices.length);
    persistentIndices.splice(targetIndex, 0, playerIndexToPersistentVertexIndex(i));
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

function doUpdateLevelGeometry(state: lk.EntityComponentState, simulationTimeS: number) {
  let players = Array.from(state.getComponents(PlayerInfo));
  let numPlayersEverAlive = players.length;
  let alivePlayers = players.filter((pi) => pi.getData().alive);
  let numPlayersAlive = alivePlayers.length;

  // This gives us memory of the final 2 players on the board so that we dont churn the geometry
  // unneccessarily when below 3 players
  let final2Players = getOrCreateFinal2Players(state);
  let final2Data = final2Players.getData();
  if(numPlayersAlive == 1) {
    let newLastPlayerIndex = alivePlayers[0].getData().playerIndex;
    if(final2Data.lastPlayerIndex !== newLastPlayerIndex) {
      final2Data.secondLastPlayerIndex = final2Data.lastPlayerIndex;
      final2Data.lastPlayerIndex = newLastPlayerIndex;
    }
  }
  if(numPlayersAlive == 2) {
    final2Data.lastPlayerIndex = alivePlayers[0].getData().playerIndex;
    final2Data.secondLastPlayerIndex = alivePlayers[1].getData().playerIndex;
  }

  // This is a multi phase process where we:
  // - add required new vertices
  // - schedule a delete for unneeded vertices.
  // - unschedule delete of any vertices that were marked but are needed again
  // - start lerping the vertices to where they need to go,
  // Added vertices originate from whichever existing persistentIndex comes after them.
  // All vertices lerp towards the target position of their persistentIndex or the target position of the next existing persistentIndex
  // On completion of lerps we delete persistentIndices which are not meant to exist any more and we re-assign visualIndices.

  let targetShape = calculateShapeForNumPlayers(numPlayersAlive);
  let persistentIndices = calculatePersistentVertexIndices(numPlayersEverAlive);
  // Represents all the persistent indices that should exist.
  let alivePersistentIndicesSet = new Set<number>(alivePlayers.map((pi) => playerIndexToPersistentVertexIndex(pi.getData().playerIndex)));

  // Insert 2 walls that are either the final 2 players or ready for the first 2
  // And position the playerless sidewalls
  let lastPlayerIndex = final2Data.lastPlayerIndex !== -1 ? final2Data.lastPlayerIndex : 0;
  let lastPlayerPersistentIndex = playerIndexToPersistentVertexIndex(lastPlayerIndex);
  let targetIndexForWall1 = persistentIndices.indexOf(lastPlayerPersistentIndex) + 1;
  persistentIndices.splice(targetIndexForWall1, 0, 1);

  let secondLastPlayerIndex = final2Data.secondLastPlayerIndex !== -1 ? final2Data.secondLastPlayerIndex : 1;
  let secondLastPlayerPersistentIndex = playerIndexToPersistentVertexIndex(secondLastPlayerIndex);
  let targetIndexForWall3 = persistentIndices.indexOf(secondLastPlayerPersistentIndex) + 1;
  persistentIndices.splice(targetIndexForWall3, 0, 3);

  if (numPlayersAlive <= 2) {
    // Guarantee these 4 walls
    alivePersistentIndicesSet.add(1);
    alivePersistentIndicesSet.add(3);
    alivePersistentIndicesSet.add(lastPlayerPersistentIndex);
    alivePersistentIndicesSet.add(secondLastPlayerPersistentIndex);
  }

  // Remove indices of dead vertices, building interpolation targets as we go.
  let alivePersistentIndices: number[] = [];
  // Describes the index in the target shape to which each persistentvertex should interpolate to.
  let interpolationTargetIndex = new Array<number>(persistentIndices.length);
  let numAliveIndicesPassed = 0;
  for (let i = 0; i < persistentIndices.length; ++i) {
    let persistentIndex = persistentIndices[i];
    interpolationTargetIndex[i] = numAliveIndicesPassed % targetShape.length;
    if (alivePersistentIndicesSet.has(persistentIndex)) {
      // Effectively "consumes" this vertex on the shape and we start sending vertices to the next one.
      numAliveIndicesPassed += 1;
      alivePersistentIndices.push(persistentIndex);
    }
  }

  interface VertAspect {
    wallVertex: lk.Component<WallVertex>;
    position: lk.Component<Position2>;
  }
  let fetchVerts: () => VertAspect[] = () => {
    return Array.from(state.getAspect(WallVertex, Position2)).map((aspect) => {
      return {
        wallVertex: aspect[0],
        position: aspect[1],
      };
    });
  };

  let existingVertices = fetchVerts();
  let existingPersistentIndices = new Set<number>(existingVertices.map((v) => v.wallVertex.getData().persistentIndex));
  let persistentIndicesToCreate = Array.from(alivePersistentIndicesSet).filter((i) => !existingPersistentIndices.has(i));
  let persistentIndicesToDelete = Array.from(existingPersistentIndices).filter((i) => !alivePersistentIndicesSet.has(i));

  // Remove scheduled deletion of vertices that are alive but scheduled for deletion.
  for (let existingVertex of existingVertices) {
    if(alivePersistentIndicesSet.has(existingVertex.wallVertex.getData().persistentIndex)) {
      let maybeScheduledDeletion = state.getComponentOfEntity(EntityScheduledDeletion, existingVertex.wallVertex.getOwnerId());
      if(maybeScheduledDeletion !== undefined) {
        maybeScheduledDeletion.delete();
      }
    }
  }

  // Create vertices that should exist
  for (let persistentIndex of persistentIndicesToCreate) {
    let vertexToInsert = new WallVertex();
    vertexToInsert.persistentIndex = persistentIndex;
    let vertPos = new Position2();
    state.createEntity([
      vertexToInsert,
      vertPos,
    ]);
  }

  // After insertions, fix the visual indices of all the vertices and fix the positions of the ones we've just created.
  // refetch this collection
  existingVertices = fetchVerts();
  let existingVerticesMap = new Map(
    existingVertices.map(
      (value) => [value.wallVertex.getData().persistentIndex, value] as [number, VertAspect],
    ),
  );

  // In lieu of a "generalised" approach for sequencing / scheduling work, we'll just do the lerp and the deletion on the same timeout.
  // TODO we need to fixup visual indices when these are deleted.
  let lerpStartDelayS = 0.1;
  let lerpDurationS = 1;
  let entityDeletionTime = simulationTimeS + lerpStartDelayS + lerpDurationS;
  for (let persistentIndex of persistentIndicesToDelete) {
    // It MUST be in here based on prior logic
    let vert = existingVerticesMap.get(persistentIndex)!;
    let scheduledDeletion = new EntityScheduledDeletion();
    scheduledDeletion.deletionTimeS = entityDeletionTime;
    state.addComponent(vert.wallVertex.getOwnerId(), scheduledDeletion);
  }

  // Sort them by the order of their appearance in the total ordering.
  let sortedExistingVertices = new Array<VertAspect>();
  for (let persistentIndex of persistentIndices) {
    let maybeObj = existingVerticesMap.get(persistentIndex);
    if (maybeObj !== undefined) {
      sortedExistingVertices.push(maybeObj);
    }
  }

  // Run through them in reverse order because the the origination positions apply from the successive
  // vertex that exists (the prior in reverse order).
  // We need to iterate a bit more than once because we can't start setting positions until we've encountered
  // one that isn't new.
  let lastExistingPos = {x: 0, y: 0};
  let firstPriorlyExistingIndex: number|undefined;
  for (let i = sortedExistingVertices.length - 1; i !== firstPriorlyExistingIndex; i = mod(i - 1, sortedExistingVertices.length)) {
    let vertexData = sortedExistingVertices[i].wallVertex.getData();
    let posData = sortedExistingVertices[i].position.getData();
    vertexData.visualIndex = i;
    let alreadyExisted = existingPersistentIndices.has(vertexData.persistentIndex);
    if (firstPriorlyExistingIndex === undefined) {
      // existingPersistentIndices.size === 0 handles case where we havent created any at all yet
      // and we'd never set the firstPriorlyExistingIndex otherwise.
      if (alreadyExisted || existingPersistentIndices.size === 0) {
        firstPriorlyExistingIndex = i;
      }
    }
    if (alreadyExisted) {
      // This one is not new, the next new one gets its position
      lastExistingPos = {x: posData.x, y: posData.y};
    } else {
      posData.x = lastExistingPos.x;
      posData.y = lastExistingPos.y;
    }
  }

  // Begin Lerps
  for (let i = 0; i < persistentIndices.length; ++i) {
    let persistentIndex = persistentIndices[i];
    let maybeObj = existingVerticesMap.get(persistentIndex);
    if (maybeObj !== undefined) {
      let currentPos = maybeObj.position.getData();
      let lerp = new Lerp2D();
      lerp.originalPosition.copy(currentPos);
      // Note the typecast on the next line is just to get around the quirks of threejs' "this" typings limitations.
      lerp.targetPosition.copy(targetShape[interpolationTargetIndex[i]] as SerializableVector2);
      lerp.startTimeS = simulationTimeS + lerpStartDelayS;
      lerp.durationS = lerpDurationS;
      state.addComponent(maybeObj.position.getOwnerId(), lerp);
    }
  }

  let playerIndexToPaddle = new Map(Array.from(state.getComponents(Paddle)).map((c) => [c.getData().playerIndex, c] as [number, lk.Component<Paddle>]));
  for (let player of players) {
    let playerData = player.getData();
    let maybePaddle = playerIndexToPaddle.get(playerData.playerIndex);
    if (playerData.alive && maybePaddle === undefined) {
      // This player needs a paddle created.
      let newPaddle = new Paddle();
      newPaddle.playerIndex = playerData.playerIndex;
      newPaddle.wallPersistentId = playerIndexToPersistentVertexIndex(playerData.playerIndex);
      // TODO Technically a Paddle's position is entirely slaved to its wallposition stuff and does not need replication
      // Consider revisiting this once we have controlled replication.
      let newPosition = new Position2();
      let newOrientation = new Orientation();
      state.createEntity([newPaddle, newPosition, newOrientation]);
    } else if (!playerData.alive && maybePaddle !== undefined) {
      // This player needs their paddle deleted.
      state.deleteEntity(maybePaddle.getOwnerId());
    }
  }
}

export class LevelGeometrySystem implements lk.System {
  // A stateful system like this must only be run on the server.
  // storing numAlivePlayersPreviouslyHandled is partly an optimisation
  // but also is necessary currently because of the order in which systems run
  // the event that adds playerinfo is processed after system updates and
  // so inspecting the previous frame's state would never show a difference
  // to this one in terms of number of players alive.
  // This poses an interesting problem regarding the relation of systems and events
  // that I don't have a solid answer for at this time.
  private numAlivePlayersPreviouslyHandled = 0;
  public Step({state, simulationTimeS}: lk.StepParams): void {
    // Updates level geometry whenever number of alive players has changed
    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let numPlayersAlive = alivePlayers.length;
    if (numPlayersAlive !== this.numAlivePlayersPreviouslyHandled) {
      this.numAlivePlayersPreviouslyHandled = numPlayersAlive;
      doUpdateLevelGeometry(state, simulationTimeS);
    }
  }
}
