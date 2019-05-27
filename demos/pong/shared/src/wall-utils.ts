import * as THREE from 'three';

// Side calculation will use the formula d=(x−x1)(y2−y1)−(y−y1)(x2−x1)
// Where (x1,y1) and (x2,y2) are points on the wall and (x,y) is the point.
// Here we will pre-calculate (y2−y1) and (x2−x1), i.e vertA - vertB on the wall
export interface WallData {
  wallPoint: THREE.Vector2;
  wallEndPoint: THREE.Vector2;
  wallUnitVec: THREE.Vector2;
  wallLength: number;
}

export function wallPointsToWallData(pointA: THREE.Vector2, pointB: THREE.Vector2): WallData {
  let wallVec = pointB.clone().sub(pointA);
  let wallLength = wallVec.length();
  let wallUnitVec = wallVec.normalize();
  return {
    wallPoint: pointA,
    wallEndPoint: pointB,
    wallUnitVec,
    wallLength,
  };
}

export function crossProduct2DBetweenWallAndPoint(wallData: WallData, point: THREE.Vector2) {
  let wallPointToPoint = point.clone().sub(wallData.wallPoint);
  return (wallPointToPoint.x * wallData.wallUnitVec.y) - (wallPointToPoint.y * wallData.wallUnitVec.x);
}
