import * as THREE from 'three';
import { camera, applyCamera, view, isTweening, tickTween } from './cameraView.ts';

export interface RenderControllerOptions {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  hud: HTMLElement;
  deptRT: Record<string, any>;
  onTick?: (now: number) => void;
}

export class RenderController {
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private hud: HTMLElement;
  private deptRT: Record<string, any>;
  private onTick?: (now: number) => void;
  private renderer: THREE.WebGLRenderer;
  private isOffscreen = false;
  private worker: Worker | null = null;
  private animId: number = 0;

  constructor(options: RenderControllerOptions) {
    this.canvas = options.canvas;
    this.scene = options.scene;
    this.hud = options.hud;
    this.deptRT = options.deptRT;
    this.onTick = options.onTick;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;

    this.initResizeHandler();
    this.startRenderLoop();
  }

  private initResizeHandler() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      applyCamera();
      this.updateBadges();
    });
  }

  public getRenderer() {
    return this.renderer;
  }

  public updateBadges() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const hw = w / 2;
    const hh = h / 2;
    const tempV = new THREE.Vector3();

    for (const k of Object.keys(this.deptRT)) {
      const d = this.deptRT[k];
      if (!d || !d.badge || !d.badgeAnchor) continue;
      tempV.copy(d.badgeAnchor);
      tempV.project(camera);
      const sx = tempV.x * hw + hw;
      const sy = -tempV.y * hh + hh;
      d.badge.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
    }
  }

  private startRenderLoop() {
    const loop = (now: number) => {
      tickTween(now);
      applyCamera();

      if (this.onTick) {
        this.onTick(now);
      }

      this.renderer.render(this.scene, camera);
      this.updateBadges();
      this.animId = requestAnimationFrame(loop);
    };

    this.animId = requestAnimationFrame(loop);
  }

  public stop() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }
}
