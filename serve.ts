// Agents Office — the local server (Beta).
// Serves the office and makes it real on your own Claude login:
//   · the command bar routes a typed task through Claude to the right agent in the department
//   · the agent produces the deliverable, which is saved as a note in your brain folder
//   · the Brain is your vault's real wiki-link graph, rebuilt live as notes are written
//   · chat with any agent is a real conversation in that agent's persona, grounded in your notes
// Everything stays on this machine: data/tasks.json and <brain>/Agents Office/*.md.
//
//   npm start                 → http://localhost:4520
//   PORT=4600 npm start       → another port
//
// Claude backend: the Claude Code CLI (`claude -p`, your existing login) — or the official SDK
// if ANTHROPIC_API_KEY is set. AO_MODEL=<model> overrides the model.
//
// V3.1: the connectors are real — the MCP servers your Claude Code is connected to are what the
// top bar shows and what the agents can call (mcp.ts); the roster is yours (office.agents.json,
// roster.ts). Tool calls only happen on the CLI backend: the SDK path has no MCP servers.
// V3.2: how the work is done is yours too — each agent's `brief` (roster.ts) and the skills
// bound to it (skills.ts: skills/ + <brain>/Agents Office/skills/) go into every task and chat.
// V3.3: the agents learn — every "revise: …" is recorded and standing rules come back into the
// prompt (learn.ts); a department lead interviews the owner in chat and writes the briefs and a
// skill for its team (onboard.ts). Roster, skills and lessons are re-read before every task.
// V3.5: routines — the office keeps its own clock (routines.ts + src/when.js). A routine in
// <brain>/Agents Office/routines.json fires at its minute whether or not the page is open; the
// server creates the task, runs it here, and a result that needs the owner's OK waits in
// WAITING ON APPROVAL until /approve (the agent then does the outbound step) or /reject (with a
// note, which the agent learns from). Emails, Accounting and Sales only in this release.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, ROOT } from './config.ts';
import { db } from './db.ts';
import { layoutGraph, readVault, readOfficeNotes, GraphResult } from './graph-build.ts';
import { DEPTS, DEPT_KEYS } from './src/data.ts';
import * as mcp from './mcp.ts';
import { loadRoster } from './roster.ts';
import { loadSkills } from './skills.ts';
import * as learn from './learn.ts';
import * as onboard from './onboard.ts';
import * as routines from './routines.ts';
import * as usage from './usage.ts';
import { normModel, modelFor, modelArgs, modelId, modelName, MODELS, MODEL_KEYS, DEFAULT_MODEL, normEffort, effortFor, effortName, EFFORT_KEYS } from './src/models.ts';
import { parseWhen, describe, valid as validWhen, untilText } from './src/when.ts';

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

if (Array.isArray(cfg.customDepartments)) {
  for (const d of cfg.customDepartments) {
    if (d.key) {
      if (!DEPT_KEYS.includes(d.key)) DEPT_KEYS.push(d.key);
      DEPTS[d.key] = { name: d.name || d.key.toUpperCase(), short: d.name || d.key.toUpperCase(), chip: d.chip || '#8FD3F4', ink: d.ink || '#2E86AB', floor: d.floor || '#E6F4FB' };
      const leadId = `${d.key}_lead`;
      if (!AGENTS.some(a => a.id === leadId || ((a.dept === d.key || a.department === d.key) && a.lead))) {
        AGENTS.push({ id: leadId, name: d.leadName || `${d.name || d.key.toUpperCase()} LEAD`, dept: d.key, department: d.key, lead: true, grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0', role: `${d.name || d.key} Lead`, does: `Manages ${d.name || d.key} operations`, tools: [], brief: '', model: d.model || '', effort: '' });
      }
    }
  }
}
let skills = loadSkills(BRAIN, AGENTS); // reloaded before every task and chat, so a new skill needs no restart
for (const w of skills.problems) console.warn('skills:', w);
// the roster's editable fields are re-read too (a brief written by the lead's interview, or by hand, lands without a restart)
function reloadRoster() {
  const r = loadRoster(BRAIN);
  for (const a of r.agents) { const cur = AGENTS.find(x => x.id === a.id); if (cur) Object.assign(cur, { name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief }); }
  if (r.problems.join() !== roster.problems.join()) for (const w of r.problems) console.warn('agents:', w);
  Object.assign(roster, { problems: r.problems, customised: r.customised, briefed: r.briefed, files: r.files });
}
const refreshSkills = () => { reloadRoster(); const s = loadSkills(BRAIN, AGENTS); if (s.problems.join() !== skills.problems.join()) for (const w of s.problems) console.warn('skills:', w); skills = s; return s; };
const leadOf = (dept: string) => AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept)!;
const setupMap = () => Object.fromEntries(DEPT_KEYS.map(k => [k, onboard.isSetUp(AGENTS, skills, k)]));

let backend = 'claude-cli', sdk: any = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic(); backend = 'anthropic-sdk';
  } catch (e: any) { console.warn('SDK not installed (npm install @anthropic-ai/sdk) — using the Claude CLI:', e.message.split('\n')[0]); }
}

/* ---------- storage ---------- */
const load = (): any[] => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = (list: any[]) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); };
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* ---------- the usage gauge (V3.6, A3): Claude's own numbers, the office's count underneath ---------- */
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

/* ---------- ask Claude ---------- */
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
  if (isHermes) {
    const fullPrompt = system ? `${system}\n\nUSER REQUEST:\n${user}` : user;
    args = ['-z', fullPrompt];
    if (mObj.flag) args.push('-m', mObj.flag);
    const eff = normEffort(effort) || mObj.effort;
    if (eff) args.push('--reasoning', eff);
  } else if (isAgy) {
    const fullPrompt = system ? `${system}\n\nUSER REQUEST:\n${user}` : user;
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

/* ---------- the brain: graph + context ---------- */
let graph: GraphResult = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() {
  try { graph = await layoutGraph(BRAIN); } catch (e: any) { console.warn('brain graph failed:', e.message); }
  return graph;
}
function vaultIndex(): Map<string, string> { // name → text (vault notes + live office notes)
  const { notes } = readVault(BRAIN); const m = new Map<string, string>();
  for (const [name, n] of notes) m.set(name, n.text);
  for (const n of readOfficeNotes(BRAIN)) m.set(n.name, n.text);
  return m;
}
function businessContext(index: Map<string, string>): string {
  const bits: string[] = [];
  for (const k of ['CLAUDE', 'index', 'business-model', 'voice']) if (index.has(k)) bits.push(`--- ${k}.md ---\n${index.get(k)!.slice(0, 1200)}`);
  return bits.join('\n\n');
}

function relevantNotes(index: Map<string, string>, dept: string, text: string, n = 4): string[] {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const mocName = ({ emails: 'MOC-Emails', sales: 'MOC-Sales', marketing: 'MOC-Marketing', ops: 'MOC-Operations', fin: 'MOC-Finance', delivery: 'MOC-Delivery' } as Record<string, string>)[dept];
  const scored: Array<[number, string]> = [];
  for (const [name, txt] of index) {
    if (['CLAUDE', 'index', 'log'].includes(name)) continue;
    const hay = (name + ' ' + txt.slice(0, 1500)).toLowerCase();
    let s = 0; for (const w of words) if (hay.includes(w)) s += name.toLowerCase().includes(w) ? 3 : 1;
    if (name === mocName) s += 2;
    if (s) scored.push([s, name]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picks = scored.slice(0, n).map(x => x[1]);
  if (mocName && index.has(mocName) && !picks.includes(mocName)) picks.push(mocName);
  return picks;
}
function contextText(index: Map<string, string>, names: string[]): string {
  return names.map(n => `--- ${n}.md ---\n${(index.get(n) || '').slice(0, 1800)}`).join('\n\n');
}

/* ---------- the roster, as Claude sees it ---------- */
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

async function run(task: any, feedback?: string, mode?: string) { // mode: undefined (a task from the bar) · 'routine' (read-only routine) · 'draft' (routine that waits for the OK) · 'approve' (the owner ticked it)
  const a = AGENTS.find(x => x.id === task.agent)!, d = DEPTS[a.department];
  refreshSkills();
  const index = vaultIndex();
  const read = relevantNotes(index, a.department, task.title + ' ' + task.text);
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${a.does}\n${agentBrief(a)}` +
    'Write the finished deliverable itself, not a description of what you would do. Plain text: a short heading, then short sections or bullets. ' +
    'At most 260 words unless a skill or the owner\'s instructions set a different shape — those win. No preamble, no sign-off. Ground it in the company notes below; where a fact is missing, make a reasonable assumption and mark it (assumed). ' +
    'If you used a tool, say so in one line at the end ("Used: Gmail — searched the client thread").\n\n' +
    `${mcp.promptText(a.tools)}\n\nCOMPANY NOTES\n${businessContext(index)}\n\nNOTES YOU READ FOR THIS TASK\n${contextText(index, read)}`;
  const routineLine = task.routine ? `\nThis is a routine (${task.when}): it runs on the office's own clock and the owner is not at the keyboard. It is now ${new Date().toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${task.late ? `; this run is late, it was due ${new Date(task.due).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Do the work for now.` : '';
  const modeLine = mode === 'draft' ? '\nPrepare everything, but send, post, pay or change NOTHING outside this machine: the owner reads this first and approves it. End with one line saying exactly what will go out when approved (or that nothing needs to).'
    : mode === 'approve' ? `\nThe owner has APPROVED the draft below. Carry out the outbound step now, exactly as drafted, with your tools (send, post, update). If a tool you need is not connected, say so and show what you would have sent. Then report in one short section: what went out, to whom, and anything that did not.\nApproved draft:\n${task.draft || task.result}` : '';
  const user = `Task: ${task.title}\nOwner's request: ${task.text}` + (task.plan?.length ? `\nAgreed plan: ${task.plan.join(' → ')}` : '') + routineLine + modeLine +
    (feedback && mode !== 'approve' ? `\n\nThe owner reviewed your previous version and asked for changes: "${feedback}"\nPrevious version:\n${task.result}` : '');
  const pick = modelFor({ task: task.model, routine: task.routineModel, agent: a.model, office: cfg.model }); // four places, one precedence
  const eff = effortFor({ task: task.effort, routine: task.routineEffort, agent: a.effort, office: cfg.effort, model: pick.model }); // same places, then the model's own
  const { text, tools, modelId: ran } = await askX(system, user, { model: pick.model, effort: eff.effort });
  if (!text) throw new Error('Claude returned nothing');
  return { result: text, read, tools: toolKeys(tools), used: mcp.namesOf(tools), skills: skills.names(a), modelUsed: pick.model, modelFrom: pick.from, modelId: ran, effortUsed: eff.effort || '', effortFrom: eff.from };
}

function writeNote(task: any): string { // the deliverable becomes a note in the brain, linked to what was read
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const a = AGENTS.find(x => x.id === task.agent)!;
  const name = `${new Date(task.doneAt).toISOString().slice(0, 10)} ${slug(task.title)}`;
  const body = `---\nagent: ${a.name}\ndepartment: ${DEPTS[a.department].name}\ntask: ${task.id}\ndone: ${new Date(task.doneAt).toISOString()}${task.used?.length ? '\ntools: ' + task.used.join(', ') : ''}${task.skills?.length ? '\nskills: ' + task.skills.join(', ') : ''}${task.routine ? '\nroutine: ' + task.when + (task.late ? ' (late)' : '') : ''}${task.modelUsed ? '\nmodel: ' + modelName(task.modelUsed) + (task.modelFrom && task.modelFrom !== 'office' ? ' (' + task.modelFrom + ')' : '') : ''}${task.effortUsed ? '\neffort: ' + task.effortUsed + (task.effortFrom && task.effortFrom !== 'model' ? ' (' + task.effortFrom + ')' : '') : ''}${task.approved ? '\napproved: ' + new Date(task.approvedAt).toISOString() : ''}\n---\n` +
    `# ${task.title}\n\n${task.result}\n\n---\nRead: ${(task.read || []).map((n: string) => `[[${n}]]`).join(' · ') || '—'}\n`;
  fs.writeFileSync(path.join(NOTES_DIR, name + '.md'), body);
  return name;
}

async function chat(agentId: string, text: string, history?: any[]) {
  const a = AGENTS.find(x => x.id === agentId); if (!a) throw new Error('unknown agent');
  const d = DEPTS[a.department]; refreshSkills();
  const index = vaultIndex();
  const read = relevantNotes(index, a.department, text, 3);
  const mine = load().filter(t => t.agent === agentId).slice(-6).map(t => `- [${t.state}] ${t.title}`).join('\n');
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${a.does}\n${agentBrief(a)}` +
    'You are talking to the owner. Answer as this agent, in first person, briefly (under 120 words unless asked for detail), plainly, no hype. ' +
    'Use the company notes; say when something is not in them. If the owner asks you to look something up, use your tools. Nothing outbound is sent without the owner\'s explicit say-so.\n\n' +
    `${mcp.promptText(a.tools)}\n\nCOMPANY NOTES\n${businessContext(index)}\n\nRELEVANT NOTES\n${contextText(index, read)}\n\nYOUR RECENT TASKS\n${mine || '—'}`;
  const convo = (history || []).slice(-8).map(m => `${m.who === 'user' ? 'Owner' : a.name}: ${m.text}`).join('\n');
  const { text: reply, tools } = await askX(system, (convo ? convo + '\n' : '') + `Owner: ${text}\n${a.name}:`, { maxTokens: 1200, model: modelFor({ agent: a.model, office: cfg.model }).model, effort: effortFor({ agent: a.effort, office: cfg.effort, model: modelFor({ agent: a.model, office: cfg.model }).model }).effort });
  return { reply, read, tools: toolKeys(tools), used: mcp.namesOf(tools) };
}

/* ---------- routines: the office's own clock (V3.5) ---------- */
const RSTATE = routines.loadState(DATA);
let rlist: { routines: any[]; problems: string[]; path: string } = { routines: [], problems: [], path: routines.file(BRAIN) };
function loadRoutines() { // re-read from disk every time: a routine written by Claude Code, or by hand, lands without a restart
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
function fire(r: any, { due = Date.now(), late = false, by = 'routine' } = {}) { // the routine becomes a task and runs here, page or no page
  const task = { id: nid(), dept: r.dept, agent: r.agent, title: r.title, text: r.text, plan: r.plan || [], eta: 15, why: '', state: 'next', addedAt: Date.now(), by, routine: r.id, when: r.desc || describe(r.when), needsOk: r.needsOk, due, late, routineModel: r.model || undefined, routineEffort: r.effort || undefined };
  const list = load(); list.push(task); save(list);
  routines.advance(RSTATE, r, Date.now(), task.id, late); routines.saveState(DATA, RSTATE);
  console.log(`⏱ ${task.id} → ${task.agent}: ${task.title}${late ? ' (LATE · was due ' + new Date(due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}`);
  enqueue(() => runServerTask(task.id));
  return task;
}

async function runServerTask(id: string, { feedback, approve }: { feedback?: string; approve?: boolean } = {}): Promise<any> {
  let list = load(); const task = list.find(t => t.id === id); if (!task) return null;
  task.state = 'doing'; task.startedAt = Date.now(); delete task.ask; save(list);
  try {
    const out = await run(task, feedback, approve ? 'approve' : task.needsOk ? 'draft' : 'routine');
    if (approve) { task.result = (task.draft || task.result) + '\n\n---\nAFTER YOUR OK\n' + out.result; task.approved = true; task.approvedAt = Date.now(); }
    else task.result = out.result;
    Object.assign(task, { read: out.read, tools: [...new Set([...(task.tools || []), ...out.tools])], used: [...new Set([...(task.used || []), ...out.used])], skills: out.skills, error: false, modelUsed: out.modelUsed, modelFrom: out.modelFrom, modelId: out.modelId, effortUsed: out.effortUsed, effortFrom: out.effortFrom });
    if (task.needsOk && !approve) { task.state = 'waiting'; task.draft = out.result; task.waitingAt = Date.now(); task.ask = routines.askLine(task); }
    else { task.state = 'done'; task.doneAt = Date.now(); task.note = writeNote(task); await rebuildGraph(); }
  } catch (e: any) {
    Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Could not complete this task: ' + e.message, error: true });
  }
  list = load(); const i = list.findIndex(t => t.id === task.id); if (i >= 0) list[i] = task; save(list);
  console.log(`${task.error ? '✗' : task.state === 'waiting' ? '⏸' : '✓'} ${task.id} ${task.error ? 'failed' : task.state === 'waiting' ? 'waiting for your OK' : 'done'} (${task.result.length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
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

/* ---------- http ---------- */
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
      return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page); // /dark: the same file, opened in dark mode
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version, backend, provider: MODELS[cfg.model]?.provider || 'antigravity', model: cfg.model, modelName: modelName(cfg.model), models: MODEL_KEYS, effort: cfg.effort || '', efforts: EFFORT_KEYS, name: cfg.name, brain: BRAIN, notes: graph.notes, depts: DEPT_KEYS,
      agents: agentsOut(), setup: setupMap(), routines: (l => ({ count: l.length, paused: l.filter(r => r.paused).length, depts: routines.ALLOWED }))(loadRoutines()), roster: { customised: roster.customised, briefed: roster.briefed, files: roster.files, problems: roster.problems }, skills: (({ count, shipped, brain, problems }) => ({ count, shipped, brain, problems }))(skills.summary()), tools: backend === 'claude-cli', mcp: mcp.summary() });
    if (url.pathname === '/api/company' && req.method === 'POST') {
      const b = await body(req);
      if (b.name) cfg.name = String(b.name).trim();
      if (b.model) cfg.model = normModel(b.model) || cfg.model;
      return json(res, 200, { ok: true, name: cfg.name, model: cfg.model });
    }
    if (url.pathname === '/api/departments' && req.method === 'GET') {
      const deptsMap: Record<string, any> = {};
      for (const k of DEPT_KEYS) {
        deptsMap[k] = { ...DEPTS[k], model: cfg.departments?.[k]?.model || '' };
      }
      return json(res, 200, { ok: true, depts: deptsMap, keys: DEPT_KEYS, custom: cfg.customDepartments || [], models: cfg.departments || {} });
    }
    if (url.pathname === '/api/departments' && req.method === 'POST') {
      const b = await body(req);
      const key = String(b.key || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '').trim();
      if (!key) return json(res, 400, { error: 'Department key is required' });
      const name = String(b.name || key).toUpperCase().trim();
      const chip = b.chip || '#8FD3F4';
      const ink = b.ink || '#2E86AB';
      const floor = b.floor || '#E6F4FB';
      const model = normModel(b.model) || '';
      const leadName = String(b.leadName || `${name} LEAD`).toUpperCase().trim();

      cfg.customDepartments = cfg.customDepartments || [];
      const existingIdx = cfg.customDepartments.findIndex((d: any) => d.key === key);
      const deptObj = { key, name, short: name, chip, ink, floor, model, leadName };
      if (existingIdx >= 0) cfg.customDepartments[existingIdx] = deptObj;
      else cfg.customDepartments.push(deptObj);

      if (!DEPT_KEYS.includes(key)) DEPT_KEYS.push(key);
      DEPTS[key] = { name, short: name, chip, ink, floor };
      if (model) {
        cfg.departments = cfg.departments || {};
        cfg.departments[key] = { model };
      }

      // Ensure Lead Agent exists
      const leadId = `${key}_lead`;
      let agent = AGENTS.find(a => a.id === leadId || ((a.dept === key || a.department === key) && a.lead));
      if (!agent) {
        agent = { id: leadId, name: leadName, dept: key, department: key, lead: true, grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0', role: `${name} Lead`, does: `Manages ${name} operations`, tools: [], brief: '', model, effort: '' };
        AGENTS.push(agent);
      } else {
        if (leadName) agent.name = leadName;
        if (model) agent.model = model;
        agent.dept = key;
        agent.department = key;
      }

      // Save to office.config.json & office.agents.json
      const configPath = path.join(ROOT, 'office.config.json');
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        fileConfig.customDepartments = cfg.customDepartments;
        fileConfig.departments = cfg.departments || {};
        fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));
      } catch (e: any) {
        console.warn('Could not save office.config.json:', e.message);
      }

      const agentsPath = path.join(ROOT, 'office.agents.json');
      try {
        let fileAgentsDoc: any = { allowCustomSeats: true, agents: [] };
        if (fs.existsSync(agentsPath)) {
          fileAgentsDoc = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
        }
        fileAgentsDoc.allowCustomSeats = true;
        fileAgentsDoc.agents = fileAgentsDoc.agents || [];
        const existingIdx = fileAgentsDoc.agents.findIndex((a: any) => a.id === agent.id);
        const agentEntry = { id: agent.id, department: key, lead: true, name: agent.name, role: agent.role, does: agent.does, tools: agent.tools || [], brief: agent.brief || '', model: agent.model || '', effort: agent.effort || '' };
        if (existingIdx >= 0) fileAgentsDoc.agents[existingIdx] = agentEntry;
        else fileAgentsDoc.agents.push(agentEntry);
        fs.writeFileSync(agentsPath, JSON.stringify(fileAgentsDoc, null, 2));
      } catch (e: any) {
        console.warn('Could not save office.agents.json:', e.message);
      }

      const deptsMap: Record<string, any> = {};
      for (const k of DEPT_KEYS) {
        deptsMap[k] = { ...DEPTS[k], model: cfg.departments?.[k]?.model || '' };
      }
      return json(res, 200, { ok: true, department: deptObj, depts: deptsMap, keys: DEPT_KEYS, agents: agentsOut() });
    }

    const dm = url.pathname.match(/^\/api\/departments\/([^/]+)$/);
    if (dm && req.method === 'DELETE') {
      const deptKey = dm[1];
      if (['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery', 'brain'].includes(deptKey)) {
        return json(res, 400, { error: 'Core default departments cannot be disbanded.' });
      }
      const { removedAgents } = db.deleteDepartment(deptKey);
      
      const kIdx = DEPT_KEYS.indexOf(deptKey);
      if (kIdx >= 0) DEPT_KEYS.splice(kIdx, 1);
      delete DEPTS[deptKey];
      delete cfg.departments?.[deptKey];
      cfg.customDepartments = (cfg.customDepartments || []).filter((d: any) => d.key !== deptKey);

      for (let i = AGENTS.length - 1; i >= 0; i--) {
        if (AGENTS[i].dept === deptKey || AGENTS[i].department === deptKey || removedAgents.includes(AGENTS[i].id)) {
          AGENTS.splice(i, 1);
        }
      }

      const deptsMap: Record<string, any> = {};
      for (const k of DEPT_KEYS) {
        deptsMap[k] = { ...DEPTS[k], model: cfg.departments?.[k]?.model || '' };
      }
      return json(res, 200, { ok: true, deleted: deptKey, depts: deptsMap, keys: DEPT_KEYS, agents: agentsOut() });
    }

    const am = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (am && req.method === 'DELETE') {
      const agentId = am[1];
      const agentObj = AGENTS.find(a => a.id === agentId);
      if (!agentObj) return json(res, 404, { error: 'Agent not found' });
      db.deleteAgent(agentId);
      const aIdx = AGENTS.findIndex(a => a.id === agentId);
      if (aIdx >= 0) AGENTS.splice(aIdx, 1);
      return json(res, 200, { ok: true, deleted: agentId, agents: agentsOut() });
    }

    if (url.pathname === '/api/mcp/config' && req.method === 'POST') {
      const b = await body(req);
      cfg.mcp = cfg.mcp || { allow: [], deny: [], departments: {} };
      if (b.departments) cfg.mcp.departments = { ...cfg.mcp.departments, ...b.departments };
      db.saveConfig(cfg);
      return json(res, 200, { ok: true, mcp: cfg.mcp });
    }

    if (url.pathname === '/api/agent-status') {
      const tasks = load();
      const activeAgents = new Set(tasks.filter(t => t.state === 'doing').map(t => t.agent));
      const status = Object.fromEntries(AGENTS.map(a => [a.id, { online: true, state: activeAgents.has(a.id) ? 'working' : 'idle' }]));
      return json(res, 200, { ok: true, status });
    }
    if (url.pathname === '/api/agents') return json(res, 200, { agents: agentsOut(), problems: roster.problems, files: roster.files });
    if (url.pathname === '/api/skills') return json(res, 200, refreshSkills().summary()); // reloads from disk: edit a skill, hit this, see it
    if (url.pathname === '/api/lessons') return json(res, 200, { dir: learn.dir(BRAIN), agents: AGENTS.map(a => ({ id: a.id, name: a.name, ...learn.read(BRAIN, a.id) })).filter(x => x.rules.length || x.oneOffs.length) });
    if (url.pathname === '/api/mcp') { if (url.searchParams.get('refresh') === '1') await mcp.discover(); else await discovering; return json(res, 200, { ...mcp.summary(), tools: backend === 'claude-cli' }); }
    if (url.pathname === '/api/brain') return json(res, 200, graph);
    if (url.pathname === '/api/usage') return json(res, 200, await getUsage(url.searchParams.get('refresh') === '1')); // V3.6: the plan's gauge (never a 500: unavailable is an answer)
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
      const r = await route(dept, String(text).trim());
      const task = { id: nid(), dept, agent: r.agent, title: r.title, text: String(text).trim(), plan: r.plan, eta: r.eta, why: r.why, priority: priority || 'MEDIUM', state: 'next', addedAt: Date.now(), by: 'you', model: normModel(model) || undefined, effort: normEffort(effort) || undefined };
      const list = load(); list.push(task); save(list);
      console.log(`+ ${task.id} [${task.priority}] → ${task.agent}: ${task.title}`);
      return json(res, 200, task);
    }
    const m = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|revise|approve|reject))?$/);
    if (m && req.method === 'POST' && (m[2] === 'approve' || m[2] === 'reject')) { // D1: the owner's tick on a routine's draft
      const task = load().find(t => t.id === m[1]);
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
      const list = load(); const task = list.find(t => t.id === m[1]);
      if (!task) return json(res, 404, { error: 'no such task' });
      const { feedback } = m[2] === 'revise' ? await body(req) : {};
      task.state = 'doing'; task.startedAt = Date.now(); save(list);
      try {
        const { result, read, tools, used, skills: sk, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom } = await run(task, feedback);
        Object.assign(task, { state: 'done', doneAt: Date.now(), result, read, tools, used, skills: sk, error: false, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom });
        task.note = writeNote(task);
        await rebuildGraph();
      } catch (e: any) {
        Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Could not complete this task: ' + e.message, error: true });
      }
      const l2 = load(); const i = l2.findIndex(t => t.id === task.id); if (i >= 0) l2[i] = task; save(l2);
      console.log(`${task.error ? '✗' : '✓'} ${task.id} ${task.error ? 'failed' : 'done'} (${task.result.length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
      json(res, 200, task);
      if (feedback && !task.error) { // learn from the correction, after the reply is out the door
        const a = AGENTS.find(x => x.id === task.agent);
        learn.classify(ask, a, task, feedback).then(v => { const r = learn.record(BRAIN, a, task, feedback, v); console.log(`  ↳ ${a.name} ${r.standing ? 'learned a rule' : 'noted a one-off'}: ${r.line.slice(0, 100)}`); })
          .catch(e => console.warn('learn:', e.message));
      }
      return;
    }
    if (m && req.method === 'DELETE') { save(load().filter(t => t.id !== m[1])); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { agent, text, history } = await body(req);
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty message' });
      const a = AGENTS.find(x => x.id === agent); if (!a) return json(res, 400, { error: 'unknown agent' });
      if (!onboard.active(DATA, a.department)) { // V3.5: "every weekday at 8am, …" · "routines" · "pause …" · "run … now" — unless the lead is mid-interview
        const rc = await routinesChat(a, String(text).trim());
        if (rc) return json(res, 200, { reply: rc.reply, read: [], tools: [], interview: false, routine: rc.routine || null, routines: true });
      }
      if (leadOf(a.department).id === a.id) { // the department lead can run the set-up interview
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
  setInterval(tickRoutines, 20000); tickRoutines(); // the clock: every 20 s; the first tick catches up anything missed while the office was off (once, marked LATE)
  console.log(`  agents: 35 (${roster.customised} customised${roster.briefed ? ', ' + roster.briefed + ' briefed' : ''}${roster.files.length ? ' via ' + roster.files.join(' + ') : ''})   tools: ${backend === 'claude-cli' ? 'connected MCP servers' + (cfg.tools?.web === false ? '' : ' + web') : 'none on the API backend'}`);
  const sk = skills.summary(); const setup = setupMap(); const notYet = DEPT_KEYS.filter(k => !setup[k]);
  console.log(`  skills: ${sk.count} (${sk.shipped} shipped in skills/, ${sk.brain} in ${path.join(NOTES_DIR, 'skills')})${sk.problems.length ? '   ⚠ ' + sk.problems.length + ' problem' + (sk.problems.length > 1 ? 's' : '') + ' — see npm run check' : ''}`);
  console.log(`  set up: ${notYet.length === DEPT_KEYS.length ? 'no department yet — open a lead\'s chat and say "set up"' : notYet.length ? DEPT_KEYS.length - notYet.length + ' of 6 departments (not yet: ' + notYet.map(k => DEPTS[k].name).join(', ') + ')' : 'all six departments'}   lessons: ${learn.dir(BRAIN)}`);
});
