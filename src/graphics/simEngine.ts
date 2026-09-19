import * as THREE from 'three';
import { DEPTS, DEPT_KEYS, AGENTS, WORKLINES } from '../data.ts';
import { KPIS, STATS, rnd, ri, person } from '../v1data.ts';
import { poseWork, posePerson } from '../builders.ts';

export interface SimEngineOptions {
  scene: THREE.Scene;
  R: Record<string, any>;
  deptRT: Record<string, any>;
  screenSets: Array<{ screenSet: any; dept: string }>;
  DEPT_AZ: Record<string, number>;
  officeWorker: any;
  getBrain: () => any;
  getTasks: () => any;
  getMcp: () => any;
  getFocused: () => string | null;
  getFocusDim: () => number;
  getModalOpen: () => string | null;
  getModalTab: () => string;
  chatPush: (id: string, msg: any) => void;
  chatHist: Record<string, any[]>;
  renderActivity: (id: string | null) => void;
  requestApproval: (id: string, ask?: string) => void;
  getBbRows: (k: string) => any[];
}

export function createSimEngine(options: SimEngineOptions) {
  const {
    scene, R, deptRT, screenSets, DEPT_AZ, officeWorker,
    getBrain, getTasks, getMcp, getFocused, getFocusDim, getModalOpen, getModalTab,
    chatPush, chatHist, renderActivity, requestApproval, getBbRows
  } = options;

  function sample(arr: any[], n: number) {
    if (!arr) return [];
    const list = Array.isArray(arr) ? arr : Array.from(arr);
    return [...list].sort(() => Math.random() - 0.5).slice(0, n);
  }

  // Meeting bubble & sprite
  function makeBubbleSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    if (x) {
      x.font = '96px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('💬', 64, 70);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
    s.scale.set(4, 4, 1);
    return s;
  }

  const bubble = makeBubbleSprite();
  bubble.position.set(2, 5.4, 2);
  bubble.visible = false;
  scene.add(bubble);

  let meeting: any = null;
  let nextApprovalAt = performance.now() + 20000;
  let nextMetricAt = performance.now() + 3000;
  let nextEmoteAt = performance.now() + 2000;
  const SWEEP_PERIOD = 16000;

  function planMeeting(now: number) {
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

  function walkStep(r: any, dt: number): boolean {
    const cur = r.person.position, tgt = r.path[r.pathI];
    if (!tgt) return true;
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

  const WORK_MODES: Array<[string, number, number, number]> = [
    ['type', 0.30, 4000, 7500], ['read', 0.18, 3500, 6500], ['phone', 0.16, 4000, 8000],
    ['glance', 0.17, 2000, 3500], ['sip', 0.11, 2500, 4000], ['spin', 0.08, 1400, 2000],
  ];

  function pickWorkMode(r: any, now: number) {
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

  const FACE_CAM = Math.PI / 4;
  function applyStandAndFacing(r: any, mode: string, now: number, dt: number) {
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

  const emoteTex: Record<string, THREE.CanvasTexture> = {};
  function getEmoteTex(icon: string) {
    if (!emoteTex[icon]) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      if (x) {
        x.beginPath(); x.arc(64, 60, 52, 0, 7);
        x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
        x.lineWidth = 3; x.strokeStyle = 'rgba(21,20,20,0.25)'; x.stroke();
        x.beginPath(); x.moveTo(50, 106); x.lineTo(64, 124); x.lineTo(74, 104); x.closePath();
        x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
        x.font = '58px "Apple Color Emoji", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillStyle = '#151414';
        x.fillText(icon, 64, 64);
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      emoteTex[icon] = t;
    }
    return emoteTex[icon];
  }

  const emotes: any[] = [];
  function spawnEmote(r: any, icon: string) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmoteTex(icon), depthTest: false, transparent: true }));
    const p = r.person.position;
    s.position.set(p.x + 0.7, p.y + 5.6, p.z);
    s.scale.set(2.9, 2.9, 1);
    scene.add(s);
    emotes.push({ s, born: performance.now() });
  }

  function tickEmotes(now: number, dt: number) {
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

  function tickSweep(now: number) {
    const focused = getFocused();
    const focusDim = getFocusDim();
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
        b.style.setProperty('--sw', DEPTS[k]?.chip || '#8FD3F4');
        b.classList.add('sweepglow');
      } else if (s <= 0.35 && b.classList.contains('sweepglow')) b.classList.remove('sweepglow');
    }
    return { theta, strength: domS, col: (domDept && DEPTS[domDept]) ? DEPTS[domDept].chip : '#FFFFFF' };
  }

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

  function weightedEv(evs: any[]) {
    const tot = evs.reduce((s, e) => s + (e.p || 1), 0);
    let x = Math.random() * tot;
    for (const e of evs) { x -= (e.p || 1); if (x <= 0) return e; }
    return evs[0];
  }

  function fireAgentEvent(seedTs?: number) {
    let ids = Object.keys(R).filter(id => R[id]?.v1?.ev && R[id].state !== 'stuck');
    if (!ids.length) ids = Object.keys(R).filter(id => R[id]?.state !== 'stuck');
    if (!ids.length) return;
    const r = R[ids[Math.floor(Math.random() * ids.length)]];
    if (!r) return;
    let i = '💡', text = 'Reviewing department operations';
    let ev: any = null;
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
      spawnEmote(r, i);
      const mcp = getMcp();
      const brain = getBrain();
      const focused = getFocused();
      const modalOpen = getModalOpen();
      const modalTab = getModalTab();

      if (mcp && mcp.onAgentEvent && r.a && r.seat) {
        mcp.onAgentEvent(r.a.id, r.a.dept, r.seat, performance.now());
      }
      if (r.a && focused === r.a.dept) {
        const line = document.querySelector(`[data-line="${r.a.id}"]`);
        if (line) line.textContent = i + ' ' + text;
      }
      if (r.a && chatHist[r.a.id]) chatPush(r.a.id, { who: 'work', i, text });
      if (ev && ev.kpi) { const k = KPIS.find(x => x.id === ev.kpi.id); if (k) k.val += ev.kpi.n; }
      const d = r.a?.dept, roll = Math.random();
      if (d === 'emails') { if (roll < 0.45) STATS.emailsSent++; else if (roll < 0.7) STATS.drafts++; }
      else if (d === 'delivery' && roll < 0.2) STATS.reports++;
      else if (d === 'sales') {
        if (roll < 0.4) (STATS as any)[rnd(['spencer', 'arwin', 'jack'])]++;
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
      }
      updateBillboards();
      if (r.a && modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
    }
  }

  // Seed believable activity history
  for (let i = 0; i < 170; i++) fireAgentEvent(Date.now() - ri(2, 200) * 60000);
  for (const r of Object.values(R)) r.feed.sort((a: any, b: any) => b.ts - a.ts);

  let lastWorkerTick = 0;
  function tickSim(now: number, dt: number) {
    if (officeWorker && officeWorker.postSimTick && (now - lastWorkerTick >= 50)) {
      lastWorkerTick = now;
      officeWorker.postSimTick(now, dt, AGENTS);
    }
    for (const r of Object.values(R)) {
      if (r.state === 'working') {
        let mode: string;
        if (r.cheerUntil && now < r.cheerUntil) mode = 'cheer';
        else if (r.slumpUntil && now < r.slumpUntil) mode = 'slump';
        else {
          if (!r.modeUntil) {
            pickWorkMode(r, now);
            r.modeUntil = now + 400 + Math.random() * 4000;
          } else if (now > r.modeUntil) pickWorkMode(r, now);
          mode = r.workMode || 'type';
        }
        poseWork(r.person, mode, now + (r.bob || 0) * 500, dt);
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
    for (const r of Object.values(R)) {
      if (r.state === 'stuck') {
        poseWork(r.person, 'wave', now + (r.bob || 0) * 500, dt);
        applyStandAndFacing(r, 'wave', now, dt);
        const p = r.person.position;
        r.warn.position.set(p.x, p.y + 5.9, p.z);
        const k = 2.6 + Math.sin(now / 240) * 0.5;
        r.warn.scale.set(k, k, 1);
      }
    }
    if (now > nextEmoteAt) {
      const ids = Object.keys(R).filter(id => R[id].state === 'working');
      if (ids.length) spawnEmote(R[ids[Math.floor(Math.random() * ids.length)]],
        rnd(['💬', '✉️', '📈', '💡', '✓', '📞', '🔍', '📎']));
      nextEmoteAt = now + 1200 + Math.random() * 1800;
    }
    tickEmotes(now, dt);
    tickSweep(now);
    const brain = getBrain();
    if (brain && brain.tick) brain.tick(now);

    const tasks = getTasks();
    if (now > nextApprovalAt && !(tasks && tasks.isLive && tasks.isLive())) {
      const pending = Object.values(R).filter(r => r.state === 'stuck').length;
      if (pending < 2) {
        const ids = Object.keys(R).filter(id => R[id].state === 'working' && !R[id].a?.lead);
        if (ids.length) requestApproval(ids[Math.floor(Math.random() * ids.length)]);
      }
      nextApprovalAt = now + 50000 + Math.random() * 40000;
    }
    if (now > nextMetricAt) {
      fireAgentEvent();
      nextMetricAt = now + 2600 + Math.random() * 3800;
    }
    if (Math.floor(now / 1800) !== Math.floor((now - dt * 1000) / 1800)) {
      if (screenSets.length > 0) {
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const ss = screenSets[Math.floor(Math.random() * screenSets.length)];
          if (ss && ss.screenSet && ss.screenSet.draw && (WORKLINES as any)[ss.dept]) {
            const rawLines = sample((WORKLINES as any)[ss.dept], 3) || [];
            const lines = Array.isArray(rawLines) ? rawLines.map(l => String(l || '').slice(0, 28)) : [];
            ss.screenSet.draw(lines);
            if (ss.screenSet.tex) ss.screenSet.tex.needsUpdate = true;
          }
        }
      }
    }
  }

  return {
    planMeeting,
    spawnEmote,
    tickEmotes,
    tickSweep,
    updateBillboards,
    fireAgentEvent,
    tickSim,
    emotes
  };
}
