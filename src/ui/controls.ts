import * as THREE from 'three';
import { FR, camera, view, flyTo, applyCamera, overviewPos } from '../graphics/cameraView.ts';

export function setupControls(options: {
  canvas: HTMLCanvasElement;
  clickTargets: THREE.Object3D[];
  personTargets: THREE.Object3D[];
  onSelectDept: (dept: string) => void;
  onSelectAgent: (agentId: string) => void;
  onOverview: () => void;
  tasks?: any;
}) {
  const { canvas, clickTargets, personTargets, onSelectDept, onSelectAgent, onOverview, tasks } = options;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let isDragging = false;
  let prevX = 0, prevY = 0;
  let dragDist = 0;

  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    isDragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
    dragDist = 0;
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;
    dragDist += Math.hypot(dx, dy);

    // Iso pan delta
    const factor = (2 * FR) / (window.innerHeight * view.zoom);
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const up = new THREE.Vector3(-1, 0, -1).normalize();

    view.target.addScaledVector(right, -dx * factor * 0.8);
    view.target.addScaledVector(up, dy * factor * 0.8);
  });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (!isDragging) return;
    isDragging = false;
    if (dragDist > 5) return; // was a drag, not click

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    applyCamera();
    raycaster.setFromCamera(mouse, camera);

    // 1. Check person target click
    const pHits = raycaster.intersectObjects(personTargets, true);
    if (pHits.length > 0) {
      let cur: any = pHits[0].object;
      while (cur && !cur.userData?.agentId) cur = cur.parent;
      if (cur?.userData?.agentId) {
        onSelectAgent(cur.userData.agentId);
        return;
      }
    }

    // 2. Check dept pod target click
    const dHits = raycaster.intersectObjects(clickTargets, true);
    if (dHits.length > 0) {
      let cur: any = dHits[0].object;
      while (cur && !cur.userData?.dept) cur = cur.parent;
      if (cur?.userData?.dept) {
        onSelectDept(cur.userData.dept);
        return;
      }
    }
  });

  // Wheel zoom to cursor
  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = THREE.MathUtils.clamp(view.zoom * zoomFactor, 0.4, 2.5);
    view.zoom = nextZoom;
  }, { passive: false });

  // Escape key to overview
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onOverview();
    }
  });
}
