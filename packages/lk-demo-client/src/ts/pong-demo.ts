import * as datGui from 'dat-gui';
import * as THREE from 'three';

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-shared';

import {RendererSizeUpdater} from './renderer-size-updater';

class ThreeRenderer implements lk.RenderingSystem {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  private renderer = new THREE.WebGLRenderer({antialias: true});
  private rendererSizeUpdater = new RendererSizeUpdater(this.camera, this.renderer);

  private lineMaterial = new THREE.LineBasicMaterial( { color: 0xbbbbbb } );
  private rendererWalls: Map<lk.ComponentId, THREE.Line> = new Map();
  private rendererPaddles: Map<lk.ComponentId, THREE.Mesh> = new Map();


  // tslint:disable-next-line:no-unused-variable
  constructor(private sceneElementContainer: HTMLElement) {
    this.camera.translateZ(20);
    let axes = new THREE.AxisHelper(1000);
    this.scene.add(axes);
    let ambientLight = new THREE.AmbientLight(0x202020);
    this.scene.add(ambientLight);
    sceneElementContainer.appendChild(this.renderer.domElement);
  }

  public render(domHighResTimestampMS: number, simulation: lk.ClientSimulation) {
    this.rendererSizeUpdater.update();

    let simTimeS = simulation.getCurrentSimulationTimeS();
    if (simTimeS === undefined) {
      // Nothing to render yet
      return;
    }
    let nearestFrames = simulation.getSimulationFrames(simTimeS);
    if (nearestFrames === undefined) {
      // Nothing to render yet
      return;
    }

    let state = nearestFrames.current.state;

    /*
    for(let wall of state.getComponents(demo.pongDemo.WallPosition)!) {
      let wallData = wall.getData();
      let maybeObj = this.rendererWalls.get(wall.getId());
      let wallGeometry = new THREE.Geometry();
      if(maybeObj === undefined) {
        maybeObj = new THREE.Line(undefined, this.lineMaterial);
        this.rendererWalls.set(wall.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      wallGeometry.vertices.push(new THREE.Vector3(wallData.endA.x, wallData.endA.y, 0));
      wallGeometry.vertices.push(new THREE.Vector3(wallData.endB.x, wallData.endB.y, 0));
      maybeObj.geometry = wallGeometry;
    }
    */

    let sortedVertices = Array.from(state.getComponents(demo.pongDemo.WallVertex)!).sort((a, b) => {
      return a.getData().visualIndex - b.getData().visualIndex;
    });

    for(let i = 0; i < sortedVertices.length; ++i) {
      let vertex = sortedVertices[i];
      let vertexData = vertex.getData();
      let nextVertIndex = (i + 1) % sortedVertices.length;
      let nextVertexData = sortedVertices[nextVertIndex].getData();
      let maybeObj = this.rendererWalls.get(vertex.getId());
      let wallGeometry = new THREE.Geometry();
      if(maybeObj === undefined) {
        maybeObj = new THREE.Line(undefined, this.lineMaterial);
        this.rendererWalls.set(vertex.getId(), maybeObj);
        this.scene.add(maybeObj);
      }
      wallGeometry.vertices.push(new THREE.Vector3(vertexData.position.x, vertexData.position.y, 0));
      wallGeometry.vertices.push(new THREE.Vector3(nextVertexData.position.x, nextVertexData.position.y, 0));
      maybeObj.geometry = wallGeometry;
    }

    for (let paddle of state.getComponents(demo.pongDemo.Paddle)!) {
      let maybeObj = this.rendererPaddles.get(paddle.getId());
      if (maybeObj === undefined) {
        let geometry = new THREE.SphereBufferGeometry(1, 32, 24);
        let material = new THREE.MeshLambertMaterial( { color: 0x0055ff, wireframe: false } );
        maybeObj = new THREE.Mesh( geometry, material );
        this.rendererPaddles.set(paddle.getId(), maybeObj);
        this.scene.add(maybeObj);
      }

      let wallData = state.getComponent(demo.pongDemo.WallPosition, paddle.getData().wallId)!.getData();
      // TODO account for width of paddle here
      let paddlePositionWallSpace = paddle.getData().positionInWallSpace;
      let paddlePositionWorldSpace = new THREE.Vector2();
      paddlePositionWorldSpace.lerpVectors(wallData.endA, wallData.endB, paddle.getData().positionInWallSpace);
      maybeObj.position.set(paddlePositionWorldSpace.x, paddlePositionWorldSpace.y, 0);

      // TODO if this paddle is ours, set our camera on it.
    }

    this.renderer.render(this.scene, this.camera);
  }
}

export class GuiRenderer implements lk.RenderingSystem {
  private guiViewModel = {
    currentSimTime: 0,
  };
  private guiView = new datGui.GUI();

  constructor() {
    this.guiView.add(this.guiViewModel, 'currentSimTime').listen();
  }

  public render(domHighResTimestampMS: number, simulation: lk.ClientSimulation) {
    this.guiViewModel.currentSimTime = simulation.getCurrentSimulationTimeS() || 0;
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

export function initialiseClient(clientEngine: lk.ClientEngine) {
  demo.pongDemo.registerSharedComponents(clientEngine.engine);
}
