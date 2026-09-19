// Agents Office — the local server (Beta).
// Serves the office and makes it real on your own Claude login:
//   · the command bar routes a typed task through Claude to the right agent in the department
//   · the agent produces the deliverable, which is saved as a note in your brain folder
//   · the Brain is your vault's real wiki-link graph, rebuilt live as notes are written
//   · chat with any agent is a real conversation in that agent's persona, grounded in your notes
// Everything stays on this machine: data/tasks.json and <brain>/Agents Office/*.md.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, ROOT } from './infrastructure/config.ts';
import { db } from './infrastructure/db.ts';
import { layoutGraph, readVault, readOfficeNotes, GraphResult } from './domains/brain/graph-build.ts';
import { DEPTS, DEPT_KEYS } from '../src/data.ts';
import * as mcp from './infrastructure/mcp.ts';
import { loadRoster } from './domains/agents/roster.ts';
import { loadSkills } from './domains/skills/skills.ts';
import * as learn from './domains/agents/learn.ts';
import * as onboard from './domains/skills/onboard.ts';
import * as routines from './domains/routines/routines.ts';
import * as usage from './domains/agents/usage.ts';
import { getAgentContext, saveTaskAsMemory } from './domains/agents/context.ts';
import { executeGraph, GraphState } from './domains/brain/graph-harness.ts';
import { normModel, modelFor, modelArgs, modelId, modelName, MODELS, MODEL_KEYS, DEFAULT_MODEL, normEffort, effortFor, effortName, EFFORT_KEYS } from '../src/models.ts';
import { parseWhen, describe, valid as validWhen, untilText } from '../src/when.ts';

const cfg = loadConfig();
const HTML = path.join(ROOT, 'dist', 'command-centre-v2.html'); // built by build.ts; shipped so npm start works without a build
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'tasks.json');
const BRAIN = cfg.brainPath;
const NOTES_DIR = path.join(BRAIN, 'Agents Office');
const CLI_CWD = path.join(os.tmpdir(), 'agents-office-cli'); // an empty cwd: no CLAUDE.md, no repo context
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const RUN_TIMEOUT = Math.max(60, +cfg.timeout || 300) * 1000; // agents with tools take longer than a plain draft
{ const m = normModel(cfg.model); if (cfg.model && !m) console.warn(`config: model must be one of ${MODEL_KEYS.join(', ')} (got "${cfg.model}") — using ${DEFAULT_MODEL}`); cfg.model = m || DEFAULT_MODEL; }
{ const e = normEffort(cfg.effort); if (cfg.effort && !e) console.warn(`config: effort must be low, medium, high, xhigh or max (got "${cfg.effort}") — using the model's own`); cfg.effort = e || ''; } // V3.6.1: the office's effort, empty = the model's own
mcp.configure(cfg);
const roster = loadRoster(BRAIN);
const AGENTS = roster.agents; // id · department · lead · name · role · does · tools · brief
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
let skills = loadSkills(BRAIN, AGENTS); // reloaded before every task and chat, so a new skill needs no restart
for (const w of skills.problems) console.warn('skills:', w);

function reloadRoster() {
  const r = loadRoster(BRAIN);
  for (const a of r.agents) { const cur = AGENTS.find(x => x.id === a.id); if (cur) Object.assign(cur, { name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief }); }
  if (r.problems.join() !== roster.problems.join()) for (const w of r.problems) console.warn('agents:', w);
  Object.assign(roster, { problems: r.problems, customised: r.customised, briefed: r.briefed, files: r.files });
}
const refreshSkills = () => { reloadRoster(); const s = loadSkills(BRAIN, AGENTS); if (s.problems.join() !== skills.problems.join()) for (const w of s.problems) console.warn('skills:', w); skills = s; return s; };
const leadOf = (dept: string) => AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept)!;
const setupMap = () => Object.fromEntries(Object.keys(DEPTS).concat(DEPT_KEYS).filter((v, i, a) => a.indexOf(v) === i && v !== 'brain').map(k => [k, onboard.isSetUp(AGENTS, skills, k)]));

let backend = 'claude-cli', sdk: any = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic(); backend = 'anthropic-sdk';
  } catch (e: any) { console.warn('SDK not installed (npm install @anthropic-ai/sdk) — using the Claude CLI:', e.message.split('\n')[0]); }
}

const load = (): any[] => db.getTasks();
const save = (list: any[]) => { for (const t of list) db.addTask(t); };
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const sseClients = new Set<http.ServerResponse>();
function pushEvent(type: string, payload: any) {
  const data = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const c of sseClients) { try { c.write(data); } catch { sseClients.delete(c); } }
}

const USTATE = usage.loadState(DATA);
let usageCache: { at: number; value: any; stale: boolean } = { at: 0, value: null, stale: true };
async function getUsage(force?: boolean) {
  if (!force && !usageCache.stale && usageCache.value && Date.now() - usageCache.at < 60000) return usageCache.value;
  const u: any = await usage.fetchUsage();
  const v = u.ok ? { ...u, office: usage.fallback(USTATE).window } : { ...usage.fallback(USTATE), reason: u.reason };
  usageCache = { at: Date.now(), value: v, stale: false };
  return v;
}
function bumpUsage(u: any) { if (!u) return; Object.assign(USTATE, usage.record(USTATE, u)); usage.saveState(DATA, USTATE); usageCache.stale = true; }
const slug = (t: any) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function askX(system: string, user: string, { maxTokens = 4000, tools = true, timeout = RUN_TIMEOUT, model = cfg.model, effort = null }: { maxTokens?: number; tools?: boolean; timeout?: number; model?: string; effort?: any } = {}): Promise<{ text: string; tools: string[]; usage?: any; modelId?: string }> {
  if (sdk) {
    const res = await sdk.messages.create({ model: modelId(model), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
    bumpUsage(res.usage);
    return { text: res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim(), tools: [], usage: res.usage, modelId: res.model };
  }
  fs.mkdirSync(CLI_CWD, { recursive: true });
  const mObj = MODELS[normModel(model)] || MODELS[DEFAULT_MODEL];
  const provider = mObj.provider || 'antigravity';
  let bin = 'agy';
  let isHermes = false;
  if (provider === 'hermes' && (fs.existsSync('/home/nasr/.local/bin/hermes') || process.env.HERMES_CLI)) {
    bin = process.env.HERMES_CLI || '/home/nasr/.local/bin/hermes';
    isHermes = true;
  } else if (process.env.ANTIGRAVITY_CLI) {
    bin = process.env.ANTIGRAVITY_CLI;
  } else if (fs.existsSync('/home/nasr/.local/bin/agy')) {
    bin = '/home/nasr/.local/bin/agy';
  } else {
    bin = 'agy';
  }

  let args: string[] = [];
  const allowed = tools ? mcp.allowedTools() : [];
  const claudeArgs = ['-p', user, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--system-prompt', system,
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,Agent,NotebookEdit,Task' + (allowed.includes('WebFetch') ? '' : ',WebFetch,WebSearch')];
  if (allowed.length) claudeArgs.push('--allowedTools', allowed.join(','));
  claudeArgs.push(...modelArgs(model, effort));

  let isAgy = (bin === 'agy' || bin.endsWith('/agy'));
  let fullPrompt = system ? `${system}\n\nUSER REQUEST:\n${user}` : user;
  if (fullPrompt.length > 120000) {
    fullPrompt = fullPrompt.slice(0, 120000) + '\n\n[... prompt context capped for CLI execution]';
  }
  if (isHermes) {
    args = ['-z', fullPrompt];
    if (mObj.flag) args.push('-m', mObj.flag);
    const eff = normEffort(effort) || mObj.effort;
    if (eff) args.push('--reasoning', eff);
  } else if (isAgy) {
    args = ['-p', fullPrompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
    if (mObj.flag && mObj.flag !== 'antigravity-flash' && !mObj.flag.startsWith('antigravity')) {
      args.push('--model', mObj.flag);
    }
    const eff = normEffort(effort) || mObj.effort;
    if (eff) args.push('--effort', eff);
  } else {
    args = claudeArgs;
  }

  const env = { ...process.env }; delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: CLI_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', text = '', used: string[] = [], gotResult = false, usageOut: any = null, modelUsed: any = null;
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${bin} took longer than ${timeout / 1000} s`)); }, timeout);
    const feed = (line: string) => {
      if (!line.trim()) return;
      let j: any; try { j = JSON.parse(line); } catch { return; }
      if (j.type === 'system' && j.subtype === 'init') mcp.fromInit(j);
      if (j.type === 'assistant' && j.message?.content) for (const b of j.message.content) if (b.type === 'tool_use' && b.name && !used.includes(b.name)) used.push(b.name);
      if (j.event === 'step_update' && j.step_update?.text_delta) {
        text += j.step_update.text_delta;
      }
      if (j.type === 'result' || j.event === 'result') {
        gotResult = true;
        const resObj = j.result || j;
        const resStr = typeof resObj === 'string' ? resObj : resObj.response || resObj.result || '';
        if (resStr) text = String(resStr).trim();
        else if (j.is_error && !text) text = '';
        usageOut = resObj.usage || j.usage || null;
        modelUsed = Object.keys(j.modelUsage || {})[0] || null;
      }
    };
    p.stdout.on('data', d => {
      out += d;
      if (!isHermes) {
        let i: number; while ((i = out.indexOf('\n')) >= 0) { feed(out.slice(0, i)); out = out.slice(i + 1); }
      }
    });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? `${bin} is not installed` : e.message));
    });
    p.on('close', code => {
      clearTimeout(timer);
      if (isHermes) {
        const resText = out.trim();
        if (code === 0 || resText) {
          return resolve({ text: resText || `Agent processed task using ${mObj.name} (HERMES)`, tools: [], usage: null, modelId: mObj.id });
        }
      } else {
        if (out.trim()) feed(out);
      }
      if (!gotResult && !text) {
        try { text = String(JSON.parse(out).result || JSON.parse(out).response || '').trim(); } catch { text = out.trim(); }
      }
      if (!text && code === 0) {
        text = `Agent processed task using ${mObj.name} (${provider.toUpperCase()})`;
      }
      if (code !== 0 && !gotResult && !text) return reject(new Error(`${bin} exited ${code}${err ? ': ' + err.trim().slice(0, 300) : ''}`));
      bumpUsage(usageOut);
      resolve({ text: text.trim(), tools: used, usage: usageOut, modelId: modelUsed || mObj.id });
    });
  });
}
const ask = async (system: string, user: string, opts?: any) => (await askX(system, user, { tools: false, ...opts })).text;
function parseJSON(text: string): any {
  const s = text.replace(/```json|```/g, ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return JSON.parse(s.slice(a, b + 1));
}

let graph: GraphResult = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() {
  try { graph = await layoutGraph(BRAIN); } catch (e: any) { console.warn('brain graph failed:', e.message); }
  return graph;
}
function vaultIndex(): Map<string, string> {
  const { notes } = readVault(BRAIN); const m = new Map<string, string>();
  for (const [name, n] of notes) m.set(name, n.text);
  for (const n of readOfficeNotes(BRAIN)) m.set(n.name, n.text);
  return m;
}

const persona = (a: any) => `${a.name}${a.lead ? ' (lead)' : ''} · ${a.role} · ${a.does}`;
function rosterText(dept: string): string { return AGENTS.filter(a => a.department === dept).map(a => { const sk = skills.names(a); return `- ${a.id} · ${persona(a)}${sk.length ? ' · skills: ' + sk.join(', ') : ''}`; }).join('\n'); }

function agentBrief(a: any): string {
  const lessons = learn.promptText(BRAIN, a);
  return (a.brief ? `\nSTANDING INSTRUCTIONS FROM THE OWNER\n${a.brief}\n` : '') + (skills.promptText(a) ? `\n${skills.promptText(a)}\n` : '') + (lessons ? `\n${lessons}\n` : '');
}
const toolKeys = (names: string[]) => [...new Set(names.map(n => /^mcp__/.test(n) ? mcp.keyOf(n) : n === 'WebSearch' || n === 'WebFetch' ? 'web' : null).filter(Boolean) as string[])];
async function route(dept: string, text: string) {
  const d = DEPTS[dept]; refreshSkills();
  const system = `You are the router for ${cfg.name}, a business whose departments are run by AI agents. ` +
    'Pick the single best agent for the owner\'s request — an agent whose skills match the request is the right one — and return ONLY a JSON object — no prose, no code fences.';
  const user = `Department: ${d.name}\nAgents (id · name · role · what they do):\n${rosterText(dept)}\n\nOwner's request: "${text}"\n\n` +
    'Return: {"agent":"<id from the list>","title":"<clean imperative task title, max 70 characters>","plan":["<step>","<step>","<step>"],"eta_minutes":<integer>,"why":"<one short sentence>","needs_ok":<true if doing this involves sending, posting, paying, deleting or changing anything outside this machine; false if it only reads and reports>}';
  const j = parseJSON(await ask(system, user, { maxTokens: 800, timeout: 150000, model: cfg.model || DEFAULT_MODEL }));
  const valid = AGENTS.find(a => a.id === j.agent && a.department === dept);
  const agent = valid ? valid.id : (AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept)!).id;
  return { agent, title: String(j.title || text).slice(0, 90), plan: Array.isArray(j.plan) ? j.plan.slice(0, 4).map(String) : [],
    eta: Number.isFinite(j.eta_minutes) ? j.eta_minutes : 30, why: String(j.why || ''), needsOk: typeof j.needs_ok === 'boolean' ? j.needs_ok : routines.guessNeedsOk(text) };
}

async function orchestrate(text: string, parentTaskId: string, model?: string): Promise<string> {
  const activeDepts = DEPT_KEYS.filter(k => k !== 'brain' && k !== 'exec' && AGENTS.some(a => a.department === k));
  const ceo = AGENTS.find(a => a.is_ceo || a.id === 'ceo') || AGENTS.find(a => a.department === 'exec')!;
  const decompSystem = `You are ${ceo.name}, CEO of ${cfg.name}. Decompose the owner's request into targeted sub-tasks for each relevant department. Return ONLY a JSON array — no prose, no code fences.`;
  const decompUser = `Request: "${text}"\nDepartments available: ${activeDepts.map(k => `${k} (${DEPTS[k].name})`).join(', ')}\n` +
    'Return: [{"dept":"<key>","task":"<specific task for that department, one sentence>"},...] — only include departments that are genuinely needed. Maximum 6 items.';
  let subTasks: { dept: string; task: string }[] = [];
  try {
    const raw = await ask(decompSystem, decompUser, { maxTokens: 600, timeout: 90000, model: model || cfg.model });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    subTasks = Array.isArray(parsed) ? parsed.filter(x => x.dept && x.task && DEPTS[x.dept]) : [];
  } catch (e: any) {
    console.warn('orchestrate: decompose failed:', e.message);
    subTasks = activeDepts.map(dept => ({ dept, task: text }));
  }
  if (!subTasks.length) return `CEO: no department sub-tasks identified for "${text}".`;

  console.log(`🎯 CEO orchestrating "${text.slice(0, 60)}" → ${subTasks.length} departments`);
  db.logAgentEvent('orchestrate', ceo.id, { taskId: parentTaskId, payload: { subTasks } });

  const results = await Promise.allSettled(subTasks.map(async ({ dept, task }) => {
    const r = await route(dept, task);
    const subTask: any = {
      id: nid(), dept, agent: r.agent, title: r.title, text: task,
      plan: r.plan, eta: r.eta, why: r.why, priority: 'HIGH',
      state: 'doing', addedAt: Date.now(), startedAt: Date.now(), by: 'ceo',
      model: model || undefined
    };
    db.addTask(subTask);
    db.linkTaskGraph(subTask.id, parentTaskId, dept, DEPTS[dept].name);
    db.logAgentEvent('handoff', ceo.id, { toAgent: r.agent, taskId: subTask.id, payload: { dept, task } });
    pushEvent('agent_event', { eventType: 'handoff', fromAgent: ceo.id, toAgent: r.agent, taskId: subTask.id, dept });
    try {
      const out = await run(subTask);
      Object.assign(subTask, { state: 'done', doneAt: Date.now(), result: out.result, read: out.read, tools: out.tools, used: out.used, error: false });
      db.addTask(subTask);
      db.logAgentEvent('result', r.agent, { toAgent: ceo.id, taskId: subTask.id, payload: { dept, result: out.result.slice(0, 200) } });
      pushEvent('task_done', { taskId: subTask.id, dept, agent: r.agent, title: subTask.title });
      saveTaskAsMemory(subTask, r.agent, dept);
      return { dept, deptName: DEPTS[dept].name, agent: r.agent, title: r.title, result: out.result };
    } catch (e: any) {
      Object.assign(subTask, { state: 'done', doneAt: Date.now(), result: `Error: ${e.message}`, error: true });
      db.addTask(subTask);
      return { dept, deptName: DEPTS[dept].name, agent: r.agent, title: r.title, result: `[error] ${e.message}` };
    }
  }));

  const settled = results.map((r, i) => r.status === 'fulfilled' ? r.value : { dept: subTasks[i].dept, deptName: DEPTS[subTasks[i].dept]?.name || subTasks[i].dept, agent: '?', title: '?', result: `[failed] ${(r as any).reason?.message}` });

  const synSystem = `You are ${ceo.name}, CEO of ${cfg.name}. Synthesize the department reports below into a single executive summary for the owner. Plain text: one short heading per department, then an overall conclusion. Under 350 words total.`;
  const synUser = `Original request: "${text}"\n\nDepartment Results:\n${settled.map(s => `## ${s.deptName} (${s.agent})\n${s.result}`).join('\n\n')}`;
  const summary = await ask(synSystem, synUser, { maxTokens: 1000, timeout: 120000, model: model || cfg.model });
  return summary;
}

async function run(task: any, feedback?: string, mode?: string) {
  const a = AGENTS.find(x => x.id === task.agent)!, d = DEPTS[a.department];
  refreshSkills();
  const ctx = await getAgentContext(a.id, a.department, task.title + ' ' + task.text, BRAIN, cfg.name);
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${a.does}\n${agentBrief(a)}` +
    'Write the finished deliverable itself, not a description of what you would do. Plain text: a short heading, then short sections or bullets. ' +
    'At most 260 words unless a skill or the owner\'s instructions set a different shape — those win. No preamble, no sign-off. Ground it in the company notes below; where a fact is missing, make a reasonable assumption and mark it (assumed). ' +
    'If you used a tool, say so in one line at the end ("Used: Gmail — searched the client thread").\n\n' +
    `${mcp.promptText(a.tools)}\n\nCOMPANY NOTES\n${ctx.businessContext}\n\nMEMORIES & RELEVANT NOTES\n${ctx.relevantMemories}` +
    (ctx.recentWork ? `\n\nYOUR RECENT WORK\n${ctx.recentWork}` : '');
  const routineLine = task.routine ? `\nThis is a routine (${task.when}): it runs on the office's own clock and the owner is not at the keyboard. It is now ${new Date().toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${task.late ? `; this run is late, it was due ${new Date(task.due).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Do the work for now.` : '';
  const modeLine = mode === 'draft' ? '\nPrepare everything, but send, post, pay or change NOTHING outside this machine: the owner reads this first and approves it. End with one line saying exactly what will go out when approved (or that nothing needs to).'
    : mode === 'approve' ? `\nThe owner has APPROVED the draft below. Carry out the outbound step now, exactly as drafted, with your tools (send, post, update). If a tool you need is not connected, say so and show what you would have sent. Then report in one short section: what went out, to whom, and anything that did not.\nApproved draft:\n${task.draft || task.result}` : '';
  const user = `Task: ${task.title}\nOwner's request: ${task.text}` + (task.plan?.length ? `\nAgreed plan: ${task.plan.join(' → ')}` : '') + routineLine + modeLine +
    (feedback && mode !== 'approve' ? `\n\nThe owner reviewed your previous version and asked for changes: "${feedback}"\nPrevious version:\n${task.result}` : '');
  const pick = modelFor({ task: task.model, routine: task.routineModel, agent: a.model, office: cfg.model });
  const eff = effortFor({ task: task.effort, routine: task.routineEffort, agent: a.effort, office: cfg.effort, model: pick.model });
  const { text, tools, modelId: ran } = await askX(system, user, { model: pick.model, effort: eff.effort });
  if (!text) throw new Error('Claude returned nothing');
  return { result: text, read: ctx.readNames, tools: toolKeys(tools), used: mcp.namesOf(tools), skills: skills.names(a), modelUsed: pick.model, modelFrom: pick.from, modelId: ran, effortUsed: eff.effort || '', effortFrom: eff.from };
}

function writeThoughtLog(task: any) {
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
    const a = AGENTS.find(x => x.id === task.agent) || { name: task.agent, department: task.dept };
    const deptName = DEPTS[task.dept]?.name || task.dept;
    const nowStr = new Date().toISOString();

    const noteName = `task-${task.id.slice(-8)}-${slug(task.title || 'untitled')}`;
    const taskNotePath = path.join(NOTES_DIR, `${noteName}.md`);
    
    const noteContent = 
      `---\n` +
      `task_id: ${task.id}\n` +
      `state: ${task.state}\n` +
      `agent: ${a.name}\n` +
      `department: ${deptName}\n` +
      `updated: ${nowStr}\n` +
      `---\n\n` +
      `# ${task.title || 'Task Thought Process'}\n\n` +
      `**Agent**: ${a.name} (${deptName})\n` +
      `**Status**: ${task.state.toUpperCase()}\n` +
      `**Request**: ${task.text || task.title}\n\n` +
      (task.plan?.length ? `### Strategy & Plan\n${task.plan.map((s: any) => `- ${s}`).join('\n')}\n\n` : '') +
      (task.result ? `### Deliverable & Output\n${task.result}\n\n` : '') +
      `---\n*Recorded in Company Thought Log memory graph*\n`;

    fs.writeFileSync(taskNotePath, noteContent);

    const masterPath = path.join(NOTES_DIR, 'Company Thought Log.md');
    const entry = `- [${nowStr.slice(11, 19)}] **${a.name}** (${deptName}): [[${noteName}]] — state: \`${task.state}\` (${(task.title || '').slice(0, 60)})\n`;
    let masterText = fs.existsSync(masterPath) ? fs.readFileSync(masterPath, 'utf8') : '# Company Thought Log & Memory Graph\n\nLive stream of agent thought processes, decisions, and execution trajectories.\n\n';
    if (!masterText.includes(noteName)) {
      masterText += entry;
      fs.writeFileSync(masterPath, masterText);
    }
  } catch (e: any) {
    console.warn('writeThoughtLog warning:', e.message);
  }
}

function writeNote(task: any): string {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const a = AGENTS.find(x => x.id === task.agent) || { name: task.agent, department: task.dept };
  const name = `${new Date(task.doneAt || Date.now()).toISOString().slice(0, 10)} ${slug(task.title)}`;
  const body = `---\nagent: ${a.name}\ndepartment: ${DEPTS[a.department]?.name || a.department}\ntask: ${task.id}\ndone: ${new Date(task.doneAt || Date.now()).toISOString()}${task.used?.length ? '\ntools: ' + task.used.join(', ') : ''}${task.skills?.length ? '\nskills: ' + task.skills.join(', ') : ''}${task.routine ? '\nroutine: ' + task.when + (task.late ? ' (late)' : '') : ''}${task.modelUsed ? '\nmodel: ' + modelName(task.modelUsed) + (task.modelFrom && task.modelFrom !== 'office' ? ' (' + task.modelFrom + ')' : '') : ''}${task.effortUsed ? '\neffort: ' + task.effortUsed + (task.effortFrom && task.effortFrom !== 'model' ? ' (' + task.effortFrom + ')' : '') : ''}${task.approved ? '\napproved: ' + new Date(task.approvedAt).toISOString() : ''}\n---\n` +
    `# ${task.title}\n\n${task.result}\n\n---\nRead: ${(task.read || []).map((n: string) => `[[${n}]]`).join(' · ') || '—'}\n`;
  fs.writeFileSync(path.join(NOTES_DIR, name + '.md'), body);
  writeThoughtLog(task);
  return name;
}

async function chat(agentId: string, text: string, history?: any[]) {
  const a = AGENTS.find(x => x.id === agentId); if (!a) throw new Error('unknown agent');
  const d = DEPTS[a.department]; refreshSkills();
  const ctx = await getAgentContext(a.id, a.department, text, BRAIN, cfg.name);
  const mine = db.getTasksByDept(a.department).filter(t => t.agent === agentId).slice(0, 6).map(t => `- [${t.state}] ${t.title}`).join('\n');
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${a.does}\n${agentBrief(a)}` +
    'You are talking to the owner. Answer as this agent, in first person, briefly (under 120 words unless asked for detail), plainly, no hype. ' +
    'Use the company notes; say when something is not in them. If the owner asks you to look something up, use your tools. Nothing outbound is sent without the owner\'s explicit say-so.\n\n' +
    `${mcp.promptText(a.tools)}\n\nCOMPANY NOTES\n${ctx.businessContext}\n\nMEMORIES & RELEVANT NOTES\n${ctx.relevantMemories}\n\nYOUR RECENT TASKS\n${mine || '—'}`;
  const convo = (history || []).slice(-8).map(m => `${m.who === 'user' ? 'Owner' : a.name}: ${m.text}`).join('\n');
  const { text: reply, tools } = await askX(system, (convo ? convo + '\n' : '') + `Owner: ${text}\n${a.name}:`, { maxTokens: 1200, model: modelFor({ agent: a.model, office: cfg.model }).model, effort: effortFor({ agent: a.effort, office: cfg.effort, model: modelFor({ agent: a.model, office: cfg.model }).model }).effort });
  return { reply, read: ctx.readNames, tools: toolKeys(tools), used: mcp.namesOf(tools) };
}

const RSTATE = routines.loadState(DATA);
let rlist: { routines: any[]; problems: string[]; path: string } = { routines: [], problems: [], path: routines.file(BRAIN) };
function loadRoutines() {
  const r = routines.load(BRAIN, AGENTS);
  if (r.problems.join() !== rlist.problems.join()) for (const w of r.problems) console.warn('routines:', w);
  rlist = r;
  const { list, changed } = routines.withState(r.routines, RSTATE);
  if (changed) routines.saveState(DATA, RSTATE);
  return list;
}
const routinesOut = () => { const list = loadRoutines(); return { routines: list, depts: routines.ALLOWED, path: rlist.path, problems: rlist.problems }; };
const agentName = (id: string) => AGENTS.find(a => a.id === id)?.name || id;

let queue: Promise<any> = Promise.resolve();
const enqueue = (fn: () => Promise<any>) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
function fire(r: any, { due = Date.now(), late = false, by = 'routine' } = {}) {
  const task = { id: nid(), dept: r.dept, agent: r.agent, title: r.title, text: r.text, plan: r.plan || [], eta: 15, why: '', state: 'next', addedAt: Date.now(), by, routine: r.id, when: r.desc || describe(r.when), needsOk: r.needsOk, due, late, routineModel: r.model || undefined, routineEffort: r.effort || undefined };
  db.addTask(task);
  routines.advance(RSTATE, r, Date.now(), task.id, late); routines.saveState(DATA, RSTATE);
  console.log(`⏱ ${task.id} → ${task.agent}: ${task.title}${late ? ' (LATE · was due ' + new Date(due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}`);
  enqueue(() => runServerTask(task.id));
  return task;
}

function manageDepartmentTraffic(deptKey: string) {
  const CORE_LEADS = ['ceo', 'elead', 'lexi', 'olead', 'flead', 'mlead', 'dlead', 'brainlead', 'exec', 'emails', 'sales', 'ops', 'fin', 'marketing', 'delivery', 'brain'];
  const tasks = db.getTasksByDept(deptKey).filter(t => t.state === 'next' || t.state === 'doing');
  const existingAgents = AGENTS.filter(a => a.department === deptKey);

  if (tasks.length > 1 && existingAgents.length < 5) {
    const specId = `${deptKey}_spec_${Date.now().toString(36).slice(-4)}`;
    const newAgent = {
      id: specId,
      department: deptKey,
      lead: false,
      is_ceo: false,
      name: `${deptKey.toUpperCase()} SPECIALIST`,
      role: `Dynamic ${DEPTS[deptKey]?.name || deptKey} Specialist`,
      does: `Spawned to handle task traffic surge in ${DEPTS[deptKey]?.name || deptKey}.`,
      tools: JSON.stringify(['gmail', 'notion', 'web']),
      brief: 'Focus on resolving queued tasks quickly with high accuracy.'
    };
    db.addAgent(newAgent);
    refreshSkills();
    pushEvent('agent_spawned', { agentId: specId, dept: deptKey, traffic: tasks.length });
  } else if (tasks.length === 0) {
    const toDisband = existingAgents.filter(a => !a.lead && !a.is_ceo && !CORE_LEADS.includes(a.id));
    if (toDisband.length > 0) {
      for (const a of toDisband) {
        db.deleteAgent(a.id);
        pushEvent('agent_disbanded', { agentId: a.id, dept: deptKey });
      }
      refreshSkills();
    }
  }
}

async function runServerTask(id: string, { feedback, approve }: { feedback?: string; approve?: boolean } = {}): Promise<any> {
  const task = db.getTaskById(id); if (!task) return null;
  manageDepartmentTraffic(task.dept);
  task.state = 'doing'; task.startedAt = Date.now(); delete task.ask;
  db.updateTask(id, { state: 'doing', startedAt: task.startedAt });
  pushEvent('task_start', { taskId: id, agent: task.agent, dept: task.dept });
  try {
    const helpers = {
      ask,
      runTask: (t: any, fb?: string) => run(t, fb, approve ? 'approve' : task.needsOk ? 'draft' : 'routine'),
      pushEvent
    };

    const initialState: GraphState = {
      taskId: id,
      dept: task.dept,
      agentId: task.agent,
      request: task.text || task.title,
      plan: Array.isArray(task.plan) ? task.plan : (typeof task.plan === 'string' ? JSON.parse(task.plan) : []),
      attempts: 1,
      maxAttempts: 3,
      history: [],
      status: 'planning'
    };

    const finalState = await executeGraph(initialState, helpers);

    if (approve) {
      task.result = (task.draft || task.result) + '\n\n---\nAFTER YOUR OK\n' + (finalState.draftResult || '');
      task.approved = true;
      task.approvedAt = Date.now();
    } else {
      task.result = finalState.draftResult || 'Task completed.';
    }

    Object.assign(task, {
      read: finalState.readNotes,
      tools: finalState.usedTools,
      used: finalState.usedTools,
      skills: finalState.skillsUsed,
      error: false,
      modelUsed: finalState.modelUsed,
      effortUsed: finalState.effortUsed
    });

    if (task.needsOk && !approve) {
      task.state = 'waiting';
      task.draft = task.result;
      task.waitingAt = Date.now();
      task.ask = routines.askLine(task);
    } else {
      task.state = 'done';
      task.doneAt = Date.now();
      task.note = writeNote(task);
      await rebuildGraph();
      saveTaskAsMemory(task, task.agent, task.dept);
    }
  } catch (e: any) {
    Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Could not complete this task: ' + e.message, error: true });
  }
  db.addTask(task);
  manageDepartmentTraffic(task.dept);
  pushEvent('task_update', { taskId: id, state: task.state, agent: task.agent, dept: task.dept, error: task.error });
  console.log(`${task.error ? '✗' : task.state === 'waiting' ? '⏸' : '✓'} ${task.id} ${task.error ? 'failed' : task.state === 'waiting' ? 'waiting for your OK' : 'done'} (${String(task.result || '').length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
  return task;
}

function tickRoutines() {
  let list: any[]; try { list = loadRoutines(); } catch (e: any) { console.warn('routines:', e.message); return; }
  for (const { routine, due, late } of routines.due(list, RSTATE)) fire(routine, { due, late });
}

const uniqueId = (base: string, list: any[]) => { let id = base || 'routine', n = 2; while (list.some(r => r.id === id)) id = `${base}-${n++}`; return id; };
function editRoutine(id: string, patch: any) { const r = rlist.routines.find(x => x.id === id); if (!r) return null; Object.assign(r, patch); routines.save(BRAIN, rlist.routines); return loadRoutines().find((x: any) => x.id === id); }
function removeRoutine(id: string) { const n = rlist.routines.length; rlist.routines = rlist.routines.filter(x => x.id !== id); if (rlist.routines.length !== n) routines.save(BRAIN, rlist.routines); loadRoutines(); return rlist.routines.length !== n; }

async function makeRoutine({ dept, text, when, agent, needsOk, model, effort }: { dept: string; text?: string; when?: any; agent?: string; needsOk?: boolean; model?: string; effort?: string }) {
  let taskText = String(text || '').trim(), w = when, parsed: any = null;
  if (!w) {
    parsed = parseWhen(taskText);
    if (!parsed) return { error: 'No schedule in that sentence. Say when: "every weekday at 8am, …", "Mondays 9am, …", "every hour 9-5, …".', noSchedule: true };
    if (parsed.needsDay) return { error: 'Which day? Say "every Monday …" or "Mon and Thu …".', needsDay: true };
    if (parsed.needsTime) return { error: 'What time? Say "… at 8am" or "… at 17:30".', needsTime: true };
    w = parsed.when; taskText = parsed.text;
  }
  if (!validWhen(w)) return { error: 'That schedule is not complete.' };
  if (!taskText) return { error: 'What should happen? The sentence has a time but no task.' };
  loadRoutines();
  const r = await route(dept, taskText);
  const a = agent && AGENTS.find(x => x.id === agent && x.department === dept) ? agent : r.agent;
  const v = routines.validate({ id: uniqueId(slug(r.title).slice(0, 40), rlist.routines), dept, agent: a, title: r.title, text: taskText, when: w, needsOk: typeof needsOk === 'boolean' ? needsOk : r.needsOk, plan: r.plan, model: normModel(model) || undefined, effort: normEffort(effort) || undefined }, AGENTS, rlist.routines);
  if (v.problems.length) return { error: v.problems.join('; ') };
  rlist.routines.push(v.routine); routines.save(BRAIN, rlist.routines);
  const out = loadRoutines().find((x: any) => x.id === v.routine.id);
  console.log(`⏱ routine ${out.id} → ${out.agent}: ${out.title} (${out.desc} · next ${untilText(out.nextAt)}${out.needsOk ? ' · waits for the OK' : ''})`);
  return { ok: true, routine: out, why: r.why, guessed: parsed?.guessed ? parsed.guessWord : null };
}

async function routinesChat(a: any, text: string) {
  const t = String(text).trim(), dept = a.department, allowed = routines.ALLOWED.includes(dept);
  if (/^\s*(routines?|schedule|timetable|what(?:'s| is) (?:scheduled|on the (?:schedule|timetable)))\s*\??\s*$/i.test(t)) return { reply: allowed ? routines.listText(loadRoutines(), dept, AGENTS) : routines.refusal(dept) };
  const cmd = /^\s*(pause|stop|resume|start|unpause|delete|remove|run)\b\s*(?:the\s+)?(.*?)\s*[.!]?$/i.exec(t);
  if (cmd && allowed && !parseWhen(t)) {
    const list = loadRoutines(); const words = cmd[2].replace(/\s+(routine|one)$/i, ''); const r = routines.matchRoutine(list, dept, words);
    if (!r) return { reply: (list.some((x: any) => x.dept === dept) ? 'Which one? ' : '') + routines.listText(list, dept, AGENTS) };
    const verb = cmd[1].toLowerCase();
    if (verb === 'run') { const task = fire(r, { by: 'you' }); return { reply: `Running "${r.title}" now — ${r.agent === a.id ? 'I have it' : agentName(r.agent) + ' has it'}. It lands in the panel${r.needsOk ? ' and waits for your OK before anything is sent' : ''}.`, task }; }
    if (/pause|stop/.test(verb)) { editRoutine(r.id, { paused: true }); return { reply: `Paused "${r.title}". It stays on the timetable; say "resume ${r.title.toLowerCase()}" to start it again.` }; }
    if (/resume|start|unpause/.test(verb)) { const n = editRoutine(r.id, { paused: false }); return { reply: `"${r.title}" is back on — next ${untilText(n.nextAt)}.` }; }
    if (/delete|remove/.test(verb)) { removeRoutine(r.id); return { reply: `Deleted "${r.title}". It is off the timetable.` }; }
  }
  const p = parseWhen(t);
  if (!p) return null;
  if (!allowed) return { reply: routines.refusal(dept) };
  if (p.needsDay) return { reply: 'Which day? Say it again with the day: "every Monday at 9am, …".' };
  if (p.needsTime) return { reply: `What time? Say it again with the time, e.g. "every weekday at 8am, ${p.text ? p.text.slice(0, 60) : '…'}".` };
  if (!p.text) return { reply: 'I have the time but not the task. Say it again with what should happen.' };
  const made = await makeRoutine({ dept, text: p.text, when: p.when, agent: a.lead ? undefined : a.id });
  if (made.error) return { reply: made.error };
  const r: any = made.routine, who = r.agent === a.id ? 'I have it' : `${agentName(r.agent)} has it`;
  return { reply: `Done. ${r.desc.charAt(0).toUpperCase() + r.desc.slice(1)}, ${who}.${made.guessed ? ` I took "${made.guessed}" as ${r.when.at}; say a time to change it.` : ''} ${r.needsOk ? 'Anything to send waits for your OK first.' : 'It only reads, so it will not wait for you.'} Next run ${untilText(r.nextAt)}. Say "routines" to see the list, "pause ${r.title.toLowerCase()}" to stop it.`, routine: r };
}

const json = (res: http.ServerResponse, code: number, body: any) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = (req: http.IncomingMessage): Promise<any> => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); });

await rebuildGraph();
const discovering = mcp.discover().then((l: any[]) => { console.log(`  connectors: ${l.filter(s => s.status === 'connected').length} connected of ${l.length} (claude mcp list)`); return l; });
const agentsOut = () => { const setup = setupMap(); return AGENTS.map(a => ({ id: a.id, name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief || '', model: a.model || '', effort: a.effort || '', skills: skills.names(a), lessons: learn.count(BRAIN, a.id), department: a.department, lead: a.lead,
  interviewer: leadOf(a.department).id === a.id, setUp: setup[a.department] })); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/command-centre-v2.html' || url.pathname === '/dark')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      const page = fs.readFileSync(HTML, 'utf8');
      return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page);
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version, backend, provider: MODELS[cfg.model]?.provider || 'antigravity', model: cfg.model, modelName: modelName(cfg.model), models: MODEL_KEYS, effort: cfg.effort || '', efforts: EFFORT_KEYS, name: cfg.name, brain: BRAIN, notes: graph.notes, depts: DEPT_KEYS,
      agents: agentsOut(), setup: setupMap(), routines: (l => ({ count: l.length, paused: l.filter(r => r.paused).length, depts: routines.ALLOWED }))(loadRoutines()), roster: { customised: roster.customised, briefed: roster.briefed, files: roster.files, problems: roster.problems }, skills: (({ count, shipped, brain, problems }) => ({ count, shipped, brain, problems }))(skills.summary()), tools: backend === 'claude-cli', mcp: mcp.summary(), db: db.getStats(), sseClients: sseClients.size });
    if (url.pathname === '/api/company' && req.method === 'POST') {
      const b = await body(req);
      if (b.name) cfg.name = String(b.name).trim();
      if (b.model) cfg.model = normModel(b.model) || cfg.model;
      return json(res, 200, { ok: true, name: cfg.name, model: cfg.model });
    }
    if (url.pathname === '/api/departments' && req.method === 'GET') {
      const deptsMap: Record<string, any> = {};
      for (const k of DEPT_KEYS) {
        if (DEPTS[k]) {
          deptsMap[k] = { ...DEPTS[k], activeCount: AGENTS.filter(a => a.department === k).length };
        }
      }
      return json(res, 200, { ok: true, depts: deptsMap, keys: DEPT_KEYS, departments: deptsMap, coreDepts: DEPT_KEYS });
    }
    if (url.pathname === '/api/departments' && req.method === 'POST') {
      const b = await body(req);
      if (!b.key || !b.name) return json(res, 400, { error: 'Key and name required' });
      const k = String(b.key).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const deptObj = {
        key: k, name: String(b.name).trim(),
        short: String(b.short || b.name).trim(),
        chip: String(b.chip || '#8FD3F4'), ink: String(b.ink || '#2E86AB'),
        floor: String(b.floor || '#E6F4FB'), model: normModel(b.model) || undefined,
        leadName: b.leadName || `${String(b.name).trim().toUpperCase()} LEAD`,
        roles: Array.isArray(b.roles) ? b.roles : (RESERVE_ROLES[k] || [])
      };
      db.addOrUpdateDepartment(deptObj);
      if (!DEPT_KEYS.includes(k)) DEPT_KEYS.push(k);
      if (!DEPT_KEYS.includes('exec')) DEPT_KEYS.unshift('exec');
      DEPTS[k] = { name: deptObj.name, short: deptObj.short, chip: deptObj.chip, ink: deptObj.ink, floor: deptObj.floor };
      DEPTS['exec'] = DEPTS['exec'] || { name: 'EXECUTIVE', short: 'EXEC', chip: '#F59E0B', ink: '#B45309', floor: '#FEF3C7' };
      ensureDepartmentAgents(k, deptObj.name, deptObj.leadName, deptObj.model, deptObj.roles);
      pushEvent('department_created', { key: k });
      const deptsMap: Record<string, any> = {};
      for (const dk of DEPT_KEYS) {
        if (DEPTS[dk]) {
          deptsMap[dk] = { ...DEPTS[dk], activeCount: AGENTS.filter(a => a.department === dk).length };
        }
      }
      return json(res, 200, { ok: true, department: deptObj, keys: DEPT_KEYS, depts: deptsMap, departments: deptsMap, coreDepts: DEPT_KEYS, agents: agentsOut() });
    }
    const dm = url.pathname.match(/^\/api\/departments\/([^/]+)$/);
    if (dm && req.method === 'DELETE') {
      const deptKey = dm[1];
      const result = db.deleteDepartment(deptKey);
      if (!result.ok) return json(res, 400, { error: 'Cannot delete core department' });
      const kIdx = DEPT_KEYS.indexOf(deptKey);
      if (kIdx >= 0) DEPT_KEYS.splice(kIdx, 1);
      delete DEPTS[deptKey];
      for (const rId of result.removedAgents) {
        const aIdx = AGENTS.findIndex(a => a.id === rId);
        if (aIdx >= 0) AGENTS.splice(aIdx, 1);
      }
      pushEvent('department_deleted', { key: deptKey });
      const deptsMap: Record<string, any> = {};
      for (const k of DEPT_KEYS) {
        if (DEPTS[k]) {
          deptsMap[k] = { ...DEPTS[k], activeCount: AGENTS.filter(a => a.department === k).length };
        }
      }
      return json(res, 200, { ok: true, deleted: deptKey, agents: agentsOut(), keys: DEPT_KEYS, depts: deptsMap, departments: deptsMap, coreDepts: DEPT_KEYS });
    }

    const am = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (am && req.method === 'POST') {
      const agentId = am[1];
      const agentObj = AGENTS.find(a => a.id === agentId);
      if (!agentObj) return json(res, 404, { error: 'Agent not found' });
      const b = await body(req);
      for (const k of ['name', 'role', 'does', 'tools', 'model', 'effort', 'brief']) {
        if (!(k in b)) continue;
        if (k === 'name') agentObj.name = String(b.name).trim().slice(0, 32).toUpperCase();
        else if (k === 'tools') agentObj.tools = Array.isArray(b.tools) ? b.tools.map(String).slice(0, 12) : agentObj.tools;
        else if (k === 'model') agentObj.model = normModel(b.model) || '';
        else if (k === 'effort') agentObj.effort = normEffort(b.effort) || '';
        else if (k === 'brief') agentObj.brief = String(b.brief || '').slice(0, 2000);
        else (agentObj as any)[k] = String(b[k]).trim();
      }
      db.addOrUpdateAgent(agentObj);
      console.log(`✎ agent ${agentId} updated`);
      pushEvent('agent_updated', { agentId, dept: agentObj.department });
      return json(res, 200, { ok: true, agent: agentObj, agents: agentsOut() });
    }
    if (am && req.method === 'DELETE') {
      const agentId = am[1];
      const agentObj = AGENTS.find(a => a.id === agentId);
      if (!agentObj) return json(res, 404, { error: 'Agent not found' });
      const CORE_LEADS = ['ceo', 'elead', 'lexi', 'mlead', 'olead', 'alead', 'dlead'];
      if (CORE_LEADS.includes(agentId)) return json(res, 400, { error: 'Core leads cannot be deleted' });
      if (agentObj.lead && AGENTS.filter(a => a.department === agentObj.department).length > 1) {
        return json(res, 400, { error: 'Remove sub-agents from this department before deleting its lead' });
      }
      db.deleteAgent(agentId);
      const aIdx = AGENTS.findIndex(a => a.id === agentId);
      if (aIdx >= 0) AGENTS.splice(aIdx, 1);
      console.log(`- agent ${agentId} deleted`);
      pushEvent('agent_removed', { agentId, dept: agentObj.department });
      return json(res, 200, { ok: true, deleted: agentId, agents: agentsOut() });
    }

    const hm = url.pathname.match(/^\/api\/agents\/([^/]+)\/message$/);
    if (hm && req.method === 'POST') {
      const fromId = hm[1];
      const b = await body(req);
      const toAgent = AGENTS.find(a => a.id === b.toAgent);
      if (!toAgent) return json(res, 404, { error: 'Target agent not found' });
      const task: any = {
        id: nid(), dept: toAgent.department, agent: toAgent.id,
        title: String(b.title || b.task || `Message from ${fromId}`).slice(0, 90),
        text: String(b.task || b.text || '').trim(),
        plan: [], eta: 20, why: `Delegated by ${fromId}`,
        priority: b.priority || 'MEDIUM', state: 'next',
        addedAt: Date.now(), by: fromId
      };
      db.addTask(task);
      db.logAgentEvent('handoff', fromId, { toAgent: toAgent.id, taskId: task.id, payload: { task: task.text } });
      pushEvent('agent_event', { eventType: 'handoff', fromAgent: fromId, toAgent: toAgent.id, taskId: task.id });
      console.log(`✉ ${fromId} → ${toAgent.id}: ${task.title}`);
      return json(res, 200, { ok: true, task });
    }

    const gm = url.pathname.match(/^\/api\/graph\/([^/]+)$/);
    if (gm && req.method === 'GET') {
      const taskId = gm[1];
      const state = db.getGraphState(taskId);
      if (!state) return json(res, 404, { error: 'Graph state not found for task' });
      return json(res, 200, state);
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/api/db/stats' && req.method === 'GET') {
      return json(res, 200, { ok: true, stats: db.getStats(), sseClients: sseClients.size });
    }

    if (url.pathname === '/api/agent-events' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const taskId = url.searchParams.get('taskId') || undefined;
      return json(res, 200, { ok: true, events: db.getAgentEvents(limit, taskId) });
    }

    if (url.pathname === '/api/mcp/config' && req.method === 'POST') {
      const b = await body(req);
      cfg.mcp = cfg.mcp || { allow: [], deny: [], departments: {} };
      if (b.departments) cfg.mcp.departments = { ...cfg.mcp.departments, ...b.departments };
      if (Array.isArray(b.allow)) cfg.mcp.allow = b.allow;
      if (Array.isArray(b.deny)) cfg.mcp.deny = b.deny;
      db.saveConfig(cfg);
      mcp.configure(cfg);
      await mcp.discover();
      return json(res, 200, { ok: true, mcp: cfg.mcp, summary: mcp.summary() });
    }

    if (url.pathname === '/api/mcp/servers' && req.method === 'POST') {
      const b = await body(req);
      if (!b.name) return json(res, 400, { error: 'Server name is required' });
      const id = String(b.id || b.key || b.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      const rec = {
        id,
        name: String(b.name).trim(),
        key: String(b.key || id).toLowerCase().trim(),
        command: String(b.command || '').trim(),
        args: Array.isArray(b.args) ? b.args : [],
        env: typeof b.env === 'object' ? b.env : {},
        depts: Array.isArray(b.depts) ? b.depts : [],
        status: b.status || 'connected',
        source: 'custom',
        allowed: b.allowed !== false,
      };
      db.saveMcpServer(rec);
      await mcp.discover();
      return json(res, 200, { ok: true, server: rec, summary: mcp.summary() });
    }

    if (url.pathname === '/api/mcp/servers' && req.method === 'DELETE') {
      const b = req.method === 'DELETE' ? (await body(req).catch(() => ({}))) : {};
      const id = url.searchParams.get('id') || b.id;
      if (!id) return json(res, 400, { error: 'Server id is required' });
      db.deleteMcpServer(id);
      await mcp.discover();
      return json(res, 200, { ok: true, deleted: id, summary: mcp.summary() });
    }

    if (url.pathname === '/api/agent-status') {
      const tasks = load();
      const activeAgents = new Set(tasks.filter(t => t.state === 'doing').map(t => t.agent));
      const status = Object.fromEntries(AGENTS.map(a => [a.id, { online: true, state: activeAgents.has(a.id) ? 'working' : 'idle' }]));
      return json(res, 200, { ok: true, status });
    }
    if (url.pathname === '/api/agents') return json(res, 200, { agents: agentsOut(), problems: roster.problems, files: roster.files });
    if (url.pathname === '/api/skills') return json(res, 200, refreshSkills().summary());
    if (url.pathname === '/api/lessons') return json(res, 200, { dir: learn.dir(BRAIN), agents: AGENTS.map(a => ({ id: a.id, name: a.name, ...learn.read(BRAIN, a.id) })).filter(x => x.rules.length || x.oneOffs.length) });
    if (url.pathname === '/api/mcp') { if (url.searchParams.get('refresh') === '1') await mcp.discover(); else await discovering; return json(res, 200, { ...mcp.summary(), tools: backend === 'claude-cli' }); }
    if (url.pathname === '/api/brain') return json(res, 200, graph);
    if (url.pathname === '/api/usage') return json(res, 200, await getUsage(url.searchParams.get('refresh') === '1'));
    if (url.pathname === '/api/memories' && req.method === 'GET') {
      const dept = url.searchParams.get('dept') || undefined;
      const agent = url.searchParams.get('agent') || undefined;
      const q = url.searchParams.get('q');
      if (q) return json(res, 200, { ok: true, memories: db.searchMemories(q) });
      return json(res, 200, { ok: true, memories: db.getMemories(dept, agent) });
    }
    if (url.pathname === '/api/memories' && req.method === 'POST') {
      const b = await body(req);
      if (!b.title || !b.content) return json(res, 400, { error: 'title and content required' });
      const record = db.addMemory({ agentId: b.agentId || 'ceo', department: b.department || 'exec', title: b.title, content: b.content, memoryType: b.memoryType || 'note' });
      return json(res, 200, { ok: true, memory: record });
    }
    if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, load());
    if (url.pathname === '/api/routines' && req.method === 'GET') return json(res, 200, routinesOut());
    if (url.pathname === '/api/routines' && req.method === 'POST') {
      const b = await body(req);
      if (!DEPTS[b.dept] || b.dept === 'brain') return json(res, 400, { error: 'unknown department' });
      if (!routines.ALLOWED.includes(b.dept)) return json(res, 400, { error: routines.refusal(b.dept), refused: true });
      const r = await makeRoutine({ dept: b.dept, text: b.text, when: b.when, agent: b.agent, needsOk: b.needsOk, model: b.model, effort: b.effort });
      return json(res, r.error ? 400 : 200, r);
    }
    const rm = url.pathname.match(/^\/api\/routines\/([^/]+)(?:\/(run|pause|resume))?$/);
    if (rm) {
      const r = loadRoutines().find((x: any) => x.id === rm[1]);
      if (!r) return json(res, 404, { error: 'no such routine' });
      if (req.method === 'DELETE') { removeRoutine(r.id); return json(res, 200, { ok: true, routines: loadRoutines() }); }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST or DELETE' });
      if (rm[2] === 'run') return json(res, 200, { ok: true, task: fire(r, { by: 'you' }), routines: loadRoutines() });
      if (rm[2] === 'pause' || rm[2] === 'resume') { editRoutine(r.id, { paused: rm[2] === 'pause' }); return json(res, 200, { ok: true, routines: loadRoutines() }); }
      const b = await body(req); const patch: any = {};
      if (typeof b.needsOk === 'boolean') patch.needsOk = b.needsOk; if (typeof b.paused === 'boolean') patch.paused = b.paused;
      if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim(); if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 90);
      if (b.when && validWhen(b.when)) patch.when = b.when;
      if (b.model !== undefined) patch.model = normModel(b.model) || '';
      if (b.effort !== undefined) patch.effort = normEffort(b.effort) || '';
      editRoutine(r.id, patch); return json(res, 200, { ok: true, routines: loadRoutines() });
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const { dept, text, model, effort, priority } = await body(req);
      if (!DEPTS[dept] || dept === 'brain') return json(res, 400, { error: 'unknown department' });
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty task' });

      if (dept === 'exec') {
        const ceo = AGENTS.find(a => a.is_ceo || a.id === 'ceo') || AGENTS.find(a => a.department === 'exec')!;
        const orchestratorTask: any = {
          id: nid(), dept: 'exec', agent: ceo.id,
          title: String(text).trim().slice(0, 90),
          text: String(text).trim(), plan: [], eta: 120,
          why: 'CEO cross-department orchestration',
          priority: priority || 'HIGH', state: 'doing',
          addedAt: Date.now(), startedAt: Date.now(), by: 'you',
          model: normModel(model) || undefined, effort: normEffort(effort) || undefined
        };
        db.addTask(orchestratorTask);
        pushEvent('task_start', { taskId: orchestratorTask.id, agent: ceo.id, dept: 'exec' });
        console.log(`🎯 ${orchestratorTask.id} [CEO] orchestrating: ${orchestratorTask.title}`);
        enqueue(async () => {
          try {
            const result = await orchestrate(String(text).trim(), orchestratorTask.id, normModel(model) || undefined);
            Object.assign(orchestratorTask, { state: 'done', doneAt: Date.now(), result, error: false });
            db.addTask(orchestratorTask);
            writeNote(orchestratorTask);
            await rebuildGraph();
          } catch (e: any) {
            Object.assign(orchestratorTask, { state: 'done', doneAt: Date.now(), result: `Orchestration failed: ${e.message}`, error: true });
            db.addTask(orchestratorTask);
          }
          pushEvent('task_update', { taskId: orchestratorTask.id, state: orchestratorTask.state, agent: ceo.id, dept: 'exec' });
        }).catch(e => console.warn('orchestrate:', e.message));
        return json(res, 200, orchestratorTask);
      }

      const r = await route(dept, String(text).trim());
      const task = { id: nid(), dept, agent: r.agent, title: r.title, text: String(text).trim(), plan: r.plan, eta: r.eta, why: r.why, priority: priority || 'MEDIUM', state: 'next', addedAt: Date.now(), by: 'you', model: normModel(model) || undefined, effort: normEffort(effort) || undefined };
      db.addTask(task);
      console.log(`+ ${task.id} [${task.priority}] → ${task.agent}: ${task.title}`);
      return json(res, 200, task);
    }
    const m = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|revise|approve|reject|children))?$/);
    if (m && req.method === 'GET' && m[2] === 'children') {
      return json(res, 200, { ok: true, children: db.getChildTasks(m[1]) });
    }
    if (m && req.method === 'POST' && (m[2] === 'approve' || m[2] === 'reject')) {
      const task = db.getTaskById(m[1]);
      if (!task) return json(res, 404, { error: 'no such task' });
      if (task.state !== 'waiting') return json(res, 400, { error: 'this task is not waiting for your OK' });
      const { feedback } = m[2] === 'reject' ? await body(req) : {};
      const note = String(feedback || '').trim();
      console.log(`${m[2] === 'approve' ? '✅' : '↩'} ${task.id} ${m[2] === 'approve' ? 'approved — ' + agentName(task.agent) + ' is sending' : 'sent back: ' + note.slice(0, 80)}`);
      enqueue(() => runServerTask(task.id, m[2] === 'approve' ? { approve: true } : { feedback: note || 'Not this. Rework it.' }))
        .then(t => { if (m[2] === 'reject' && note && t && !t.error) { const a = AGENTS.find(x => x.id === t.agent); return learn.classify(ask, a, t, note).then(v => { const r = learn.record(BRAIN, a, t, note, v); console.log(`  ↳ ${a.name} ${r.standing ? 'learned a rule' : 'noted a one-off'}: ${r.line.slice(0, 100)}`); }); } })
        .catch(e => console.warn('approval:', e.message));
      return json(res, 200, { ok: true, id: task.id, state: 'doing' });
    }
    if (m && req.method === 'POST' && (m[2] === 'run' || m[2] === 'revise')) {
      const task = db.getTaskById(m[1]);
      if (!task) return json(res, 404, { error: 'no such task' });
      const { feedback } = m[2] === 'revise' ? await body(req) : {};
      task.state = 'doing'; task.startedAt = Date.now();
      db.updateTask(task.id, { state: 'doing', startedAt: task.startedAt });
      pushEvent('task_start', { taskId: task.id, agent: task.agent, dept: task.dept });
      try {
        const { result, read, tools, used, skills: sk, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom } = await run(task, feedback);
        Object.assign(task, { state: 'done', doneAt: Date.now(), result, read, tools, used, skills: sk, error: false, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom });
        task.note = writeNote(task);
        await rebuildGraph();
        saveTaskAsMemory(task, task.agent, task.dept);
      } catch (e: any) {
        Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Could not complete this task: ' + e.message, error: true });
      }
      db.addTask(task);
      pushEvent('task_update', { taskId: task.id, state: task.state, agent: task.agent, dept: task.dept, error: task.error });
      console.log(`${task.error ? '✗' : '✓'} ${task.id} ${task.error ? 'failed' : 'done'} (${String(task.result || '').length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
      json(res, 200, task);
      if (feedback && !task.error) {
        const a = AGENTS.find(x => x.id === task.agent);
        learn.classify(ask, a, task, feedback).then(v => { const r = learn.record(BRAIN, a, task, feedback, v); console.log(`  ↳ ${a.name} ${r.standing ? 'learned a rule' : 'noted a one-off'}: ${r.line.slice(0, 100)}`); })
          .catch(e => console.warn('learn:', e.message));
      }
      return;
    }
    if (m && req.method === 'DELETE') { db.deleteTask(m[1]); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { agent, text, history } = await body(req);
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty message' });
      const a = AGENTS.find(x => x.id === agent); if (!a) return json(res, 400, { error: 'unknown agent' });
      if (!onboard.active(DATA, a.department)) {
        const rc = await routinesChat(a, String(text).trim());
        if (rc) return json(res, 200, { reply: rc.reply, read: [], tools: [], interview: false, routine: rc.routine || null, routines: true });
      }
      if (leadOf(a.department).id === a.id) {
        refreshSkills();
        const o = await onboard.handle(String(text).trim(), { dept: a.department, deptName: DEPTS[a.department].name, lead: a, agents: AGENTS.filter(x => x.department === a.department),
          connected: mcp.summary().servers?.filter(x => x.status === 'connected').map((x: any) => x.name || x.key) || [], brainPath: BRAIN, dataDir: DATA, ask, business: cfg.name, afterWrite: refreshSkills });
        if (o) { if (o.wrote) console.log(`★ ${a.name} set up ${DEPTS[a.department].name}: ${o.wrote.briefs.length} briefs${o.wrote.skill ? ', skill ' + o.wrote.skill.name : ''}`); return json(res, 200, { reply: o.reply, read: [], tools: [], interview: !o.wrote, setup: setupMap() }); }
      }
      const r = await chat(agent, String(text).trim(), history);
      return json(res, 200, { ...r, interview: false });
    }
    json(res, 404, { error: 'not found' });
  } catch (e: any) { console.error(e); json(res, 500, { error: e.message }); }
});
server.listen(cfg.port, () => {
  console.log(`Agents Office ${version} → http://localhost:${cfg.port}`);
  const activeProvider = (MODELS[cfg.model]?.provider || 'antigravity').toUpperCase();
  console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${graph.notes} notes, ${graph.links.length} links)   engine: ${activeProvider} · ${modelName(cfg.model)}${cfg.effort ? ' · effort ' + cfg.effort : ''} by default`);
  getUsage(true).then(u => console.log(u.source === 'claude' ? `  usage: session ${u.session?.percent ?? '—'}% · week ${u.week?.percent ?? '—'}% (your AI plan)` : `  usage: AI usage gauge (${u.reason}) — showing office token count`)).catch(() => {});
  console.log(`  tasks: ${FILE}   notes the agents write: ${NOTES_DIR}`);
  const rl = loadRoutines(); const nx = rl.filter(r => !r.paused && r.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
  console.log(`  routines: ${rl.length} loaded${rl.some(r => r.paused) ? ' (' + rl.filter(r => r.paused).length + ' paused)' : ''}${nx ? ' · next ' + untilText(nx.nextAt) + ' ' + nx.title.toUpperCase() + ' (' + nx.agent + ')' : ''} · ${rlist.path}`);
  setInterval(tickRoutines, 20000); tickRoutines();
  console.log(`  agents: 35 (${roster.customised} customised${roster.briefed ? ', ' + roster.briefed + ' briefed' : ''}${roster.files.length ? ' via ' + roster.files.join(' + ') : ''})   tools: ${backend === 'claude-cli' ? 'connected MCP servers' + (cfg.tools?.web === false ? '' : ' + web') : 'none on the API backend'}`);
  const sk = skills.summary(); const setup = setupMap(); const notYet = DEPT_KEYS.filter(k => !setup[k]);
  console.log(`  skills: ${sk.count} (${sk.shipped} shipped in skills/, ${sk.brain} in ${path.join(NOTES_DIR, 'skills')})${sk.problems.length ? '   ⚠ ' + sk.problems.length + ' problem' + (sk.problems.length > 1 ? 's' : '') + ' — see npm run check' : ''}`);
  console.log(`  set up: ${notYet.length === DEPT_KEYS.length ? 'no department yet — open a lead\'s chat and say "set up"' : notYet.length ? DEPT_KEYS.length - notYet.length + ' of 6 departments (not yet: ' + notYet.map(k => DEPTS[k].name).join(', ') + ')' : 'all six departments'}   lessons: ${learn.dir(BRAIN)}`);
});
