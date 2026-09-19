// Web Worker for 3D isometric office rendering via OffscreenCanvas
import * as THREE from 'three';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    const { canvas, width, height, pixelRatio } = payload;
    camera = new THREE.OrthographicCamera(-42 * (width / height), 42 * (width / height), 42, -42, -400, 800);
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    scene = new THREE.Scene();
  }

  if (type === 'RESIZE' && renderer && camera) {
    const { width, height } = payload;
    camera.left = -42 * (width / height);
    camera.right = 42 * (width / height);
    camera.top = 42;
    camera.bottom = -42;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  if (type === 'RENDER' && renderer && scene && camera) {
    renderer.render(scene, camera);
  }
};
