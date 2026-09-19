import * as THREE from 'three';

export interface LodEngineOptions {
  camera: THREE.Camera;
  deptRT: Record<string, any>;
  R: Record<string, any>;
  LAYOUT: Record<string, any>;
  tasks: any;
  getFocused: () => string | null;
  getZoom: () => number;
  getFocusDim: () => number;
}

export function createLodEngine(options: LodEngineOptions) {
  const { camera, deptRT, R, LAYOUT, getFocused, getZoom, getFocusDim } = options;
  const v3 = new THREE.Vector3();

  function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
  function smooth(a: number, b: number, x: number) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function toScreen(p: THREE.Vector3): [number, number] {
    v3.copy(p).project(camera);
    return [(v3.x * 0.5 + 0.5) * window.innerWidth, (-v3.y * 0.5 + 0.5) * window.innerHeight];
  }

  // Dirty state tracking to eliminate redundant DOM layout/reflows when camera & agents are stationary
  let lastZoom = -1;
  let lastCamX = -99999, lastCamY = -99999, lastCamZ = -99999;
  let lastFocusDim = -1;
  let lastFocused: string | null = null;
  let forceNextTick = true;

  function markDirty() {
    forceNextTick = true;
  }

  function tickLOD(force = false) {
    const z = getZoom();
    const focused = getFocused();
    const focusDim = getFocusDim();

    const cam = camera.position;
    const isCameraDirty = force || forceNextTick ||
      Math.abs(z - lastZoom) > 0.0001 ||
      Math.abs(cam.x - lastCamX) > 0.01 ||
      Math.abs(cam.y - lastCamY) > 0.01 ||
      Math.abs(cam.z - lastCamZ) > 0.01 ||
      Math.abs(focusDim - lastFocusDim) > 0.001 ||
      focused !== lastFocused;

    // Billboards (department badges)
    const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
    const tasksPanelWidth = (options.tasks && options.tasks.isOpen && options.tasks.isOpen() ? 400 : 40) + 26;
    const rightEdge = window.innerWidth - tasksPanelWidth;

    if (isCameraDirty) {
      for (const [k, d] of Object.entries(deptRT)) {
        if (focused === k && k !== 'brain') continue; // billboard is docked in the rail
        if (!d.badgeAnchor || !d.badge) continue;

        if (!d.cachedBW || force || forceNextTick) {
          d.cachedBW = d.badge.offsetWidth || 180;
          d.cachedBH = d.badge.offsetHeight || 120;
        }
        let [sx, sy] = toScreen(d.badgeAnchor);
        const bh = d.cachedBH * badgeScale;
        const bw = d.cachedBW * badgeScale;
        let xf: string;

        if (k !== 'brain') {
          const L = LAYOUT[k];
          const px = L ? L.pos[0] : 0, pz = L ? L.pos[1] : 0;
          const dist = Math.hypot(px, pz) || 1;
          const ux = px / dist, uz = pz / dist;

          if (ux < -0.3) {
            xf = 'translate(-100%, -50%)';
            sx = clamp(sx, bw + 12, rightEdge);
          } else if (ux > 0.3) {
            xf = 'translate(0%, -50%)';
            sx = clamp(sx, 12, rightEdge - bw - 12);
          } else if (uz < 0) {
            xf = 'translate(-50%, -100%)';
            sx = clamp(sx, bw / 2 + 12, rightEdge - bw / 2);
          } else {
            xf = 'translate(-50%, 0%)';
            sx = clamp(sx, bw / 2 + 12, rightEdge - bw / 2);
          }
          sy = clamp(sy, bh / 2 + 64, window.innerHeight - bh / 2 - 12);
        } else {
          sy = clamp(sy, bh + 64, window.innerHeight - 12);
          sx = clamp(sx, bw / 2 + 8, rightEdge - bw / 2);
          xf = 'translate(-50%,-100%)';
        }

        d.badge.style.transform = `translate(${sx}px,${sy}px) ${xf} scale(${badgeScale})`;
        d.badge.style.opacity = String(1 - 0.75 * focusDim);
        d.badge.style.pointerEvents = 'auto';
      }
    }

    // Name pills
    const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
    for (const r of Object.values(R)) {
      if (!r.pill || !r.person) continue;
      const isMoving = r.state === 'walking' || r.state === 'returning' || r.workMode === 'spin';
      if (isCameraDirty || isMoving) {
        const p = r.person.position;
        const [sx, sy] = toScreen(v3.set(p.x, p.y + 5.9 * (r.a?.lead ? 1.12 : 1), p.z));
        r.pill.style.display = 'block';
        r.pill.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${pillScale})`;
        const dimmed = focused && focused !== 'brain' && r.a?.dept !== focused;
        r.pill.style.opacity = String(dimmed ? 1 - 0.85 * focusDim : 1);
      }
    }

    if (isCameraDirty) {
      lastZoom = z;
      lastCamX = cam.x;
      lastCamY = cam.y;
      lastCamZ = cam.z;
      lastFocusDim = focusDim;
      lastFocused = focused;
      forceNextTick = false;
    }
  }

  return {
    toScreen,
    tickLOD,
    markDirty,
    clamp,
    smooth
  };
}
