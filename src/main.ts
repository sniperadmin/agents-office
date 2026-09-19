// Agents Office v2 — Three.js isometric office with zoom-driven LOD
// Far: clean pods + agent counts (Image 1 read). Near: diorama with 3D people + holo screens (Image 2 read).
import * as THREE from 'three';
import { TOKENS, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, WORKLINES, APPROVAL_ASKS, APPROVAL_BY_AGENT, getDeptDimensions } from './data.ts';
import { V1, FILE_GEN, STATS, KPIS, P, rnd, ri, person, money } from './v1data.ts';
import {
  PLINTH_H, mat, rbox, makePlinth, makeFloorTitle, makeDesk, makeChair,
  makePerson, posePerson, poseWork, makePlant, makeServerRack, makeMeetingTable, makeWalkway, makeWarnSprite,
} from './builders.ts';
import { initMcp } from './mcp.ts';
import { loadConnectors } from './connectors.ts';
import { initTasks } from './tasks.ts';
import { initBrain } from './brain.ts';
import { initDeptManagerDomain } from './domains/departments/deptManager.ts';
import { disposeHierarchy } from './graphics/SceneReconciler.ts';
import { sseSync } from './core/SSESync.ts';
import { store } from './core/Store.ts';
import { events } from './core/EventBus.ts';
import { createOfficeWorker } from './graphics/workerClient.ts';
let tasks = null; // V3 task boards — initialised after the rail constants exist
let brain: any = null;

const officeWorker = createOfficeWorker();
officeWorker.onSimTickResult((data) => {
  if (data?.updates) {
    for (const [id, u] of Object.entries(data.updates)) {
      if (R[id]) {
        R[id].workerBob = (u as any).bob;
      }
    }
  }
});

/* ---------- renderer / scene / camera ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();

const FR = 42; // frustum half-height at zoom 1
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
const CAM_DIST = 220;
// V3.2 overview (AJ, 5 Sep late): every dept card sits ON its own pod, over the wiring. With six
// pods the scene is pulled back to 0.86 and shifted down so the EMAILS and DELIVERY cards can
// float above their back rows instead of being shoved out to the screen edges.
// V3.3: the Task Status panel owns the right ~430px at every zoom, so the overview target slides
// along screen-right by half the panel width — the scene sits centred in what is left.
const OVERVIEW = { base: [-9, 0, -9], zoom: 0.8 }; // (-9,-9) shifts the scene straight DOWN the screen, no sideways drift
const SR_ = new THREE.Vector3(1, 0, -1).normalize();
function overviewPos() {
  const pw = (tasks ? tasks.panelWidth() : 400) + 30;
  const ppw = OVERVIEW.zoom * innerHeight / (2 * FR);
  const sh = (pw / 2) / ppw;
  return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh];
}
const view = { target: new THREE.Vector3(...overviewPos()), zoom: OVERVIEW.zoom, arc: 0 };
let tween = null;
const UPV = new THREE.Vector3(0, 1, 0);
const isoWork = new THREE.Vector3();

function applyCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = -FR * aspect; camera.right = FR * aspect;
  camera.top = FR; camera.bottom = -FR;
  camera.zoom = view.zoom;
  isoWork.copy(ISO);
  if (view.arc) isoWork.applyAxisAngle(UPV, view.arc); // cinematic swing-in, settles back to locked iso
  camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
  camera.lookAt(view.target);
  camera.updateProjectionMatrix();
}

// house easing cubic-bezier(0.2, 0.8, 0.2, 1)
function bezier(t) {
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

function flyTo(targetPos, zoom, dur = 800, opts = {}) {
  tween = {
    t0: performance.now(), dur,
    fromT: view.target.clone(), toT: new THREE.Vector3(...targetPos),
    fromZ: view.zoom, toZ: zoom,
    arc: opts.arc || 0, onDone: opts.onDone,
  };
}
function tickTween(now) {
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

/* ---------- lights: one warm key top-left + soft fill ---------- */
const hemi = new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
key.position.set(-60, 90, 20);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -95; key.shadow.camera.right = 95;
key.shadow.camera.top = 95; key.shadow.camera.bottom = -95;
key.shadow.camera.far = 400;
key.shadow.radius = 7; key.shadow.blurSamples = 12;
key.shadow.bias = -0.0004;
scene.add(key);

// shadow catcher — makes the pods float over the cream page
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.13 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -7;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- build the office ---------- */
const hud = document.getElementById('hud');
const clickTargets = [];   // plinth meshes -> dept key
const personTargets = [];  // person meshes -> agent id
const R = {};              // runtime per agent
const deptRT = {};         // runtime per dept
const screenSets = [];
const DEPT_AZ = {};
let darkOn = false;
const DARK = { plinth: 0x2c2d2b, walkway: 0x303230, ground: 0x1b1c1a };
function mix(hex: any, base: any, k: number) { const a = new THREE.Color(hex), b = new THREE.Color(base); return b.lerp(a, k); }
const SWEEP_PERIOD = 16000; // ms per full orbit
const COLS = { emails: 2, sales: 2, marketing: 2, ops: 2, fin: 2, delivery: 2 };

const kv = id => KPIS.find(k => k.id === id).val;
const BB_ROWS = {
  emails: [
    ['EMAILS SENT', () => STATS.emailsSent],
    ['REPLIES DRAFTED', () => STATS.drafts]],
  delivery: [
    ['REPORTS SENT', () => STATS.reports],
    ['ON TRACK', () => STATS.onTrack + ' / ' + STATS.projects]],
  sales: [
    ['CALLS S·A·J', () => STATS.spencer + '·' + STATS.arwin + '·' + STATS.jack],
    ['NEW MANAGERS', () => STATS.managers],
    ['AUTO-ONBOARDED', () => STATS.autoOnb]],
  marketing: [
    ['NEW INSIGHTS', () => STATS.insMkt],
    ['COST PER USER', () => '$' + Math.round(STATS.cpa)]],
  ops: [
    ['PROPOSALS MADE', () => Math.round(kv('proposals'))],
    ['NEW INSIGHTS', () => STATS.insOps]],
  fin: [
    ['INVOICES ISSUED', () => Math.round(kv('invoices'))],
    ['BILLS PAID', () => STATS.billsPaid]],
  brain: [
    ['NOTES INDEXED', () => brain ? brain.state.notes.toLocaleString('en-NZ') : '0']],
};
function getBbRows(k: string) {
  if (BB_ROWS[k]) return BB_ROWS[k];
  return [
    ['ACTIVE AGENTS', () => AGENTS.filter(a => a.dept === k).length],
    ['TASKS DONE', () => (typeof doneCount !== 'undefined' && doneCount[k]) || 0]
  ];
}

function buildDeptBadge(k) {
  if (!deptRT[k] || deptRT[k].badge) return;
  const dept = DEPTS[k];
  const rows = getBbRows(k);
  const n = AGENTS.filter(a => a.dept === k).length;
  const b = document.createElement('div');
  b.className = 'badge';
  b.dataset.dept = k;
  b.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.short}<span class="live"></span></div>
    <div class="b-count">${k === 'brain' ? '<span class="b-num">∞</span><span class="b-lab">KNOWLEDGE</span>' : `<span class="b-num">${n}</span><span class="b-lab">AGENTS</span>`}</div>
    <div class="b-metrics">${rows.map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
    </div>
    <div class="b-appr" style="display:none">⚠ <span class="ap-n">1</span> WAITING APPROVAL</div>`;
  b.addEventListener('click', (e) => {
    if (e.target.closest('.b-appr')) { zoomToApproval(k); e.stopPropagation(); }
    else if (e.target.closest('.b-tasks') && tasks) { tasks.openFor(k); e.stopPropagation(); }
    else zoomToDept(k);
  });
  if (k === 'brain') {
    b.className = 'badge brainTag';
    b.innerHTML = `<div class="b-name"><span class="dot" style="background:${dept.chip}"></span>THE BRAIN<b>${brain ? brain.state.notes.toLocaleString('en-NZ') : 0}</b>NOTES</div>`;
    b.onclick = (e) => { e.stopPropagation(); if (brain) brain.open(); };
    b.title = 'open the Brain (G)';
  }
  hud.appendChild(b);
  deptRT[k].badge = b;
  deptRT[k].vals = rows.map(row => String(row[1]()));
  deptRT[k].apprRow = b.querySelector('.b-appr');
  deptRT[k].apprN = b.querySelector('.ap-n');
  const L = LAYOUT[k];
  if (k === 'brain') {
    deptRT[k].badgeAnchor = new THREE.Vector3(-5.5, 3.2, -5.5);
  } else if (L) {
    const px = L.pos[0], pz = L.pos[1];
    const dist = Math.hypot(px, pz) || 1;
    const ux = px / dist, uz = pz / dist;
    const isFront = uz > 0.1;
    const offset = isFront ? 24 : 15;
    const h = isFront ? 1.2 : 8.6;
    deptRT[k].badgeAnchor = new THREE.Vector3(px + ux * offset, h, pz + uz * offset);
  } else {
    deptRT[k].badgeAnchor = new THREE.Vector3(0, 8.6, 0);
  }
}

function buildDeptPod(key_) {
  if (key_ !== 'brain' && !DEPT_KEYS.includes(key_)) return null;
  if (deptRT[key_]) {
    const dim = getDeptDimensions(key_);
    if (deptRT[key_].L && (deptRT[key_].L.w !== dim.w || deptRT[key_].L.d !== dim.d)) {
      deptRT[key_].L.w = dim.w;
      deptRT[key_].L.d = dim.d;
      const g = deptRT[key_].group;
      if (g) {
        for (let i = g.children.length - 1; i >= 0; i--) g.remove(g.children[i]);
        const plinth = makePlinth(dim.w, dim.d, DEPTS[key_].floor);
        g.add(plinth);
        plinth.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
        plinth.children[0].userData.part = 'plinth'; plinth.children[1].userData.part = 'floor'; plinth.children[1].userData.chip = DEPTS[key_].chip;
      }
    }
    return deptRT[key_];
  }
  const dim = getDeptDimensions(key_);
  const L = LAYOUT[key_];
  if (!L) return null;
  L.w = dim.w; L.d = dim.d;
  const dept = DEPTS[key_];
  const g = new THREE.Group();
  g.position.set(L.pos[0], 0, L.pos[1]);
  const plinth = makePlinth(L.w, L.d, dept.floor);
  g.add(plinth);
  plinth.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
  plinth.children[0].userData.part = 'plinth'; plinth.children[1].userData.part = 'floor'; plinth.children[1].userData.chip = dept.chip;

  scene.add(g);
  deptRT[key_] = { group: g, L };

  if (key_ !== 'brain') {
    const sx = Math.sign(L.pos[0]) || 1, sz = Math.sign(L.pos[1]) || 1;
    const from = [L.pos[0] - sx * (L.w / 2 - 1), L.pos[1] - sz * (L.d / 2 - 1)];
    const to = [sx * 6.5, sz * 6.5];
    const walk = makeWalkway(from, to);
    walk.userData.dept = key_; walk.userData.part = 'walkway';
    scene.add(walk);
    deptRT[key_].walkway = walk;
    deptRT[key_].gate = new THREE.Vector3(from[0], 0, from[1]);
    deptRT[key_].brainGate = new THREE.Vector3(to[0], 0, to[1]);

    const plant = makePlant();
    plant.position.set(L.pos[0] + sx * (L.w / 2 - 1.6), 0.12, L.pos[1] + sz * (L.d / 2 - 1.6));
    plant.traverse(o => { if (o.isMesh) o.userData.dept = key_; });
    scene.add(plant);
    deptRT[key_].plant = plant;

    DEPT_AZ[key_] = Math.atan2(L.pos[1], L.pos[0]);
  }

  buildDeptBadge(key_);

  if (typeof darkOn !== 'undefined' && darkOn) {
    g.traverse(o => {
      if (!o.isMesh || !o.userData.part) return;
      const m = o.material; if (!m.userData.base) m.userData.base = m.color.clone();
      if (o.userData.part === 'plinth') m.color.set(DARK.plinth);
      else if (o.userData.part === 'floor') m.color.copy(mix(o.userData.chip, '#1b1c1a', key_ === 'brain' ? 0.07 : 0.22));
    });
  }

  return deptRT[key_];
}

function buildAgent3D(a) {
  if (R[a.id]) return;
  if (!DEPT_KEYS.includes(a.dept) && a.dept !== 'brain') return;
  const dRT = deptRT[a.dept];
  if (!dRT) return;
  const dept = DEPTS[a.dept];
  const L = dRT.L;
  const dim = getDeptDimensions(a.dept);
  const cols = dim.cols;

  const deptAgents = AGENTS.filter(x => x.dept === a.dept);
  const agentIdx = deptAgents.indexOf(a);
  const colIdx = agentIdx % cols;
  const rowIdx = Math.floor(agentIdx / cols);

  const gx = (colIdx - (cols - 1) / 2) * dim.spacingX;
  const startZ = -(dim.d / 2 - 5.5);
  const gz = startZ + rowIdx * dim.spacingZ;
  const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);

  const ANG = Math.PI / 4;
  const rot = (v: any) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

  const station = new THREE.Group();
  station.position.copy(base);
  station.rotation.y = ANG;
  const { group: desk, screenSet } = makeDesk(dept.chip);
  station.add(desk);
  screenSets.push({ screenSet, dept: a.dept });
  const chair = makeChair();
  chair.position.set(0, 0, 1.75);
  station.add(chair);
  station.traverse(o => { if (o.isMesh) o.userData.dept = a.dept; });
  scene.add(station);

  const person = makePerson({ hair: a.hair || '#1f1f1f', skin: a.skin || '#F0C9A0', chip: dept.chip, lead: a.lead });
  person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
  person.rotation.y = ANG + Math.PI;
  person.traverse(o => { if (o.isMesh) { o.userData.agentId = a.id; o.userData.dept = a.dept; personTargets.push(o); } });
  scene.add(person);

  const warn = makeWarnSprite();
  warn.visible = false;
  scene.add(warn);

  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.innerHTML = (a.lead ? '<span class="star">★</span>' : '') + a.name;
  pill.addEventListener('click', () => openAgent(a.id, 'chat'));
  hud.appendChild(pill);

  R[a.id] = {
    a, station, person, warn, pill, seat: person.position.clone(), seatRot: ANG + Math.PI,
    stand: person.position.clone().add(rot(new THREE.Vector3(1.5, 0, 0.15))),
    state: 'working', bob: Math.random() * 10, path: null, pathI: 0, speed: 9.5, ask: null,
    v1: V1.find(x => x.id === a.id) || { id: a.id, name: a.name, greeting: `Hello, I am ${a.name}.` },
    feed: [],
  };
}

function realignAllDepts() {
  for (const k of DEPT_KEYS) {
    const L = LAYOUT[k];
    if (!L) continue;
    const dim = getDeptDimensions(k);
    L.w = dim.w; L.d = dim.d;
    const pos = L.pos;
    const dRT = deptRT[k];
    if (dRT) {
      if (dRT.group) {
        dRT.group.position.set(pos[0], 0, pos[1]);
        if (!dRT.L || dRT.L.w !== dim.w || dRT.L.d !== dim.d) {
          for (let i = dRT.group.children.length - 1; i >= 0; i--) dRT.group.remove(dRT.group.children[i]);
          const plinth = makePlinth(dim.w, dim.d, DEPTS[k].floor);
          dRT.group.add(plinth);
          plinth.traverse(o => { if (o.isMesh) { o.userData.dept = k; clickTargets.push(o); } });
          plinth.children[0].userData.part = 'plinth'; plinth.children[1].userData.part = 'floor'; plinth.children[1].userData.chip = DEPTS[k].chip;
        }
      }
      dRT.L = L;

      if (k !== 'brain') {
        if (dRT.walkway) scene.remove(dRT.walkway);
        if (dRT.plant) scene.remove(dRT.plant);

        const sx = Math.sign(pos[0]) || 1, sz = Math.sign(pos[1]) || 1;
        const from = [pos[0] - sx * (L.w / 2 - 1), pos[1] - sz * (L.d / 2 - 1)];
        const to = [sx * 6.5, sz * 6.5];
        const walk = makeWalkway(from, to);
        walk.userData.dept = k; walk.userData.part = 'walkway';
        scene.add(walk);
        dRT.walkway = walk;

        const plant = makePlant();
        plant.position.set(pos[0] + sx * (L.w / 2 - 1.6), 0.12, pos[1] + sz * (L.d / 2 - 1.6));
        plant.traverse(o => { if (o.isMesh) o.userData.dept = k; });
        scene.add(plant);
        dRT.plant = plant;

        dRT.gate = new THREE.Vector3(from[0], 0, from[1]);
        dRT.brainGate = new THREE.Vector3(to[0], 0, to[1]);
        DEPT_AZ[k] = Math.atan2(pos[1], pos[0]);

        const dist = Math.hypot(pos[0], pos[1]) || 1;
        const ux = pos[0] / dist, uz = pos[1] / dist;
        const isFront = uz > 0.1;
        const offset = isFront ? (L.d / 2 + 12) : (L.d / 2 + 5);
        const h = isFront ? 1.2 : 8.6;
        if (dRT.badgeAnchor) dRT.badgeAnchor.set(pos[0] + ux * offset, h, pos[1] + uz * offset);
      }

      const cols = dim.cols;
      const deptAgents = AGENTS.filter(x => x.dept === k);
      for (const a of deptAgents) {
        if (R[a.id]) {
          const agentIdx = deptAgents.indexOf(a);
          const colIdx = agentIdx % cols;
          const rowIdx = Math.floor(agentIdx / cols);
          const gx = (colIdx - (cols - 1) / 2) * dim.spacingX;
          const startZ = -(dim.d / 2 - 5.5);
          const gz = startZ + rowIdx * dim.spacingZ;
          const base = new THREE.Vector3(pos[0] + gx, 0.12, pos[1] + gz);
          const ANG = Math.PI / 4;
          const rot = (v: any) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

          const r = R[a.id];
          if (r.station) {
            r.station.position.copy(base);
          }
          r.seat.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
          r.stand.copy(base).add(rot(new THREE.Vector3(1.5, 0, 0.15)));
          if (r.state === 'working') {
            r.person.position.copy(r.seat);
          }
        }
      }
    }
  }
}

function removeAgent3D(id) {
  const r = R[id];
  if (!r) return;
  if (r.person) {
    scene.remove(r.person);
    disposeHierarchy(r.person);
  }
  if (r.station) {
    scene.remove(r.station);
    disposeHierarchy(r.station);
  }
  if (r.warn) {
    scene.remove(r.warn);
    disposeHierarchy(r.warn);
  }
  if (r.pill && r.pill.parentNode) {
    r.pill.parentNode.removeChild(r.pill);
  }
  for (let i = personTargets.length - 1; i >= 0; i--) {
    if ((personTargets[i].userData as any)?.agentId === id) {
      personTargets.splice(i, 1);
    }
  }
  delete R[id];
}

function removeDeptPod(key_) {
  // First remove all seated agents of this department
  const agentIds = Object.keys(R).filter(id => R[id]?.a?.dept === key_);
  for (const id of agentIds) {
    removeAgent3D(id);
  }

  const dRT = deptRT[key_];
  if (dRT) {
    if (dRT.group) {
      scene.remove(dRT.group);
      disposeHierarchy(dRT.group);
    }
    if (dRT.walkway) {
      scene.remove(dRT.walkway);
      disposeHierarchy(dRT.walkway);
    }
    if (dRT.plant) {
      scene.remove(dRT.plant);
      disposeHierarchy(dRT.plant);
    }
    if (dRT.badge && dRT.badge.parentNode) {
      dRT.badge.parentNode.removeChild(dRT.badge);
    }
    delete deptRT[key_];
    delete DEPT_AZ[key_];
  }

  document.querySelectorAll(`.badge[data-dept="${key_}"]`).forEach(el => el.remove());

  for (let i = clickTargets.length - 1; i >= 0; i--) {
    if ((clickTargets[i].userData as any)?.dept === key_) {
      clickTargets.splice(i, 1);
    }
  }

  for (let i = screenSets.length - 1; i >= 0; i--) {
    if (screenSets[i].dept === key_) {
      screenSets.splice(i, 1);
    }
  }

  realignAllDepts();
}

function refresh3D() {
  const activeKeys = new Set(DEPT_KEYS);
  // 1. Unmount pods for disbanded departments
  for (const k of Object.keys(deptRT)) {
    if (k !== 'brain' && !activeKeys.has(k)) {
      removeDeptPod(k);
    }
  }

  // 2. Unmount any agents no longer in active roster or whose dept is disbanded
  const activeAgentIds = new Set(AGENTS.filter(a => activeKeys.has(a.dept)).map(a => a.id));
  for (const id of Object.keys(R)) {
    const r = R[id];
    if (!activeAgentIds.has(id) || !activeKeys.has(r.a?.dept)) {
      removeAgent3D(id);
    }
  }

  realignAllDepts();

  // 3. Build missing pods
  for (const k of DEPT_KEYS) {
    if (!deptRT[k]) {
      buildDeptPod(k);
    } else if (deptRT[k].badge) {
      const cntEl = deptRT[k].badge.querySelector('.b-num');
      if (cntEl && k !== 'brain') {
        cntEl.textContent = String(AGENTS.filter(a => a.dept === k).length);
      }
    }
  }

  // 4. Build missing agents ONLY for active departments
  for (const a of AGENTS) {
    if (activeKeys.has(a.dept) && !R[a.id]) {
      buildAgent3D(a);
    }
  }
  realignAllDepts();
}

if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
  try {
    const cached = localStorage.getItem('ao_active_depts');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        DEPT_KEYS.length = 0;
        DEPT_KEYS.push(...parsed);
      }
    } else {
      DEPT_KEYS.length = 0;
      DEPT_KEYS.push('exec');
    }
  } catch {}
}

// Initial 3D pods & agents build (only active departments)
for (const key_ of [...DEPT_KEYS, 'brain']) buildDeptPod(key_);
for (const a of AGENTS) {
  if (DEPT_KEYS.includes(a.dept)) buildAgent3D(a);
}

// brain centre
{
  const bg = deptRT.brain.group;
  brain = initBrain({ scene, brainGroup: bg, getR: () => R, esc: (t) => esc(t), hud, toScreen: (p) => toScreen(p), getCamera: () => camera });
  const plant = makePlant(); plant.position.set(6.2, 0.12, -5.8); bg.add(plant);
}

function tickSweep(now) {
  const on = (!focused || focused === 'brain') ? 1 : 1 - focusDim;
  const theta = (now % SWEEP_PERIOD) / SWEEP_PERIOD * Math.PI * 2;
  let domDept = null, domS = 0;
  for (const [k, az] of Object.entries(DEPT_AZ)) {
    const d = Math.atan2(Math.sin(theta - az), Math.cos(theta - az));
    let s = Math.max(0, 1 - Math.abs(d) / 0.7);
    s = s * s * (3 - 2 * s) * on;
    if (s > domS) { domS = s; domDept = k; }
    const b = deptRT[k] ? deptRT[k].badge : null;
    if (!b) continue;
    if (s > 0.55 && !b.classList.contains('sweepglow')) {
      b.style.setProperty('--sw', DEPTS[k].chip);
      b.classList.add('sweepglow');
    } else if (s <= 0.35 && b.classList.contains('sweepglow')) b.classList.remove('sweepglow');
  }
  return { theta, strength: domS, col: domDept ? DEPTS[domDept].chip : '#FFFFFF' };
}

// tag remaining brain furnishings
deptRT.brain.group.traverse(o => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'brain'; });

/* CONNECTORS — per-dept dock of MCP logos with back-and-forth traffic (AJ's spec, 2 Aug rev 2)
   V3.1: served, the list is the user's REAL MCP servers (GET /api/mcp) — the strip waits for it.
   Opened as a file the demo list plays at once. `mcp` is a thin proxy so the rest of the office
   never cares which it got. */
let mcpImpl: any = null, mcpDark = false;
let mcpUsage: any = null;
export async function refreshMcp() {
  try {
    const c = await loadConnectors();
    mcpImpl = initMcp({ scene, hud, LAYOUT, DEPTS, DEPT_KEYS, FR, R, connectors: c });
    if (mcpDark && mcpImpl) mcpImpl.setDark(true);
    if (mcpUsage && mcpImpl) mcpImpl.setUsage(mcpUsage);
    mcp.sprites = (mcpImpl && mcpImpl.sprites) || [];
  } catch (err) {
    console.warn('refreshMcp failed:', err);
  }
}
const mcp = {
  sprites: [],
  tick: (...a: any[]) => mcpImpl && mcpImpl.tick(...a),
  onAgentEvent: (...a: any[]) => mcpImpl && mcpImpl.onAgentEvent(...a),
  onToolsUsed: (...a: any[]) => mcpImpl && mcpImpl.onToolsUsed(...a),
  showTip: (...a: any[]) => mcpImpl && mcpImpl.showTip(...a),
  startReveal: (...a: any[]) => mcpImpl && mcpImpl.startReveal(...a),
  setDark: (on: boolean) => { mcpDark = on; if (mcpImpl) mcpImpl.setDark(on); },
  setUsage: (u: any) => { mcpUsage = u; if (mcpImpl) mcpImpl.setUsage(u); }, // V3.6: the plan's gauge; kept until the strip exists
  isLive: () => !!(mcpImpl && mcpImpl.live),
  refresh: refreshMcp,
};
refreshMcp();

/* ---------- focus dim: unfocused depts genuinely darken/desaturate in-scene ---------- */
let focusDimTarget = 0, focusDim = 0;
const dimSwapped = [];
const dimCache = new Map();
function dimTwin(m) {
  if (!dimCache.has(m.uuid)) {
    const d = m.clone();
    d.userData.baseColor = m.color.clone();
    const l = (m.color.r + m.color.g + m.color.b) / 3;
    d.userData.dimColor = new THREE.Color(l * 0.40 + 0.10, l * 0.40 + 0.10, l * 0.38 + 0.09);
    dimCache.set(m.uuid, d);
  }
  return dimCache.get(m.uuid);
}
function applySceneDim(deptKey) {
  restoreSceneDim();
  scene.traverse(o => {
    if (!(o.isMesh || o.isLine || o.isSprite) || !o.material || o.material.isShadowMaterial || !o.userData.dept) return;
    if (o.userData.dept === deptKey) return;
    if (deptKey === 'brain' && o.userData.dept === 'brainCore') return; // brain focus keeps its nebula lit
    dimSwapped.push({ mesh: o, orig: o.material });
    o.material = dimTwin(o.material);
  });
}
function restoreSceneDim() {
  for (const s of dimSwapped) s.mesh.material = s.orig;
  dimSwapped.length = 0;
}
function tickDim(dt) {
  focusDim += (focusDimTarget - focusDim) * (1 - Math.exp(-dt * 5));
  if (focusDimTarget === 0 && focusDim < 0.02 && dimSwapped.length) restoreSceneDim();
  for (const m of dimCache.values())
    m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, focusDim);
}

/* ---------- department billboards — v1's exact agreed metric rows + amber approval row ---------- */

function updateBillboards() {
  for (const k of DEPT_KEYS) {
    const rows = getBbRows(k);
    if (!deptRT[k] || !deptRT[k].vals) continue;
    rows.forEach((row, i) => {
      const nv = String(row[1]());
      if (nv !== deptRT[k].vals[i]) {
        deptRT[k].vals[i] = nv;
        const el = deptRT[k].badge ? deptRT[k].badge.querySelector(`[data-m="${k}-${i}"]`) : null;
        if (!el) return;
        el.textContent = nv;
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        const rel = document.querySelector(`[data-rm="${k}-${i}"]`);
        if (rel) {
          rel.textContent = nv;
          rel.classList.remove('flash'); void rel.offsetWidth; rel.classList.add('flash');
        }
      }
    });
  }
}

/* ---------- meeting bubble ---------- */
const bubble = makeBubbleSprite();
bubble.position.set(2, 5.4, 2); // meetings happen beneath the floating brain
bubble.visible = false;
scene.add(bubble);
function makeBubbleSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.font = '96px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('💬', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(4, 4, 1);
  return s;
}

/* ---------- controls: wheel zoom-to-cursor, drag pan, click to fly ---------- */
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function worldAt(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(groundPlane, p);
  return p;
}
let focused = null; // dept key when zoomed into a dept

addEventListener('wheel', (e) => {
  if (e.target && e.target.closest && e.target.closest('#rail, #deptModal, .tb-box, .tp-big, .tp-box, textarea, select, input')) return;
  e.preventDefault();
  tween = null;
  view.arc = 0;
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
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

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) {
    tween = null;
    const a = worldAt((drag.x / innerWidth) * 2 - 1, -(drag.y / innerHeight) * 2 + 1);
    const b = worldAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (a && b) view.target.add(a.sub(b));
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
addEventListener('pointerup', (e) => {
  const wasDrag = drag && drag.moved;
  drag = null;
  if (wasDrag) return;
  if (e.target !== canvas) return; // HTML chrome handles its own clicks
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const mHits = ray.intersectObjects(mcp.sprites, false);
  if (mHits.length) { // MCP logo tile → pulse + connection tooltip
    mcp.showTip(mHits[0].object, e.clientX, e.clientY, performance.now());
    return;
  }
  const pHits = ray.intersectObjects(personTargets, false);
  if (pHits.length) {
    // clicking an agent opens its rail — a stuck agent opens straight to Chat (v1 rule)
    openAgent(pHits[0].object.userData.agentId, 'chat');
    return;
  }
  const hits = ray.intersectObjects(clickTargets, false);
  if (hits.length) {
    const dk = hits[0].object.userData.dept;
    if (dk === 'brain') { brain.open(); return; } // V3.6: the Brain opens as the graph
    if (dk !== focused) enterFocus(dk);
  }
});
addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // typing in the bar, the big editor or a menu never fires a hotkey
  if (e.key === 'Escape') { if (brain.isOpen()) brain.close(); else if (tasks && tasks.isOpen()) tasks.close(); else zoomOut(); }
  else if (e.key === 'g' || e.key === 'G') brain.toggle(); // V3.6: the full-screen Brain graph
  else if (e.key === 'b' || e.key === 'B') { if (tasks) tasks.toggle(); } // V3: the company-wide board
  else if (e.key === '+' || e.key === '=') zoomStep(1.5);
  else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
  else if (e.key === '0') zoomOut();
  else if (e.key === 'x' || e.key === 'X') { if (!meeting) planMeeting(performance.now()); }
  else if (e.key >= '1' && e.key <= '6') { // jump straight to a department
    const dept = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'][+e.key - 1];
    if (focused !== dept) enterFocus(dept);
  }
  else if (e.key === 'c' || e.key === 'C') { // in a department: open its (lead) agent's chat
    if (focused && focused !== 'brain') {
      const a = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
      if (a) openAgentRail(a.id, 'chat');
    }
  }
  else if (e.key === 'v' || e.key === 'V') setCam(!document.body.classList.contains('cam'));
  else if (e.key === 'd' || e.key === 'D') setDark(!darkOn);
  else if (e.key === 'w' || e.key === 'W') requestApproval('apay'); // demo cue: Accounts Payable asks for approval
});

// camera mode: mid-tone backdrop for filming the screen (#cam=1 / V toggles)
function setCam(on) { document.body.classList.toggle('cam', !!on); }
// DARK MODE (AJ, 6 Sep 2026: "make another one in dark mode as I will show both"): D toggles, #dark=1
// forces it, /dark on the server opens in it. The chrome follows the CSS tokens; the scene
// re-tints its shared materials (plinths, floors, walkways), relights, and the Brain/wires swap ink.
function setDark(on) {
  darkOn = !!on;
  document.body.classList.toggle('dark', darkOn);
  restoreSceneDim(); dimCache.clear(); // the dim twins cache base colours — rebuild them for the new palette
  scene.traverse(o => {
    if (!o.isMesh || !o.userData.part) return;
    const m = o.material; if (!m.userData.base) m.userData.base = m.color.clone();
    if (o.userData.part === 'plinth') m.color.set(darkOn ? DARK.plinth : m.userData.base);
    else if (o.userData.part === 'walkway') m.color.set(darkOn ? DARK.walkway : m.userData.base);
    else if (o.userData.part === 'floor') m.color.copy(darkOn ? mix(o.userData.chip, '#1b1c1a', o.userData.dept === 'brain' ? 0.07 : 0.22) : m.userData.base); // the Brain's pale sage needs a lighter touch
  });
  hemi.color.set(darkOn ? 0x8e95a3 : 0xfdfff8); hemi.groundColor.set(darkOn ? 0x14151a : 0xd8d4c8); hemi.intensity = darkOn ? 0.75 : 0.85;
  key.color.set(darkOn ? 0xe4e9f2 : 0xfff1dd); key.intensity = darkOn ? 1.5 : 2.2;
  ground.material.opacity = darkOn ? 0.35 : 0.13;
  if (focused && focused !== 'brain') applySceneDim(focused);
  if (brain) brain.setTheme(darkOn);
  mcp.setDark(darkOn);
}

// double-click empty space → straight back to overview
canvas.addEventListener('dblclick', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  if (!ray.intersectObjects(clickTargets, false).length) zoomOut();
});

// on-screen zoom controls
function zoomStep(f) {
  flyTo([view.target.x, 0, view.target.z], clamp(view.zoom * f, 0.72, 5.2), 350);
  if (view.zoom * f < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}
document.getElementById('zIn').addEventListener('click', () => zoomStep(1.5));
document.getElementById('zOut').addEventListener('click', () => zoomStep(1 / 1.5));
document.getElementById('zHome').addEventListener('click', zoomOut);

function zoomToDept(k) { enterFocus(k); }
function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null;
  flyTo(overviewPos(), OVERVIEW.zoom, 550);
  syncOverviewBtn();
}
document.getElementById('overviewBtn').addEventListener('click', zoomOut);
function syncOverviewBtn() {
  document.getElementById('overviewBtn').classList.toggle('show',
    (view.zoom > 1.45 && !(tween && tween.toZ <= OVERVIEW.zoom + 0.05)) || !!focused);
}

/* ---------- focus rail: dept billboard + activity rows; agent CHAT & ACTIVITY slide-over ---------- */
const chatHist = {};
const rail = document.getElementById('rail');
const vignette = document.getElementById('vignette');
const mMsgs = document.getElementById('mMsgs');
let modalOpen = null, modalTab = 'chat'; // modalOpen = agent id open in the rail slide-over
// V3.3: the rail docks LEFT for every department — the task panel has the right side
const RAIL_SIDE = { marketing: 'left', emails: 'left', sales: 'left', ops: 'left', fin: 'left', delivery: 'left' };
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

function ensureChat(id) {
  if (chatHist[id]) return;
  const r = R[id];
  const v = r?.v1 || { greeting: `Hello, I am ${id}.` };
  chatHist[id] = [
    { who: 'agent', text: v.greeting || 'Hello.' },
    { who: 'work', i: '⏺', text: 'session attached — live work stream below' },
  ];
  if (FILE_GEN[id] && !(tasks && tasks.isLive())) chatHist[id].push({ who: 'file', ...FILE_GEN[id]() }); // demo-only sample file; a live office shows real deliverables
}
function chatPush(id, msg) {
  ensureChat(id);
  chatHist[id].push(msg);
  if (chatHist[id].length > 80) chatHist[id].splice(2, 1);
  if (modalOpen === id && modalTab === 'chat') renderChat(id);
}
function renderChat(id) {
  const r = R[id];
  if (!chatHist[id]) return;
  mMsgs.innerHTML = chatHist[id].map((m, i) => {
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}</div>`;
    if (m.who === 'user') return `<div class="m-user">${esc(m.text)}</div>`;
    if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
    if (m.who === 'file') return `
      <div class="m-file" data-i="${i}">
        <div class="f-head"><span>${m.icon}</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.meta)}</div></div></div>
        <pre>${esc(m.content)}</pre>
      </div>`;
    if (m.who === 'appr') return `
      <div class="m-appr" data-i="${i}">
        <div class="a-who">needs your approval</div>
        <div class="a-ask">${esc(m.text)}</div>
        ${m.mock ? `<div class="a-mock">${m.mock}</div>` : ''}
        ${m.pending
          ? '<div class="a-btns"><button class="a-yes">APPROVE</button><button class="a-no">REJECT</button></div>'
          : `<div class="a-done">${m.approved ? '✓ Approved' : '✗ Rejected'} by AJ</div>`}
      </div>`;
    return '';
  }).join('');
  mMsgs.querySelectorAll('.m-file').forEach(el =>
    el.addEventListener('click', () => el.classList.toggle('exp')));
  mMsgs.querySelectorAll('.m-appr .a-yes').forEach(el =>
    el.addEventListener('click', () => resolveApproval(id, true)));
  mMsgs.querySelectorAll('.m-appr .a-no').forEach(el =>
    el.addEventListener('click', () => resolveApproval(id, false)));
  mMsgs.scrollTop = mMsgs.scrollHeight;
}
function renderActivity(id) {
  const r = R[id];
  if (!r) return;
  const v = r.v1 || {};
  const task = rnd(v.tasks || ['Working through the queue'])
    .replace('{co}', rnd(P.co)).replace('{person}', person()).replace('{count}', ri(3, 9));
  document.getElementById('mNow').innerHTML = `NOW &nbsp;<b>${esc(task)}</b>`;
  document.getElementById('mStats').innerHTML = (v.stats || []).map(([l, val]) => `
    <div class="st"><div class="st-l">${esc(l)}</div><div class="st-v">${esc(String(typeof val === 'function' ? val() : val))}</div></div>`).join('');
  const chip = DEPTS[r.a?.dept]?.chip || '#8FD3F4';
  const mx = Math.max(...(v.chart || [1]));
  document.querySelector('#mChart .ch-lbl').textContent = v.chartLbl || '';
  document.querySelector('#mChart .ch-bars').innerHTML = (v.chart || []).map(n =>
    `<i style="height:${Math.round(n / mx * 100)}%;background:${chip}"></i>`).join('');
  document.getElementById('mFeed').innerHTML = (r.feed || []).map(f => `
    <div class="fe"><span class="fi">${f.i}</span><span>${esc(f.text)}</span><span class="ft">${ago(f.ts)}</span></div>`).join('');
}
/* camera target offset so the pod sits beside the rail, not behind it */
function focusTarget(k, atPos) {
  const base = atPos ? [atPos.x, 0, atPos.z] : [LAYOUT[k].pos[0], 0, LAYOUT[k].pos[1] + 1];
  const boardW = (tasks ? tasks.panelWidth() : 400) + 30; // V3.3: the task panel is always on the right
  const zoom = atPos ? 3.3 : 2.5;
  const pxPerWorld = zoom * innerHeight / (2 * FR);
  const railW = Math.min(400, innerWidth * 0.92);
  // pod sits in the middle of whatever screen is left: rail on one side, board (if open) on the other
  const shift = ((railW - boardW) / 2 + (boardW ? 0 : 30)) / pxPerWorld;
  const dir = RAIL_SIDE[k] === 'left' ? -shift : shift;
  return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
}
function enterFocus(k, pendingAgentId) {
  if (k === 'brain') { // the Brain keeps its plain fly-in (AJ's call)
    focused = 'brain';
    if (tasks) tasks.onFocusChange('brain');
    flyTo([LAYOUT.brain.pos[0], 0, LAYOUT.brain.pos[1] + 1.5], 3.1, 700);
    syncOverviewBtn();
    return;
  }
  if (focused === k && !pendingAgentId) return;
  if (focused && focused !== k) { rail.classList.remove('open', 'agentOpen'); modalOpen = null; }
  focused = k;
  if (tasks) tasks.onFocusChange(k);
  focusDimTarget = 1;
  applySceneDim(k);
  vignette.classList.add('on');
  const t = focusTarget(k);
  flyTo(t.pos, t.zoom, 950, {
    arc: RAIL_SIDE[k] === 'left' ? 0.10 : -0.10,
    onDone: () => { if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab, true); pendingTab = 'chat'; },
  });
  buildDeptRail(k);
  rail.className = RAIL_SIDE[k];
  rail.style.display = 'block';
  // V3.4: the rail IS the chat — it opens on the department lead (or first agent) at once
  // (after the className reset above, which would otherwise drop the agentOpen state)
  const first = pendingAgentId || (AGENTS.find(x => x.dept === k && x.lead) || AGENTS.find(x => x.dept === k)).id;
  openAgentRail(first, pendingAgentId ? pendingTab : 'chat', false);
  document.getElementById('overviewBtn').classList.toggle('right', RAIL_SIDE[k] === 'left');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    rail.classList.add('open');
    flyBillboardIntoRail(k);
    cascadeRows();
  }));
  syncOverviewBtn();
}
function exitFocus(flyOut = true) {
  if (!focused) return;
  const k = focused;
  focused = null;
  modalOpen = null;
  if (tasks) tasks.onFocusChange(null);
  focusDimTarget = 0;
  vignette.classList.remove('on');
  rail.classList.remove('open', 'agentOpen');
  setTimeout(() => { if (!focused) rail.style.display = 'none'; }, 650);
  document.getElementById('overviewBtn').classList.remove('right');
  if (k !== 'brain' && deptRT[k] && deptRT[k].badge) deptRT[k].badge.style.display = '';
  if (flyOut) flyTo(overviewPos(), OVERVIEW.zoom, 700);
  syncOverviewBtn();
}
function buildDeptRail(k) {
  const dept = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const rh = document.getElementById('railHeader');
  rh.classList.remove('show');
  rh.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.name}<span class="live"></span></div>
    <div class="b-count"><span class="b-num">${n}</span><span class="b-lab">AGENTS</span></div>
    <div class="b-metrics">${getBbRows(k).map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-rm="${k}-${i}">${row[1]()}</span></div>`).join('')}</div>
    ${tasks ? tasks.rowHTML(k) : ''}
    <div class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}">⚠ <span class="ap-n">${stuckIn(k).length}</span> WAITING APPROVAL</div>`;
  const trow = rh.querySelector('.b-tasks');
  if (trow) trow.addEventListener('click', () => tasks.toggle());
  rh.querySelector('.b-appr').addEventListener('click', () => {
    const s = stuckIn(k)[0];
    if (s) openAgentRail(s.a.id);
  });
  // V3.7 (AJ, 6 Sep): the agent-chip strip is gone — click an agent in the scene to talk to them
}
function cascadeRows() {
  document.querySelectorAll('#railRows .arow').forEach((el, i) => {
    el.style.transitionDelay = (280 + i * 85) + 'ms';
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.style.transitionDelay = '0ms'; }, 1600);
  });
}
/* the floating billboard physically FLIES and docks as the rail header (the hero beat) */
function flyBillboardIntoRail(k) {
  const badge = deptRT[k] ? deptRT[k].badge : null;
  if (!badge) return;
  const from = badge.getBoundingClientRect();
  badge.style.display = 'none';
  const side = RAIL_SIDE[k];
  const railW = rail.offsetWidth;
  const tLeft = side === 'left' ? 18 : innerWidth - railW + 18;
  const clone = badge.cloneNode(true);
  clone.style.cssText = `position:fixed;box-sizing:border-box;left:${from.left}px;top:${from.top}px;` +
    `width:${from.width}px;margin:0;transform:none;transition:all .72s var(--ease);z-index:40;pointer-events:none;opacity:1;`;
  document.body.appendChild(clone);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.left = tLeft + 'px';
    clone.style.top = (52 + 18) + 'px';
    clone.style.width = (railW - 36) + 'px';
  }));
  setTimeout(() => {
    clone.remove();
    document.getElementById('railHeader').classList.add('show');
  }, 740);
}
function openAgentRail(id, tab = 'chat', fly = true) {
  const r = R[id];
  if (!r) return;
  ensureChat(id);
  modalOpen = id;
  const dept = DEPTS[r.a?.dept] || { chip: '#888', name: r.a?.dept || 'Team' };
  const dot = document.querySelector('#railAgent .mh-dot');
  if (dot) dot.style.background = dept.chip;
  const nameEl = document.querySelector('#railAgent .mh-name');
  if (nameEl) {
    nameEl.innerHTML = (r.a?.lead ? '<span class="star">★ </span>' : '') + (r.a?.name || id);
  }
  const roleEl = document.querySelector('#railAgent .mh-role');
  if (roleEl) roleEl.textContent = `${r.v1?.role || r.a?.role || 'Agent'} · ${dept.name}`;
  const tagEl = document.querySelector('#railAgent .mh-tag');
  if (tagEl) tagEl.textContent = r.v1?.tagline || r.a?.bio || '';
  const chipsEl = document.getElementById('mChips');
  if (chipsEl) {
    chipsEl.innerHTML = (r.v1?.chips || []).map(c =>
      `<button>${esc(c)}</button>`).join('');
    chipsEl.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => sendChat(b.textContent)));
  }
  rail.classList.add('agentOpen');
  setTab(tab);
  if (tasks && tasks.railFor) tasks.railFor(id); // V3.5: the agent's routines strip
  if (fly && r.seat && focusTarget) {
    const t = focusTarget(r.a?.dept, r.seat);
    if (t) flyTo(t.pos, t.zoom, 500);
  }
}
// V3: the board opening/closing re-centres the pod without leaving focus
function reframe() {
  if (!focused || focused === 'brain' || modalOpen) return;
  const t = focusTarget(focused);
  if (t) flyTo(t.pos, t.zoom, 600);
}
function railBack() { // V3.4: "back" = back to the pod view, chat stays on the lead
  if (!focused || focused === 'brain') return;
  const lead = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
  if (!lead || !R[lead.id]) return;
  openAgentRail(lead.id, 'chat', false);
  const t = focusTarget(focused);
  if (t) flyTo(t.pos, t.zoom, 500);
}
document.getElementById('railBack').addEventListener('click', railBack);
let pendingTab = 'chat';
// compat entry point (person clicks, pills, CC export): route through focus mode
function openAgent(id, tab = 'chat') {
  const r = R[id];
  if (!r) return;
  const dept = r.a?.dept;
  if (focused === dept) { openAgentRail(id, tab); return; }
  pendingTab = tab;
  enterFocus(dept, id);
}
function setTab(tab) {
  modalTab = tab;
  document.querySelectorAll('#rail .mtabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('mChat').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('mAct').style.display = tab === 'activity' ? 'flex' : 'none';
  if (tab === 'chat') renderChat(modalOpen); else renderActivity(modalOpen);
}
document.querySelectorAll('#rail .mtabs button').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
function sendChat(text) {
  const id = modalOpen;
  if (!id || !text.trim()) return;
  const r = R[id];
  chatPush(id, { who: 'user', text });
  document.getElementById('mIn').value = '';
  const low = text.toLowerCase();
  setTimeout(() => {
    if (tasks && tasks.pendingReject(id)) { tasks.rejectLive(id, text); return; } // V3.5: the line after REJECT is the note the agent reworks with
    if (r.state === 'stuck' && /\b(approve|reject)\b/.test(low)) {
      resolveApproval(id, /approve/.test(low));
      return;
    }
    const rv = tasks && tasks.isLive() && text.match(/^\s*revise\s*[:\-–]\s*(.+)$/i); // LIVE: "revise: …" re-runs the last deliverable
    if (rv && tasks.revise(id, rv[1].trim())) { chatPush(id, { who: 'agent', text: 'On it — revising now. It will land here when it is ready.' }); return; }
    const tr = tasks && tasks.handleChat(id, text); // "add task: …" / "what's on the board"
    if (tr) { chatPush(id, { who: 'agent', text: tr }); return; }
    if (tasks && tasks.isLive()) { // LIVE: a real conversation with the agent, grounded in the brain
      chatPush(id, { who: 'work', i: '…', text: `${r.a.name} is thinking` });
      fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: id, text, history: chatHist[id].filter(m => m.who === 'user' || m.who === 'agent').slice(-8) }) })
        .then(async res => { if (!res.ok) throw new Error((await res.json()).error || res.statusText); return res.json(); })
        .then(j => {
          const h = chatHist[id]; const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} is thinking`); if (k >= 0) h.splice(k, 1);
          chatPush(id, { who: 'agent', text: j.reply });
          if (j.routines && tasks.refresh) tasks.refresh(); // a routine was set, paused, run or deleted in chat
          if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
          if (j.tools && j.tools.length) mcp.onToolsUsed(id, j.tools);
        })
        .catch(e => chatPush(id, { who: 'agent', text: `I couldn't reach the AI engine (${e.message}).` }));
      return;
    }
    const hit = ((r.v1 && r.v1.chat) || []).find(c => c.k.some(k => low.includes(k)));
    const reply = hit ? rnd(hit.r) : rnd((r.v1 && r.v1.fallback) || ['On it.']);
    chatPush(id, { who: 'agent', text: reply });
  }, 450 + Math.random() * 500);
}
document.getElementById('mSend').addEventListener('click', () =>
  sendChat(document.getElementById('mIn').value));
document.getElementById('mIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat(e.target.value);
  e.stopPropagation();
});
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
}

/* ---------- approval mockups — show AJ exactly what he's approving ---------- */
function mockupFor(id) {
  const chip = DEPTS[R[id].a.dept].chip;
  switch (id) {
    case 'apay': return `<div class="mk mk-doc">
      <div class="d-brand">INVOICE AUDIT — #218</div>
      <div class="d-title">Design contractor</div>
      <div class="d-line"><span>Invoiced</span><b>14 hrs × $110 = $1,540</b></div>
      <div class="d-line"><span>Contract rate</span><b>$85/hr (signed 12 Mar)</b></div>
      <div class="d-line"><span>Variance</span><b>+$350 ⚠</b></div>
      <div class="d-line"><span>Scope</span><b>matches the brief ✓</b></div>
      <div class="d-p">Hours and scope check out — only the rate is off, and there's no signed variation covering it. Recommend holding payment and querying the rate before it's paid.</div></div>`;
    case 'piper': return `<div class="mk mk-doc">
      <div class="d-brand">AGENTS OFFICE — PROPOSAL</div>
      <div class="d-title">Ridgeline Property Group</div>
      <div class="d-line"><span>Seats</span><b>12</b></div>
      <div class="d-line"><span>Plan</span><b>Growth</b></div>
      <div class="d-line"><span>Price</span><b>$1,080/mo · 12-mo lock</b></div>
      <div class="d-p">Proof point: Auckland roofing co — 0 → 40 tracked calls/week in 14 days. Sign-online link included.</div></div>`;
    case 'bill': return `<div class="mk mk-doc">
      <div class="d-brand">REFUND VERIFICATION</div>
      <div class="d-title">Harbour City Roofing — $680</div>
      <div class="d-line"><span>Reason</span><b>double payment, two cards</b></div>
      <div class="d-line"><span>Txn #1 / #2</span><b>verified ✓ / duplicate ✓</b></div>
      <div class="d-line"><span>Account</span><b>14 months, good standing</b></div>
      <div class="d-p">Legit case. Above my $500 limit — releases the moment you approve.</div></div>`;
    case 'iggy': return `<div class="mk-phone">
      <div class="ph-handle"></div>
      <div class="ph-hook">“calls before 10am are a trap”</div>
      <div class="ph-sub">connect rates nearly double 10:00–11:30am — across 40,000 dials</div>
      <div class="ph-ui"><span>♥ 2.4k</span><span>💬 118</span><span>↗ share</span></div></div>`;
    case 'ada': return `<div class="mk mk-ad">
      <div class="ad-head"><div class="ad-av"></div><div><div class="ad-who">sahni.ai</div><div class="ad-sp">Sponsored</div></div></div>
      <div class="ad-text">Cold call anxiety? Your first 5 dials decide your whole day…</div>
      <div class="ad-media" style="background:linear-gradient(135deg, ${chip}55, ${chip}22)">“the 10am rule — call when they answer”</div>
      <div class="ad-foot"><span class="ad-hl">Start your free trial</span><span class="ad-cta">SIGN UP</span></div>
      <div class="ad-stat">CPA $29 · best performer · scaling to $180/day</div></div>`;
    case 'newt': return `<div class="mk mk-mail">
      <div class="ml-lab">SUBJECT A</div><div class="ml-sub">calls before 10am are a trap</div>
      <div class="ml-lab">SUBJECT B</div><div class="ml-sub">we looked at 40,000 calls — call at this time</div>
      <div class="ml-body">  before 10am ...... 11% connect
  10:00–11:30 ...... 21% connect
  after 4pm ........ 9% connect

→ 3,400 subscribers · CTA: reply "10AM"</div></div>`;
    case 'scout': return `<div class="mk mk-doc">
      <div class="d-brand">OPPORTUNITY MEMO</div>
      <div class="d-title">CallForge +8% price rise</div>
      <div class="d-line"><span>Window</span><b>2–3 weeks</b></div>
      <div class="d-line"><span>Play</span><b>comparison page + retargeting</b></div>
      <div class="d-line"><span>Briefed</span><b>META ADS · PROPOSALS</b></div>
      <div class="d-p">Their G2 reviews already flag value-for-money. Talk-track: 12-month price lock.</div></div>`;
    case 'enzo': return `<div class="mk mk-doc">
      <div class="d-brand">PURCHASE ORDER</div>
      <div class="d-title">FullEnrich — 500 credits</div>
      <div class="d-line"><span>Cost</span><b>$250 ($0.50/credit)</b></div>
      <div class="d-line"><span>Current balance</span><b>38 credits — out tomorrow</b></div>
      <div class="d-line"><span>Burn rate</span><b>~90/week</b></div>
      <div class="d-p">Same card as last month. Without credits, enrichment stops and the Sales Lead runs dry.</div></div>`;
    default: {
      // generic: render the agent's own deliverable in a document frame
      if (!FILE_GEN[id]) return '';
      const f = FILE_GEN[id]();
      return `<div class="mk mk-doc">
        <div class="d-brand">${esc(f.name)}</div>
        <div class="ml-body" style="border:0;margin:0;padding:6px 0 0">${esc(f.content.split('\n').slice(0, 9).join('\n'))}</div></div>`;
    }
  }
}

/* ---------- approvals: agent STUCK → amber billboard row → chat approval message ---------- */
function requestApproval(id, ask) {
  const r = R[id];
  if (!r || r.state !== 'working') return;
  r.state = 'stuck';
  r.ask = ask || APPROVAL_BY_AGENT[id] || sample(APPROVAL_ASKS[r.a.dept], 1)[0];
  r.warn.visible = true;
  const hadChat = !!chatHist[id]; // fresh chats already seed the deliverable card
  chatPush(id, { who: 'appr', text: r.ask, pending: true, mock: mockupFor(id) });
  if (FILE_GEN[id] && hadChat) chatPush(id, { who: 'file', ...FILE_GEN[id]() });
  if (tasks) tasks.onStuck(id, r.ask);
  syncApprovals();
}
// V3.5: a routine's draft is waiting for the owner's OK — the agent stands and waves like any approval; the chat already holds the draft card
function setStuckLive(id, ask, sid) {
  const r = R[id]; if (!r) return;
  r.state = 'stuck'; r.ask = ask; r.liveSid = sid; r.warn.visible = true;
  syncApprovals();
}
function resolveApproval(id, approved) {
  const r = R[id];
  if (!r || r.state !== 'stuck') return;
  r.state = 'working';
  r.ask = null;
  r.warn.visible = false;
  const msg = chatHist[id] && [...chatHist[id]].reverse().find(m => m.who === 'appr' && m.pending);
  if (msg) { msg.pending = false; msg.approved = approved; }
  // visible reaction in the scene: cheer + ✅, or slump + ❌
  const now = performance.now();
  if (approved) r.cheerUntil = now + 2400; else r.slumpUntil = now + 2600;
  spawnEmote(r, approved ? '✅' : '❌');
  if (r.liveSid) { r.liveSid = null; if (tasks) tasks.resolveLive(id, approved); syncApprovals(); return; } // live: APPROVE sends, REJECT asks for the note
  if (tasks) tasks.onResolve(id, approved);
  chatPush(id, {
    who: 'agent',
    text: approved ? '✓ Approved — actioning it now. I\'ll log the result in my activity.'
                   : '✗ Understood — parked. I\'ll adjust and come back with a better version.',
  });
  syncApprovals();
}
function stuckIn(dept) { return Object.values(R).filter(r => r.state === 'stuck' && r.a.dept === dept); }
function syncApprovals() {
  let total = 0;
  for (const k of DEPT_KEYS) {
    const n = stuckIn(k).length; total += n;
    if (deptRT[k] && deptRT[k].apprRow) deptRT[k].apprRow.style.display = n ? 'flex' : 'none';
    if (deptRT[k] && deptRT[k].apprN) deptRT[k].apprN.textContent = n;
  }
  const top = document.getElementById('topAppr');
  top.style.display = total ? 'inline-flex' : 'none';
  top.querySelector('span').textContent = total;
  // mirror into the docked rail header + row status tags
  if (focused && focused !== 'brain') {
    const n = stuckIn(focused).length;
    const rh = document.getElementById('railHeader');
    const ap = rh.querySelector('.b-appr');
    if (ap) { ap.style.display = n ? 'flex' : 'none'; ap.querySelector('.ap-n').textContent = n; }
  }
}
function zoomToApproval(dept) {
  const s = stuckIn(dept)[0];
  if (!s) { enterFocus(dept); return; }
  if (focused === dept) openAgentRail(s.a.id);
  else enterFocus(dept, s.a.id);
}
document.getElementById('topAppr').addEventListener('click', () => {
  const s = Object.values(R).find(r => r.state === 'stuck');
  if (s) zoomToApproval(s.a.dept);
});

/* ---------- event engine: weighted v1 templates → feed + chat + billboards ---------- */
function weightedEv(evs) {
  const tot = evs.reduce((s, e) => s + (e.p || 1), 0);
  let x = Math.random() * tot;
  for (const e of evs) { x -= (e.p || 1); if (x <= 0) return e; }
  return evs[0];
}
function fireAgentEvent(seedTs) {
  let ids = Object.keys(R).filter(id => R[id]?.v1?.ev && R[id].state !== 'stuck');
  if (!ids.length) ids = Object.keys(R).filter(id => R[id]?.state !== 'stuck');
  if (!ids.length) return;
  const r = R[ids[Math.floor(Math.random() * ids.length)]];
  if (!r) return;
  let i = '💡', text = 'Reviewing department operations';
  let ev = null;
  if (r.v1?.ev?.length) {
    ev = weightedEv(r.v1.ev);
    if (ev) {
      i = ev.i;
      text = typeof ev.t === 'function' ? ev.t() : (ev.text || text);
    }
  } else {
    text = `Reviewing ${r.a?.name || 'executive'} deliverables`;
  }
  r.feed.unshift({ i, text, ts: seedTs || Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (!seedTs) {
    spawnEmote(r, i); // real work events pop their icon over the desk
    if (mcp && mcp.onAgentEvent && r.a && r.seat) {
      mcp.onAgentEvent(r.a.id, r.a.dept, r.seat, performance.now()); // tool tile pulses + packet beam
    }
    if (r.a && focused === r.a.dept) { // live-update the rail activity row
      const line = document.querySelector(`[data-line="${r.a.id}"]`);
      if (line) line.textContent = i + ' ' + text;
    }
    if (r.a && chatHist[r.a.id]) chatPush(r.a.id, { who: 'work', i, text });
    if (ev && ev.kpi) { const k = KPIS.find(x => x.id === ev.kpi.id); if (k) k.val += ev.kpi.n; }
    const d = r.a?.dept, roll = Math.random();
    if (d === 'emails') { if (roll < 0.45) STATS.emailsSent++; else if (roll < 0.7) STATS.drafts++; }
    else if (d === 'delivery' && roll < 0.2) STATS.reports++;
    else if (d === 'sales') {
      if (roll < 0.4) STATS[rnd(['spencer', 'arwin', 'jack'])]++;
      else if (roll < 0.5) STATS.autoOnb++;
      else if (roll < 0.56) STATS.managers++;
    }
    else if (d === 'marketing') {
      if (roll < 0.18) STATS.insMkt++;
      else if (roll < 0.5) STATS.cpa = Math.max(25, STATS.cpa + (Math.random() - 0.55) * 1.2);
    }
    else if (d === 'ops' && roll < 0.22) STATS.insOps++;
    else if (d === 'fin' && roll < 0.3) STATS.billsPaid++;
    if (ev && (ev.brain || Math.random() < 0.12)) {
      if (brain) { brain.state.notes++; if (r.a) brain.read(r.a.id); }
    } // the Brain shows the read
    updateBillboards();
    if (r.a && modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
  }
}
// seed a believable history so Activity isn't empty at boot
for (let i = 0; i < 170; i++) fireAgentEvent(Date.now() - ri(2, 200) * 60000);
for (const r of Object.values(R)) r.feed.sort((a, b) => b.ts - a.ts);

/* ---------- minimal sim: work bobs, screen updates, brain meetings ---------- */
let meeting = null; // Brain meetings fire ONLY on the X hotkey (AJ's call — demo cue, not ambient)
let nextApprovalAt = performance.now() + 20000;
let nextMetricAt = performance.now() + 3000;
let nextEmoteAt = performance.now() + 2000;

function planMeeting(now) {
  const ids = Object.keys(R).filter(id => R[id]?.state === 'working');
  if (ids.length < 2) return;
  const depts = new Set(ids.map(id => R[id]?.a?.dept).filter(Boolean));
  if (depts.size < 2) return;
  const a = R[ids[Math.floor(Math.random() * ids.length)]];
  if (!a) return;
  let b = a;
  let attempts = 0;
  while ((!b || b.a?.dept === a.a?.dept) && attempts++ < 30) {
    b = R[ids[Math.floor(Math.random() * ids.length)]];
  }
  if (!b || b.a?.dept === a.a?.dept) return;
  for (const [i, r] of [a, b].entries()) {
    const d = deptRT[r.a?.dept];
    if (!d || !d.gate || !d.brainGate) continue;
    const stand = new THREE.Vector3(2 + (i ? 3.4 : -3.4), 0.12, 2 + 2.6);
    r.path = [r.seat.clone(), d.gate.clone().setY(0.12), d.brainGate.clone().setY(0.12), stand];
    r.pathI = 0; r.state = 'walking';
  }
  meeting = { a, b, phase: 'gather', endAt: 0 };
}

function walkStep(r, dt) {
  const cur = r.person.position, tgt = r.path[r.pathI];
  const d = new THREE.Vector3().subVectors(tgt, cur); d.y = 0;
  const dist = d.length();
  const step = r.speed * dt;
  if (dist <= step) {
    cur.copy(tgt);
    r.pathI++;
    if (r.pathI >= r.path.length) return true;
  } else {
    d.normalize();
    cur.addScaledVector(d, step);
    r.person.rotation.y = Math.atan2(d.x, d.z);
  }
  return false;
}

// desk-life variety: each agent cycles through work modes on its own clock
// no 'stretch' — AJ found the stand-up stretches annoying (1 Aug). Last entry = pick fallback.
const WORK_MODES = [
  ['type', 0.30, 4000, 7500], ['read', 0.18, 3500, 6500], ['phone', 0.16, 4000, 8000],
  ['glance', 0.17, 2000, 3500], ['sip', 0.11, 2500, 4000], ['spin', 0.08, 1400, 2000],
];
function pickWorkMode(r, now) {
  let x = Math.random();
  for (const [mode, w, dMin, dMax] of WORK_MODES) {
    x -= w;
    if (x <= 0 || mode === WORK_MODES[WORK_MODES.length - 1][0]) {
      r.workMode = mode;
      r.modeStart = now;
      r.modeUntil = now + dMin + Math.random() * (dMax - dMin);
      if (mode === 'glance')
        r.person.userData.glanceDir = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.25);
      return;
    }
  }
}
// standing modes drift the agent from the chair to a spot beside the desk, and can re-face the camera
const FACE_CAM = Math.PI / 4;
function applyStandAndFacing(r, mode, now, dt) {
  const u = r.person.userData;
  const sk = (u.cur && u.cur.standK) || 0;
  r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * sk;
  r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * sk;
  if (mode === 'spin') {
    const span = Math.max(400, (r.modeUntil - r.modeStart) || 1500);
    r.person.rotation.y = r.seatRot + ((now - r.modeStart) / span) * Math.PI * 2;
    return;
  }
  const target = (mode === 'stretch' || mode === 'cheer' || mode === 'wave') ? FACE_CAM : r.seatRot;
  let d = target - r.person.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
}
// floating emoji work-bubbles — constant visible "something is happening" at any zoom
const emoteTex = {};
function getEmoteTex(icon) {
  if (!emoteTex[icon]) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    // cream bubble disc so the icon reads at any zoom
    x.beginPath(); x.arc(64, 60, 52, 0, 7);
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = 'rgba(21,20,20,0.25)'; x.stroke();
    x.beginPath(); x.moveTo(50, 106); x.lineTo(64, 124); x.lineTo(74, 104); x.closePath();
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.font = '58px "Apple Color Emoji", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#151414';
    x.fillText(icon, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    emoteTex[icon] = t;
  }
  return emoteTex[icon];
}
const emotes = [];
function spawnEmote(r, icon) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmoteTex(icon), depthTest: false, transparent: true }));
  const p = r.person.position;
  s.position.set(p.x + 0.7, p.y + 5.6, p.z);
  s.scale.set(2.9, 2.9, 1);
  scene.add(s);
  emotes.push({ s, born: performance.now() });
}
function tickEmotes(now, dt) {
  for (let i = emotes.length - 1; i >= 0; i--) {
    const e = emotes[i], age = (now - e.born) / 1700;
    if (age >= 1) {
      scene.remove(e.s); e.s.material.dispose(); emotes.splice(i, 1);
    } else {
      e.s.position.y += dt * 1.7;
      e.s.material.opacity = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
    }
  }
}
function tickSim(now, dt) {
  officeWorker.postSimTick(now, dt, AGENTS);
  for (const r of Object.values(R)) {
    if (r.state === 'working') {
      let mode;
      if (r.cheerUntil && now < r.cheerUntil) mode = 'cheer';
      else if (r.slumpUntil && now < r.slumpUntil) mode = 'slump';
      else {
        if (!r.modeUntil) { // first pick: desync everyone so the room never moves in lockstep
          pickWorkMode(r, now);
          r.modeUntil = now + 400 + Math.random() * 4000;
        } else if (now > r.modeUntil) pickWorkMode(r, now);
        mode = r.workMode;
      }
      poseWork(r.person, mode, now + r.bob * 500, dt);
      applyStandAndFacing(r, mode, now, dt);
    } else if (r.state === 'walking' || r.state === 'returning') {
      posePerson(r.person, 'walk', now);
      if (walkStep(r, dt)) {
        if (r.state === 'walking') {
          r.state = 'atBrain';
          r.person.rotation.y = r.person.position.x < 2 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          r.state = 'working';
          r.person.position.copy(r.seat);
          r.person.rotation.y = r.seatRot;
        }
      }
    } else if (r.state === 'atBrain') {
      posePerson(r.person, 'stand', now);
    }
  }
  if (meeting) {
    const { a, b } = meeting;
    if (meeting.phase === 'gather' && a.state === 'atBrain' && b.state === 'atBrain') {
      meeting.phase = 'talk';
      meeting.endAt = now + 8000 + Math.random() * 6000;
      bubble.visible = true;
    }
    if (meeting.phase === 'talk') {
      bubble.scale.setScalar(4 + Math.sin(now / 300) * 0.3);
      if (now > meeting.endAt) {
        bubble.visible = false;
        for (const r of [a, b]) {
          r.path = [...r.path].reverse(); r.path[r.path.length - 1] = r.seat.clone();
          r.pathI = 0; r.state = 'returning';
        }
        meeting = null;
      }
    }
  }
  // stuck agents STAND, face the camera and WAVE under their pulsing ⚠ (AJ's spec)
  for (const r of Object.values(R)) {
    if (r.state === 'stuck') {
      poseWork(r.person, 'wave', now + r.bob * 500, dt);
      applyStandAndFacing(r, 'wave', now, dt);
      const p = r.person.position;
      r.warn.position.set(p.x, p.y + 5.9, p.z);
      const k = 2.6 + Math.sin(now / 240) * 0.5;
      r.warn.scale.set(k, k, 1);
    }
  }
  // ambient emoji work-bubbles pop over random desks every beat or two
  if (now > nextEmoteAt) {
    const ids = Object.keys(R).filter(id => R[id].state === 'working');
    if (ids.length) spawnEmote(R[ids[Math.floor(Math.random() * ids.length)]],
      rnd(['💬', '✉️', '📈', '💡', '✓', '📞', '🔍', '📎']));
    nextEmoteAt = now + 1200 + Math.random() * 1800;
  }
  tickEmotes(now, dt);
  tickSweep(now);
  brain.tick(now);
  // schedule a new approval request now and then — capped so a long unattended demo
  // never ends up with half the office stuck waving (v1 demo-safety rule)
  if (now > nextApprovalAt && !(tasks && tasks.isLive())) { // V3.5: a live office's approvals are real (routine drafts) — no theatre ones
    const pending = Object.values(R).filter(r => r.state === 'stuck').length;
    if (pending < 2) {
      const ids = Object.keys(R).filter(id => R[id].state === 'working' && !R[id].a.lead);
      if (ids.length) requestApproval(ids[Math.floor(Math.random() * ids.length)]);
    }
    nextApprovalAt = now + 50000 + Math.random() * 40000;
  }
  // agent events drive everything — feed, chat streams, billboard metrics (nothing is static)
  if (now > nextMetricAt) {
    fireAgentEvent();
    nextMetricAt = now + 2600 + Math.random() * 3800;
  }
  // rotate desk screen content — a couple of screens refresh every beat so the room reads busy
  if (Math.floor(now / 1800) !== Math.floor((now - dt * 1000) / 1800)) {
    if (screenSets.length > 0) {
      const n = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const ss = screenSets[Math.floor(Math.random() * screenSets.length)];
        if (ss && ss.screenSet && ss.screenSet.draw) {
          const rawLines = sample(WORKLINES[ss.dept], 3) || [];
          const lines = Array.isArray(rawLines) ? rawLines.map(l => String(l || '').slice(0, 28)) : [];
          ss.screenSet.draw(lines);
          if (ss.screenSet.tex) ss.screenSet.tex.needsUpdate = true;
        }
      }
    }
  }
}

/* ---------- zoom LOD + HTML overlay projection ---------- */
const v3 = new THREE.Vector3();
function toScreen(p) {
  v3.copy(p).project(camera);
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

function tickLOD() {
  const z = view.zoom;
  const detail = smooth(1.75, 2.5, z);
  const pillA = smooth(1.45, 1.85, z); // pills stay on at near — they name the agents
  // billboards persist at every zoom (v1 rule) — slightly larger when far, compact when near
  const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
  for (const [k, d] of Object.entries(deptRT)) {
    if (focused === k && k !== 'brain') continue; // this billboard is docked in the rail
    if (!d.badgeAnchor || !d.badge) continue;
    let [sx, sy] = toScreen(d.badgeAnchor);
    const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
    const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26);
    let xf;
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
      sy = clamp(sy, bh / 2 + 64, innerHeight - bh / 2 - 12);
    } else {
      sy = clamp(sy, bh + 64, innerHeight - 12);
      sx = clamp(sx, bw / 2 + 8, rightEdge - bw / 2);
      xf = 'translate(-50%,-100%)';
    }
    d.badge.style.transform = `translate(${sx}px,${sy}px) ${xf} scale(${badgeScale})`;
    d.badge.style.opacity = 1 - 0.75 * focusDim; // unfocused boards recede with the scene
    d.badge.style.pointerEvents = 'auto';
  }
  // name pills stay on at EVERY zoom (AJ's call) — smaller when far, full-size when near
  const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
  for (const r of Object.values(R)) {
    const p = r.person.position;
    const [sx, sy] = toScreen(v3.set(p.x, p.y + 5.9 * (r.a.lead ? 1.12 : 1), p.z).clone());
    r.pill.style.display = 'block';
    r.pill.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${pillScale})`;
    const dimmed = focused && focused !== 'brain' && r.a.dept !== focused;
    r.pill.style.opacity = dimmed ? 1 - 0.85 * focusDim : 1;
  }
}

/* ---------- clock (REAL local time — locked rule) ---------- */
function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000); tickClock();

/* ---------- helpers ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function sample(arr, n) {
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : Array.from(arr);
  const out = [...list].sort(() => Math.random() - 0.5).slice(0, n);
  return out;
}

/* ---------- V3 task boards ---------- */
function feedPush(r, i, text) {
  r.feed.unshift({ i, text, ts: Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (focused === r.a.dept) {
    const line = document.querySelector(`[data-line="${r.a.id}"]`);
    if (line) line.textContent = i + ' ' + text;
  }
  if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
}
// V3.1 LIVE: the served roster (office.agents.json) renames the seats and rewrites what each
// agent says about itself; the demo's fake greetings and stat chips are wrong in a real office
function applyRoster(agents) {
  if (!Array.isArray(agents)) return;
  for (const a of agents) {
    const r = R[a.id]; if (!r) continue;
    r.a.name = a.name;
    r.pill.innerHTML = (r.a.lead ? '<span class="star">★</span>' : '') + esc(a.name);
    r.v1 = r.v1 || {};
    r.v1.role = a.role || r.v1.role || ''; r.v1.tagline = a.does || r.v1.tagline || '';
    r.v1.greeting = `${a.does || 'I am ' + a.name + '.'} Give me a task in the bar on the right, or ask me something here.` +
      (a.interviewer && a.setUp === false ? ` Nothing in this department is yours yet: say "set up" and I will ask you five questions about how it works here, then write it down for the team.` : '');
    r.v1.chips = a.interviewer && a.setUp === false ? ['set up', 'What can you do for me?', 'What tools can you use?'] : ['What are you working on?', 'What can you do for me?', 'What tools can you use?'];
    if (chatHist[a.id] && chatHist[a.id][0] && chatHist[a.id][0].who === 'agent') chatHist[a.id][0].text = r.v1.greeting;
    if (modalOpen === a.id) openAgentRail(a.id, modalTab, false);
  }
  if (tasks && tasks.syncPills) tasks.syncPills(); // the pills were rebuilt — put the clock chips back
}
tasks = initTasks({
  hud, R, deptRT, RAIL_SIDE, spawnEmote, chatPush, chatHist, feedPush, zoomToApproval, enterFocus, openAgent, esc,
  brainWrite: (id, title) => brain.write(id, title), brain,
  onLive: (h) => {
    document.querySelector('#topbar .brand .ver').textContent = 'BETA';
    document.title = `${h.name} — Agents Office`;
    brain.setOwner(h.name);
    brain.setQuiet(true);
    if (h.depts && tasks && tasks.syncDepartments) tasks.syncDepartments({ keys: h.depts });
    if (h.agents && tasks && tasks.syncAgents) tasks.syncAgents(h.agents);
    applyRoster(h.agents);
    refresh3D();
  },
  onTools: (agentId, keys) => mcp.onToolsUsed(agentId, keys),
  requestApproval, setStuck: setStuckLive,
  onUsage: (u) => { if (mcp && mcp.setUsage) mcp.setUsage(u); }, // V3.6: the plan's gauge in the top bar
  getFocused: () => focused, getZoom: () => view.zoom, getFocusDim: () => focusDim,
  toScreen: (p) => toScreen(p), reframe, refresh3D, removeDeptPod, removeAgent3D, buildAgent3D,
});
view.target.set(...overviewPos());
addEventListener('resize', () => { if (!focused && !tween) view.target.set(...overviewPos()); });

/* ---------- boot ---------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
}
addEventListener('resize', resize);
resize();

// deterministic view hooks for headless screenshots: #view=sales | #zoom=2.2
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) view.zoom = parseFloat(h.get('zoom')) || 1;
  if (h.get('appr')) requestApproval(h.get('appr') === '1' ? 'apay' : h.get('appr'));
  if (h.get('view') && LAYOUT[h.get('view')]) enterFocus(h.get('view'));
  if (h.get('cam')) setCam(h.get('cam') === '1');
  if (h.get('dark') === '1' || document.body.classList.contains('dark')) setDark(true);
  // typing #dark=1 into an OPEN tab is a same-document hash change (no reload) — react to it live
  addEventListener('hashchange', () => { const d = new URLSearchParams(location.hash.slice(1)).get('dark'); if (d === '1') setDark(true); else if (d === '0') setDark(false); });
  if (h.get('board')) { // #board=1 → company board · #board=marketing → that dept's board
    const b = h.get('board');
    if (LAYOUT[b] && b !== 'brain') tasks.openFor(b); else tasks.open();
  }
  syncOverviewBtn();
}
window.CC = { flyTo, zoomToDept, zoomOut, zoomToApproval, requestApproval, openAgent, view, applyCamera, R, emotes,
  setCam, setDark, brain, connectorReveal: () => mcp.startReveal(performance.now()),
  toggleBoard: () => tasks.toggle(), addTask: (agentId: string, title: string) => tasks.addTask(agentId, title), tasks, routines: () => tasks.routines,
  refresh3D, refreshMcp, resetMeshCache: async () => { await syncInitialStateFromApi(); refresh3D(); await refreshMcp(); return true; },
  deptRT, DEPT_KEYS, DEPTS, AGENTS, worker: officeWorker };

// Department Manager (Domain Driven Module)
initDeptManagerDomain({ DEPT_KEYS, DEPTS, tasks, refresh3D, refreshMcp });

// Synchronize initial state from DB if live HTTP
async function syncInitialStateFromApi() {
  if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) return;
  try {
    const res = await fetch('/api/departments');
    if (!res.ok) return;
    const data = await res.json();
    let activeKeys = data.keys || data.coreDepts || (data.depts ? Object.keys(data.depts) : null);
    if (!activeKeys || !Array.isArray(activeKeys)) activeKeys = ['exec'];
    if (!activeKeys.includes('exec')) activeKeys.unshift('exec');

    DEPT_KEYS.length = 0;
    DEPT_KEYS.push(...activeKeys);

    for (const k of Object.keys(DEPTS)) {
      if (!activeKeys.includes(k) && k !== 'brain') {
        delete DEPTS[k];
      }
    }
    DEPTS['exec'] = DEPTS['exec'] || { name: 'EXECUTIVE', short: 'EXEC', chip: '#F59E0B', ink: '#B45309', floor: '#FEF3C7' };
    if (data.depts) {
      for (const k of activeKeys) {
        if (data.depts[k]) {
          DEPTS[k] = {
            name: data.depts[k].name || (k === 'exec' ? 'EXECUTIVE' : k.toUpperCase()),
            short: data.depts[k].short || data.depts[k].name || (k === 'exec' ? 'EXEC' : k.toUpperCase()),
            chip: data.depts[k].chip || (k === 'exec' ? '#F59E0B' : '#8FD3F4'),
            ink: data.depts[k].ink || (k === 'exec' ? '#B45309' : '#2E86AB'),
            floor: data.depts[k].floor || (k === 'exec' ? '#FEF3C7' : '#E6F4FB')
          };
        }
      }
    }

    // Immediately prune AGENTS to active departments
    const activeSet = new Set(activeKeys);
    for (let i = AGENTS.length - 1; i >= 0; i--) {
      if (!activeSet.has(AGENTS[i].dept)) {
        AGENTS.splice(i, 1);
      }
    }
    refresh3D();
    await refreshMcp();

    try {
      const aRes = await fetch('/api/agents');
      if (aRes.ok) {
        const aData = await aRes.json();
        const serverAgents = (aData.agents || []).filter((a: any) => activeKeys.includes(a.department || a.dept));
        if (serverAgents.length > 0) {
          const sIds = new Set(serverAgents.map((a: any) => a.id));
          for (let i = AGENTS.length - 1; i >= 0; i--) {
            if (!sIds.has(AGENTS[i].id) || !activeKeys.includes(AGENTS[i].dept)) {
              AGENTS.splice(i, 1);
            }
          }
          for (const sa of serverAgents) {
            let existing = AGENTS.find(x => x.id === sa.id);
            if (!existing) {
              AGENTS.push({
                id: sa.id,
                name: sa.name || sa.id.toUpperCase(),
                dept: sa.department || sa.dept || 'exec',
                lead: !!sa.lead,
                grid: [0.5, 0] as [number, number],
                hair: '#1f1f1f',
                skin: '#F0C9A0',
                role: sa.role || '',
                does: sa.does || '',
                tools: sa.tools || [],
                brief: sa.brief || ''
              });
            } else {
              Object.assign(existing, { name: sa.name, role: sa.role, does: sa.does, tools: sa.tools, brief: sa.brief, dept: sa.department || sa.dept, lead: sa.lead });
            }
          }
          refresh3D();
          await refreshMcp();
        }
      }
    } catch {}

    if (tasks && tasks.syncDepartments) {
      tasks.syncDepartments(data);
    }
    try {
      localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS));
    } catch {}
  } catch (e) {
    console.warn('syncInitialStateFromApi error:', e);
  }
}
syncInitialStateFromApi();

// Real-time Event-Driven Synchronization (SSE / DB -> UI & 3D Scene)
sseSync.start();
events.on('DEPARTMENTS_UPDATED', (payload: any) => {
  if (tasks && tasks.syncDepartments) tasks.syncDepartments(payload);
  if (payload.agents && tasks && tasks.syncAgents) tasks.syncAgents(payload.agents);
  try {
    localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS));
  } catch {}
  refresh3D();
  refreshMcp();
});
events.on('DEPARTMENT_ACTIVATED', () => {
  try {
    localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS));
  } catch {}
  refresh3D();
  refreshMcp();
});
events.on('DEPARTMENT_DISBANDED', () => {
  try {
    localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS));
  } catch {}
  refresh3D();
  refreshMcp();
});
events.on('AGENT_UPDATED', () => {
  refresh3D();
  refreshMcp();
});
events.on('AGENT_REMOVED', () => {
  refresh3D();
  refreshMcp();
});

function initMcpManager() {
  const topconn = document.getElementById('topconn');
  const mcpManagerBtn = document.getElementById('mcpManagerBtn');
  const modal = document.getElementById('mcpModal');
  const closeBtn = document.getElementById('mcpModalClose');
  const addBtn = document.getElementById('addMcpBtn');
  const formContainer = document.getElementById('mcpFormContainer');
  const form = document.getElementById('mcpForm') as HTMLFormElement;
  const formCancel = document.getElementById('mcpFormCancel');
  const listContainer = document.getElementById('mcpListContainer');
  const formDepts = document.getElementById('mcpFormDepts');

  if (!modal) return;
  modal.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

  const openModal = () => {
    modal.classList.add('on');
    loadMcpServers();
  };

  if (mcpManagerBtn) mcpManagerBtn.addEventListener('click', openModal);
  if (topconn) {
    topconn.style.cursor = 'pointer';
    topconn.title = 'Click to customize MCP servers and connectors';
    topconn.addEventListener('click', openModal);
  }

  closeBtn?.addEventListener('click', () => { modal.classList.remove('on'); });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('on'); });

  addBtn?.addEventListener('click', () => {
    if (formContainer) {
      (document.getElementById('mcpFormId') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormName') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormKey') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormCommand') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormTitle') as HTMLElement).textContent = 'Add Custom MCP Server';
      renderFormDepts([]);
      formContainer.style.display = 'block';
    }
  });

  formCancel?.addEventListener('click', () => {
    if (formContainer) formContainer.style.display = 'none';
  });

  function renderFormDepts(selected: string[]) {
    if (!formDepts) return;
    formDepts.innerHTML = DEPT_KEYS.map(k => {
      const isChecked = selected.includes(k);
      return `<label style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; cursor: pointer;">
        <input type="checkbox" name="mcpDept" value="${k}" ${isChecked ? 'checked' : ''}> ${k.toUpperCase()}
      </label>`;
    }).join('');
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (document.getElementById('mcpFormId') as HTMLInputElement).value;
    const name = (document.getElementById('mcpFormName') as HTMLInputElement).value.trim();
    const key = (document.getElementById('mcpFormKey') as HTMLInputElement).value.trim();
    const command = (document.getElementById('mcpFormCommand') as HTMLInputElement).value.trim();
    const checkedDepts = Array.from(formDepts?.querySelectorAll('input[name="mcpDept"]:checked') || []).map((el: any) => el.value);

    await fetch('/api/mcp/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name, key, command, depts: checkedDepts })
    });

    if (formContainer) formContainer.style.display = 'none';
    loadMcpServers();
    if (window.location.protocol.startsWith('http')) {
      await refreshMcp();
    }
  });

  async function loadMcpServers() {
    if (!listContainer) return;
    try {
      const res = await fetch('/api/mcp').then(r => r.json());
      const servers = res.servers || [];
      if (!servers.length) {
        listContainer.innerHTML = '<div style="font-size: 12px; color: var(--grey); padding: 20px; text-align: center;">No MCP servers registered yet. Click "+ ADD MCP SERVER" above to connect one.</div>';
        return;
      }

      listContainer.innerHTML = servers.map((s: any) => {
        const isAllowed = s.allowed !== false;
        const depts = s.depts || DEPT_KEYS;
        return `
          <div class="dept-card" style="display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--hairline); border-radius: 8px; padding: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 700; font-size: 13px; color: var(--fg);">${s.name}</span>
                <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: ${s.status === 'connected' ? '#2E8B5722' : '#E0A02022'}; color: ${s.status === 'connected' ? '#2E8B57' : '#E0A020'}; font-weight: 700; text-transform: uppercase;">${s.status || 'connected'}</span>
                <span style="font-size: 9px; color: var(--grey);">source: ${s.source || 'custom'}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button data-mcp-edit="${s.id}" class="mcp-edit-btn" style="background:rgba(255,255,255,0.06); color:var(--fg); border:1px solid var(--border); border-radius:4px; padding:3px 8px; font-size:10px; font-weight:700; cursor:pointer;">EDIT</button>
                <button data-mcp-toggle="${s.id}" class="mcp-toggle-btn" style="background: ${isAllowed ? '#2E8B5722' : '#C4606022'}; color: ${isAllowed ? '#2E8B57' : '#C46060'}; border: 1px solid ${isAllowed ? '#2E8B5744' : '#C4606044'}; border-radius: 4px; padding: 3px 10px; font-size: 10px; font-weight: 700; cursor: pointer;">
                  ${isAllowed ? '✓ ALLOWED' : '✕ BLOCKED'}
                </button>
                ${s.source === 'custom' ? `<button data-mcp-delete="${s.id}" class="mcp-delete-btn" style="background:#e6939322; color:#C46060; border:1px solid #C4606044; border-radius:4px; padding:3px 8px; font-size:10px; font-weight:700; cursor:pointer;">DELETE</button>` : ''}
              </div>
            </div>
            ${s.target || s.command ? `<div style="font-size: 10px; font-family: monospace; color: var(--grey); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">${s.command || s.target}</div>` : ''}
            <div>
              <div style="font-size: 9px; color: var(--grey); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Assigned Departments:</div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${DEPT_KEYS.map(dk => {
                  const assigned = depts.includes(dk);
                  return `<label style="font-size: 9.5px; display: inline-flex; align-items: center; gap: 3px; background: ${assigned ? 'rgba(90,222,183,0.12)' : 'rgba(255,255,255,0.03)'}; color: ${assigned ? '#5ADEB7' : 'var(--grey)'}; padding: 2px 6px; border-radius: 4px; cursor: pointer;">
                    <input type="checkbox" data-mcp-dept-toggle="${s.id}" data-dept-key="${dk}" ${assigned ? 'checked' : ''}> ${dk.toUpperCase()}
                  </label>`;
                }).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Attach event handlers
      listContainer.querySelectorAll('.mcp-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-edit')!;
          const s = servers.find((x: any) => x.id === sid);
          if (!s || !formContainer) return;
          (document.getElementById('mcpFormId') as HTMLInputElement).value = s.id;
          (document.getElementById('mcpFormName') as HTMLInputElement).value = s.name;
          (document.getElementById('mcpFormKey') as HTMLInputElement).value = s.key || s.id;
          (document.getElementById('mcpFormCommand') as HTMLInputElement).value = s.command || s.target || '';
          (document.getElementById('mcpFormTitle') as HTMLElement).textContent = `Edit MCP Server: ${s.name}`;
          renderFormDepts(s.depts || DEPT_KEYS);
          formContainer.style.display = 'block';
        });
      });

      listContainer.querySelectorAll('.mcp-toggle-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-toggle')!;
          const s = servers.find((x: any) => x.id === sid);
          if (!s) return;
          const isAllowed = s.allowed !== false;
          const cfgRes = await fetch('/api/mcp').then(r => r.json());
          const curConfig = cfgRes.mcp || { allow: [], deny: [], departments: {} };
          let deny = curConfig.deny || [];
          if (isAllowed) {
            if (!deny.includes(sid)) deny.push(sid);
          } else {
            deny = deny.filter((x: string) => x !== sid);
          }
          await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deny })
          });
          loadMcpServers();
        });
      });

      listContainer.querySelectorAll('.mcp-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-delete')!;
          if (confirm(`Are you sure you want to delete MCP server ${sid}?`)) {
            await fetch(`/api/mcp/servers?id=${sid}`, { method: 'DELETE' });
            loadMcpServers();
          }
        });
      });

      listContainer.querySelectorAll('[data-mcp-dept-toggle]').forEach(cb => {
        cb.addEventListener('change', async (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-dept-toggle')!;
          const dk = (e.target as HTMLElement).getAttribute('data-dept-key')!;
          const s = servers.find((x: any) => x.id === sid);
          if (!s) return;
          let curDepts = [...(s.depts || DEPT_KEYS)];
          if ((e.target as HTMLInputElement).checked) {
            if (!curDepts.includes(dk)) curDepts.push(dk);
          } else {
            curDepts = curDepts.filter(x => x !== dk);
          }
          await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ departments: { [sid]: curDepts } })
          });
        });
      });

    } catch (e: any) {
      console.warn('loadMcpServers failed:', e.message);
    }
  }
}

initMcpManager();


let last = performance.now();
let fpsFrames = 0;
let lastFpsTime = performance.now();
let fpsValueEl: HTMLElement | null = null;
let fpsDotEl: HTMLElement | null = null;

function updateFps(now: number) {
  fpsFrames++;
  const delta = now - lastFpsTime;
  if (delta >= 500) {
    const fps = Math.round((fpsFrames * 1000) / delta);
    fpsFrames = 0;
    lastFpsTime = now;
    if (!fpsValueEl) fpsValueEl = document.getElementById('fpsValue');
    if (!fpsDotEl) fpsDotEl = document.getElementById('fpsDot');
    if (fpsValueEl) fpsValueEl.textContent = `${fps} FPS`;
    if (fpsDotEl) {
      if (fps >= 50) {
        fpsDotEl.style.background = '#10B981';
      } else if (fps >= 30) {
        fpsDotEl.style.background = '#F59E0B';
      } else {
        fpsDotEl.style.background = '#EF4444';
      }
    }
  }
}

function loop(now) {
  updateFps(now);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tickTween(now);
  applyCamera();
  tickDim(dt);
  tickSim(now, dt);
  tickLOD();
  tasks.tick(now);
  mcp.tick(now, dt, view, camera, focused, focusDim);
  syncOverviewBtn();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
