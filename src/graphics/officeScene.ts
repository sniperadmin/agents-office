import * as THREE from 'three';
import { DEPTS, DEPT_KEYS, AGENTS, LAYOUT, getDeptDimensions } from '../data.ts';
import { V1 } from '../v1data.ts';
import { makePlinth, makeWalkway, makePlant, makeDesk, makeChair, makePerson, makeWarnSprite } from '../builders.ts';
import { disposeHierarchy } from './SceneReconciler.ts';

export interface OfficeSceneOptions {
  scene: THREE.Scene;
  hud: HTMLElement;
  R: Record<string, any>;
  deptRT: Record<string, any>;
  clickTargets: THREE.Object3D[];
  personTargets: THREE.Object3D[];
  screenSets: Array<{ screenSet: any; dept: string }>;
  DEPT_AZ: Record<string, number>;
  getBbRows: (k: string) => any[];
  zoomToApproval: (k: string) => void;
  zoomToDept: (k: string) => void;
  openAgent: (id: string, tab?: string) => void;
  getTasks: () => any;
  getBrain: () => any;
  getDarkOn: () => boolean;
  refreshMcp: () => Promise<void>;
  esc: (s: string) => string;
}

export function createOfficeScene(options: OfficeSceneOptions) {
  const {
    scene, hud, R, deptRT, clickTargets, personTargets, screenSets, DEPT_AZ,
    getBbRows, zoomToApproval, zoomToDept, openAgent, getTasks, getBrain, getDarkOn, refreshMcp, esc
  } = options;

  const DARK = { plinth: 0x2c2d2b, walkway: 0x303230, ground: 0x1b1c1a };
  function mix(hex: any, base: any, k: number) {
    const a = new THREE.Color(hex), b = new THREE.Color(base);
    return b.lerp(a, k);
  }

  function buildDeptBadge(k: string) {
    if (!deptRT[k] || deptRT[k].badge) return;
    const dept = DEPTS[k] || { chip: '#8FD3F4', short: k.toUpperCase(), name: k };
    const rows = getBbRows(k);
    const n = AGENTS.filter(a => a.dept === k).length;
    const b = document.createElement('div');
    b.className = 'badge';
    b.dataset.dept = k;
    const brain = getBrain();
    const tasks = getTasks();

    b.innerHTML = `
      <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.short}<span class="live"></span></div>
      <div class="b-count">${k === 'brain' ? '<span class="b-num">∞</span><span class="b-lab">KNOWLEDGE</span>' : `<span class="b-num">${n}</span><span class="b-lab">AGENTS</span>`}</div>
      <div class="b-metrics">${rows.map((row, i) => `
        <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
      </div>
      <div class="b-appr" style="display:none">⚠ <span class="ap-n">1</span> WAITING APPROVAL</div>`;

    b.addEventListener('click', (e: any) => {
      if (e.target.closest('.b-appr')) {
        zoomToApproval(k);
        e.stopPropagation();
      } else if (e.target.closest('.b-tasks') && tasks) {
        tasks.openFor(k);
        e.stopPropagation();
      } else {
        zoomToDept(k);
      }
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

  function buildDeptPod(key_: string) {
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
          plinth.traverse((o: any) => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
          plinth.children[0].userData.part = 'plinth';
          plinth.children[1].userData.part = 'floor';
          plinth.children[1].userData.chip = DEPTS[key_].chip;
        }
      }
      return deptRT[key_];
    }
    const dim = getDeptDimensions(key_);
    const L = LAYOUT[key_];
    if (!L) return null;
    L.w = dim.w; L.d = dim.d;
    const dept = DEPTS[key_] || { floor: '#FEF3C7', chip: '#F59E0B' };
    const g = new THREE.Group();
    g.position.set(L.pos[0], 0, L.pos[1]);
    const plinth = makePlinth(L.w, L.d, dept.floor);
    g.add(plinth);
    plinth.traverse((o: any) => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
    plinth.children[0].userData.part = 'plinth';
    plinth.children[1].userData.part = 'floor';
    plinth.children[1].userData.chip = dept.chip;

    scene.add(g);
    deptRT[key_] = { group: g, L };

    if (key_ !== 'brain') {
      const sx = Math.sign(L.pos[0]) || 1, sz = Math.sign(L.pos[1]) || 1;
      const from: [number, number] = [L.pos[0] - sx * (L.w / 2 - 1), L.pos[1] - sz * (L.d / 2 - 1)];
      const to: [number, number] = [sx * 6.5, sz * 6.5];
      const walk = makeWalkway(from, to);
      walk.userData.dept = key_; walk.userData.part = 'walkway';
      scene.add(walk);
      deptRT[key_].walkway = walk;
      deptRT[key_].gate = new THREE.Vector3(from[0], 0, from[1]);
      deptRT[key_].brainGate = new THREE.Vector3(to[0], 0, to[1]);

      const plant = makePlant();
      plant.position.set(L.pos[0] + sx * (L.w / 2 - 1.6), 0.12, L.pos[1] + sz * (L.d / 2 - 1.6));
      plant.traverse((o: any) => { if (o.isMesh) o.userData.dept = key_; });
      scene.add(plant);
      deptRT[key_].plant = plant;

      DEPT_AZ[key_] = Math.atan2(L.pos[1], L.pos[0]);
    }

    buildDeptBadge(key_);

    if (getDarkOn()) {
      g.traverse((o: any) => {
        if (!o.isMesh || !o.userData.part) return;
        const m = o.material;
        if (!m.userData.base) m.userData.base = m.color.clone();
        if (o.userData.part === 'plinth') m.color.set(DARK.plinth);
        else if (o.userData.part === 'floor') m.color.copy(mix(o.userData.chip, '#1b1c1a', key_ === 'brain' ? 0.07 : 0.22));
      });
    }

    return deptRT[key_];
  }

  function buildAgent3D(a: any) {
    if (R[a.id]) return;
    if (!DEPT_KEYS.includes(a.dept) && a.dept !== 'brain') return;
    const dRT = deptRT[a.dept];
    if (!dRT) return;
    const dept = DEPTS[a.dept] || { chip: '#8FD3F4' };
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
    station.traverse((o: any) => { if (o.isMesh) o.userData.dept = a.dept; });
    scene.add(station);

    const person = makePerson({ hair: a.hair || '#1f1f1f', skin: a.skin || '#F0C9A0', chip: dept.chip, lead: a.lead });
    person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
    person.rotation.y = ANG + Math.PI;
    person.traverse((o: any) => { if (o.isMesh) { o.userData.agentId = a.id; o.userData.dept = a.dept; personTargets.push(o); } });
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
            plinth.traverse((o: any) => { if (o.isMesh) { o.userData.dept = k; clickTargets.push(o); } });
            plinth.children[0].userData.part = 'plinth';
            plinth.children[1].userData.part = 'floor';
            plinth.children[1].userData.chip = DEPTS[k].chip;
          }
        }
        dRT.L = L;

        if (k !== 'brain') {
          if (dRT.walkway) scene.remove(dRT.walkway);
          if (dRT.plant) scene.remove(dRT.plant);

          const sx = Math.sign(pos[0]) || 1, sz = Math.sign(pos[1]) || 1;
          const from: [number, number] = [pos[0] - sx * (L.w / 2 - 1), pos[1] - sz * (L.d / 2 - 1)];
          const to: [number, number] = [sx * 6.5, sz * 6.5];
          const walk = makeWalkway(from, to);
          walk.userData.dept = k; walk.userData.part = 'walkway';
          scene.add(walk);
          dRT.walkway = walk;

          const plant = makePlant();
          plant.position.set(pos[0] + sx * (L.w / 2 - 1.6), 0.12, pos[1] + sz * (L.d / 2 - 1.6));
          plant.traverse((o: any) => { if (o.isMesh) o.userData.dept = k; });
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

  function removeAgent3D(id: string) {
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

  function removeDeptPod(key_: string) {
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
    for (const k of Object.keys(deptRT)) {
      if (k !== 'brain' && !activeKeys.has(k)) {
        removeDeptPod(k);
      }
    }

    const activeAgentIds = new Set(AGENTS.filter(a => activeKeys.has(a.dept)).map(a => a.id));
    for (const id of Object.keys(R)) {
      const r = R[id];
      if (!activeAgentIds.has(id) || !activeKeys.has(r.a?.dept)) {
        removeAgent3D(id);
      }
    }

    realignAllDepts();

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

    for (const a of AGENTS) {
      if (activeKeys.has(a.dept) && !R[a.id]) {
        buildAgent3D(a);
      }
    }
    realignAllDepts();
  }

  function applyRoster(agents: any[], chatHist: Record<string, any[]>, modalOpen: string | null, modalTab: string, openAgentRail: any) {
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
      if (modalOpen === a.id && openAgentRail) openAgentRail(a.id, modalTab, false);
    }
    const tasks = getTasks();
    if (tasks && tasks.syncPills) tasks.syncPills();
  }

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

      const tasks = getTasks();
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

  return {
    buildDeptBadge,
    buildDeptPod,
    buildAgent3D,
    realignAllDepts,
    removeAgent3D,
    removeDeptPod,
    refresh3D,
    applyRoster,
    syncInitialStateFromApi
  };
}
