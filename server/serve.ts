// Agents Office — local server bootstrap
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './infrastructure/config.ts';
import { db } from './infrastructure/db.ts';
import { layoutGraph, GraphResult } from './domains/brain/graph-build.ts';
import { DEPTS, DEPT_KEYS } from '../src/data.ts';
import * as mcp from './infrastructure/mcp.ts';
import { loadRoster } from './domains/agents/roster.ts';
import { loadSkills } from './domains/skills/skills.ts';
import * as learn from './domains/agents/learn.ts';
import * as onboard from './domains/skills/onboard.ts';
import * as routines from './domains/routines/routines.ts';
import { getUsage } from './infrastructure/llm.ts';
import { runServerTask } from './domains/orchestrator/taskRunner.ts';
import { RoutineScheduler } from './domains/routines/scheduler.ts';
import { handleRequest, AppContext } from './api/routes.ts';
import { normModel, normEffort, modelName, MODELS, MODEL_KEYS, DEFAULT_MODEL } from '../src/models.ts';
import { untilText } from '../src/when.ts';

const cfg = loadConfig();
const HTML = path.join(ROOT, 'dist', 'command-centre-v2.html');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'tasks.json');
const BRAIN = cfg.brainPath;
const NOTES_DIR = path.join(BRAIN, 'Agents Office');
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();

{ const m = normModel(cfg.model); if (cfg.model && !m) console.warn(`config: model must be one of ${MODEL_KEYS.join(', ')} (got "${cfg.model}") — using ${DEFAULT_MODEL}`); cfg.model = m || DEFAULT_MODEL; }
{ const e = normEffort(cfg.effort); if (cfg.effort && !e) console.warn(`config: effort must be low, medium, high, xhigh or max (got "${cfg.effort}") — using the model's own`); cfg.effort = e || ''; }
mcp.configure(cfg);

const roster = loadRoster(BRAIN);
const AGENTS = roster.agents;
for (const w of roster.problems) console.warn('agents:', w);

const RESERVE_ROLES: Record<string, string[]> = {
  dev: ['Backend Architect', 'Frontend Dev', 'Mobile Builder', 'Solidity Engineer', '3D Specialist'],
  design: ['UI Designer', 'UX Architect', 'UX Researcher', 'Brand Guardian', 'Whimsy Injector'],
  devops: ['DevOps Automator', 'Site Reliability Engineer', 'Cloud Security Architect', 'DB Optimizer'],
  product_qa: ['Sprint Prioritizer', 'API Tester', 'Model QA Auditor', 'Accessibility Specialist'],
  sec: ['AppSec Engineer', 'Penetration Tester', 'Threat Detection Specialist', 'Data Privacy Officer'],
  growth: ['Growth Hacker', 'Analytics Reporter', 'AI Citation Strategist', 'Data Engineer'],
  legal_fin: ['Legal Doc Reviewer', 'Legal Client Intake', 'Accounts Payable Agent', 'Finance Tracker'],
  support: ['Support Responder', 'Customer Service Specialist', 'Client Success Manager'],
  marketing: ['Marketing Head', 'Short-Form Specialist', 'LinkedIn Writer', 'Paid Ads'],
  sales: ['Sales Head', 'Funnel Architect', 'VSL Builder', 'Sales Scripter'],
  nurture: ['Nurture Head', 'Email Copywriter', 'Lead Magnet Designer', 'Show-Rate Ops'],
  launch: ['Launch Head', 'Launch Manager', 'Post-Launch Analyst', 'Case Study Producer'],
  partnerships: ['Partnerships Head', 'JV Outreach', 'Referral Designer', 'Affiliate Architect'],
  scale: ['Scale Head', 'Revenue Analyst', 'SOP Builder', 'Client Success'],
  foundations: ['Foundations Head', 'ICP Builder', 'Offer Architect', 'Niche Architect', 'Brand Voice', 'Financial Modeler', 'Researcher']
};

function ensureDepartmentAgents(deptKey: string, deptName: string, leadName?: string, model?: string, rolesInput?: string[]) {
  const k = deptKey;
  if (k === 'exec') {
    if (!AGENTS.some(a => a.id === 'ceo')) {
      const ceoObj = {
        id: 'ceo', name: leadName || 'CHIEF EXECUTIVE OFFICER',
        dept: 'exec', department: 'exec', lead: true, is_ceo: true, grid: [0, 0],
        hair: '#1c1917', skin: '#F5D5B0', role: 'CHIEF EXECUTIVE OFFICER Specialist',
        does: 'Drives chief executive officer strategy, execution, and deliverables for the department.',
        tools: [], brief: '', model: model || '', effort: ''
      };
      AGENTS.push(ceoObj as any);
      db.addOrUpdateAgent(ceoObj as any);
    }
    return;
  }
  const leadId = `${k}_lead`;
  if (!AGENTS.some(a => a.id === leadId)) {
    const leadObj = {
      id: leadId, name: leadName || `${deptName.toUpperCase()} LEAD`,
      dept: k, department: k, lead: true, grid: [0.5, 0],
      hair: '#1f1f1f', skin: '#F0C9A0', role: `${deptName} Lead`,
      does: `Manages ${deptName} operations`, tools: [], brief: '',
      model: model || '', effort: ''
    };
    AGENTS.push(leadObj as any);
    db.addOrUpdateAgent(leadObj as any);
  }

  const roles = Array.isArray(rolesInput) && rolesInput.length ? rolesInput : (RESERVE_ROLES[k] || []);
  roles.forEach((rName: string, idx: number) => {
    const rSlug = String(rName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const memberId = `${k}_${rSlug}`;
    if (!AGENTS.some(a => a.id === memberId)) {
      const col = idx % 2 === 0 ? 0 : 1;
      const row = Math.floor(idx / 2) + 1;
      const memberObj = {
        id: memberId, name: rName.toUpperCase(), dept: k, department: k, lead: false,
        grid: [col, row], hair: '#2b2b2b', skin: '#F0C9A0', role: rName,
        does: `${rName} specialist for ${deptName}`, tools: [], brief: '',
        model: model || '', effort: ''
      };
      AGENTS.push(memberObj as any);
      db.addOrUpdateAgent(memberObj as any);
    }
  });
}

try {
  db.deleteAgent('exec_lead');
  const staleIdx = AGENTS.findIndex(a => a.id === 'exec_lead');
  if (staleIdx >= 0) AGENTS.splice(staleIdx, 1);
} catch {}

const dbDepts = db.getCustomDepartments();
DEPT_KEYS.length = 0;
DEPT_KEYS.push('exec');
DEPTS['exec'] = { name: 'EXECUTIVE', short: 'EXEC', chip: '#F59E0B', ink: '#B45309', floor: '#FEF3C7' };
ensureDepartmentAgents('exec', 'EXECUTIVE', 'CHIEF EXECUTIVE OFFICER');

if (dbDepts && dbDepts.length > 0) {
  for (const d of dbDepts) {
    if (d.key && d.key !== 'exec') {
      if (!DEPT_KEYS.includes(d.key)) DEPT_KEYS.push(d.key);
      DEPTS[d.key] = { name: d.name || d.key.toUpperCase(), short: d.short || d.name || d.key.toUpperCase(), chip: d.chip || '#8FD3F4', ink: d.ink || '#2E86AB', floor: d.floor || '#E6F4FB' };
      ensureDepartmentAgents(d.key, d.name || d.key.toUpperCase(), d.leadName, d.model, d.roles);
    }
  }
} else if (Array.isArray(cfg.customDepartments) && cfg.customDepartments.length > 0) {
  for (const d of cfg.customDepartments) {
    if (d.key && d.key !== 'exec') {
      if (!DEPT_KEYS.includes(d.key)) DEPT_KEYS.push(d.key);
      DEPTS[d.key] = { name: d.name || d.key.toUpperCase(), short: d.short || d.name || d.key.toUpperCase(), chip: d.chip || '#8FD3F4', ink: d.ink || '#2E86AB', floor: d.floor || '#E6F4FB' };
      ensureDepartmentAgents(d.key, d.name || d.key.toUpperCase(), d.leadName, d.model, d.roles);
    }
  }
}

let skills = loadSkills(BRAIN, AGENTS);
for (const w of skills.problems) console.warn('skills:', w);

function reloadRoster() {
  const r = loadRoster(BRAIN);
  for (const a of r.agents) {
    const cur = AGENTS.find(x => x.id === a.id);
    if (cur) Object.assign(cur, { name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief });
  }
  if (r.problems.join() !== roster.problems.join()) for (const w of r.problems) console.warn('agents:', w);
  Object.assign(roster, { problems: r.problems, customised: r.customised, briefed: r.briefed, files: r.files });
}

let ctx: AppContext;

const refreshSkills = () => {
  reloadRoster();
  const s = loadSkills(BRAIN, AGENTS);
  if (s.problems.join() !== skills.problems.join()) for (const w of s.problems) console.warn('skills:', w);
  skills = s;
  if (ctx) ctx.skills = s;
  return s;
};

const backend = process.env.ANTHROPIC_API_KEY ? 'anthropic-sdk' : 'claude-cli';
const sseClients = new Set<http.ServerResponse>();
function pushEvent(type: string, payload: any) {
  const data = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const c of sseClients) {
    try { c.write(data); } catch { sseClients.delete(c); }
  }
}

let queue: Promise<any> = Promise.resolve();
const enqueue = (fn: () => Promise<any>) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

let graph: GraphResult = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() {
  try {
    graph = await layoutGraph(BRAIN);
    if (ctx) ctx.graph = graph;
  } catch (e: any) {
    console.warn('brain graph failed:', e.message);
  }
  return graph;
}

const scheduler = new RoutineScheduler({
  brainPath: BRAIN,
  dataDir: DATA,
  agents: AGENTS,
  enqueue,
  runServerTask: (id, opts) => runServerTask(id, {
    ...opts, agents: AGENTS, depts: DEPTS, brainPath: BRAIN, notesDir: NOTES_DIR,
    businessName: cfg.name, officeModel: cfg.model, officeEffort: cfg.effort,
    pushEvent, rebuildGraph, refreshSkills
  })
});

ctx = {
  cfg, version, backend, brainPath: BRAIN, notesDir: NOTES_DIR, htmlPath: HTML,
  agents: AGENTS, depts: DEPTS, deptKeys: DEPT_KEYS, reserveRoles: RESERVE_ROLES,
  ensureDepartmentAgents, graph, rebuildGraph, roster, skills, refreshSkills,
  scheduler, sseClients, pushEvent, enqueue
};

await rebuildGraph();

mcp.discover().then((l: any[]) => {
  console.log(`  connectors: ${l.filter(s => s.status === 'connected').length} connected of ${l.length} (claude mcp list)`);
  return l;
});

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res, ctx);
  } catch (e: any) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(cfg.port, () => {
  console.log(`Agents Office ${version} → http://localhost:${cfg.port}`);
  const activeProvider = (MODELS[cfg.model]?.provider || 'antigravity').toUpperCase();
  console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${graph.notes} notes, ${graph.links.length} links)   engine: ${activeProvider} · ${modelName(cfg.model)}${cfg.effort ? ' · effort ' + cfg.effort : ''} by default`);
  getUsage(true).then(u => console.log(u.source === 'claude' ? `  usage: session ${u.session?.percent ?? '—'}% · week ${u.week?.percent ?? '—'}% (your AI plan)` : `  usage: AI usage gauge (${u.reason}) — showing office token count`)).catch(() => {});
  console.log(`  tasks: ${FILE}   notes the agents write: ${NOTES_DIR}`);
  const rl = scheduler.loadRoutines(AGENTS);
  const nx = rl.filter((r: any) => !r.paused && r.nextAt).sort((a: any, b: any) => a.nextAt - b.nextAt)[0];
  console.log(`  routines: ${rl.length} loaded${rl.some((r: any) => r.paused) ? ' (' + rl.filter((r: any) => r.paused).length + ' paused)' : ''}${nx ? ' · next ' + untilText(nx.nextAt) + ' ' + nx.title.toUpperCase() + ' (' + nx.agent + ')' : ''} · ${scheduler.rlist.path}`);
  setInterval(() => scheduler.tickRoutines(AGENTS), 20000);
  scheduler.tickRoutines(AGENTS);
  console.log(`  agents: ${AGENTS.length} (${roster.customised} customised${roster.briefed ? ', ' + roster.briefed + ' briefed' : ''}${roster.files.length ? ' via ' + roster.files.join(' + ') : ''})   tools: ${backend === 'claude-cli' ? 'connected MCP servers' + (cfg.tools?.web === false ? '' : ' + web') : 'none on the API backend'}`);
  const sk = skills.summary();
  const setup = Object.fromEntries(Object.keys(DEPTS).concat(DEPT_KEYS).filter((v, i, a) => a.indexOf(v) === i && v !== 'brain').map(k => [k, onboard.isSetUp(AGENTS, skills, k)]));
  const notYet = DEPT_KEYS.filter(k => !setup[k]);
  console.log(`  skills: ${sk.count} (${sk.shipped} shipped in skills/, ${sk.brain} in ${path.join(NOTES_DIR, 'skills')})${sk.problems.length ? '   ⚠ ' + sk.problems.length + ' problem' + (sk.problems.length > 1 ? 's' : '') + ' — see npm run check' : ''}`);
  console.log(`  set up: ${notYet.length === DEPT_KEYS.length ? 'no department yet — open a lead\'s chat and say "set up"' : notYet.length ? DEPT_KEYS.length - notYet.length + ' of 6 departments (not yet: ' + notYet.map(k => DEPTS[k].name).join(', ') + ')' : 'all six departments'}   lessons: ${learn.dir(BRAIN)}`);
});
