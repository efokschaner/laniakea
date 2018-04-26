import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  EntityScheduledDeletion,
  Final2Players,
  Orientation,
  Paddle,
  PlayerInfo,
  PolarLerp2D,
  Position2,
  SerializableVector2,
  WallVertex,
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

function calculatePersistentVertexIndices(numPlayers: number): number[] {
  // default with 2 sides in fixed clockwise order
  let persistentIndices = [1, 2];
  let prng = new DeterministicPRNG(1);
  for (let i = 2; i < numPlayers; ++i) {
    // Insert the sides in a scrambled but deterministic order that
    // ensures existing sides are not reordered
    let targetIndex = prng.getRandomInt(persistentIndices.length);
    persistentIndices.splice(targetIndex, 0, i + 1);
  }
  // Now insert holes for playerless walls
  let persistentIndicesWithHoles = new Array<number>();
  for (let i of persistentIndices) {
    persistentIndicesWithHoles.push(i, -i);
}
  return persistentIndicesWithHoles;
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

  let targetShape = calculateShapeForNumPlayers(numPlayersAlive);
  let persistentIndices = calculatePersistentVertexIndices(numPlayersEverAlive);

  // This gives us memory of the final 2 players on the board so that we dont churn the geometry
  // unneccessarily when below 3 players
  let final2Players = getOrCreateFinal2Players(state);
  let final2Data = final2Players.getData();
  if (numPlayersAlive === 2) {
    let playerIndexA = alivePlayers[0].getData().playerIndex;
    let playerIndexB = alivePlayers[1].getData().playerIndex;
    // The goal is to make entries in to this object "sticky". To not reorder them unnecessarily.
    // Start by looking for one of the players already being in the list, if they exist we just set
    // the remaining entry to the other player.
    if (final2Data.finalPlayerIndexA === playerIndexA) {
      final2Data.finalPlayerIndexB = playerIndexB;
    } else if (final2Data.finalPlayerIndexA === playerIndexB) {
      final2Data.finalPlayerIndexB = playerIndexA;
    } else if (final2Data.finalPlayerIndexB === playerIndexA) {
      final2Data.finalPlayerIndexA = playerIndexB;
    } else if (final2Data.finalPlayerIndexB === playerIndexB) {
      final2Data.finalPlayerIndexA = playerIndexA;
    } else {
      // We insert them in the order as they would be in the natural geometry
      let persistentIndexA = playerIndexA;
      let persistentIndexB = playerIndexB;
      let indexInPersistentIdsOfA = persistentIndices.indexOf(persistentIndexA);
      let indexInPersistentIdsOfB = persistentIndices.indexOf(persistentIndexB);
      if (indexInPersistentIdsOfA < indexInPersistentIdsOfB) {
        final2Data.finalPlayerIndexA = playerIndexA;
        final2Data.finalPlayerIndexB = playerIndexB;
      } else {
        final2Data.finalPlayerIndexA = playerIndexB;
        final2Data.finalPlayerIndexB = playerIndexA;
      }
    }
  }

  // This is a multi phase process where we:
  // - add required new vertices
  // - schedule a delete for unneeded vertices.
  // - unschedule delete of any vertices that were marked but are needed again
  // - start lerping the vertices to where they need to go,
  // Added vertices originate from whichever existing persistentIndex comes after them.
  // All vertices lerp towards the target position of their persistentIndex or the target position of the next existing persistentIndex
  // On completion of lerps we delete persistentIndices which are not meant to exist any more and we re-assign visualIndices.

  // Represents all the persistent indices that should exist.
  let alivePersistentIndicesSet = new Set<number>(alivePlayers.map((pi) => pi.getData().playerIndex));

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

  if (numPlayersAlive <= 2) {
    let playerPersistentIndexA = final2Data.finalPlayerIndexA;
    let persistentIndexOfPlayerlessWallA = - playerPersistentIndexA;
    let playerPersistentIndexB = final2Data.finalPlayerIndexB;
    let persistentIndexOfPlayerlessWallB = - playerPersistentIndexB;

    // Now we will try to see if there already exists playerless walls that partition our
    // shape as needed, so that we dont recreate the playerless wall with every change of players.
    // If the shape is not partitioned right, we add the playerless wall that comes after player A or B
    // (with indices -A and -B) as needed.

    // Divide the persistent indices in to 2 partitions, the BtoA partition is implied by the AtoB one
    let positiveIndicesFromAtoB = new Set<number>();

    let indexOfPlayerA = persistentIndices.indexOf(playerPersistentIndexA);
    let indexOfPlayerB = persistentIndices.indexOf(playerPersistentIndexB);
    for (let i = indexOfPlayerA; i !== indexOfPlayerB; i = mod(i + 2, persistentIndices.length)) {
      positiveIndicesFromAtoB.add(persistentIndices[i]);
    }

    let existingPlayerlessVertsFromAtoB = new Set<number>();
    let existingPlayerlessVertsFromBtoA = new Set<number>();

    for (let vert of existingVertices) {
      let persistentIndex = vert.wallVertex.getData().persistentIndex;
      // We only care about playerless verts
      if (persistentIndex < 0) {
        if (positiveIndicesFromAtoB.has(-persistentIndex)) {
          existingPlayerlessVertsFromAtoB.add(persistentIndex);
        } else {
          existingPlayerlessVertsFromBtoA.add(persistentIndex);
        }
      }
    }

    // If theres already a playerless wall in here, recycle it
    if (existingPlayerlessVertsFromAtoB.size > 0) {
      persistentIndexOfPlayerlessWallA = existingPlayerlessVertsFromAtoB.values().next().value;
    }
    if (existingPlayerlessVertsFromBtoA.size > 0) {
      persistentIndexOfPlayerlessWallB = existingPlayerlessVertsFromBtoA.values().next().value;
    }

    // Guarantee these 4 walls
    alivePersistentIndicesSet.add(playerPersistentIndexA);
    alivePersistentIndicesSet.add(persistentIndexOfPlayerlessWallA);
    alivePersistentIndicesSet.add(playerPersistentIndexB);
    alivePersistentIndicesSet.add(persistentIndexOfPlayerlessWallB);

    // Finally.....
    // The vertices in the 2 player shape are hardcoded to have playerlessWallA at index 1, we need to rotate it to match.
    // To do this we need to know the order in which our 4 walls have appeared in the persistent indices.
    let alivePersistentIndices: number[] = [];
    for (let persistentIndex of persistentIndices) {
      if (alivePersistentIndicesSet.has(persistentIndex)) {
        alivePersistentIndices.push(persistentIndex);
      }
    }

    let indexOfPlayerlessWallA = alivePersistentIndices.indexOf(persistentIndexOfPlayerlessWallA);
    let shapeOffset = indexOfPlayerlessWallA - 1;
    targetShape = [
      targetShape[mod(0 - shapeOffset, 4)],
      targetShape[mod(1 - shapeOffset, 4)],
      targetShape[mod(2 - shapeOffset, 4)],
      targetShape[mod(3 - shapeOffset, 4)]];
  }

  let existingPersistentIndices = new Set<number>(existingVertices.map((v) => v.wallVertex.getData().persistentIndex));
  let persistentIndicesToCreate = Array.from(alivePersistentIndicesSet).filter((i) => !existingPersistentIndices.has(i));
  let persistentIndicesToDelete = Array.from(existingPersistentIndices).filter((i) => !alivePersistentIndicesSet.has(i));

  // Remove scheduled deletion of vertices that are alive but scheduled for deletion.
  for (let existingVertex of existingVertices) {
    if (alivePersistentIndicesSet.has(existingVertex.wallVertex.getData().persistentIndex)) {
      let maybeScheduledDeletion = state.getComponentOfEntity(EntityScheduledDeletion, existingVertex.wallVertex.getOwnerId());
      if (maybeScheduledDeletion !== undefined) {
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

  // Build interpolation targets
  // Describes the index in the target shape to which each persistentvertex should interpolate to.
  let interpolationTargetIndex = new Array<number>(persistentIndices.length);
  let numAliveIndicesPassed = 0;
  for (let i = 0; i < persistentIndices.length; ++i) {
    let persistentIndex = persistentIndices[i];
    interpolationTargetIndex[i] = numAliveIndicesPassed % targetShape.length;
    if (alivePersistentIndicesSet.has(persistentIndex)) {
      // Effectively "consumes" this vertex on the shape and we start sending vertices to the next one.
      numAliveIndicesPassed += 1;
    }
  }

  // Begin Lerps
  for (let i = 0; i < persistentIndices.length; ++i) {
    let persistentIndex = persistentIndices[i];
    let maybeObj = existingVerticesMap.get(persistentIndex);
    if (maybeObj !== undefined) {
      let currentPos = maybeObj.position.getData();
      let lerp = new PolarLerp2D();
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
      newPaddle.wallPersistentId = playerData.playerIndex;
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
