import * as THREE from 'three';

// Utility to keep the size + aspect ratio synchronised with the size of the parent element
export class RendererSizeUpdater {
  private needsAspectRatioUpdate = true;
  private resizeListener = () => { this.needsAspectRatioUpdate = true; };

  constructor(
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer) {
    window.addEventListener("resize", this.resizeListener);
  }

  public update() {
    if(this.needsAspectRatioUpdate && this.renderer.domElement.parentElement) {
      let sceneElementContainer = this.renderer.domElement.parentElement;
      this.camera.aspect = sceneElementContainer.clientWidth / sceneElementContainer.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(sceneElementContainer.clientWidth, sceneElementContainer.clientHeight);
      this.needsAspectRatioUpdate = false;
    }
  }

  public shutDown() {
    window.removeEventListener("resize", this.resizeListener);
  }
}
