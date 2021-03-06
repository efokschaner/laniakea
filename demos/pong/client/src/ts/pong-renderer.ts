import * as dat from 'dat.gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import * as lk from '@laniakea/client-engine';

import {
  BallMovement,
  HumanPlayerId,
  Orientation,
  Paddle,
  PlayerInfo,
  Position2,
  WallVertex,
} from 'lk-demo-pong-shared';

import { ClientSettings } from './client-settings';
import { RendererSizeUpdater } from './renderer-size-updater';

class ThreeRenderer implements lk.RenderingSystem {
  private graphicalWorldRadius = 12;
  private backgroundColor = 0xffffff;
  private foregroundThickness = 0.2;

  private scene = new THREE.Scene();

  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  private lastCameraUpdateTimestampMS?: number = undefined;
  private cameraMaxRotationSpeedRadiansPerSecond = Math.PI / 2;
  private currentCameraTargetOrientation?: THREE.Quaternion = undefined;

  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private rendererSizeUpdater = new RendererSizeUpdater(
    this.camera,
    this.renderer
  );

  private floorGeometry = new THREE.PlaneBufferGeometry(
    this.graphicalWorldRadius * 2,
    this.graphicalWorldRadius * 2,
    8,
    8
  );
  private floorMaterial = new THREE.MeshLambertMaterial({
    color: this.backgroundColor,
    wireframe: false,
  });
  private floorMesh = new THREE.Mesh(this.floorGeometry, this.floorMaterial);

  private lineMaterial = new THREE.LineBasicMaterial({
    color: 0x080808,
    linewidth: 0.4,
  });
  private rendererWalls = new Map<lk.EntityId, THREE.Line>();

  private allyColor = 0x3030ff;
  private allyPaddleMaterial = new THREE.MeshLambertMaterial({
    color: this.allyColor,
    emissive: this.allyColor,
    emissiveIntensity: 0.6,
  });
  private enemyColor = 0xff2b2b;
  private enemyPaddleMaterial = new THREE.MeshLambertMaterial({
    color: this.enemyColor,
    emissive: this.enemyColor,
    emissiveIntensity: 0.6,
  });
  private paddleGeometry = new THREE.BoxBufferGeometry(
    1,
    this.foregroundThickness,
    this.foregroundThickness,
    1,
    1,
    1
  );
  private rendererPaddles = new Map<lk.EntityId, THREE.Mesh>();

  private ballGeometry = new THREE.BoxBufferGeometry(
    this.foregroundThickness,
    this.foregroundThickness,
    this.foregroundThickness,
    1,
    1,
    1
  );
  private ballMaterial = new THREE.MeshLambertMaterial({ color: 0x080808 });
  private rendererBalls = new Map<lk.EntityId, THREE.Mesh>();

  private dayLight = new THREE.DirectionalLight();

  // ORBITAL CAMERA JUST FOR DEBUG.
  private cameraController?: OrbitControls;

  public constructor(
    private clientSettings: ClientSettings,
    private sceneElementContainer: HTMLElement
  ) {
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
    this.cameraController = new OrbitControls(this.camera, this.renderer.domElement);
    this.cameraController.enablePan = true;
    this.cameraController.mouseButtons = {
      LEFT: THREE.MOUSE.RIGHT,
      MIDDLE: THREE.MOUSE.MIDDLE,
      RIGHT: THREE.MOUSE.LEFT,
    };
    */

    this.floorMesh.translateZ(-0.75 * this.foregroundThickness);
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    this.sceneElementContainer.appendChild(this.renderer.domElement);
  }

  private updateCamera(domHighResTimestampMS: number) {
    let cameraUpdateDeltaS = 0;
    if (this.lastCameraUpdateTimestampMS !== undefined) {
      cameraUpdateDeltaS =
        (domHighResTimestampMS - this.lastCameraUpdateTimestampMS) / 1000;
    }
    this.lastCameraUpdateTimestampMS = domHighResTimestampMS;

    this.rendererSizeUpdater.update();

    // Set camera distance to ensure scene is contained.
    let verticalFov = (this.camera.getEffectiveFOV() * Math.PI) / 180;
    let smallerFov = verticalFov;
    if (this.camera.aspect < 1) {
      let horizontalFov =
        2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
      smallerFov = horizontalFov;
    }
    let distanceForCamera =
      this.graphicalWorldRadius / Math.tan(smallerFov / 2);
    this.camera.position.z = distanceForCamera;

    if (this.cameraController !== undefined) {
      this.cameraController.update();
    } else if (this.currentCameraTargetOrientation !== undefined) {
      this.camera.quaternion.rotateTowards(
        this.currentCameraTargetOrientation,
        this.cameraMaxRotationSpeedRadiansPerSecond * cameraUpdateDeltaS
      );
    }
  }

  public render(
    domHighResTimestampMS: number,
    simulation: lk.ClientSimulation
  ) {
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

    let midFrameLerpFactor =
      (targetSimTimeS - nearestFrames.current.simulationTimeS) /
      (nearestFrames.next.simulationTimeS -
        nearestFrames.current.simulationTimeS);
    if (!this.clientSettings.subFrameInterpolationEnabled.get()) {
      midFrameLerpFactor = 0;
    }
    let interpolatedPositions = new Map<lk.EntityId, Position2>();
    // Loop through the current frame for positions, if there are positions in the next frame that are not in the current
    // we just don't care about them. If there are positions in the current frame that are not in the next, we just accept
    // their current pos as the value.
    for (let currentFramePos of nearestFrames.current.state.getComponents(
      Position2
    )) {
      // TODO Vector2.clone() signature should actually return a "this" type but doesn't.
      let interpolatedPosition = currentFramePos.getData().clone() as Position2;
      let maybeNextFramePos = nearestFrames.next.state.getComponent(
        Position2,
        currentFramePos.getId().ownerId
      );
      if (maybeNextFramePos !== undefined) {
        interpolatedPosition.lerp(
          maybeNextFramePos.getData(),
          midFrameLerpFactor
        );
      }
      interpolatedPositions.set(
        currentFramePos.getId().ownerId,
        interpolatedPosition
      );
    }
    // Now do the same for orientations.
    // Note we use lerp not slerp as we expect sub-frame quaternion differences to be small / less in need of a more expensive slerp.
    let interpolatedOrientations = new Map<lk.EntityId, Orientation>();
    let scratchOrientation = new THREE.Vector4();
    let scratchNextFrameOrientation = new THREE.Vector4();
    for (let currentFrameOrientation of nearestFrames.current.state.getComponents(
      Orientation
    )) {
      let currentData = currentFrameOrientation.getData();
      scratchOrientation.set(
        currentData.x,
        currentData.y,
        currentData.z,
        currentData.w
      );
      let maybeNextFrameOrientation = nearestFrames.next.state.getComponent(
        Orientation,
        currentFrameOrientation.getId().ownerId
      );
      if (maybeNextFrameOrientation !== undefined) {
        let nextFrameOrientation = maybeNextFrameOrientation.getData();
        scratchNextFrameOrientation.set(
          nextFrameOrientation.x,
          nextFrameOrientation.y,
          nextFrameOrientation.z,
          nextFrameOrientation.w
        );
        scratchOrientation.lerp(
          scratchNextFrameOrientation,
          midFrameLerpFactor
        );
      }
      interpolatedOrientations.set(
        currentFrameOrientation.getId().ownerId,
        new Orientation(
          scratchOrientation.x,
          scratchOrientation.y,
          scratchOrientation.z,
          scratchOrientation.w
        )
      );
    }

    let state = nearestFrames.current.state;

    let sortedVertexPositions = Array.from(
      state.getAspect(WallVertex, Position2)
    ).sort((a, b) => a[0].getData().visualIndex - b[0].getData().visualIndex);

    for (let line of this.rendererWalls.values()) {
      // We set everything to NOT visible, and if the object still exists we'll set it visible when updating properties.
      line.visible = false;
    }

    // Build this map so we can use it to set paddle sizes later.
    let wallPersistentIdToLength = new Map<number, number>();

    for (let i = 0; i < sortedVertexPositions.length; ++i) {
      let [vertex, pos] = sortedVertexPositions[i];
      let vertexPos = interpolatedPositions.get(pos.getId().ownerId)!;
      let nextVertIndex = (i + 1) % sortedVertexPositions.length;
      let nextVertexPos = interpolatedPositions.get(
        sortedVertexPositions[nextVertIndex][1].getId().ownerId
      )!;
      let maybeLine = this.rendererWalls.get(vertex.getId().ownerId);
      let wallGeometry = new THREE.BufferGeometry();
      if (maybeLine === undefined) {
        maybeLine = new THREE.Line(undefined, this.lineMaterial);
        this.rendererWalls.set(vertex.getId().ownerId, maybeLine);
        this.scene.add(maybeLine);
      }
      let floorZ = this.floorMesh.position.z;
      let wallStart = new THREE.Vector3(vertexPos.x, vertexPos.y, floorZ);
      let wallEnd = new THREE.Vector3(nextVertexPos.x, nextVertexPos.y, floorZ);
      wallGeometry.setFromPoints([wallStart, wallEnd]);
      maybeLine.geometry = wallGeometry;
      maybeLine.visible = true;
      wallPersistentIdToLength.set(
        vertex.getData().persistentIndex,
        wallStart.distanceTo(wallEnd)
      );
    }

    for (let paddle of this.rendererPaddles.values()) {
      // We set everything to NOT visible, and if the object still exists we'll set it visible when updating properties.
      paddle.visible = false;
    }

    let ownPlayerId = simulation.getOwnPlayerId()!;
    let ownPlayerInfo: PlayerInfo | undefined;
    for (let [playerInfo, humanPlayerId] of state.getAspect(
      PlayerInfo,
      HumanPlayerId
    )) {
      if (humanPlayerId.getData().playerId === ownPlayerId) {
        ownPlayerInfo = playerInfo.getData();
      }
    }

    let halfPaddleHeight = this.paddleGeometry.parameters.height / 2;
    for (let [paddle, paddlePos, paddleOrientation] of state.getAspect(
      Paddle,
      Position2,
      Orientation
    )!) {
      let paddleOrientationData = interpolatedOrientations.get(
        paddleOrientation.getId().ownerId
      )!;
      let maybeObj = this.rendererPaddles.get(paddle.getId().ownerId);
      if (maybeObj === undefined) {
        maybeObj = new THREE.Mesh(
          this.paddleGeometry,
          this.enemyPaddleMaterial
        );
        maybeObj.castShadow = true;
        this.rendererPaddles.set(paddle.getId().ownerId, maybeObj);
        this.scene.add(maybeObj);
      }
      let pos = interpolatedPositions.get(paddlePos.getId().ownerId)!;
      maybeObj.scale.x =
        wallPersistentIdToLength.get(paddle.getData().wallPersistentId)! *
        Paddle.lengthAsProportionOfWallLength;
      maybeObj.scale.x = Math.max(0.001, maybeObj.scale.x); // Don't allow 0 scale
      maybeObj.position.x = pos.x;
      maybeObj.position.y = pos.y;
      maybeObj.position.z = 0;
      maybeObj.setRotationFromQuaternion(paddleOrientationData);
      // Translate by half the height of the paddle so that the ball hitting the edge of the space does not
      // excessively interserct the paddle.
      maybeObj.translateY(halfPaddleHeight);
      maybeObj.visible = true;
      if (ownPlayerInfo !== undefined) {
        let paddleIsOurs =
          paddle.getData().playerIndex === ownPlayerInfo.playerIndex;
        if (paddleIsOurs) {
          maybeObj.material = this.allyPaddleMaterial;
          let targetOrientation = paddleOrientationData.clone();
          // rotating by paddle rotation sets the paddle to the top (as paddles y axis poins outwards)
          // rotate by another 180 degrees to put it at the bottom
          targetOrientation.multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              Math.PI
            )
          );
          this.currentCameraTargetOrientation = targetOrientation;
        }
      }
    }

    // Note we do this before balls because balls want the camera's orientation.
    // The data dependency is not super ideal but not too egregious yet.
    this.updateCamera(domHighResTimestampMS);

    for (let ball of this.rendererBalls.values()) {
      ball.visible = false;
    }
    for (let [ballPosition] of state.getAspect(Position2, BallMovement)) {
      let maybeBall = this.rendererBalls.get(ballPosition.getId().ownerId);
      if (maybeBall === undefined) {
        maybeBall = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
        maybeBall.castShadow = true;
        this.rendererBalls.set(ballPosition.getId().ownerId, maybeBall);
        this.scene.add(maybeBall);
      }
      let ballPosData = interpolatedPositions.get(
        ballPosition.getId().ownerId
      )!;
      maybeBall.position.x = ballPosData.x;
      maybeBall.position.y = ballPosData.y;
      maybeBall.visible = true;
      // Balls do not have an orientation, rotate them into the same orientation as the camera.
      maybeBall.quaternion.copy(this.camera.quaternion);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

export class GuiRenderer implements lk.RenderingSystem {
  private guiViewModel = {
    currentSimTime: 0,
    inputTravelTimeMS: 0,
  };

  private guiView = new dat.GUI({ width: 300 });

  public constructor(clientSettings: ClientSettings) {
    this.guiView.add(this.guiViewModel, 'currentSimTime').listen();
    this.guiView.add(this.guiViewModel, 'inputTravelTimeMS').listen();
    this.guiView
      .add(clientSettings.clientIsBot, 'value')
      .name('clientIsBot')
      .listen();
    this.guiView
      .add(clientSettings.clientSimulationEnabled, 'value')
      .name('clientSimulationEnabled')
      .listen();
    this.guiView
      .add(clientSettings.subFrameInterpolationEnabled, 'value')
      .name('subFrameInterpolationEnabled')
      .listen();
  }

  public render(
    _domHighResTimestampMS: number,
    simulation: lk.ClientSimulation
  ): void {
    this.guiViewModel.currentSimTime =
      simulation.getCurrentSimulationTimeS() || 0;
    let inputTravelTimeS = simulation.getInputTravelTimeS() || 0;
    this.guiViewModel.inputTravelTimeMS = inputTravelTimeS * 1000;
  }
}

export class RenderingSystemImpl implements lk.RenderingSystem {
  private threeRenderer: ThreeRenderer;
  private guiRenderer: GuiRenderer;

  public constructor(
    private sceneElementContainer: HTMLElement,
    clientSettings: ClientSettings
  ) {
    this.threeRenderer = new ThreeRenderer(
      clientSettings,
      this.sceneElementContainer
    );
    this.guiRenderer = new GuiRenderer(clientSettings);
  }

  public render(
    domHighResTimestampMS: number,
    simulation: lk.ClientSimulation
  ): void {
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
