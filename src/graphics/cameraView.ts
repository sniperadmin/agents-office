import * as THREE from 'three';
import { DEPTS, LAYOUT } from '../data.ts';

export interface CameraViewOptions {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  ground: THREE.Mesh;
  FR: number;
  CAM_DIST: number;
  OVERVIEW: { base: [number, number, number]; zoom: number };
  SR_: THREE.Vector3;
  ISO: THREE.Vector3;
  getTasks: () => any;
  getBrain: () => any;
  getMcp: () => any;
  getDeptRT: () => Record<string, any>;
  clickTargets: THREE.Object3D[];
  personTargets: THREE.Object3D[];
  openAgent: (id: string, tab?: string) => void;
  openAgentRail: (id: string, tab?: string, fly?: boolean) => void;
  buildDeptRail: (k: string) => void;
  flyBillboardIntoRail: (k: string) => void;
  cascadeRows: () => void;
  planMeeting: (now: number) => void;
  requestApproval: (id: string) => void;
  RAIL_SIDE: Record<string, string>;
  getAgents: () => any[];
}

export function createCameraView(options: CameraViewOptions) {
  const {
    canvas, scene, hemi, key, ground, FR, CAM_DIST, OVERVIEW, SR_, ISO,
    getTasks, getBrain, getMcp, getDeptRT, clickTargets, personTargets,
    openAgent, openAgentRail, buildDeptRail, flyBillboardIntoRail, cascadeRows,
    planMeeting, requestApproval, RAIL_SIDE, getAgents
  } = options;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
  const UPV = new THREE.Vector3(0, 1, 0);
  const isoWork = new THREE.Vector3();
  const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

  function overviewPos() {
    const tasks = getTasks();
    const pw = (tasks ? tasks.panelWidth() : 400) + 30;
    const ppw = OVERVIEW.zoom * window.innerHeight / (2 * FR);
    const sh = (pw / 2) / ppw;
    return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh] as [number, number, number];
  }

  const view = { target: new THREE.Vector3(...overviewPos()), zoom: OVERVIEW.zoom, arc: 0 };
  let tween: any = null;
  let focused: string | null = null;
  let focusDimTarget = 0, focusDim = 0;
  let darkOn = false;
  const DARK = { plinth: 0x2c2d2b, walkway: 0x303230, ground: 0x1b1c1a };
  const dimSwapped: Array<{ mesh: any; orig: any }> = [];
  const dimCache = new Map();

  function mix(hex: any, base: any, k: number) {
    const a = new THREE.Color(hex), b = new THREE.Color(base);
    return b.lerp(a, k);
  }

  function applyCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -FR * aspect; camera.right = FR * aspect;
    camera.top = FR; camera.bottom = -FR;
    camera.zoom = view.zoom;
    isoWork.copy(ISO);
    if (view.arc) isoWork.applyAxisAngle(UPV, view.arc);
    camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
    camera.lookAt(view.target);
    camera.updateProjectionMatrix();
  }

  function bezier(t: number) {
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

  function flyTo(targetPos: number[], zoom: number, dur = 800, opts: any = {}) {
    tween = {
      t0: performance.now(), dur,
      fromT: view.target.clone(), toT: new THREE.Vector3(...targetPos),
      fromZ: view.zoom, toZ: zoom,
      arc: opts.arc || 0, onDone: opts.onDone,
    };
  }

  function tickTween(now: number) {
    if (!tween) return;
    const k = Math.min(1, (now - tween.t0) / tween.dur);
    const e = bezier(k);
    view.target.lerpVectors(tween.fromT, tween.toT, e);
    view.zoom = tween.fromZ + (tween.toZ - tween.fromZ) * e;
    view.arc = Math.sin(e * Math.PI) * tween.arc;
    if (k >= 1) {
      const cb = tween.onDone;
      view.arc = 0; tween = null;
      if (cb) cb();
    }
  }

  function dimTwin(m: any) {
    if (!dimCache.has(m.uuid)) {
      const d = m.clone();
      d.userData.baseColor = m.color.clone();
      const l = (m.color.r + m.color.g + m.color.b) / 3;
      d.userData.dimColor = new THREE.Color(l * 0.40 + 0.10, l * 0.40 + 0.10, l * 0.38 + 0.09);
      dimCache.set(m.uuid, d);
    }
    return dimCache.get(m.uuid);
  }

  function applySceneDim(deptKey: string) {
    restoreSceneDim();
    scene.traverse((o: any) => {
      if (!(o.isMesh || o.isLine || o.isSprite) || !o.material || o.material.isShadowMaterial || !o.userData.dept) return;
      if (o.userData.dept === deptKey) return;
      if (deptKey === 'brain' && o.userData.dept === 'brainCore') return;
      dimSwapped.push({ mesh: o, orig: o.material });
      o.material = dimTwin(o.material);
    });
  }

  function restoreSceneDim() {
    for (const s of dimSwapped) s.mesh.material = s.orig;
    dimSwapped.length = 0;
  }

  function tickDim(dt: number) {
    focusDim += (focusDimTarget - focusDim) * (1 - Math.exp(-dt * 5));
    if (focusDimTarget === 0 && focusDim < 0.02 && dimSwapped.length) restoreSceneDim();
    for (const m of dimCache.values())
      m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, focusDim);
  }

  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function worldAt(nx: number, ny: number) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(groundPlane, p);
    return p;
  }

  function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

  function focusTarget(k: string, atPos?: any) {
    const layout = LAYOUT[k] || { pos: [0, 0] };
    const base = atPos ? [atPos.x, 0, atPos.z] : [layout.pos[0], 0, layout.pos[1] + 1];
    const tasks = getTasks();
    const boardW = (tasks ? tasks.panelWidth() : 400) + 30;
    const zoom = atPos ? 3.3 : 2.5;
    const pxPerWorld = zoom * window.innerHeight / (2 * FR);
    const railW = Math.min(400, window.innerWidth * 0.92);
    const shift = ((railW - boardW) / 2 + (boardW ? 0 : 30)) / pxPerWorld;
    const dir = RAIL_SIDE[k] === 'left' ? -shift : shift;
    return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
  }

  let pendingTab = 'chat';
  const rail = document.getElementById('rail');
  const vignette = document.getElementById('vignette');

  function enterFocus(k: string, pendingAgentId?: string) {
    const tasks = getTasks();
    const brain = getBrain();
    if (k === 'brain') {
      focused = 'brain';
      if (tasks && tasks.onFocusChange) tasks.onFocusChange('brain');
      const bp = LAYOUT.brain?.pos || [0, 0];
      flyTo([bp[0], 0, bp[1] + 1.5], 3.1, 700);
      syncOverviewBtn();
      return;
    }
    if (focused === k && !pendingAgentId) return;
    if (focused && focused !== k && rail) {
      rail.classList.remove('open', 'agentOpen');
    }
    focused = k;
    if (tasks && tasks.onFocusChange) tasks.onFocusChange(k);
    focusDimTarget = 1;
    applySceneDim(k);
    if (vignette) vignette.classList.add('on');
    const t = focusTarget(k);
    flyTo(t.pos, t.zoom, 950, {
      arc: RAIL_SIDE[k] === 'left' ? 0.10 : -0.10,
      onDone: () => {
        if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab, true);
        pendingTab = 'chat';
      },
    });
    buildDeptRail(k);
    if (rail) {
      rail.className = RAIL_SIDE[k];
      rail.style.display = 'block';
    }
    const agents = getAgents();
    const first = pendingAgentId || (agents.find(x => x.dept === k && x.lead) || agents.find(x => x.dept === k))?.id;
    if (first) openAgentRail(first, pendingAgentId ? pendingTab : 'chat', false);
    document.getElementById('overviewBtn')?.classList.toggle('right', RAIL_SIDE[k] === 'left');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (rail) rail.classList.add('open');
      flyBillboardIntoRail(k);
      cascadeRows();
    }));
    syncOverviewBtn();
  }

  function exitFocus(flyOut = true) {
    if (!focused) return;
    const k = focused;
    focused = null;
    const tasks = getTasks();
    if (tasks && tasks.onFocusChange) tasks.onFocusChange(null);
    focusDimTarget = 0;
    if (vignette) vignette.classList.remove('on');
    if (rail) rail.classList.remove('open', 'agentOpen');
    setTimeout(() => { if (!focused && rail) rail.style.display = 'none'; }, 650);
    document.getElementById('overviewBtn')?.classList.remove('right');
    const deptRT = getDeptRT();
    if (k !== 'brain' && deptRT[k] && deptRT[k].badge) deptRT[k].badge.style.display = '';
    if (flyOut) flyTo(overviewPos(), OVERVIEW.zoom, 700);
    syncOverviewBtn();
  }

  function zoomToDept(k: string) { enterFocus(k); }

  function zoomOut() {
    if (focused && focused !== 'brain') { exitFocus(true); return; }
    focused = null;
    flyTo(overviewPos(), OVERVIEW.zoom, 550);
    syncOverviewBtn();
  }

  function zoomStep(f: number) {
    flyTo([view.target.x, 0, view.target.z], clamp(view.zoom * f, 0.72, 5.2), 350);
    if (view.zoom * f < 1.6 && focused) {
      if (focused === 'brain') focused = null; else exitFocus(false);
    }
    syncOverviewBtn();
  }

  function syncOverviewBtn() {
    const btn = document.getElementById('overviewBtn');
    if (btn) {
      btn.classList.toggle('show',
        (view.zoom > 1.45 && !(tween && tween.toZ <= OVERVIEW.zoom + 0.05)) || !!focused);
    }
  }

  function reframe() {
    if (!focused || focused === 'brain') return;
    const t = focusTarget(focused);
    if (t) flyTo(t.pos, t.zoom, 600);
  }

  function setCam(on: boolean) {
    document.body.classList.toggle('cam', !!on);
  }

  function setDark(on: boolean) {
    darkOn = !!on;
    document.body.classList.toggle('dark', darkOn);
    restoreSceneDim();
    dimCache.clear();
    scene.traverse((o: any) => {
      if (!o.isMesh || !o.userData.part) return;
      const m = o.material;
      if (!m.userData.base) m.userData.base = m.color.clone();
      if (o.userData.part === 'plinth') m.color.set(darkOn ? DARK.plinth : m.userData.base);
      else if (o.userData.part === 'walkway') m.color.set(darkOn ? DARK.walkway : m.userData.base);
      else if (o.userData.part === 'floor') m.color.copy(darkOn ? mix(o.userData.chip, '#1b1c1a', o.userData.dept === 'brain' ? 0.07 : 0.22) : m.userData.base);
    });
    hemi.color.set(darkOn ? 0x8e95a3 : 0xfdfff8);
    hemi.groundColor.set(darkOn ? 0x14151a : 0xd8d4c8);
    hemi.intensity = darkOn ? 0.75 : 0.85;
    key.color.set(darkOn ? 0xe4e9f2 : 0xfff1dd);
    key.intensity = darkOn ? 1.5 : 2.2;
    (ground.material as THREE.ShadowMaterial).opacity = darkOn ? 0.35 : 0.13;
    if (focused && focused !== 'brain') applySceneDim(focused);
    const brain = getBrain();
    if (brain && brain.setTheme) brain.setTheme(darkOn);
    const mcp = getMcp();
    if (mcp && mcp.setDark) mcp.setDark(darkOn);
  }

  // Interactive controls listeners
  window.addEventListener('wheel', (e) => {
    if ((e.target as HTMLElement)?.closest('#rail, #deptModal, .tb-box, .tp-big, .tp-box, textarea, select, input, #mcpModal')) return;
    e.preventDefault();
    tween = null;
    view.arc = 0;
    const nx = (e.clientX / window.innerWidth) * 2 - 1, ny = -(e.clientY / window.innerHeight) * 2 + 1;
    const before = worldAt(nx, ny);
    view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0032), 0.72, 5.2);
    applyCamera();
    const after = worldAt(nx, ny);
    if (before && after) view.target.add(before.sub(after));
    if (view.zoom < 1.6 && focused) {
      if (focused === 'brain') focused = null; else exitFocus(false);
    }
    syncOverviewBtn();
  }, { passive: false });

  let drag: any = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      tween = null;
      const a = worldAt((drag.x / window.innerWidth) * 2 - 1, -(drag.y / window.innerHeight) * 2 + 1);
      const b = worldAt((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (a && b) view.target.add(a.sub(b));
      drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  window.addEventListener('pointerup', (e) => {
    const wasDrag = drag && drag.moved;
    drag = null;
    if (wasDrag) return;
    if (e.target !== canvas) return;
    const nx = (e.clientX / window.innerWidth) * 2 - 1, ny = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const mcp = getMcp();
    const mHits = ray.intersectObjects((mcp && mcp.sprites) || [], false);
    if (mHits.length) {
      mcp.showTip(mHits[0].object, e.clientX, e.clientY, performance.now());
      return;
    }
    const pHits = ray.intersectObjects(personTargets, false);
    if (pHits.length) {
      openAgent(pHits[0].object.userData.agentId, 'chat');
      return;
    }
    const hits = ray.intersectObjects(clickTargets, false);
    if (hits.length) {
      const dk = hits[0].object.userData.dept;
      const brain = getBrain();
      if (dk === 'brain') { if (brain) brain.open(); return; }
      if (dk !== focused) enterFocus(dk);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    const brain = getBrain();
    const tasks = getTasks();
    if (e.key === 'Escape') {
      if (brain && brain.isOpen && brain.isOpen()) brain.close();
      else if (tasks && tasks.isOpen && tasks.isOpen()) tasks.close();
      else zoomOut();
    }
    else if (e.key === 'g' || e.key === 'G') { if (brain && brain.toggle) brain.toggle(); }
    else if (e.key === 'b' || e.key === 'B') { if (tasks && tasks.toggle) tasks.toggle(); }
    else if (e.key === '+' || e.key === '=') zoomStep(1.5);
    else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
    else if (e.key === '0') zoomOut();
    else if (e.key === 'x' || e.key === 'X') planMeeting(performance.now());
    else if (e.key >= '1' && e.key <= '6') {
      const dept = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'][+e.key - 1];
      if (focused !== dept) enterFocus(dept);
    }
    else if (e.key === 'c' || e.key === 'C') {
      if (focused && focused !== 'brain') {
        const agents = getAgents();
        const a = agents.find(x => x.dept === focused && x.lead) || agents.find(x => x.dept === focused);
        if (a) openAgentRail(a.id, 'chat');
      }
    }
    else if (e.key === 'v' || e.key === 'V') setCam(!document.body.classList.contains('cam'));
    else if (e.key === 'd' || e.key === 'D') setDark(!darkOn);
    else if (e.key === 'w' || e.key === 'W') requestApproval('apay');
  });

  canvas.addEventListener('dblclick', (e) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1, ny = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    if (!ray.intersectObjects(clickTargets, false).length) zoomOut();
  });

  document.getElementById('zIn')?.addEventListener('click', () => zoomStep(1.5));
  document.getElementById('zOut')?.addEventListener('click', () => zoomStep(1 / 1.5));
  document.getElementById('zHome')?.addEventListener('click', zoomOut);
  document.getElementById('overviewBtn')?.addEventListener('click', zoomOut);

  return {
    camera,
    view,
    applyCamera,
    flyTo,
    tickTween,
    worldAt,
    overviewPos,
    focusTarget,
    enterFocus,
    exitFocus,
    zoomToDept,
    zoomOut,
    zoomStep,
    syncOverviewBtn,
    reframe,
    setCam,
    setDark,
    applySceneDim,
    restoreSceneDim,
    tickDim,
    getFocused: () => focused,
    getFocusDim: () => focusDim,
    getDarkOn: () => darkOn
  };
}
