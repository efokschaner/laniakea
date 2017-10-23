import * as THREE from 'three';

// Utility to keep the size + aspect ratio of the renderer
// synchronised with the size of the parent element
export class RendererSizeUpdater {
  private prevSize = { clientWidth: 0, clientHeight: 0 };

  constructor(
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer) {
  }

  public update() {
    let sceneElementContainer = this.renderer.domElement.parentElement;
    if (!sceneElementContainer) {
      return;
    }
    if (sceneElementContainer.clientWidth !== this.prevSize.clientWidth
        || sceneElementContainer.clientHeight !== this.prevSize.clientHeight) {
      this.prevSize.clientWidth = sceneElementContainer.clientWidth;
      this.prevSize.clientHeight = sceneElementContainer.clientHeight;
      this.camera.aspect = sceneElementContainer.clientWidth / sceneElementContainer.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(sceneElementContainer.clientWidth, sceneElementContainer.clientHeight);
    }
  }
}
