import * as THREE from 'three';
import { DEPTS, AGENTS, LAYOUT } from '../data.ts';
import { STATS, KPIS } from '../v1data.ts';

const kv = (id: string) => KPIS.find(k => k.id === id)?.val ?? 0;

export const BB_ROWS: Record<string, Array<[string, () => any]>> = {
  emails: [
    ['EMAILS SENT', () => STATS.emailsSent],
    ['REPLIES DRAFTED', () => STATS.drafts]
  ],
  delivery: [
    ['REPORTS SENT', () => STATS.reports],
    ['ON TRACK', () => STATS.onTrack + ' / ' + STATS.projects]
  ],
  sales: [
    ['CALLS S·A·J', () => STATS.spencer + '·' + STATS.arwin + '·' + STATS.jack],
    ['NEW MANAGERS', () => STATS.managers],
    ['AUTO-ONBOARDED', () => STATS.autoOnb]
  ],
  marketing: [
    ['NEW INSIGHTS', () => STATS.insMkt],
    ['COST PER USER', () => '$' + Math.round(STATS.cpa)]
  ],
  ops: [
    ['PROPOSALS MADE', () => Math.round(kv('proposals'))],
    ['NEW INSIGHTS', () => STATS.insOps]
  ],
  fin: [
    ['INVOICES ISSUED', () => Math.round(kv('invoices'))],
    ['BILLS PAID', () => STATS.billsPaid]
  ],
  brain: [
    ['NOTES INDEXED', () => (window as any).brainInstance ? (window as any).brainInstance.state.notes.toLocaleString('en-NZ') : '0']
  ]
};

export function getBbRows(k: string, doneCount?: Record<string, number>) {
  if (BB_ROWS[k]) return BB_ROWS[k];
  return [
    ['ACTIVE AGENTS', () => AGENTS.filter(a => a.dept === k).length],
    ['TASKS DONE', () => (doneCount && doneCount[k]) || 0]
  ];
}

export function buildDeptBadge(
  k: string,
  options: {
    deptRT: Record<string, any>;
    hud: HTMLElement;
    brain: any;
    tasks: any;
    zoomToDept: (k: string) => void;
    zoomToApproval: (k: string) => void;
    doneCount?: Record<string, number>;
  }
) {
  const { deptRT, hud, brain, tasks, zoomToDept, zoomToApproval, doneCount } = options;
  if (!deptRT[k] || deptRT[k].badge) return;
  const dept = DEPTS[k] || { name: k.toUpperCase(), short: k.toUpperCase(), chip: '#8FD3F4' };
  const rows = getBbRows(k, doneCount);
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
  
  b.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.b-appr')) { zoomToApproval(k); e.stopPropagation(); }
    else if (target.closest('.b-tasks') && tasks) { tasks.openFor(k); e.stopPropagation(); }
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
