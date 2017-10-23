import * as THREE from 'three';
require('imports-loader?THREE=three!three/examples/js/controls/OrbitControls.js');

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-shared';

import {RendererSizeUpdater} from './renderer-size-updater';

export class RenderingSystemImpl implements lk.RenderingSystem {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  private renderer = new THREE.WebGLRenderer({antialias: true});
  private rendererSizeUpdater = new RendererSizeUpdater(this.camera, this.renderer);


  private cameraController: THREE.OrbitControls;
  private currentlySelectedObject?: THREE.Object3D;
  private activeCameraLerp?: (currentWallTimeMS: number) => void;
  private rendererSpheres: Map<lk.ComponentId, THREE.Mesh> = new Map();
  private rendererWalls: Map<lk.ComponentId, THREE.Mesh> = new Map();

  private focusObject(object: THREE.Object3D) {
    let originalTargetPos = this.cameraController.target.clone();
    let targetPosToCameraPos = this.cameraController.object.position.clone().sub(originalTargetPos);
    let lerpStartTime = performance.now();
    this.activeCameraLerp = (currentWallTimeMS: number) => {
      let lerpFactor = (currentWallTimeMS - lerpStartTime) / 500;
      if(lerpFactor >= 1) {
        lerpFactor = 1;
        this.activeCameraLerp = undefined;
      }
      let targetPosition = object.getWorldPosition();
      this.cameraController.target = originalTargetPos.clone().lerp(targetPosition, lerpFactor);
      this.cameraController.object.position.copy(this.cameraController.target.clone().add(targetPosToCameraPos));
    };
    this.currentlySelectedObject = object;
  }

  private raycaster = new THREE.Raycaster();
  private getIntersects(camera: THREE.Camera, topLeftScreenCoord: { x: number, y: number}, objects: THREE.Object3D[]) {
    let centeredScreenCoord = { x: (topLeftScreenCoord.x * 2) - 1, y: 1 - (topLeftScreenCoord.y * 2)};
    this.raycaster.setFromCamera(centeredScreenCoord, camera);
    return this.raycaster.intersectObjects(objects);
  }

  constructor(private sceneElementContainer: HTMLElement) {
    this.camera.translateZ(200);
    this.cameraController = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.cameraController.enablePan = true;
    this.cameraController.mouseButtons = {
      ORBIT: THREE.MOUSE.RIGHT,
      PAN: THREE.MOUSE.LEFT,
      ZOOM: THREE.MOUSE.MIDDLE
    }
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.addEventListener('mousedown', (mouseEvent: MouseEvent) => {
      if(mouseEvent.button !== 0) {
        // handle left click only
        return;
      }
      let intersects = this.getIntersects(
        this.camera,
        { x: mouseEvent.offsetX / this.renderer.domElement.clientWidth,
          y: mouseEvent.offsetY / this.renderer.domElement.clientHeight },
        this.scene.children);
      if(intersects.length) {
        this.focusObject(intersects[0].object);
      }
    });

    let axes = new THREE.AxisHelper(1000);
    this.scene.add(axes);
    var pointLight = new THREE.PointLight(0xffffff);
    pointLight.position.set(160, 120, 140);
    pointLight.castShadow = true;
    this.scene.add(pointLight);
    var ambientLight = new THREE.AmbientLight(0x202020);
    this.scene.add(ambientLight);

    sceneElementContainer.appendChild(this.renderer.domElement);
  }

  render(wallTimeNowMS: number, engine: lk.ComponentEngine) {
    this.rendererSizeUpdater.update();
    if(this.activeCameraLerp) { this.activeCameraLerp(wallTimeNowMS); }
    this.cameraController.update();
    for(let ball of engine.getComponents(demo.ballsDemo.BallShape)!) {
      let maybeObj = this.rendererSpheres.get(ball.getId());
      if(maybeObj === undefined) {
        let geometry = new THREE.SphereBufferGeometry(ball.getData().radius, 32, 24);
        let material = new THREE.MeshLambertMaterial( { color: 0x0055ff, wireframe: false } );
        maybeObj = new THREE.Mesh( geometry, material );
        maybeObj.castShadow = true;
        this.rendererSpheres.set(ball.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      maybeObj.position.copy(ball.getData().center);
    }

    for(let wall of engine.getComponents(demo.ballsDemo.WallPlane)!) {
      let maybeObj = this.rendererWalls.get(wall.getId());
      if(maybeObj === undefined) {
        let geometry = new THREE.PlaneBufferGeometry(200, 200, 4, 4);
        let material = new THREE.MeshLambertMaterial( { color: 0xdddddd, wireframe: false } );
        maybeObj = new THREE.Mesh( geometry, material );
        maybeObj.receiveShadow = true;
        this.rendererWalls.set(wall.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      wall.getData().projectPoint(new THREE.Vector3(0,0,0), maybeObj.position);
      maybeObj.lookAt(wall.getData().normal);
    }

    this.renderer.render(this.scene, this.camera);
  }
}