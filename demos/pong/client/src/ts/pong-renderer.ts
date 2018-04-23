import dat from 'dat.gui';
import * as THREE from 'three';

import * as lk from 'laniakea-client';

import {
  BallMovement,
  HumanPlayerId,
  Orientation,
  Paddle,
  paddleLengthAsProportionOfWallLength,
  PlayerInfo,
  Position2,
  WallVertex,
} from 'lk-demo-pong-shared';

import {RendererSizeUpdater} from './renderer-size-updater';

class ThreeRenderer implements lk.RenderingSystem {
  private graphicalWorldRadius = 12;
  private backgroundColor = 0xffffff;
  private foregroundThickness = 0.2;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  private currentCameraLerp?: {
    startOrientation: THREE.Quaternion,
    startTimestampMS: number,
    endOrientation: THREE.Quaternion,
    endTimestampMS: number} = undefined;
  private cameraIsLockedToPlayer = false;

  private renderer = new THREE.WebGLRenderer({antialias: true});
  private rendererSizeUpdater = new RendererSizeUpdater(this.camera, this.renderer);

  private floorGeometry = new THREE.PlaneBufferGeometry(this.graphicalWorldRadius * 2, this.graphicalWorldRadius * 2, 8, 8);
  private floorMaterial = new THREE.MeshLambertMaterial( { color: this.backgroundColor, wireframe: false } );
  private floorMesh = new THREE.Mesh(this.floorGeometry, this.floorMaterial);

  private lineMaterial = new THREE.LineBasicMaterial( { color: 0x080808, linewidth: 0.4 } );
  private rendererWalls = new Map<lk.ComponentId, THREE.Line>();

  private allyColor = 0x3030ff;
  private allyPaddleMaterial = new THREE.MeshLambertMaterial({ color: this.allyColor, emissive: this.allyColor, emissiveIntensity: 0.6 });
  private enemyColor = 0xff2b2b;
  private enemyPaddleMaterial = new THREE.MeshLambertMaterial({ color: this.enemyColor, emissive: this.enemyColor, emissiveIntensity: 0.6 });
  private paddleGeometry = new THREE.BoxBufferGeometry(1, this.foregroundThickness, this.foregroundThickness, 1, 1, 1);
  private rendererPaddles = new Map<lk.ComponentId, THREE.Mesh>();

  private ballGeometry = new THREE.BoxBufferGeometry(this.foregroundThickness, this.foregroundThickness, this.foregroundThickness, 1, 1, 1);
  private ballMaterial = new THREE.MeshLambertMaterial( { color: 0x080808 } );
  private rendererBalls = new Map<lk.EntityId, THREE.Mesh>();

  private dayLight = new THREE.DirectionalLight();

  // ORBITAL CAMERA JUST FOR DEBUG.
  private cameraController?: THREE.OrbitControls;

  // tslint:disable-next-line:no-unused-variable
  constructor(private sceneElementContainer: HTMLElement) {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(this.backgroundColor);
    let ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);
    this.dayLight.position.set(0, 0, 2);
    this.dayLight.castShadow = true;
    this.dayLight.shadow.camera.far = 3;
    this.dayLight.shadow.camera.top = this.graphicalWorldRadius;
    this.dayLight.shadow.camera.right = this.graphicalWorldRadius;
    this.dayLight.shadow.camera.bottom = -this.graphicalWorldRadius;
    this.dayLight.shadow.camera.left = -this.graphicalWorldRadius;
    this.dayLight.shadow.mapSize.x = 2048;
    this.dayLight.shadow.mapSize.y = 2048;
    this.scene.add(this.dayLight);

    // HELPERS FOR VISUAL DEBUGGING
    // this.scene.add(new THREE.CameraHelper(this.dayLight.shadow.camera));
    // this.scene.add(new THREE.BoxHelper(this.floorMesh));
    // CAMERA CONTROLS
    /*
    this.cameraController = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.cameraController.enablePan = true;
    this.cameraController.mouseButtons = {
      ORBIT: THREE.MOUSE.RIGHT,
      ZOOM: THREE.MOUSE.MIDDLE,
      PAN: THREE.MOUSE.LEFT,
    };
    */

    this.floorMesh.translateZ(- 0.75 * this.foregroundThickness);
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    sceneElementContainer.appendChild(this.renderer.domElement);
  }

  private updateCamera(domHighResTimestampMS: number) {
    this.rendererSizeUpdater.update();

    // Set camera distance to ensure scene is contained.
    let verticalFov = this.camera.getEffectiveFOV() * Math.PI / 180;
    let smallerFov = verticalFov;
    if (this.camera.aspect < 1) {
      let horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
      smallerFov = horizontalFov;
    }
    let distanceForCamera = this.graphicalWorldRadius / Math.tan(smallerFov / 2);
    this.camera.position.z = distanceForCamera;

    if (this.cameraController !== undefined) {
      this.cameraController.update();
    }
    if (this.currentCameraLerp !== undefined) {
      let lerpFactor = (domHighResTimestampMS - this.currentCameraLerp.startTimestampMS) /
                       (this.currentCameraLerp.endTimestampMS - this.currentCameraLerp.startTimestampMS);
      let clampedLerpFactor = THREE.Math.clamp(lerpFactor, 0, 1);
      this.camera.quaternion.copy(this.currentCameraLerp.startOrientation).slerp(this.currentCameraLerp.endOrientation, clampedLerpFactor);
      if (clampedLerpFactor >= 1) {
        this.currentCameraLerp = undefined;
      }
    }
  }

  private startCameraLerp(currentDomHighResTimestampMS: number, targetOrientation: THREE.Quaternion, durationMS: number) {
    // If we're already in that orientation do nothing.
    if (this.camera.quaternion.equals(targetOrientation)) {
      return;
    }
    // If we're already lerping to that orientation do nothing.
    if (this.currentCameraLerp !== undefined && this.currentCameraLerp.endOrientation.equals(targetOrientation)) {
      return;
    }
    this.currentCameraLerp = {
      startOrientation: this.camera.quaternion.clone(),
      startTimestampMS: currentDomHighResTimestampMS,
      endOrientation: targetOrientation,
      endTimestampMS: currentDomHighResTimestampMS + durationMS,
    };
  }

  public render(domHighResTimestampMS: number, simulation: lk.ClientSimulation) {
    // TODO, on the client we need to handle "entity deletion" so we release resources
    // For the renderer this is not on the frame its deleted but when none of our frame history contains
    // any live copies of the entity any more.
    // For now we just set the visibility of the component at the moment we're rendering which is still
    // needed but doesnt handle permament cleanup.

    let simTimeS = simulation.getCurrentSimulationTimeS();
    if (simTimeS === undefined) {
      // Nothing to render yet
      return;
    }

    // The -0.025 is a small fudge factor well below perception threshold
    let targetSimTimeS = simTimeS + simulation.getInputTravelTimeS()! - 0.025;
    let nearestFrames = simulation.getSimulationFrames(targetSimTimeS);
    if (nearestFrames === undefined) {
      // Nothing to render yet
      return;
    }

    let midFrameLerpFactor = (targetSimTimeS - nearestFrames.current.simulationTimeS) /
                             (nearestFrames.next.simulationTimeS - nearestFrames.current.simulationTimeS);
    let interpolatedPositions = new Map<lk.ComponentId, Position2>();
    // Loop through the current frame for positions, if there are positions in the next frame that are not in the current
    // we just don't care about them. If there are positions in the current frame that are not in the next, we just accept
    // their current pos as the value.
    for (let currentFramePos of nearestFrames.current.state.getComponents(Position2)) {
      let interpolatedPosition = currentFramePos.getData().clone();
      let maybeNextFramePos = nearestFrames.next.state.getComponent(Position2, currentFramePos.getId());
      if (maybeNextFramePos !== undefined) {
        interpolatedPosition.lerp(maybeNextFramePos.getData(), midFrameLerpFactor);
      }
      interpolatedPositions.set(currentFramePos.getId(), interpolatedPosition);
    }
    // Now do the same for orientations.
    // Note we use lerp not slerp as we expect sub-frame quaternion differences to be small / less in need of a more expensive slerp.
    let interpolatedOrientations = new Map<lk.ComponentId, Orientation>();
    let scratchOrientation = new THREE.Vector4();
    let scratchNextFrameOrientation = new THREE.Vector4();
    for (let currentFrameOrientation of nearestFrames.current.state.getComponents(Orientation)) {
      let currentData = currentFrameOrientation.getData();
      scratchOrientation.set(currentData.x, currentData.y, currentData.z, currentData.w);
      let maybeNextFrameOrientation = nearestFrames.next.state.getComponent(Orientation, currentFrameOrientation.getId());
      if (maybeNextFrameOrientation !== undefined) {
        let nextFrameOrientation = maybeNextFrameOrientation.getData();
        scratchNextFrameOrientation.set(nextFrameOrientation.x, nextFrameOrientation.y, nextFrameOrientation.z, nextFrameOrientation.w);
        scratchOrientation.lerp(scratchNextFrameOrientation, midFrameLerpFactor);
      }
      interpolatedOrientations.set(
        currentFrameOrientation.getId(),
        new Orientation(scratchOrientation.x, scratchOrientation.y, scratchOrientation.z, scratchOrientation.w),
      );
    }

    let state = nearestFrames.current.state;

    let sortedVertexPositions = Array.from(state.getAspect(WallVertex, Position2)).sort((a, b) => {
      return a[0].getData().visualIndex - b[0].getData().visualIndex;
    });

    for (let line of this.rendererWalls.values()) {
      // We set everything to NOT visible, and if the object still exists we'll set it visible when updating properties.
      line.visible = false;
    }

    // Build this map so we can use it to set paddle sizes later.
    let wallPersistentIdToLength = new Map<number, number>();

    for (let i = 0; i < sortedVertexPositions.length; ++i) {
      let [vertex, pos] = sortedVertexPositions[i];
      let vertexPos = interpolatedPositions.get(pos.getId())!;
      let nextVertIndex = (i + 1) % sortedVertexPositions.length;
      let nextVertexPos = interpolatedPositions.get(sortedVertexPositions[nextVertIndex][1].getId())!;
      let maybeLine = this.rendererWalls.get(vertex.getId());
      let wallGeometry = new THREE.Geometry();
      if (maybeLine === undefined) {
        maybeLine = new THREE.Line(undefined, this.lineMaterial);
        this.rendererWalls.set(vertex.getId(), maybeLine);
        this.scene.add(maybeLine);
      }
      let floorZ = this.floorMesh.position.z;
      let wallStart = new THREE.Vector3(vertexPos.x, vertexPos.y, floorZ);
      let wallEnd = new THREE.Vector3(nextVertexPos.x, nextVertexPos.y, floorZ);
      wallGeometry.vertices.push(wallStart);
      wallGeometry.vertices.push(wallEnd);
      maybeLine.geometry = wallGeometry;
      maybeLine.visible = true;
      wallPersistentIdToLength.set(vertex.getData().persistentIndex, wallStart.distanceTo(wallEnd));
    }

    for (let paddle of this.rendererPaddles.values()) {
      // We set everything to NOT visible, and if the object still exists we'll set it visible when updating properties.
      paddle.visible = false;
    }

    let ownPlayerId = simulation.getOwnPlayerId()!;
    let ownPlayerInfo: PlayerInfo|undefined;
    for (let [playerInfo, humanPlayerId] of state.getAspect(PlayerInfo, HumanPlayerId)) {
      if (humanPlayerId.getData().playerId === ownPlayerId) {
        ownPlayerInfo = playerInfo.getData();
      }
    }

    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let numPlayersAlive = alivePlayers.length;
    if (numPlayersAlive < 3) {
      this.cameraIsLockedToPlayer = false;
      this.startCameraLerp(domHighResTimestampMS, new THREE.Quaternion(0, 0, 0, 1), 2000);
    }

    let halfPaddleHeight = this.paddleGeometry.parameters.height / 2;
    for (let [paddle, paddlePos, paddleOrientation] of state.getAspect(Paddle, Position2, Orientation)!) {
      let paddleOrientationData = interpolatedOrientations.get(paddleOrientation.getId())!;
      let maybeObj = this.rendererPaddles.get(paddle.getId());
      if (maybeObj === undefined) {
        maybeObj = new THREE.Mesh(this.paddleGeometry, this.enemyPaddleMaterial);
        maybeObj.castShadow = true;
        this.rendererPaddles.set(paddle.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      let pos = interpolatedPositions.get(paddlePos.getId())!;
      maybeObj.scale.x = wallPersistentIdToLength.get(paddle.getData().wallPersistentId)! * paddleLengthAsProportionOfWallLength;
      maybeObj.position.x = pos.x;
      maybeObj.position.y = pos.y;
      maybeObj.position.z = 0;
      maybeObj.setRotationFromQuaternion(paddleOrientationData);
      // Translate by half the height of the paddle so that the ball hitting the edge of the space does not
      // excessively interserct the paddle.
      maybeObj.translateY(halfPaddleHeight);
      maybeObj.visible = true;
      if (ownPlayerInfo !== undefined) {
        let paddleIsOurs = paddle.getData().playerIndex === ownPlayerInfo.playerIndex;
        if (paddleIsOurs) {
          maybeObj.material = this.allyPaddleMaterial;
          if (numPlayersAlive >= 3) {
            let targetOrientation = paddleOrientationData.clone();
            // rotating by paddle rotation sets the paddle to the top (as paddles y axis poins outwards)
            // rotate by another 180 degrees to put it at the bottom
            targetOrientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
            if (!this.cameraIsLockedToPlayer) {
              this.startCameraLerp(domHighResTimestampMS, targetOrientation, 1000);
            }
            if (this.cameraIsLockedToPlayer || this.camera.quaternion.equals(targetOrientation)) {
              this.cameraIsLockedToPlayer = true;
              this.camera.quaternion.copy(targetOrientation);
            }
          }
        }
      }
    }

    for (let ball of this.rendererBalls.values()) {
      ball.visible = false;
    }
    for (let [ballPosition, _] of state.getAspect(Position2, BallMovement)) {
      let maybeBall = this.rendererBalls.get(ballPosition.getOwnerId());
      if (maybeBall === undefined) {
        maybeBall = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
        maybeBall.castShadow = true;
        this.rendererBalls.set(ballPosition.getOwnerId(), maybeBall);
        this.scene.add(maybeBall);
      }
      let ballPosData = interpolatedPositions.get(ballPosition.getId())!;
      maybeBall.position.x = ballPosData.x;
      maybeBall.position.y = ballPosData.y;
      maybeBall.visible = true;
    }

    this.updateCamera(domHighResTimestampMS);
    this.renderer.render(this.scene, this.camera);
  }
}

export class GuiRenderer implements lk.RenderingSystem {
  private guiViewModel = {
    currentSimTime: 0,
    inputTravelTimeMS: 0,
  };
  private guiView = new dat.GUI({width: 300});

  constructor() {
    this.guiView.add(this.guiViewModel, 'currentSimTime').listen();
    this.guiView.add(this.guiViewModel, 'inputTravelTimeMS').listen();
  }

  public render(domHighResTimestampMS: number, simulation: lk.ClientSimulation) {
    this.guiViewModel.currentSimTime = simulation.getCurrentSimulationTimeS() || 0;
    let inputTravelTimeS = simulation.getInputTravelTimeS() || 0;
    this.guiViewModel.inputTravelTimeMS = inputTravelTimeS * 1000;
  }
}

export class RenderingSystemImpl implements lk.RenderingSystem {
  private threeRenderer: ThreeRenderer;
  private guiRenderer: GuiRenderer;

  // tslint:disable-next-line:no-unused-variable
  constructor(private sceneElementContainer: HTMLElement) {
    this.threeRenderer = new ThreeRenderer(sceneElementContainer);
    this.guiRenderer = new GuiRenderer();
  }

  public render(domHighResTimestampMS: number, simulation: lk.ClientSimulation) {
    // Strategy for this renderer is loosely inspired by "local perception filters".
    // For information on these, see:
    // https://0fps.net/2014/02/26/replication-in-networked-games-spacetime-consistency-part-3/
    // https://link.springer.com/article/10.1007/s00530-012-0271-3#Sec15
    // For the second link, note we use a server authoritative model and do not store first class timeline data.

    // The baseline timepoint at which to render the world is its least extrapolated state at (server time - RTT / 2).
    // The player projects a bubble of extrapolated simulation around themselves. This bubble of extrapolation
    // is a smooth time gradient, with time being (server time + RTT / 2) at the player, and baseline time
    // at its edge. It forms a 4D hypercone (essentially an expanding sphere, or a lightcone).
    // NOTE it may be worth capping the player's extrapolation time at the centre to (some constant plus server time)
    // as huge extrapolation errors may be worse than the resultant input lag. It'salso important to cap the max
    // extrapolation as extrapolating further each frame increases the amount of work to do for the
    // rewind replay simulation.

    // Unresolved question: what should the radius of this hypercone be? Possibly just a constant based on
    // level geometry and the speed of objects. In a sense this cone defines a "speed of light"
    // much in the same way as relativity in as this shape determines "how far we look in to
    // the past per unit of distance". But if we fix its radius, then players with different latency
    // get different "speeds of light". So it may be preferable to fix the speed, and let the radius vary,
    // but this is not immediately clear.

    // To figure out what renders where, we walk this shape back through the simulation history,
    // simulating its expansion backwards through time from its center space-time point.
    // Every step back through the sim, we calculate what entities are contained in this lightcone.
    // Any that we have not already captured, we snapshot them at this timepoint for rendering.
    // Once we get to the limit radius of this cone, at the baseline timepoint, all remaining entities
    // are rendered at that state.
    // NOTE: technically we should probably do some kind of lerp based on an estimate of where between 2 frames
    // the worldline of the object intersected the lightcone.

    // Finally, we may add in some cosmetic blending / interpolating to smooth things as
    // we're not being fully rigorous in our use of a local perception filter, with our given game mechanics.

    // We should consider making different parts of the render strategy toggleable so that we can run the renderer
    // render in different modes for distinguishing between simulation issues vs. perception filter issues
    // vs. smoothing issues etc.

    this.threeRenderer.render(domHighResTimestampMS, simulation);
    this.guiRenderer.render(domHighResTimestampMS, simulation);
  }
}
