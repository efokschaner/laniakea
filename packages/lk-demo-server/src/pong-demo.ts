import * as THREE from 'three';

import * as lk from 'laniakea-server';

import { pongDemo } from 'lk-demo-shared';

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

  let playerAtVertIndex = new Array<number>();
  for(let i = 0; i < numPlayers; ++i) {
    let angle = 2 * Math.PI * i / numPlayers;
    let vert = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    vert.multiplyScalar(scaleFactor);
    result.vertices[numPlayers] = vert;

    // Insert the players in a scrambled but deterministic order that
    // ensures existing players are not reordered
    if (i == 0) {
      playerAtVertIndex[0] = 0;
    } else if (i == 1) {
      playerAtVertIndex[1] = 1;
    } else {
      let targetIndex = Math.floor(i * (Math.cos(2 * i) ^ 2)) % i;
      playerAtVertIndex.splice(targetIndex, 0, i);
    }
  }
  for (let i = 0; i < playerAtVertIndex.length; ++i) {
    result.vertIndicesOfPlayers[playerAtVertIndex[i]] = i;
  }
  return result;
}


export function initialiseServer(serverEngine: lk.ServerEngine) {
  pongDemo.registerSharedComponents(serverEngine.engine);
  serverEngine.onPlayerConnected.attach(() => {
    let paddles = Array.from(serverEngine.engine.getComponents(pongDemo.Paddle));
    let numPlayersPriorToAddition = paddles.length;
    let { vertices, vertIndicesOfPlayers } = calculateShapeForNumPlayers(numPlayersPriorToAddition + 1);

    // Remove any unneeded walls
    let wallIndices = serverEngine.engine.getComponents(pongDemo.WallIndex);
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