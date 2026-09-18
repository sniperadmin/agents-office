/**
 * Camera controller for 3D Isometric View and Smooth FlyTo Transitions.
 * 
 * Provides isometric camera setup, FR frustum projection, overview positioning,
 * and smooth cubic-bezier lerping for zooming and panning across department pods.
 */

import * as THREE from 'three';

export const FR = 42; // Frustum half-height at zoom 1
export const CAM_DIST = 220;
export const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
export const UPV = new THREE.Vector3(0, 1, 0);
export const SR_ = new THREE.Vector3(1, 0, -1).normalize();

export interface CameraOverview {
  base: [number, number, number];
  zoom: number;
}

export const OVERVIEW: CameraOverview = { base: [-9, 0, -9], zoom: 0.8 };

export interface ViewState {
  target: THREE.Vector3;
  zoom: number;
  arc: number;
}

export function overviewPos(panelWidth = 400): [number, number, number] {
  const pw = panelWidth + 30;
  const ppw = OVERVIEW.zoom * window.innerHeight / (2 * FR);
  const sh = (pw / 2) / ppw;
  return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh];
}

export const viewState: ViewState = {
  target: new THREE.Vector3(...overviewPos()),
  zoom: OVERVIEW.zoom,
  arc: 0,
};

export interface TweenState {
  t0: number;
  dur: number;
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  fromZ: number;
  toZ: number;
  arc: number;
  onDone?: () => void;
}

let activeTween: TweenState | null = null;
const isoWork = new THREE.Vector3();

/**
 * Cubic-bezier easing (0.2, 0.8, 0.2, 1) for smooth camera motion.
 */
export function bezierEase(t: number): number {
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

/**
 * Updates camera projection parameters and lookAt target.
 */
export function applyCamera(camera: THREE.OrthographicCamera, view: ViewState = viewState): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -FR * aspect;
  camera.right = FR * aspect;
  camera.top = FR;
  camera.bottom = -FR;
  camera.zoom = view.zoom;

  isoWork.copy(ISO);
  if (view.arc) {
    isoWork.applyAxisAngle(UPV, view.arc);
  }
  camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
  camera.lookAt(view.target);
  camera.updateProjectionMatrix();
}

/**
 * Triggers a smooth camera transition to a target position and zoom level.
 */
export function flyTo(
  targetPos: [number, number, number] | THREE.Vector3,
  zoom: number,
  dur = 800,
  opts: { arc?: number; onDone?: () => void } = {},
  view: ViewState = viewState
): void {
  const toT = targetPos instanceof THREE.Vector3 ? targetPos.clone() : new THREE.Vector3(...targetPos);
  activeTween = {
    t0: performance.now(),
    dur,
    fromT: view.target.clone(),
    toT,
    fromZ: view.zoom,
    toZ: zoom,
    arc: opts.arc || 0,
    onDone: opts.onDone,
  };
}

/**
 * Ticks active camera tween animation on every render frame.
 */
export function tickCameraTween(now: number, view: ViewState = viewState): void {
  if (!activeTween) return;
  const k = Math.min(1, (now - activeTween.t0) / activeTween.dur);
  const e = bezierEase(k);
  view.target.lerpVectors(activeTween.fromT, activeTween.toT, e);
  view.zoom = activeTween.fromZ + (activeTween.toZ - activeTween.fromZ) * e;
  view.arc = Math.sin(e * Math.PI) * activeTween.arc;

  if (k >= 1) {
    const cb = activeTween.onDone;
    view.arc = 0;
    activeTween = null;
    if (cb) cb();
  }
}
