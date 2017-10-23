import * as THREE from 'three';
import * as datGui from 'dat-gui';

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-shared';

import {RendererSizeUpdater} from './renderer-size-updater';

class ThreeRenderer implements lk.RenderingSystem {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  private renderer = new THREE.WebGLRenderer({antialias: true});
  private rendererSizeUpdater = new RendererSizeUpdater(this.camera, this.renderer);

  // Translate these?
  // private rendererSpheres: Map<lk.ComponentId, THREE.Mesh> = new Map();
  // private rendererWalls: Map<lk.ComponentId, THREE.Mesh> = new Map();

  constructor(private sceneElementContainer: HTMLElement) {
    this.camera.translateZ(10);
    let axes = new THREE.AxisHelper(1000);
    this.scene.add(axes);
    var ambientLight = new THREE.AmbientLight(0x202020);
    this.scene.add(ambientLight);
    sceneElementContainer.appendChild(this.renderer.domElement);
  }

  render(wallTimeNowMS: number, engine: lk.ComponentEngine) {
    this.rendererSizeUpdater.update();
    /*
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
    */
    this.renderer.render(this.scene, this.camera);
  }
}

export class GuiRenderer implements lk.RenderingSystem {
  private guiViewModel = {
    currentSimTime: 0
  };
  private guiView = new datGui.GUI();

  constructor(private engine: lk.ClientEngine) {
    this.guiView.add(this.guiViewModel, 'currentSimTime').listen();
  }

  render(wallTimeNowMS: number, engine: lk.ComponentEngine) {
    this.guiViewModel.currentSimTime = this.engine.currentFrameStartWallTimeMS;
  }
}

export class RenderingSystemImpl implements lk.RenderingSystem {
  private threeRenderer: ThreeRenderer;
  private guiRenderer: GuiRenderer;

  constructor(
    private sceneElementContainer: HTMLElement,
    engine: lk.ClientEngine) {
    this.threeRenderer = new ThreeRenderer(sceneElementContainer);
    this.guiRenderer = new GuiRenderer(engine);
  }

  render(wallTimeNowMS: number, engine: lk.ComponentEngine) {
    this.threeRenderer.render(wallTimeNowMS, engine);
    this.guiRenderer.render(wallTimeNowMS, engine);
  }
}

export function initialiseClient(clientEngine: lk.ClientEngine) {
  demo.pongDemo.registerSharedComponents(clientEngine.engine);
}
