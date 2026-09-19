import * as THREE from 'three';

export const FR = 42; // frustum half-height at zoom 1
export const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
export const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
export const CAM_DIST = 220;
export const OVERVIEW = { base: [-9, 0, -9], zoom: 0.8 };
export const SR_ = new THREE.Vector3(1, 0, -1).normalize();

export function overviewPos(tasks?: any) {
  const pw = (tasks ? tasks.panelWidth() : 400) + 30;
  const ppw = OVERVIEW.zoom * window.innerHeight / (2 * FR);
  const sh = (pw / 2) / ppw;
  return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh];
}

export const view = {
  target: new THREE.Vector3(...overviewPos()),
  zoom: OVERVIEW.zoom,
  arc: 0
};

let tween: any = null;
const UPV = new THREE.Vector3(0, 1, 0);
const isoWork = new THREE.Vector3();

export function applyCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -FR * aspect;
  camera.right = FR * aspect;
  camera.top = FR;
  camera.bottom = -FR;
  camera.zoom = view.zoom;
  isoWork.copy(ISO);
  if (view.arc) isoWork.applyAxisAngle(UPV, view.arc);
  camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
  camera.lookAt(view.target);
  camera.updateProjectionMatrix();
}

export function bezier(t: number) {
  const cx = 3 * 0.2, bx = 3 * (0.2 - 0.2) - cx, ax = 1 - cx - bx;
  const cy = 3 * 0.8, by = 3 * (1 - 0.8) - cy, ay = 1 - cy - by;
  let u = t;
  for (let i = 0; i < 5; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  return ((ay * u + by) * u + cy) * u;
}

export function flyTo(targetPos: number[], zoom: number, dur = 800, opts: any = {}) {
  tween = {
    t0: performance.now(),
    dur,
    fromT: view.target.clone(),
    toT: new THREE.Vector3(...targetPos),
    fromZ: view.zoom,
    toZ: zoom,
    arc: opts.arc || 0,
    onDone: opts.onDone
  };
}

export function tickTween(now: number) {
  if (!tween) return;
  const k = Math.min(1, (now - tween.t0) / tween.dur);
  const e = bezier(k);
  view.target.lerpVectors(tween.fromT, tween.toT, e);
  view.zoom = tween.fromZ + (tween.toZ - tween.fromZ) * e;
  view.arc = Math.sin(e * Math.PI) * tween.arc;
  if (k >= 1) {
    const cb = tween.onDone;
    view.arc = 0;
    tween = null;
    if (cb) cb();
  }
}

export function isTweening() {
  return tween !== null;
}
