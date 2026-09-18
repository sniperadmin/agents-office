// Agents Office — Brain Graph Indexer Service.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT } from '../../infrastructure/config.ts';

const OUT = path.join(ROOT, 'src', 'braingraph.js');
const SKIP = new Set(['node_modules', '99-Archive', '.obsidian', '.trash', '.git', 'graphify-out', 'command-centre-v2', 'your-brain', 'starter-vault', 'pro-vault', 'replit-handover', 'Agents Office']);

export interface NoteInfo {
  group: string;
  path: string;
  text: string;
}

export interface GraphResult {
  notes: number;
  nodes: Array<{ id: string; g: string; d: number; x: number; y: number }>;
  links: Array<[number, number]>;
  floor: Array<[number, number]>;
}

export function readVault(vault: string): { notes: Map<string, NoteInfo>; raw: Array<[string, string]> } {
  const notes = new Map<string, NoteInfo>();
  const raw: Array<[string, string]> = [];
  if (!fs.existsSync(vault)) return { notes, raw };
  (function walk(dir: string, top: string) {
    let ents: fs.Dirent[]; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p, top || ent.name); continue; }
      if (!ent.name.endsWith('.md')) continue;
      const name = ent.name.slice(0, -3);
      let text = ''; try { text = fs.readFileSync(p, 'utf8'); } catch {}
      notes.set(name, { group: top || '00-Meta', path: p, text });
      for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) raw.push([name, m[1].trim().split('/').pop()!]);
    }
  })(vault, '');
  return { notes, raw };
}

export function readOfficeNotes(vault: string): Array<{ name: string; path: string; text: string }> {
  const dir = path.join(vault, 'Agents Office'); const out: Array<{ name: string; path: string; text: string }> = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push({ name: f.slice(0, -3), path: path.join(dir, f), text: fs.readFileSync(path.join(dir, f), 'utf8') });
  return out;
}

export async function layoutGraph(vault: string): Promise<GraphResult> {
  const { notes, raw } = readVault(vault);
  for (const n of readOfficeNotes(vault)) {
    notes.set(n.name, { group: 'Agents Office', path: n.path, text: n.text });
    for (const m of n.text.matchAll(/\[\[([^\]|#]+)/g)) raw.push([n.name, m[1].trim().split('/').pop()!]);
  }
  const deg = new Map<string, number>();
  const seen = new Set<string>(); const links: Array<[string, string]> = [];
  for (const [a, b] of raw) {
    if (!notes.has(a) || !notes.has(b) || a === b) continue;
    const k = a < b ? a + ' ' + b : b + ' ' + a;
    if (seen.has(k)) continue; seen.add(k);
    links.push([a, b]); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1);
  }
  const ids = [...notes.keys()].filter(n => deg.get(n)).sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0));
  const idx = new Map(ids.map((n, i) => [n, i]));
  const N = ids.length;
  const L: Array<[number, number]> = links.map(([a, b]) => [idx.get(a)!, idx.get(b)!]);
  const x = new Float64Array(N), y = new Float64Array(N);
  let laid = false;
  try {
    const d3 = await import('d3-force');
    const sn = ids.map((id, i) => ({ id, i, x: 0, y: 0 })), sl = L.map(([s, t]) => ({ source: s, target: t }));
    const sim = (d3 as any).forceSimulation(sn)
      .force('link', (d3 as any).forceLink(sl).id((d: any) => d.i).distance(22).strength(0.5))
      .force('charge', (d3 as any).forceManyBody().strength(-38))
      .force('center', (d3 as any).forceCenter(0, 0))
      .force('collide', (d3 as any).forceCollide(4)).stop();
    for (let i = 0; i < 400; i++) sim.tick();
    sn.forEach(n => { x[n.i] = n.x; y[n.i] = n.y; });
    laid = true;
  } catch (e: any) { console.log('brain graph: d3-force not available (' + e.message.split('\n')[0] + '), using the built-in layout'); }
  if (!laid) {
    const vx = new Float64Array(N), vy = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = i * 2.399963; const r = 0.3 + 0.7 * Math.sqrt(i / N); x[i] = Math.cos(a) * r * 60; y[i] = Math.sin(a) * r * 60; }
    const k = 7;
    for (let it = 0; it < 520; it++) {
      const temp = 6 * (1 - it / 520) + 0.3;
      vx.fill(0); vy.fill(0);
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j]; let d2 = dx * dx + dy * dy + 0.01;
        const f = (k * k) / d2; vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
      }
      for (const [i, j] of L) {
        const dx = x[i] - x[j], dy = y[i] - y[j]; const d = Math.hypot(dx, dy) + 0.01; const f = d / k * 0.9;
        vx[i] -= dx / d * f; vy[i] -= dy / d * f; vx[j] += dx / d * f; vy[j] += dy / d * f;
      }
      for (let i = 0; i < N; i++) {
        const g = 0.006 + 0.012 * Math.min(1, (deg.get(ids[i]) || 0) / 40);
        vx[i] -= x[i] * g; vy[i] -= y[i] * g;
        const v = Math.hypot(vx[i], vy[i]) || 1; const s = Math.min(v, temp) / v;
        x[i] += vx[i] * s; y[i] += vy[i] * s;
      }
    }
  }
  const FN = Math.min(90, N);
  const fl = L.filter(([a, b]) => a < FN && b < FN);
  const fx = new Float64Array(FN), fy = new Float64Array(FN);
  try {
    const d3 = await import('d3-force');
    const sn = Array.from({ length: FN }, (_, i) => ({ i, x: 0, y: 0 })), sl = fl.map(([s, t]) => ({ source: s, target: t }));
    const sim = (d3 as any).forceSimulation(sn).force('link', (d3 as any).forceLink(sl).id((d: any) => d.i).distance(20).strength(0.5))
      .force('charge', (d3 as any).forceManyBody().strength(-30)).force('center', (d3 as any).forceCenter(0, 0)).force('collide', (d3 as any).forceCollide(3)).stop();
    for (let i = 0; i < 300; i++) sim.tick();
    sn.forEach(n => { fx[n.i] = n.x; fy[n.i] = n.y; });
  } catch { for (let i = 0; i < FN; i++) { fx[i] = x[i]; fy[i] = y[i]; } }
  let FR = 0; for (let i = 0; i < FN; i++) FR = Math.max(FR, Math.hypot(fx[i], fy[i]));
  const floor: Array<[number, number]> = Array.from({ length: FN }, (_, i) => [+(fx[i] / (FR || 1)).toFixed(3), +(fy[i] / (FR || 1)).toFixed(3)]);
  let R = 0; for (let i = 0; i < N; i++) R = Math.max(R, Math.hypot(x[i], y[i]));
  const nodes = ids.map((n, i) => ({ id: n, g: notes.get(n)!.group, d: deg.get(n)!, x: +(x[i] / (R || 1)).toFixed(3), y: +(y[i] / (R || 1)).toFixed(3) }));
  return { notes: notes.size, nodes, links: L, floor };
}

export async function buildBrainGraph(vault: string = loadConfig().brainPath): Promise<boolean> {
  if (!fs.existsSync(vault)) { console.log('brain graph: no brain at', vault, '— keeping the existing src/braingraph.js'); return false; }
  const g = await layoutGraph(vault);
  if (!g.nodes.length) { console.log('brain graph: no linked notes in', vault, '— keeping the existing src/braingraph.js'); return false; }
  const out = `// GENERATED by graph-build.ts — do not hand-edit. Rebuilt by \`tsx build.ts\` from the configured brain.\n` +
    `// ${g.notes} notes · ${g.nodes.length} linked · ${g.links.length} wiki links · ${new Date().toISOString().slice(0, 10)}\n` +
    `export const BRAIN = ${JSON.stringify(g)};\n`;
  fs.writeFileSync(OUT, out);
  console.log(`brain graph: ${g.notes} notes, ${g.nodes.length} linked, ${g.links.length} links → src/braingraph.js  (${path.relative(ROOT, vault) || '.'})`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildBrainGraph();
