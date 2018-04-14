import * as THREE from 'three';

import * as lk from 'laniakea-server';

import { pongDemo } from 'lk-demo-shared';

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

function calculatePlayersOrdering(numPlayers: number): Array<number> {
  // default with 2 players in fixed clockwise order to prevent them experiencing
  // a swapping as the shape grows / contracts from the non-random regime to this one
  let playerAtVertIndex = [0, 1];
  let prng = new DeterministicPRNG(1);
  for(let i = 2; i < numPlayers; ++i) {
    // Insert the players in a scrambled but deterministic order that
    // ensures existing players are not reordered
    let targetIndex = prng.getRandomInt(playerAtVertIndex.length);
    playerAtVertIndex.splice(targetIndex, 0, i);
  }
  return playerAtVertIndex;
}

function calculateShapeForNumPlayers(numPlayers: number) {
  let scaleFactor = 10;
  // Create a classic pong board
  if (numPlayers < 3) {
    let boxMax = new THREE.Vector2(0.9 * scaleFactor, 0.5 * scaleFactor)
    let box = new THREE.Box2(
      boxMax.clone().multiplyScalar(-1),
      boxMax
    );
    return {
      vertices: [
        // Order matters here, we start in the top right so its not far
        // from the top vertex that is usually the start off wall 0 in the polygon
        new THREE.Vector2(box.max.x, box.max.y),
        new THREE.Vector2(box.max.x, box.min.y),
        new THREE.Vector2(box.min.x, box.min.y),
        new THREE.Vector2(box.min.x, box.max.y)
      ],
      vertIndicesOfPlayers: [0, 2]
    }
  }

  // Arrange players around a circle to create a polygon
  let result = {
    vertices: new Array<THREE.Vector2>(numPlayers),
    vertIndicesOfPlayers: new Array<number>(numPlayers)
  };
  let playerAtVertIndex = calculatePlayersOrdering(numPlayers);
  for (let i = 0; i < playerAtVertIndex.length; ++i) {
    let angle = 2 * Math.PI * i / numPlayers;
    let vert = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    vert.multiplyScalar(scaleFactor);
    result.vertices[i] = vert;
    result.vertIndicesOfPlayers[playerAtVertIndex[i]] = i;
  }
  return result;
}


export function initialiseServer(serverEngine: lk.ServerEngine) {
  pongDemo.registerSharedComponents(serverEngine.engine);
  serverEngine.onPlayerConnected.attach(() => {
    let paddles = Array.from(serverEngine.currentFrame.state.getComponents(pongDemo.Paddle));
    let numPlayersPriorToAddition = paddles.length;
    let { vertices, vertIndicesOfPlayers } = calculateShapeForNumPlayers(numPlayersPriorToAddition + 1);

    // Remove any unneeded walls
    let wallIndices = serverEngine.currentFrame.state.getComponents(pongDemo.WallIndex);
    for(let wallIndex of wallIndices) {
      if (wallIndex.getData().index > vertices.length) {
        // TODO Implement removal // serverEngine.engine.removeEntity(wallIndex.getOwnerId());
      }
    }

    // Insert new player + wall, its vertices start at its adjacent walls' verts
    let indexOfNewPlayer = vertIndicesOfPlayers.length - 1;
    let vertIndexOfNewPlayer = vertIndicesOfPlayers[indexOfNewPlayer];


    //let maybePrevPlayer = vertices[];

    let vertOfNewPlayer = vertices[vertIndexOfNewPlayer];


    // Begin Lerp all walls to new positions

  });
}