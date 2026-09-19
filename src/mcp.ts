// CONNECTORS — per-department dock of MCP brand-logo tiles (AJ's spec, 2 Aug 2026, rev 2).
// v1 was an orbit ring; AJ: "uncoordinated and hard to notice". Now each dept has ONE fixed
// "CONNECTORS" group — a tidy camera-facing row of tiles — with constant back-and-forth
// packet traffic between tiles and desks so the connectors visibly help the agents work.
// Real sim events fire a strong pulse + tile→desk beam + return ack; ambient exchanges keep
// steady energy between events. Full brand colour · LOD small-out/full-in · click = tooltip.
//
// V3.1 (7 Sep 2026): the list is REAL when served — `connectors` (src/connectors.js) carries the
// MCP servers the user's Claude Code is connected to, their status, which pods they feed, and
// the roster's tool preferences; onToolsUsed() lights the wire an agent actually pulled on.
// Opened as a file (no server) the demo list below still plays.
import * as THREE from 'three';
import { MCP_LOGOS, MCP_BY_DEPT } from './mcplogos.ts';
import { DEPT_KEYS as DEFAULT_DEPT_KEYS } from './data.ts';

// agent → tools they'd plausibly be driving (falls back to any connector in the dept's dock)
export const AGENT_MCP = {
  // marketing
  mlead: ['meta', 'clarity', 'notion'], ada: ['meta', 'clarity'], newt: ['beehiiv', 'loops'], gfx: ['canva'], iggy: ['canva', 'clarity'], riley: ['meta', 'beehiiv', 'clarity', 'notion'],
  vid: ['hyperframes', 'canva'],
  // emails
  elead: ['gmail', 'notion'], cmail: ['gmail'], imail: ['gmail', 'notion'], vmail: ['gmail'], kmail: ['gmail'],
  // sales
  enzo: ['fullenrich'], lexi: ['notion', 'gmail'], ilm: ['gmail', 'imessage', 'fullenrich'], pros: ['apollo', 'gmail'],
  piper: ['notion', 'gmail'], folo: ['gmail', 'imessage'],
  // operations
  olead: ['notion', 'gmail', 'pandadoc'], scout: ['notion'], legal: ['pandadoc', 'gmail'], comply: ['notion', 'gmail'], report: ['gmail', 'notion'], dash: ['notion'],
  // finance
  alead: ['xero', 'gmail'],
  invo: ['xero', 'stripe'], apay: ['xero'], recon: ['stripe', 'xero'],
  // delivery
  dlead: ['notion', 'gmail'], pco: ['notion'], qa: ['notion'], crep: ['pandadoc', 'notion'], cass: ['canva', 'notion'],
  dasst: ['canva'], ona: ['gmail', 'notion'],
};

// screen axes in world space (iso azimuth 45°): SR = screen-right, FRONT = toward camera
const SR = new THREE.Vector3(1, 0, -1).normalize();
const FRONT = new THREE.Vector3(1, 0, 1).normalize();

// per-dept dock anchor: direction * distance from pod centre, picked to dodge billboards,
// the Brain constellation and each dept's focus rail. Verified by screenshot, not theory.
// fdir/fdist/fh (optional) = a SECOND anchor used while that dept is focused, lerped in by
// focusDim — the marketing focus look (row floating in the empty gap beside the pod, labels
// under, pill above) is AJ's approved reference; support/sales re-anchor to match it.
const DOCKS: Record<string, any> = {
  marketing:   { dir: SR.clone().negate(), dist: 12.5, h: 8.0 },  // screen-left of pod — the approved reference look
  emails:      { dir: SR.clone(),          dist: 12.5, h: 8.0,    // overview: screen-right of pod (was support's slot)
               fdir: SR.clone().negate(), fdist: 12.5 },        // focus: mirror marketing (rail LEFT, empty gap left of pod)
  delivery:    { dir: SR.clone().negate(), dist: 12.5, h: 8.0 },  // rail LEFT like marketing → dock in the gap beside the pod
  sales:       { dir: FRONT.clone(),       dist: 17.5, h: 8.0,    // overview: front row below the pod (old right-edge stack clipped off-screen)
               fdir: SR.clone().negate(), fdist: 13.5 },        // focus: marketing-style row in the open floor (rail is RIGHT)
  fin:         { dir: FRONT.clone(), dist: 20.5, h: 8.0 },        // front-bottom past the corner; camera-facing
  ops:         { dir: SR.clone().negate(), dist: 13.5, h: 8.0,    // bottom-left pod: dock in the open floor to its screen-left
               fdir: SR.clone().negate(), fdist: 13.5 },
  design:      { dir: SR.clone().negate(), dist: 13.5, h: 8.0 },
  dev:         { dir: SR.clone(), dist: 13.5, h: 8.0 },
  devops:      { dir: SR.clone(), dist: 13.5, h: 8.0 },
  sec:         { dir: FRONT.clone(), dist: 16.5, h: 8.0 },
  growth:      { dir: SR.clone().negate(), dist: 12.5, h: 8.0 },
  creative:    { dir: SR.clone().negate(), dist: 12.5, h: 8.0 },
  intel:       { dir: FRONT.clone(), dist: 16.5, h: 8.0 },
  exec:        { dir: SR.clone(), dist: 12.5, h: 8.0 },
  foundations: { dir: FRONT.clone(), dist: 15.5, h: 8.0 },
  nurture:     { dir: SR.clone().negate(), dist: 12.5, h: 8.0 },
  launch:      { dir: SR.clone(), dist: 12.5, h: 8.0 },
  partnerships:{ dir: FRONT.clone(), dist: 15.5, h: 8.0 },
  scale:       { dir: SR.clone().negate(), dist: 12.5, h: 8.0 },
  support:     { dir: SR.clone(), dist: 12.5, h: 8.0 },
  legal_fin:   { dir: FRONT.clone(), dist: 18.5, h: 8.0 },
};

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export function initMcp({ scene, hud, LAYOUT, DEPTS, DEPT_KEYS, FR, R, connectors = null }: any) {
  const ACTIVE_DEPTS = (DEPT_KEYS && DEPT_KEYS.length) ? DEPT_KEYS : DEFAULT_DEPT_KEYS;
  const LIVE = !!(connectors && connectors.live);
  const BY_DEPT = LIVE ? connectors.byDept : MCP_BY_DEPT;
  const LOGOS = LIVE ? { ...MCP_LOGOS, ...connectors.logos } : MCP_LOGOS;
  const AGENT_TOOLS = (LIVE && connectors.agentTools) || AGENT_MCP;
  const STATUS = (LIVE && connectors.status) || {};
  const NAMES = (LIVE && connectors.names) || {};

  // Clean up any existing MCP 3D objects in scene to prevent lingering meshes
  if (scene) {
    const toRemove: THREE.Object3D[] = [];
    scene.traverse((o: any) => {
      if (o.userData && (o.userData.mcpKey || o.userData.isMcpGlow || o.userData.isMcp)) {
        toRemove.push(o);
      }
    });
    toRemove.forEach(o => {
      scene.remove(o);
      if ((o as any).geometry) (o as any).geometry.dispose();
      if ((o as any).material) {
        if (Array.isArray((o as any).material)) (o as any).material.forEach((m: any) => m.dispose());
        else (o as any).material.dispose();
      }
    });
  }

  const loader = new THREE.TextureLoader();
  const items = [];          // every connector tile
  const byDeptKey = {};      // `${dept}:${key}` -> item
  const byDept = {};         // dept -> items
  const sprites = [];        // raycast targets
  const beams = [];          // travelling data packets
  const dotTex = {};         // per-colour packet textures
  const docks = {};          // dept -> runtime (label el, seats, ambient timer)
  const v3 = new THREE.Vector3();

  function glowTexture(hex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, hex + 'ff'); g.addColorStop(0.45, hex + '88'); g.addColorStop(1, hex + '00');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function dotTexture(hex) {
    if (!dotTex[hex]) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.beginPath(); x.arc(32, 32, 18, 0, 7); x.fillStyle = hex; x.fill();
      x.lineWidth = 4; x.strokeStyle = 'rgba(21,20,20,0.55)'; x.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      dotTex[hex] = t;
    }
    return dotTex[hex];
  }

  for (const [dept, keys] of Object.entries(BY_DEPT || {})) {
    if (!ACTIVE_DEPTS.includes(dept)) continue;
    const L = LAYOUT[dept];
    if (!L) continue;
    const D = DOCKS[dept] || { dir: SR.clone().negate(), dist: 12.5, h: 8.0 };
    const glowT = glowTexture((DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4');
    const anchor = new THREE.Vector3(
      L.pos[0] + D.dir.x * D.dist, D.h, L.pos[1] + D.dir.z * D.dist);
    byDept[dept] = [];
    if (Array.isArray(keys)) {
      keys.forEach((key, i) => {
        const def = LOGOS[key];
        if (!def) return;
        const tex = loader.load(def.img);
        tex.colorSpace = THREE.SRGBColorSpace;
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowT, transparent: true, opacity: 0, depthTest: false }));
        glow.renderOrder = 48;
        glow.userData.dept = dept;
        glow.userData.isMcpGlow = true;
        scene.add(glow);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        s.renderOrder = 50;
        s.userData.dept = dept;       // joins the focus-dim pass
        s.userData.mcpKey = key;
        s.userData.isMcp = true;
        scene.add(s);
        sprites.push(s);

        const label = document.createElement('div');
        label.className = 'mcpl';
        label.textContent = def.name.toUpperCase();
        hud.appendChild(label);

        const item = {
          dept, key, name: def.name, sprite: s, glow, label,
          anchor, i, n: keys.length,
          bobPhase: i * 0.9 + Math.random() * 0.4,
          pulseT0: -1e9, pulseAmp: 0.3,
          lastActive: performance.now() - Math.random() * 9000,
        };
        items.push(item);
        byDept[dept].push(item);
        byDeptKey[dept + ':' + key] = item;
      });
    }

    // the group label — this is what names the dock "CONNECTORS" at every zoom
    const conn = document.createElement('div');
    conn.className = 'connl';
    conn.innerHTML = `<span class="dot" style="background:${(DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4'}"></span>CONNECTORS`;
    hud.appendChild(conn);
    docks[dept] = {
      anchor, conn,
      seats: Object.values(R).filter(r => r.a.dept === dept).map(r => r.seat),
      nextAmbient: performance.now() + 600 + Math.random() * 1400,
    };
  }

  // ── top-bar connector strip — the overview face of the connectors ──
  // The overview is the demo's first frame: familiar brand logos ARE the header (they
  // replaced the agent-count tags), and data visibly beams from each logo down into its
  // department(s). The 3D docks beside the pods only exist zoomed IN (dockA fade below);
  // at overview all connector traffic originates from the top bar instead.
  // SHARED connectors (gmail: five depts; notion: every dept, V3.1) sit at the far RIGHT end
  // of the strip and each runs its OWN loom (below) instead of joining any dept's cluster/fan
  const SHARED = LIVE ? (connectors.shared || { notion: '#151414', gmail: '#EA4335' }) : { notion: '#151414', gmail: '#EA4335' };
  const uniqKeys = [...new Set(Object.values(BY_DEPT || {}).filter(Array.isArray).flat())].filter(k => k && LOGOS[k] && !SHARED[k]);
  for (const k of ((LIVE && connectors.off) || [])) if (k && !uniqKeys.includes(k)) uniqKeys.push(k); // present but unusable: shown grey, never wired
  for (const k of Object.keys(SHARED)) if (k) uniqKeys.push(k);
  const topconn = document.getElementById('topconn');
  const topImgs = {};
  if (topconn) {
    topconn.innerHTML = `<span class="tc-lab"><span class="dot"></span>CONNECTED TO</span>`;
    uniqKeys.forEach((k, i) => {
      if (!LOGOS[k]) return;
      const img = document.createElement('img');
      img.src = LOGOS[k].img;
      img.alt = img.title = LOGOS[k].name;
      if (STATUS[k] && STATUS[k] !== 'connected') { // real list: a server that is there but not usable
        img.classList.add('off', 'st-' + STATUS[k]);
        img.title = LOGOS[k].name + ' — ' + ({ 'needs-auth': 'needs authentication (run claude, then /mcp)', failed: 'failed to connect', pending: 'connecting…', denied: 'connected · blocked for agents in office.config.json' }[STATUS[k]] || STATUS[k]);
      }
      img.style.setProperty('--d', (0.15 + i * 0.09) + 's'); // staggered pop-in on load
      img.addEventListener('animationend', (e) => { if (e.animationName === 'tcin') img.classList.add('in'); });
      img.addEventListener('click', () => fireConnector(k)); // presenter cue: click a logo → its dept(s) light up
      topconn.appendChild(img);
      topImgs[k] = img;
    });
    if (LIVE && !uniqKeys.length) { // honest empty state — nothing is wired until the user connects something
      const none = document.createElement('span');
      none.className = 'tc-none';
      none.textContent = 'nothing yet — connect in claude.ai or run: claude mcp add';
      topconn.appendChild(none);
    }
  }

  // cam + dockAcur are set every tick. At overview (dockAcur low) all connector traffic
  // rides the PERMANENT WIRES below — nothing free-flies (free packets from the top bar
  // read as "drones attacking the pods", AJ). Zoomed in, tile→desk beams as before.
  // volleyAt schedules the boot/replay flourish: a pulse from every connector into its dept(s).
  let cam = null, dockAcur = 0;
  let volleyAt = performance.now() + uniqKeys.length * 90 + 900;

  // ── permanent wiring loom (overview mode) ──
  // One fixed conduit per dept: leaves the top bar under that dept's logo cluster, bows out
  // toward the screen side and enters the pod at a floor-level corner port — cable tray, not
  // flight path (entering from the sky is what made it look like an airstrike). The dash
  // pattern crawls toward the pod for constant "data flowing" life; real events send a
  // brighter pulse dot along the wire (reverse = desk→tool ack rides back up).
  const existingSvg = document.getElementById('wires');
  if (existingSvg) existingSvg.remove();
  if (hud) hud.querySelectorAll('.mcpl, .connl').forEach(el => el.remove());

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = 'wires';
  hud.insertBefore(svg, hud.firstChild); // under every HUD overlay, above the 3D canvas
  const PORT_CORNER: Record<string, [number, number]> = {
    marketing: [-1, 1], emails: [-1, -1], sales: [1, -1], ops: [1, -1],
    fin: [1, -1], delivery: [-1, -1], exec: [1, -1], foundations: [1, 1],
    nurture: [-1, 1], launch: [-1, -1], partnerships: [1, -1], scale: [1, 1],
    design: [-1, 1], dev: [1, -1], devops: [1, -1], sec: [1, -1], growth: [-1, 1],
    creative: [-1, 1], intel: [1, 1], support: [-1, -1], legal_fin: [1, -1]
  };
  const wires: Record<string, any> = {}, wirePulses: any[] = [];
  Object.keys(BY_DEPT || {}).forEach((dept, ji) => {
    if (!ACTIVE_DEPTS.includes(dept)) return;
    const L = LAYOUT[dept];
    if (!L) return;
    const [cx, cz] = PORT_CORNER[dept] || [-1, 1];
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', (DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-dasharray', '3 8');
    svg.appendChild(path);
    // branch fan: a thin drop from EACH of this dept's logos, converging at a junction
    // node under the bar — makes "which tools feed this dept" readable at a glance
    const branch = document.createElementNS(svgNS, 'path');
    branch.setAttribute('fill', 'none');
    branch.setAttribute('stroke', (DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4');
    branch.setAttribute('stroke-width', '1.3');
    branch.setAttribute('stroke-linecap', 'round');
    branch.setAttribute('stroke-dasharray', '2 5');
    svg.appendChild(branch);
    const jdot = document.createElementNS(svgNS, 'circle'); // junction node
    jdot.setAttribute('r', '1.9');
    jdot.setAttribute('fill', (DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4');
    svg.appendChild(jdot);
    const dot = document.createElementNS(svgNS, 'circle'); // the pod-side socket
    dot.setAttribute('r', '2.6');
    dot.setAttribute('fill', (DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4');
    svg.appendChild(dot);
    wires[dept] = { path, branch, jdot, dot, offset: 0, ji,
      port: [L.pos[0] + cx * L.w / 2, 1.3, L.pos[1] + cz * L.d / 2],
      fport: [L.pos[0] - L.w / 2, 1.3, L.pos[1] - L.d / 2] }; // V3.5 focus: the back corner
  });
  // SHARED wiring (gmail per AJ 3 Aug rev 2; notion joins 5 Sep): NOT part of any dept fan/loom —
  // from its far-right logo each shared connector drops to its own junction, then runs one fully
  // INDEPENDENT trunk-style conduit per using dept, entering the pod at its own socket a few
  // units along the edge from the dept's port (cables plugged in side by side, never merged).
  // Traffic keyed to a shared connector pulses on ITS wire, not the dept trunk.
  const shared: Record<string, any> = {};
  Object.keys(SHARED).forEach((key, si) => {
    const ink = SHARED[key];
    const drop = document.createElementNS(svgNS, 'path'); // logo → junction
    drop.setAttribute('fill', 'none');
    drop.setAttribute('stroke', ink);
    drop.setAttribute('stroke-width', '1.3');
    drop.setAttribute('stroke-linecap', 'round');
    drop.setAttribute('stroke-dasharray', '2 5');
    svg.appendChild(drop);
    const jdot = document.createElementNS(svgNS, 'circle');
    jdot.setAttribute('r', '1.9');
    jdot.setAttribute('fill', ink);
    svg.appendChild(jdot);
    const wiresOf: Record<string, any> = {};
    Object.keys(BY_DEPT || {}).filter(d => Array.isArray(BY_DEPT[d]) && BY_DEPT[d].includes(key) && ACTIVE_DEPTS.includes(d)).forEach(dept => {
      const L = LAYOUT[dept];
      if (!L) return;
      const [cx, cz] = PORT_CORNER[dept] || [-1, 1];
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', ink);
      path.setAttribute('stroke-width', '1.4');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-dasharray', '3 8');
      svg.appendChild(path);
      const dot = document.createElementNS(svgNS, 'circle'); // its own socket at the pod
      dot.setAttribute('r', '2.3');
      dot.setAttribute('fill', ink);
      svg.appendChild(dot);
      // socket sits 4 (gmail) / 8 (notion) world units along the pod edge from the dept port
      wiresOf[dept] = { path, dot,
        port: [L.pos[0] + cx * L.w / 2 - cx * 4 * (si + 1), 1.3, L.pos[1] + cz * L.d / 2],
        fport: [L.pos[0] - L.w / 2 + 4 * (si + 1), 1.3, L.pos[1] - L.d / 2] };
    });
    shared[key] = { ink, drop, jdot, wires: wiresOf, offset: 0, jy: 92 + si * 10 };
  });

  // ── the MODEL layer: Antigravity runs the office headless ──
  // The Antigravity logo on the right of the top bar is wired straight into the Brain pod — the
  // conduits pulse on their own so the thinking is visible even when nothing else fires.
  const MODELS: Record<string, string> = { antigravity: '#7C3AED' };
  const topmodels = document.getElementById('topmodels');
  const modelImgs: Record<string, HTMLImageElement> = {};
  if (topmodels) {
    topmodels.innerHTML = `<span class="tc-lab"><span class="dot"></span>RUNS HEADLESS ON</span>`;
    Object.keys(MODELS).forEach((k, i) => {
      const img = document.createElement('img');
      img.src = LOGOS[k]?.img || MCP_LOGOS[k]?.img || '';
      img.alt = img.title = (LOGOS[k]?.name || 'Antigravity') + ' — headless';
      img.style.setProperty('--d', (0.9 + i * 0.12) + 's');
      img.addEventListener('animationend', (e) => { if (e.animationName === 'tcin') img.classList.add('in'); });
      img.addEventListener('click', () => modelPulse(k, true));
      topmodels.appendChild(img);
      modelImgs[k] = img;
    });
  }
  const mwires: Record<string, any> = {};
  Object.keys(MODELS).forEach((k, i) => {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', MODELS[k]);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-dasharray', '3 8');
    svg.appendChild(path);
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('r', '2.6');
    dot.setAttribute('fill', MODELS[k]);
    svg.appendChild(dot);
    // sockets on the Brain pod's back edge, side by side
    mwires[k] = { path, dot, port: [LAYOUT.brain.w / 2 - 2 - i * 4, 1.3, -LAYOUT.brain.d / 2] };
  });
  let nextModelPulse = performance.now() + 2600;
  // Antigravity rolling usage gauge beside the logo — session tokens and runs
  let usageEl: HTMLElement | null = null;
  function setUsage(u: any) {
    if (!topmodels) return;
    if (!usageEl) { usageEl = document.createElement('span'); usageEl.className = 'tm-usage'; topmodels.appendChild(usageEl); }
    const when = (ts: any) => ts ? new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
    const bar = (lab: string, x: any) => { if (!x) return ''; const cls = x.percent >= 90 ? 'c' : x.percent >= 75 ? 'w' : ''; return `<span>${lab}</span><span class="ub"><i class="${cls}" style="width:${x.percent}%"></i></span><b>${x.percent >= 100 ? 'LIMIT' : x.percent + '%'}</b>`; };
    if (u && u.ok && u.source === 'claude') {
      usageEl.className = 'tm-usage';
      usageEl.innerHTML = bar('SESSION', u.session) + (u.session && u.week ? '<span class="sep">·</span>' : '') + bar('WEEK', u.week);
      usageEl.title = `Your Claude plan, as Claude Code shows it. Session resets ${when(u.session && u.session.resetsAt)} · week resets ${when(u.week && u.week.resetsAt)}.`;
    } else if (u && u.ok && (u.source === 'office' || u.source === 'antigravity')) {
      const w = u.window || {}; const n = w.tokens || 0; const tok = n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
      usageEl.className = 'tm-usage off';
      usageEl.innerHTML = `<span>THIS WINDOW</span><b>${tok}</b><span>TOKENS</span><span class="sep">·</span><b>${w.runs || 0}</b><span>RUNS</span>` + (w.resetsAt ? `<span class="sep">·</span><span>RESETS</span><b>${new Date(w.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>` : '');
      usageEl.title = `Antigravity Engine live consumption. This is the office's token count for the current five-hour window.`;
    } else { usageEl.className = 'tm-usage off'; usageEl.innerHTML = '<span>USAGE UNAVAILABLE</span>'; usageEl.title = (u && u.reason) || ''; }
  }
  function modelPulse(k: string, strong = false) {
    if (!modelImgs[k]) return;
    wirePulse('brain', { model: k, scale: strong ? 1.2 : 0.9 });
    wirePulse('brain', { model: k, reverse: true, delay: 900, scale: strong ? 1 : 0.75 });
    if (modelImgs[k] && strong) { modelImgs[k].classList.remove('tpulse'); void modelImgs[k].offsetWidth; modelImgs[k].classList.add('tpulse'); }
  }

  // subtle by design (rev 2, AJ: pulses still read as attacks): small, dim, slow glides
  function wirePulse(dept, { reverse = false, delay = 0, scale = 1, shared: sk = null, model = null } = {}) {
    const el = document.createElementNS(svgNS, 'circle');
    el.setAttribute('r', 2.2 * scale);
    el.setAttribute('fill', model ? MODELS[model] : sk ? SHARED[sk] : ((DEPTS[dept] && DEPTS[dept].chip) || '#8FD3F4'));
    el.setAttribute('opacity', '0');
    svg.appendChild(el);
    wirePulses.push({ dept, el, reverse, shared: sk, model, t0: performance.now() + delay, dur: 1400 });
  }
  let stripDept = undefined;
  function tickWires(now, dt, wireA, focused) {
    // V3.4 (AJ): inside a department the header strip shows THAT dept's connectors (the others
    // hide); the wiring loom still fades out. At overview every logo shows and the loom is back.
    const f = (focused && focused !== 'brain') ? focused : null;
    if (topconn) {
      if (f) {
        topconn.style.opacity = 1; topconn.style.visibility = 'visible';
        if (stripDept !== f) { // centre the strip and name the department it feeds
          for (const [k, img] of Object.entries(topImgs)) img.style.display = (BY_DEPT[f] && Array.isArray(BY_DEPT[f]) && BY_DEPT[f].includes(k)) ? '' : 'none';
          topconn.classList.add('focus');
          const chipColor = (DEPTS[f] && DEPTS[f].chip) || '#8FD3F4';
          const deptShort = (DEPTS[f] && DEPTS[f].short) || f;
          topconn.querySelector('.tc-lab').innerHTML =
            `<span class="dot" style="background:${chipColor}"></span>${deptShort} · CONNECTED TO`;
        }
      } else {
        topconn.style.opacity = wireA;
        topconn.style.visibility = wireA < 0.02 ? 'hidden' : 'visible';
        if (stripDept !== null) {
          for (const img of Object.values(topImgs)) img.style.display = '';
          topconn.classList.remove('focus');
          topconn.querySelector('.tc-lab').innerHTML = `<span class="dot"></span>CONNECTED TO`;
        }
      }
      stripDept = f;
    }
    if (topmodels) {
      topmodels.style.opacity = f ? 1 : wireA;
      topmodels.style.visibility = (!f && wireA < 0.02) ? 'hidden' : 'visible';
    }
    if (wireA < 0.02) { svg.style.display = 'none'; return; }
    svg.style.display = 'block';
    const hideWire = (w: any) => { w.path.setAttribute('d', ''); w.branch && w.branch.setAttribute('d', ''); w.jdot && w.jdot.setAttribute('opacity', 0); w.dot.setAttribute('opacity', 0); w.curve = null; };

    const getMidX = (el: HTMLElement | null) => {
      if (!el) return 0;
      if (!(el as any)._cachedMidX) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) (el as any)._cachedMidX = (r.left + r.right) / 2;
      }
      return (el as any)._cachedMidX || (innerWidth * 0.5);
    };

    const isWireGeomDirty = !cam || (cam as any)._wireDirty ||
      Math.abs(cam.position.x - ((cam as any)._lastWX || 0)) > 0.01 ||
      Math.abs(cam.position.y - ((cam as any)._lastWY || 0)) > 0.01 ||
      Math.abs(cam.position.z - ((cam as any)._lastWZ || 0)) > 0.01 ||
      (cam as any)._lastWF !== f ||
      (cam as any)._lastWW !== innerWidth ||
      (cam as any)._lastWH !== innerHeight;

    if (isWireGeomDirty && cam) {
      (cam as any)._lastWX = cam.position.x;
      (cam as any)._lastWY = cam.position.y;
      (cam as any)._lastWZ = cam.position.z;
      (cam as any)._lastWF = f;
      (cam as any)._lastWW = innerWidth;
      (cam as any)._lastWH = innerHeight;
      (cam as any)._wireDirty = false;
    }

    for (const [dept, w] of Object.entries(wires)) {
      if (f && dept !== f) { hideWire(w); continue; }
      if (isWireGeomDirty) {
        const xs = (BY_DEPT[dept] || []).filter(k => !SHARED[k] && topImgs[k]).map(k => getMidX(topImgs[k]));
        if (!xs.length) {
          hideWire(w);
          continue;
        }
        const jx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const jy = f ? 100 : 104 + w.ji * 12, sy = 50;
        w.branch.setAttribute('d', xs.map(x =>
          `M ${x} ${sy} C ${x} ${sy + (jy - sy) * 0.5}, ${jx} ${jy - (jy - sy) * 0.4}, ${jx} ${jy}`).join(' '));
        const pt = f ? w.fport : w.port;
        v3.set(pt[0], pt[1], pt[2]).project(cam);
        const ex = (v3.x * 0.5 + 0.5) * innerWidth, ey = (-v3.y * 0.5 + 0.5) * innerHeight;
        const side = ex < innerWidth * 0.5 ? -1 : 1;
        const bow = f ? 30 : Math.min(170, 40 + Math.abs(ex - jx) * 0.25);
        const cp1x = jx + side * bow * 0.35, cp1y = jy + (ey - jy) * 0.4;
        const cp2x = ex + side * bow, cp2y = ey - (ey - jy) * 0.45;
        w.path.setAttribute('d', `M ${jx} ${jy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`);
        w.curve = { x0: jx, y0: jy, x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x3: ex, y3: ey };
        w.jdot.setAttribute('cx', jx); w.jdot.setAttribute('cy', jy);
        w.dot.setAttribute('cx', ex); w.dot.setAttribute('cy', ey);
      }
      w.offset -= dt * (f ? 13 : 6);
      w.path.setAttribute('stroke-dashoffset', w.offset);
      w.path.setAttribute('stroke-opacity', (f ? 0.8 : 0.26) * wireA);
      w.path.setAttribute('stroke-width', f ? 2.2 : 1.6);
      w.branch.setAttribute('stroke-dashoffset', w.offset);
      w.branch.setAttribute('stroke-opacity', (f ? 0.85 : 0.3) * wireA);
      w.branch.setAttribute('stroke-width', f ? 1.8 : 1.3);
      w.jdot.setAttribute('opacity', (f ? 0.75 : 0.38) * wireA);
      w.dot.setAttribute('opacity', (f ? 0.85 : 0.45) * wireA);
    }

    for (const [key, sh] of Object.entries(shared)) {
      if (!topImgs[key]) continue;
      const gx = getMidX(topImgs[key]), gsy = 50, gjy = sh.jy;
      if (isWireGeomDirty) {
        sh.drop.setAttribute('d', `M ${gx} ${gsy} L ${gx} ${gjy}`);
        sh.jdot.setAttribute('cx', gx); sh.jdot.setAttribute('cy', gjy);
      }
      sh.offset -= dt * (f ? 13 : 6);
      sh.drop.setAttribute('stroke-dashoffset', sh.offset);
      sh.drop.setAttribute('stroke-opacity', (f ? 0.6 : 0.3) * wireA);
      sh.jdot.setAttribute('opacity', (f ? 0.75 : 0.38) * wireA);
      for (const [dept, g] of Object.entries(sh.wires)) {
        if (f && dept !== f) { hideWire(g); continue; }
        if (isWireGeomDirty) {
          const gp = f ? g.fport : g.port;
          v3.set(gp[0], gp[1], gp[2]).project(cam);
          const ex = (v3.x * 0.5 + 0.5) * innerWidth, ey = (-v3.y * 0.5 + 0.5) * innerHeight;
          const side = ex < innerWidth * 0.5 ? -1 : 1;
          const bow = Math.min(170, 40 + Math.abs(ex - gx) * 0.25);
          const cp1x = gx + side * bow * 0.35, cp1y = gjy + (ey - gjy) * 0.4;
          const cp2x = ex + side * bow, cp2y = ey - (ey - gjy) * 0.45;
          g.path.setAttribute('d', `M ${gx} ${gjy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`);
          g.curve = { x0: gx, y0: gjy, x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x3: ex, y3: ey };
          g.dot.setAttribute('cx', ex); g.dot.setAttribute('cy', ey);
        }
        g.path.setAttribute('stroke-dashoffset', sh.offset);
        g.path.setAttribute('stroke-opacity', (f ? 0.75 : key === 'notion' ? 0.16 : 0.26) * wireA);
        g.path.setAttribute('stroke-width', f ? 2 : 1.4);
        g.dot.setAttribute('opacity', (f ? 0.85 : 0.45) * wireA);
      }
    }

    for (const [k, m] of Object.entries(mwires)) {
      if (!modelImgs[k]) continue;
      const mx = getMidX(modelImgs[k]), msy = 50;
      if (isWireGeomDirty) {
        v3.set(m.port[0], m.port[1], m.port[2]).project(cam);
        const ex = (v3.x * 0.5 + 0.5) * innerWidth, ey = (-v3.y * 0.5 + 0.5) * innerHeight;
        const cp1x = mx, cp1y = msy + (ey - msy) * 0.45;
        const cp2x = ex + 40, cp2y = ey - (ey - msy) * 0.35;
        m.path.setAttribute('d', `M ${mx} ${msy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`);
        m.curve = { x0: mx, y0: msy, x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x3: ex, y3: ey };
        m.dot.setAttribute('cx', ex); m.dot.setAttribute('cy', ey);
      }
      m.offset = (m.offset || 0) - dt * (f ? 13 : 6);
      m.path.setAttribute('stroke-dashoffset', m.offset);
      m.path.setAttribute('stroke-opacity', (f ? 0.45 : 0.22) * wireA);
      m.dot.setAttribute('opacity', (f ? 0.85 : 0.45) * wireA);
    }
    if (now > nextModelPulse) {
      modelPulse('antigravity');
      nextModelPulse = now + 2400 + Math.random() * 3200;
    }

    function sampleBezier(p: any, t: number) {
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;
      return {
        x: uuu * p.x0 + 3 * uu * t * p.x1 + 3 * u * tt * p.x2 + ttt * p.x3,
        y: uuu * p.y0 + 3 * uu * t * p.y1 + 3 * u * tt * p.y2 + ttt * p.y3
      };
    }

    for (let i = wirePulses.length - 1; i >= 0; i--) {
      const p = wirePulses[i];
      const k = (now - p.t0) / p.dur;
      if (k < 0) continue;
      if (k >= 1) { p.el.remove(); wirePulses.splice(i, 1); continue; }
      const curve = p.model ? mwires[p.model]?.curve
        : (p.shared && shared[p.shared]?.wires[p.dept]) ? shared[p.shared].wires[p.dept]?.curve
        : wires[p.dept]?.curve;
      if (!curve) { p.el.remove(); wirePulses.splice(i, 1); continue; }
      const e = k * k * (3 - 2 * k);
      const pt = sampleBezier(curve, p.reverse ? 1 - e : e);
      p.el.setAttribute('cx', pt.x.toFixed(1));
      p.el.setAttribute('cy', pt.y.toFixed(1));
      p.el.setAttribute('opacity', ((k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1) * 0.55 * wireA).toFixed(2));
    }
  }

  function fireConnector(key) {
    const now = performance.now();
    for (const [dept, keys] of Object.entries(BY_DEPT)) {
      if (!keys.includes(key)) continue;
      const item = byDeptKey[dept + ':' + key];
      const seats = docks[dept] ? docks[dept].seats : [];
      if (!item || !seats || !seats.length) continue;
      pulse(item, now, 0.3);
      const seat = seats[Math.floor(Math.random() * seats.length)];
      spawnBeam(item, seat, now, { count: 3 });                                        // tool → desk
      spawnBeam(item, seat, now, { reverse: true, count: 2, delay: 650, scale: 0.8 }); // desk → tool ack
    }
  }

  // C hotkey / CC.connectorReveal(): re-pop the top-bar logos, then the beam volley
  function startReveal(now) {
    for (const img of Object.values(topImgs)) {
      img.classList.remove('in', 'tpulse');
      img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
    }
    volleyAt = now + uniqKeys.length * 90 + 600;
  }

  function pulse(item, now, amp = 0.3) {
    if (!item) return;
    item.pulseT0 = now;
    item.pulseAmp = amp;
    item.lastActive = now;
    // docks hidden (overview) → the top-bar logo carries the activity pulse instead
    if (dockAcur < 0.5 && item.key) {
      const img = topImgs[item.key];
      if (img && img.classList.contains('in')) {
        img.classList.remove('tpulse'); void img.offsetWidth; img.classList.add('tpulse');
      }
    }
  }

  // packet train along an arc. reverse=true sends desk → tile (the "ack"/request direction)
  // ephemeral connection line under an exchange — packets riding a visible wire read as
  // data transfer; the same dots free-flying read as projectiles ("attacking the pods", AJ)
  const streams = new Map(); // key -> {line, mat, dept, t0, until}
  function ensureStream(from, mid, to, dept, now, until) {
    const key = [from.x, from.z, to.x, to.z].map(v => v.toFixed(1)).join(':');
    const s = streams.get(key);
    if (s) { s.until = Math.max(s.until, until); return; }
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(from.clone().lerp(mid, t).lerp(mid.clone().lerp(to, t), t));
    }
    const mat = new THREE.LineBasicMaterial({
      color: DEPTS[dept].chip, transparent: true, opacity: 0, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.renderOrder = 45; // under the tiles (50) and packets (60)
    line.userData.dept = dept;
    scene.add(line);
    streams.set(key, { line, mat, dept, t0: now, until });
  }
  function tickStreams(now, focused, focusDim) {
    for (const [key, s] of streams) {
      const fadeIn = Math.min(1, (now - s.t0) / 250);
      const fadeOut = now > s.until ? Math.max(0, 1 - (now - s.until) / 350) : 1;
      const dimmed = focused && focused !== 'brain' && s.dept !== focused;
      s.mat.opacity = 0.34 * fadeIn * fadeOut * (dimmed ? 1 - 0.85 * focusDim : 1);
      if (fadeOut === 0) {
        scene.remove(s.line); s.line.geometry.dispose(); s.mat.dispose();
        streams.delete(key);
      }
    }
  }

  function spawnBeam(item, seatPos, now, { reverse = false, count = 4, delay = 0, scale = 1 } = {}) {
    if (!cam || !item || !item.dept || !seatPos) return;
    // overview: docks are hidden, so the exchange rides the dept's permanent wire instead
    // of free-flying packets — one pulse dot per train, direction preserved
    if (dockAcur < 0.5) { wirePulse(item.dept, { reverse, delay, scale, shared: item.key && SHARED[item.key] ? item.key : null }); return; }
    const tile = item.sprite ? item.sprite.position.clone() : new THREE.Vector3();
    const desk = seatPos.clone(); desk.y += 3.1;
    const from = reverse ? desk : tile, to = reverse ? tile : desk;
    const mid = from.clone().lerp(to, 0.5); mid.y = Math.max(from.y, to.y) + 2.4;
    const hex = DEPTS[item.dept].chip;
    ensureStream(from, mid, to, item.dept, now, now + delay + count * 105 + 720);
    for (let i = 0; i < count; i++) {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTexture(hex), transparent: true, depthTest: false, opacity: 0 }));
      d.renderOrder = 60;
      d.scale.set(0.9 * scale, 0.9 * scale, 1);
      scene.add(d);
      beams.push({ s: d, from, mid, to, t0: now + delay + i * 105, dur: 720 });
    }
  }

  function tickBeams(now) {
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      const k = (now - b.t0) / b.dur;
      if (k < 0) { b.s.material.opacity = 0; continue; }
      if (k >= 1) { scene.remove(b.s); b.s.material.dispose(); beams.splice(i, 1); continue; }
      const e = k * k * (3 - 2 * k); // eased glide along the wire, not constant missile speed
      const a1 = v3.copy(b.from).lerp(b.mid, e);
      const a2 = b.mid.clone().lerp(b.to, e);
      b.s.position.copy(a1.lerp(a2, e));
      b.s.material.opacity = k < 0.12 ? k / 0.12 : k > 0.8 ? (1 - k) / 0.2 : 1;
    }
  }

  // an agent did real work → their connector lights up, ships a packet train to the desk,
  // and the desk answers with a return train — visible request/response
  function onAgentEvent(agentId, dept, seatPos, now) {
    const prefs = (AGENT_TOOLS[agentId] || []).filter(k => byDeptKey[dept + ':' + k]);
    const dock = BY_DEPT[dept] || [];
    if (!dock.length) return;
    const key = prefs.length ? prefs[Math.floor(Math.random() * prefs.length)]
                             : dock[Math.floor(Math.random() * dock.length)];
    const item = byDeptKey[dept + ':' + key];
    if (!item) return;
    pulse(item, now, 0.3);
    spawnBeam(item, seatPos, now);                                   // tile → desk
    spawnBeam(item, seatPos, now, { reverse: true, count: 3, delay: 850, scale: 0.85 }); // desk → tile ack
  }

  // LIVE: an agent really called these tools → their logos pulse and the exchange rides the
  // wire into that agent's pod (keys as the server gives them: logo key, server id, or 'web')
  function onToolsUsed(agentId, keys) {
    const r = R[agentId]; if (!r || !Array.isArray(keys)) return;
    keys.forEach((key, i) => setTimeout(() => {
      const t = performance.now();
      if (key === 'web') { modelPulse('antigravity', true); return; }
      const item = byDeptKey[r.a.dept + ':' + key] || items.find(it => it.key === key);
      if (!item) return;
      pulse(item, t, 0.3);
      if (item.dept === r.a.dept) {
        spawnBeam(item, r.seat, t, { count: 3 });
        spawnBeam(item, r.seat, t, { reverse: true, count: 2, delay: 650, scale: 0.8 });
      } else wirePulse(item.dept, { shared: SHARED[key] ? key : null });
      if (byDeptKey[r.a.dept + ':' + key] === undefined && SHARED[key]) wirePulse(r.a.dept, { shared: key });
    }, i * 420));
  }

  // click tooltip
  const tip = document.createElement('div');
  tip.className = 'mcp-tip';
  document.body.appendChild(tip);
  let tipHideAt = 0;
  function showTip(sprite, x, y, now) {
    if (!sprite.visible) return; // docks hidden at overview — raycast still hits invisible sprites
    const item = items.find(it => it.sprite === sprite);
    if (!item) return;
    pulse(item, now, 0.3);
    const idle = Math.max(0, Math.round((now - item.lastActive) / 1000));
    tip.innerHTML = `<b>${item.name}</b> MCP<br><span class="t-live">● ${STATUS[item.key] || 'connected'}</span> · ` +
      `${DEPTS[item.dept].short.toLowerCase()} · ${idle < 2 ? 'active now' : 'active ' + idle + 's ago'}`;
    tip.style.left = Math.min(x + 14, innerWidth - 190) + 'px';
    tip.style.top = (y - 10) + 'px';
    tip.classList.add('on');
    tipHideAt = now + 2600;
  }

  function tick(now, dt, view, camera, focused, focusDim) {
    const z = view.zoom;
    const pxPerWorld = z * innerHeight / (2 * FR);
    // pixel-targeted sizing: ~32px tiles at overview, ~80px zoomed in — holds at any viewport
    const targetPx = 32 + 48 * smooth(1.15, 3.2, z);
    const base = targetPx / pxPerWorld;
    const gap = base * 1.16;                    // row spacing scales with tile size
    const labelA = smooth(2.0, 2.5, z);
    const pillScale = 0.68 + 0.32 * smooth(1.2, 2.4, z);
    cam = camera;
    // V3.5 (AJ, 6 Sep): the in-world tile docks are RETIRED — the top-bar strip is the
    // connectors at every zoom (centred + wired to the pod in focus). dockA pinned to 0 keeps
    // the sprites/labels/pills hidden and routes all traffic onto the wires.
    const dockA = 0;
    dockAcur = dockA;

    // boot/replay flourish: ONE gentle pulse per department, well spaced — a per-connector
    // volley (17 exchanges at once) read as a barrage
    if (volleyAt && now > volleyAt) {
      const go = !focused;
      volleyAt = 0;
      if (go) Object.keys(BY_DEPT).forEach((dept, i) => setTimeout(() => {
        const its = byDept[dept] || [], seats = docks[dept] ? docks[dept].seats : [];
        if (!its.length || !seats || !seats.length) return;
        const item = its[Math.floor(Math.random() * its.length)];
        pulse(item, performance.now(), 0.3);
        spawnBeam(item, seats[Math.floor(Math.random() * seats.length)], performance.now(), { scale: 0.9 });
      }, 350 + i * 420));
    }

    // current dock anchor per dept: overview anchor, lerped to the focus anchor (if any)
    // by focusDim while that dept is focused
    const anchorOf = (dept, out) => {
      const D = DOCKS[dept] || { dir: SR.clone().negate(), dist: 12.5, h: 8.0 };
      const L = LAYOUT[dept];
      if (!L) return out;
      const k = (focused === dept && D.fdir) ? focusDim : 0;
      const fd = D.fdir || D.dir, fdist = D.fdist ?? D.dist, fh = D.fh ?? D.h;
      return out.set(
        L.pos[0] + D.dir.x * D.dist * (1 - k) + fd.x * fdist * k,
        D.h * (1 - k) + fh * k,
        L.pos[1] + D.dir.z * D.dist * (1 - k) + fd.z * fdist * k);
    };

    if (dockA > 0.02) {
      for (const it of items) {
        if (!it) continue;
        const off = (it.i - (it.n - 1) / 2) * gap;
        const bob = 0.22 * Math.sin(now / 750 + (it.bobPhase || 0));
        anchorOf(it.dept, it.sprite.position);
        it.sprite.position.x += SR.x * off;
        it.sprite.position.y += bob;
        it.sprite.position.z += SR.z * off;

        it.sprite.visible = it.glow.visible = true;
        it.sprite.material.opacity = dockA;
        const pk = (now - (it.pulseT0 || 0)) / 600;
        const pop = pk >= 0 && pk < 1 ? 1 + (it.pulseAmp || 0.3) * Math.sin(Math.min(pk, 1) * Math.PI) : 1;
        it.sprite.scale.set(base * pop, base * pop, 1);
        it.glow.position.copy(it.sprite.position);
        it.glow.scale.set(base * 2.1 * pop, base * 2.1 * pop, 1);
        it.glow.material.opacity = (pk >= 0 && pk < 1 ? 0.85 * Math.sin(pk * Math.PI) * it.pulseAmp / 0.3 : 0) * dockA;

        const dimmed = focused && focused !== 'brain' && it.dept !== focused;
        const a = labelA * dockA * (dimmed ? 1 - 0.85 * focusDim : 1);
        if (a < 0.02) { it.label.style.display = 'none'; }
        else {
          it.label.style.display = 'block';
          v3.copy(it.sprite.position).project(camera);
          const sx = (v3.x * 0.5 + 0.5) * innerWidth;
          const sy = (-v3.y * 0.5 + 0.5) * innerHeight + base * pxPerWorld * 0.5 + 5;
          it.label.style.transform = `translate(${sx}px,${sy}px) translate(-50%,0)`;
          it.label.style.opacity = a;
        }
      }

      for (const [dept, dk] of Object.entries(docks)) {
        anchorOf(dept, v3);
        v3.y += 0.6 + base * 0.62;
        v3.project(camera);
        const sx = (v3.x * 0.5 + 0.5) * innerWidth;
        const sy = (-v3.y * 0.5 + 0.5) * innerHeight;
        const dimmed = focused && focused !== 'brain' && dept !== focused;
        dk.conn.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${pillScale})`;
        dk.conn.style.opacity = (dimmed ? 1 - 0.85 * focusDim : 1) * dockA;
      }
    }
    tickBeams(now);
    tickStreams(now, focused, focusDim);
    tickWires(now, dt, 1 - dockA, focused);
    if (tipHideAt && now > tipHideAt) { tip.classList.remove('on'); tipHideAt = 0; }
  }

  // dark mode: the two ink-coloured looms (Notion, ChatGPT) would vanish on a dark ground
  const inkBlack = new Set(Object.keys(SHARED).filter(k => SHARED[k] === '#151414'));
  function setDark(on) {
    const ink = on ? '#E8E6DF' : '#151414';
    MODELS.chatgpt = ink;
    for (const k of inkBlack) {
      SHARED[k] = ink;
      const sh = shared[k];
      if (sh) { sh.ink = ink; sh.drop.setAttribute('stroke', ink); sh.jdot.setAttribute('fill', ink); for (const g of Object.values(sh.wires)) { g.path.setAttribute('stroke', ink); g.dot.setAttribute('fill', ink); } }
    }
    if (mwires.chatgpt) { mwires.chatgpt.path.setAttribute('stroke', ink); mwires.chatgpt.dot.setAttribute('fill', ink); }
  }
  return { tick, sprites: [], onAgentEvent, onToolsUsed, showTip, startReveal, setDark, setUsage, live: LIVE, keys: uniqKeys }; // sprites: none clickable — docks retired
}
