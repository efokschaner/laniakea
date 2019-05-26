import * as dat from 'dat.gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import * as lk from 'laniakea-client';

import { BallShape, WallPlane } from 'lk-demo-balls-shared';

import {RendererSizeUpdater} from './renderer-size-updater';

export class RenderingSystemImpl implements lk.RenderingSystem {

  private guiViewModel = {
    currentSimTimeS: 0,
    inputTravelTimeMS: 0,
  };
  private guiView = new dat.GUI();

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  private renderer = new THREE.WebGLRenderer({antialias: true});
  private rendererSizeUpdater = new RendererSizeUpdater(this.camera, this.renderer);

  private cameraController: OrbitControls;
  private activeCameraLerp?: (currentWallTimeMS: number) => void;
  private rendererSpheres: Map<lk.ComponentId, THREE.Mesh> = new Map();
  private rendererWalls: Map<lk.ComponentId, THREE.Mesh> = new Map();

  private focusObject(object: THREE.Object3D) {
    let originalTargetPos = this.cameraController.target.clone();
    let targetPosToCameraPos = this.cameraController.object.position.clone().sub(originalTargetPos);
    let lerpStartTime = performance.now();
    this.activeCameraLerp = (currentWallTimeMS: number) => {
      let lerpFactor = (currentWallTimeMS - lerpStartTime) / 500;
      if (lerpFactor >= 1) {
        lerpFactor = 1;
        this.activeCameraLerp = undefined;
      }
      let targetPosition = object.getWorldPosition(new THREE.Vector3());
      this.cameraController.target = originalTargetPos.clone().lerp(targetPosition, lerpFactor);
      this.cameraController.object.position.copy(this.cameraController.target.clone().add(targetPosToCameraPos));
    };
  }

  private raycaster = new THREE.Raycaster();
  private getIntersects(camera: THREE.Camera, topLeftScreenCoord: { x: number, y: number}, objects: THREE.Object3D[]) {
    let centeredScreenCoord = { x: (topLeftScreenCoord.x * 2) - 1, y: 1 - (topLeftScreenCoord.y * 2)};
    this.raycaster.setFromCamera(centeredScreenCoord, camera);
    return this.raycaster.intersectObjects(objects);
  }

  constructor(private sceneElementContainer: HTMLElement) {
    this.guiView.add(this.guiViewModel, 'currentSimTimeS').listen();
    this.guiView.add(this.guiViewModel, 'inputTravelTimeMS').listen();
    this.camera.translateZ(200);
    this.cameraController = new OrbitControls(this.camera, this.renderer.domElement);
    this.cameraController.enablePan = true;
    this.cameraController.mouseButtons = {
      ORBIT: THREE.MOUSE.RIGHT,
      ZOOM: THREE.MOUSE.MIDDLE,
      PAN: THREE.MOUSE.LEFT,
    };
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.addEventListener('mousedown', (mouseEvent: MouseEvent) => {
      if (mouseEvent.button !== 0) {
        // handle left click only
        return;
      }
      let intersects = this.getIntersects(
        this.camera,
        { x: mouseEvent.offsetX / this.renderer.domElement.clientWidth,
          y: mouseEvent.offsetY / this.renderer.domElement.clientHeight },
        this.scene.children);
      if (intersects.length) {
        this.focusObject(intersects[0].object);
      }
    });

    let axes = new THREE.AxesHelper(1000);
    this.scene.add(axes);
    let pointLight = new THREE.PointLight(0xffffff);
    pointLight.position.set(160, 120, 140);
    pointLight.castShadow = true;
    pointLight.shadow.camera.near = 0.1;
    pointLight.shadow.camera.far = 1000;
    pointLight.shadow.bias = -0.005;
    this.scene.add(pointLight);
    let ambientLight = new THREE.AmbientLight(0x202020);
    this.scene.add(ambientLight);

    this.sceneElementContainer.appendChild(this.renderer.domElement);
  }

  public render(domHighResTimestampMS: number, clientSimulation: lk.ClientSimulation) {
    this.rendererSizeUpdater.update();
    if (this.activeCameraLerp) { this.activeCameraLerp(domHighResTimestampMS); }
    this.cameraController.update();
    let simTimeS = clientSimulation.getCurrentSimulationTimeS();
    this.guiViewModel.currentSimTimeS = simTimeS || 0;
    let inputTravelTimeS = clientSimulation.getInputTravelTimeS() || 0;
    this.guiViewModel.inputTravelTimeMS = inputTravelTimeS * 1000;
    if (simTimeS === undefined) {
      // Nothing to render yet
      return;
    }
    let nearestFrames = clientSimulation.getSimulationFrames(simTimeS + inputTravelTimeS);
    if (nearestFrames === undefined) {
      // Nothing to render yet
      return;
    }
    let state = nearestFrames.current.state;

    for (let ball of state.getComponents(BallShape)!) {
      let maybeObj = this.rendererSpheres.get(ball.getId());
      if (maybeObj === undefined) {
        let geometry = new THREE.SphereBufferGeometry(ball.getData().radius, 32, 24);
        let material = new THREE.MeshLambertMaterial( { color: 0x0055ff, wireframe: false } );
        maybeObj = new THREE.Mesh( geometry, material );
        maybeObj.castShadow = true;
        this.rendererSpheres.set(ball.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      maybeObj.position.copy(ball.getData().center);
    }

    for (let wall of state.getComponents(WallPlane)!) {
      let maybeObj = this.rendererWalls.get(wall.getId());
      let wallData = wall.getData();
      if (maybeObj === undefined) {
        let geometry = new THREE.PlaneBufferGeometry(1, 1, 16, 16);
        let material = new THREE.MeshLambertMaterial( { color: 0xdddddd, wireframe: false } );
        maybeObj = new THREE.Mesh( geometry, material );
        maybeObj.receiveShadow = true;
        this.rendererWalls.set(wall.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      let widthAndHeight = 2 * wallData.constant;
      maybeObj.scale.setScalar(widthAndHeight);
      wallData.projectPoint(new THREE.Vector3(0, 0, 0), maybeObj.position);
      maybeObj.lookAt(wallData.normal);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
