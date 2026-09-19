// Agents Office v2 — Modular Three.js isometric office with zoom-driven LOD & Web Worker geometry
import * as THREE from 'three';
import { DEPTS, DEPT_KEYS, AGENTS, LAYOUT, getDeptDimensions } from './data.ts';
import { STATS, KPIS } from './v1data.ts';
import { makePlant } from './builders.ts';
import { initMcp } from './mcp.ts';
import { loadConnectors } from './connectors.ts';
import { initTasks } from './tasks.ts';
import { initBrain } from './brain.ts';
import { initDeptManagerDomain } from './domains/departments/deptManager.ts';
import { sseSync } from './core/SSESync.ts';
import { events } from './core/EventBus.ts';
import { createOfficeWorker } from './graphics/workerClient.ts';
import { createLodEngine } from './graphics/lodEngine.ts';
import { createApprovalsManager } from './ui/approvals.ts';
import { createChatRail } from './ui/chatRail.ts';
import { createOfficeScene } from './graphics/officeScene.ts';
import { createSimEngine } from './graphics/simEngine.ts';
import { createCameraView } from './graphics/cameraView.ts';
import { initMcpManager } from './ui/mcpManagerModal.ts';

// Shared state containers
const hud = document.getElementById('hud') as HTMLElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const clickTargets: THREE.Object3D[] = [];
const personTargets: THREE.Object3D[] = [];
const R: Record<string, any> = {};
const deptRT: Record<string, any> = {};
const screenSets: Array<{ screenSet: any; dept: string }> = [];
const DEPT_AZ: Record<string, number> = {};
const chatHist: Record<string, any[]> = {};
const RAIL_SIDE: Record<string, string> = {
  marketing: 'left', emails: 'left', sales: 'left', ops: 'left', fin: 'left', delivery: 'left', exec: 'left'
};

let tasks: any = null;
let brain: any = null;
let mcpImpl: any = null;
let mcpDark = false;
let mcpUsage: any = null;

// Background Web Worker for geometry & physics
const officeWorker = createOfficeWorker();
officeWorker.onSimTickResult((data: any) => {
  if (data?.updates) {
    for (const [id, u] of Object.entries(data.updates)) {
      if (R[id]) {
        R[id].workerBob = (u as any).bob;
      }
    }
  }
});

/* ---------- Renderer, Lighting & 60 FPS Optimized Shadows ---------- */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // High performance soft shadows (60 FPS)

const scene = new THREE.Scene();
const FR = 42;
const CAM_DIST = 220;
const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
const SR_ = new THREE.Vector3(1, 0, -1).normalize();
const OVERVIEW = { base: [-9, 0, -9] as [number, number, number], zoom: 0.8 };

const hemi = new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.85);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
key.position.set(-60, 90, 20);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -95; key.shadow.camera.right = 95;
key.shadow.camera.top = 95; key.shadow.camera.bottom = -95;
key.shadow.camera.far = 400;
key.shadow.radius = 2;
key.shadow.blurSamples = 4;
key.shadow.bias = -0.0004;
scene.add(key);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.13 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -7;
ground.receiveShadow = true;
scene.add(ground);

function esc(s: string) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const kv = (id: string) => KPIS.find(k => k.id === id)?.val || 0;
const BB_ROWS: Record<string, Array<[string, () => any]>> = {
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
    ['TASKS DONE', () => (tasks && tasks.doneCount && tasks.doneCount[k]) || 0]
  ];
}

/* ---------- Subsystem Modules Initialisation ---------- */
// 1. Camera & View Controls
const camView = createCameraView({
  canvas, scene, hemi, key, ground, FR, CAM_DIST, OVERVIEW, SR_, ISO,
  getTasks: () => tasks,
  getBrain: () => brain,
  getMcp: () => mcp,
  getDeptRT: () => deptRT,
  clickTargets, personTargets,
  openAgent: (id, tab) => openAgent(id, tab),
  openAgentRail: (id, tab, fly) => chatRail.openAgentRail(id, tab, fly),
  buildDeptRail: (k) => chatRail.buildDeptRail(k, getBbRows),
  flyBillboardIntoRail: (k) => chatRail.flyBillboardIntoRail(k),
  cascadeRows: () => chatRail.cascadeRows(),
  planMeeting: (now) => sim.planMeeting(now),
  requestApproval: (id) => approvals.requestApproval(id),
  RAIL_SIDE,
  getAgents: () => AGENTS
});

// 2. LOD & Projection Engine
const lod = createLodEngine({
  camera: camView.camera,
  deptRT,
  R,
  LAYOUT,
  tasks,
  getFocused: () => camView.getFocused(),
  getZoom: () => camView.view.zoom,
  getFocusDim: () => camView.getFocusDim()
});

// 3. Approvals Manager
const approvals = createApprovalsManager({
  R, deptRT, chatHist,
  chatPush: (id, msg) => chatRail.chatPush(id, msg),
  spawnEmote: (r, icon) => sim.spawnEmote(r, icon),
  getTasks: () => tasks,
  getFocused: () => camView.getFocused(),
  enterFocus: (k, pendingId) => camView.enterFocus(k, pendingId),
  openAgentRail: (id, tab, fly) => chatRail.openAgentRail(id, tab, fly),
  esc
});

// 4. Focus Rail & Chat Slide-over
const chatRail = createChatRail({
  R, deptRT, chatHist, RAIL_SIDE,
  getTasks: () => tasks,
  getMcp: () => mcp,
  getBrain: () => brain,
  getFocused: () => camView.getFocused(),
  flyTo: (pos, zoom, dur, opts) => camView.flyTo(pos, zoom, dur, opts),
  focusTarget: (k, atPos) => camView.focusTarget(k, atPos),
  resolveApproval: (id, ok) => approvals.resolveApproval(id, ok),
  stuckIn: (dept) => approvals.stuckIn(dept),
  esc
});

function openAgent(id: string, tab = 'chat') {
  const r = R[id];
  if (!r) return;
  const dept = r.a?.dept;
  if (camView.getFocused() === dept) {
    chatRail.openAgentRail(id, tab);
    return;
  }
  camView.enterFocus(dept, id);
}

// 5. Office 3D Scene Reconciler
const officeScene = createOfficeScene({
  scene, hud, R, deptRT, clickTargets, personTargets, screenSets, DEPT_AZ,
  getBbRows,
  zoomToApproval: (k) => approvals.zoomToApproval(k),
  zoomToDept: (k) => camView.zoomToDept(k),
  openAgent,
  getTasks: () => tasks,
  getBrain: () => brain,
  getDarkOn: () => camView.getDarkOn(),
  refreshMcp,
  esc
});

// 6. Simulation & Animation Engine
const sim = createSimEngine({
  scene, R, deptRT, screenSets, DEPT_AZ, officeWorker,
  getBrain: () => brain,
  getTasks: () => tasks,
  getMcp: () => mcp,
  getFocused: () => camView.getFocused(),
  getFocusDim: () => camView.getFocusDim(),
  getModalOpen: () => chatRail.getModalOpen(),
  getModalTab: () => chatRail.getModalTab(),
  chatPush: (id, msg) => chatRail.chatPush(id, msg),
  chatHist,
  renderActivity: (id) => chatRail.renderActivity(id),
  requestApproval: (id, ask) => approvals.requestApproval(id, ask),
  getBbRows
});

/* ---------- MCP Connectors Proxy ---------- */
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
  sprites: [] as THREE.Object3D[],
  tick: (...a: any[]) => mcpImpl && mcpImpl.tick(...a),
  onAgentEvent: (...a: any[]) => mcpImpl && mcpImpl.onAgentEvent(...a),
  onToolsUsed: (...a: any[]) => mcpImpl && mcpImpl.onToolsUsed(...a),
  showTip: (...a: any[]) => mcpImpl && mcpImpl.showTip(...a),
  startReveal: (...a: any[]) => mcpImpl && mcpImpl.startReveal(...a),
  setDark: (on: boolean) => { mcpDark = on; if (mcpImpl) mcpImpl.setDark(on); },
  setUsage: (u: any) => { mcpUsage = u; if (mcpImpl) mcpImpl.setUsage(u); },
  isLive: () => !!(mcpImpl && mcpImpl.live),
  refresh: refreshMcp,
};
refreshMcp();

/* ---------- Initial Build & Task System Setup ---------- */
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

for (const key_ of [...DEPT_KEYS, 'brain']) officeScene.buildDeptPod(key_);
for (const a of AGENTS) {
  if (DEPT_KEYS.includes(a.dept)) officeScene.buildAgent3D(a);
}

// Initialise central Brain graph
{
  const bg = deptRT.brain.group;
  brain = initBrain({ scene, brainGroup: bg, getR: () => R, esc, hud, toScreen: (p: THREE.Vector3) => lod.toScreen(p), getCamera: () => camView.camera });
  const plant = makePlant();
  plant.position.set(6.2, 0.12, -5.8);
  bg.add(plant);
  bg.traverse((o: any) => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'brain'; });
}

function feedPush(r: any, i: string, text: string) {
  r.feed.unshift({ i, text, ts: Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (camView.getFocused() === r.a?.dept) {
    const line = document.querySelector(`[data-line="${r.a?.id}"]`);
    if (line) line.textContent = i + ' ' + text;
  }
  if (chatRail.getModalOpen() === r.a?.id && chatRail.getModalTab() === 'activity') {
    chatRail.renderActivity(r.a?.id);
  }
}

tasks = initTasks({
  hud, R, deptRT, RAIL_SIDE,
  spawnEmote: (r: any, icon: string) => sim.spawnEmote(r, icon),
  chatPush: (id: string, msg: any) => chatRail.chatPush(id, msg),
  chatHist,
  feedPush,
  zoomToApproval: (dept: string) => approvals.zoomToApproval(dept),
  enterFocus: (k: string, pendingId?: string) => camView.enterFocus(k, pendingId),
  openAgent,
  esc,
  brainWrite: (id: string, title: string) => brain.write(id, title),
  brain,
  onLive: (h: any) => {
    const ver = document.querySelector('#topbar .brand .ver');
    if (ver) ver.textContent = 'BETA';
    document.title = `${h.name} — Agents Office`;
    brain.setOwner(h.name);
    brain.setQuiet(true);
    if (h.depts && tasks && tasks.syncDepartments) tasks.syncDepartments({ keys: h.depts });
    if (h.agents && tasks && tasks.syncAgents) tasks.syncAgents(h.agents);
    officeScene.applyRoster(h.agents, chatHist, chatRail.getModalOpen(), chatRail.getModalTab(), chatRail.openAgentRail);
    officeScene.refresh3D();
  },
  onTools: (agentId: string, keys: string[]) => mcp.onToolsUsed(agentId, keys),
  requestApproval: (id: string, ask?: string) => approvals.requestApproval(id, ask),
  setStuck: (id: string, ask: string, sid?: string) => approvals.setStuckLive(id, ask, sid),
  onUsage: (u: any) => { if (mcp && mcp.setUsage) mcp.setUsage(u); },
  getFocused: () => camView.getFocused(),
  getZoom: () => camView.view.zoom,
  getFocusDim: () => camView.getFocusDim(),
  toScreen: (p: THREE.Vector3) => lod.toScreen(p),
  reframe: () => camView.reframe(),
  refresh3D: () => officeScene.refresh3D(),
  removeDeptPod: (k: string) => officeScene.removeDeptPod(k),
  removeAgent3D: (id: string) => officeScene.removeAgent3D(id),
  buildAgent3D: (a: any) => officeScene.buildAgent3D(a),
});

camView.view.target.set(...camView.overviewPos());
window.addEventListener('resize', () => {
  if (!camView.getFocused()) camView.view.target.set(...camView.overviewPos());
  renderer.setSize(window.innerWidth, window.innerHeight);
  camView.applyCamera();
});
renderer.setSize(window.innerWidth, window.innerHeight);
camView.applyCamera();

// Clock
function tickClock() {
  const d = new Date();
  const el = document.getElementById('clock');
  if (el) el.textContent = d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000); tickClock();

// Hash hooks
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) camView.view.zoom = parseFloat(h.get('zoom')!) || 1;
  if (h.get('appr')) approvals.requestApproval(h.get('appr') === '1' ? 'apay' : h.get('appr')!);
  if (h.get('view') && LAYOUT[h.get('view')!]) camView.enterFocus(h.get('view')!);
  if (h.get('cam')) camView.setCam(h.get('cam') === '1');
  if (h.get('dark') === '1' || document.body.classList.contains('dark')) camView.setDark(true);
  window.addEventListener('hashchange', () => {
    const d = new URLSearchParams(location.hash.slice(1)).get('dark');
    if (d === '1') camView.setDark(true); else if (d === '0') camView.setDark(false);
  });
  if (h.get('board')) {
    const b = h.get('board')!;
    if (LAYOUT[b] && b !== 'brain') tasks.openFor(b); else tasks.open();
  }
  camView.syncOverviewBtn();
}

// Global CC debug / automation interface
(window as any).CC = {
  flyTo: (...a: any[]) => camView.flyTo(...(a as [number[], number])),
  zoomToDept: (k: string) => camView.zoomToDept(k),
  zoomOut: () => camView.zoomOut(),
  zoomToApproval: (k: string) => approvals.zoomToApproval(k),
  requestApproval: (id: string) => approvals.requestApproval(id),
  openAgent,
  view: camView.view,
  applyCamera: () => camView.applyCamera(),
  R,
  emotes: sim.emotes,
  setCam: (on: boolean) => camView.setCam(on),
  setDark: (on: boolean) => camView.setDark(on),
  brain,
  connectorReveal: () => mcp.startReveal(performance.now()),
  toggleBoard: () => tasks.toggle(),
  addTask: (agentId: string, title: string) => tasks.addTask(agentId, title),
  tasks,
  routines: () => tasks.routines,
  refresh3D: () => officeScene.refresh3D(),
  refreshMcp,
  resetMeshCache: async () => { await officeScene.syncInitialStateFromApi(); officeScene.refresh3D(); await refreshMcp(); return true; },
  deptRT,
  DEPT_KEYS,
  DEPTS,
  AGENTS,
  worker: officeWorker
};

// Department Manager Domain
initDeptManagerDomain({ DEPT_KEYS, DEPTS, tasks, refresh3D: () => officeScene.refresh3D(), refreshMcp });
officeScene.syncInitialStateFromApi();

// Real-time Event-Driven Synchronization (SSE / DB -> UI & 3D Scene)
sseSync.start();
events.on('DEPARTMENTS_UPDATED', (payload: any) => {
  if (tasks && tasks.syncDepartments) tasks.syncDepartments(payload);
  if (payload.agents && tasks && tasks.syncAgents) tasks.syncAgents(payload.agents);
  try { localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS)); } catch {}
  officeScene.refresh3D();
  refreshMcp();
});
events.on('DEPARTMENT_ACTIVATED', () => {
  try { localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS)); } catch {}
  officeScene.refresh3D();
  refreshMcp();
});
events.on('DEPARTMENT_DISBANDED', () => {
  try { localStorage.setItem('ao_active_depts', JSON.stringify(DEPT_KEYS)); } catch {}
  officeScene.refresh3D();
  refreshMcp();
});
events.on('AGENT_UPDATED', () => {
  officeScene.refresh3D();
  refreshMcp();
});
events.on('AGENT_REMOVED', () => {
  officeScene.refresh3D();
  refreshMcp();
});

// MCP Modal
initMcpManager({ deptKeys: DEPT_KEYS, refreshMcp });

/* ---------- Render Loop & FPS Counter ---------- */
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
      if (fps >= 50) fpsDotEl.style.background = '#10B981';
      else if (fps >= 30) fpsDotEl.style.background = '#F59E0B';
      else fpsDotEl.style.background = '#EF4444';
    }
  }
}

function loop(now: number) {
  updateFps(now);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  camView.tickTween(now);
  camView.applyCamera();
  camView.tickDim(dt);
  sim.tickSim(now, dt);
  lod.tickLOD();
  tasks.tick(now);
  mcp.tick(now, dt, camView.view, camView.camera, camView.getFocused(), camView.getFocusDim());
  camView.syncOverviewBtn();
  renderer.render(scene, camView.camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
