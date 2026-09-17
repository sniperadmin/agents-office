// Agents Office V3.5 — routines: tasks the office does on its own clock.
import fs from 'node:fs';
import path from 'node:path';
import { describe, nextRun, valid } from './src/when.ts';
import { MODEL_KEYS, normModel } from './src/models.ts';

export const ALLOWED = ['emails', 'fin', 'sales', 'marketing', 'ops', 'delivery', 'design', 'dev', 'qa'];
export const NAMES: Record<string, string> = { emails: 'Emails', fin: 'Accounting', sales: 'Sales', marketing: 'Marketing', ops: 'Operations', delivery: 'Delivery', design: 'Design', dev: 'Development', qa: 'QA' };
export const file = (brainPath: string): string => path.join(brainPath, 'Agents Office', 'routines.json');
export const stateFile = (dataDir: string): string => path.join(dataDir, 'routines.json');
export const LATE_AFTER = 90 * 1000;

const slug = (t: any): string => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const readJSON = (p: string, fallback: any): any => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

export function refusal(dept: string): string {
  return `Department "${dept}" is not recognized for routines.`;
}

export function validate(r: any, agents: any[], existing: any[] = []) {
  const problems: string[] = [];
  const out: any = {};
  const a = agents.find(x => x.id === r.agent);
  out.dept = r.dept || (a && a.department);
  if (!a) problems.push(`${r.id || r.title || 'routine'}: no agent called "${r.agent}"`);
  else if (a.department !== out.dept) problems.push(`${r.id || r.title || 'routine'}: ${a.name} is in ${NAMES[a.department] || a.department}, not ${NAMES[out.dept] || out.dept}`);
  out.agent = r.agent;
  out.text = String(r.text || '').trim();
  if (!out.text) problems.push(`${r.id || 'routine'}: no task text`);
  out.title = String(r.title || out.text).trim().slice(0, 90);
  out.id = String(r.id || slug(out.title) || 'routine');
  if (existing.some(x => x.id === out.id)) problems.push(`${out.id}: two routines share this id`);
  out.when = r.when;
  if (!valid(out.when)) problems.push(`${out.id}: the schedule is not complete (${JSON.stringify(r.when || null)}) — see src/when.js`);
  out.needsOk = r.needsOk !== false;
  out.paused = r.paused === true;
  if (Array.isArray(r.plan)) out.plan = r.plan.slice(0, 4).map(String);
  if (r.model !== undefined && r.model !== '' && r.model !== null) { const m = normModel(r.model); if (m) out.model = m; else problems.push(`${out.id}: model must be one of ${MODEL_KEYS.join(', ')} (got "${r.model}")`); }
  if (r.effort !== undefined && r.effort !== '' && r.effort !== null) { const e = String(r.effort).toLowerCase().trim(); if (['low', 'medium', 'high', 'xhigh', 'max'].includes(e)) out.effort = e; else problems.push(`${out.id}: effort must be low, medium, high, xhigh or max (got "${r.effort}")`); }
  return { routine: out, problems };
}

export function load(brainPath: string, agents: any[]) {
  const p = file(brainPath);
  const doc = readJSON(p, null);
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.routines) ? doc.routines : [];
  const routines: any[] = [], problems: string[] = [];
  if (doc && !Array.isArray(doc) && !Array.isArray(doc.routines)) problems.push(`${p}: expected {"routines": [...]}`);
  for (const r of list) {
    const v = validate(r, agents, routines);
    if (v.problems.length) problems.push(...v.problems); else routines.push(v.routine);
  }
  return { routines, problems, path: p, exists: fs.existsSync(p) };
}

export function save(brainPath: string, routines: any[]) {
  const p = file(brainPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const clean = routines.map(r => ({ id: r.id, dept: r.dept, agent: r.agent, title: r.title, text: r.text, when: r.when, needsOk: r.needsOk, paused: r.paused, ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}), ...(r.plan ? { plan: r.plan } : {}) }));
  fs.writeFileSync(p, JSON.stringify({ routines: clean }, null, 2) + '\n');
  return p;
}

export const loadState = (dataDir: string): any => readJSON(stateFile(dataDir), {});
export function saveState(dataDir: string, st: any) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile(dataDir), JSON.stringify(st, null, 2)); }

export function withState(routines: any[], st: any, now = Date.now()) {
  let changed = false;
  const out = routines.map(r => {
    const s = st[r.id] || (st[r.id] = {});
    if (!s.nextAt || s.when !== JSON.stringify(r.when)) { s.nextAt = nextRun(r.when, now); s.when = JSON.stringify(r.when); changed = true; }
    return { ...r, desc: describe(r.when), nextAt: r.paused ? null : s.nextAt, lastAt: s.lastAt || null, runs: s.runs || 0, lastTaskId: s.lastTaskId || null, lastLate: !!s.lastLate };
  });
  for (const id of Object.keys(st)) if (!routines.some(r => r.id === id)) { delete st[id]; changed = true; }
  return { list: out, changed };
}

export function due(routines: any[], st: any, now = Date.now()) {
  const hits: any[] = [];
  for (const r of routines) {
    if (r.paused) continue;
    const s = st[r.id]; if (!s || !s.nextAt) continue;
    if (s.nextAt <= now) hits.push({ routine: r, due: s.nextAt, late: now - s.nextAt > LATE_AFTER });
  }
  return hits;
}

export function advance(st: any, r: any, now = Date.now(), taskId: string | null = null, late = false) {
  const s = st[r.id] || (st[r.id] = {});
  s.lastAt = now; s.runs = (s.runs || 0) + 1; s.lastTaskId = taskId; s.lastLate = late;
  s.nextAt = nextRun(r.when, now);
  return s;
}

export function guessNeedsOk(text: string): boolean {
  const t = String(text).toLowerCase();
  const outbound = /\b(send|sends|email them|reply to|replies|respond|chase|nudge|remind|reminder|post|publish|pay|invoice them|book|schedule a|cancel|update the crm|delete|forward|message)\b/.test(t);
  const readOnly = /\b(list|summari[sz]e|triage|tell me|what|report|match|reconcile|qualify|review|check|read|find|flag|count|draft)\b/.test(t);
  if (/\bdraft\b/.test(t) && !/\bsend\b/.test(t)) return true;
  return outbound || !readOnly;
}

export function askLine(task: any): string {
  return `"${task.title}" is done and waiting for your OK — approve to send it, reject to tell me what to change.`;
}

export function listText(list: any[], dept: string, agents: any[]): string {
  const mine = list.filter(r => r.dept === dept);
  if (!mine.length) return `Nothing on the ${NAMES[dept]} timetable yet. Give me one with a time in it — "every weekday at 8am, …" — and I will put it on.`;
  const name = (id: string) => agents.find(a => a.id === id)?.name || id;
  return `${NAMES[dept]} routines:\n` + mine.map(r => `• ${r.title} — ${r.desc} · ${name(r.agent)}${r.paused ? ' · PAUSED' : ''}${r.needsOk ? ' · waits for your OK' : ' · read-only'}`).join('\n') +
    `\n\nSay "pause …", "resume …", "run … now" or "delete …" with a few words from the name.`;
}

export function matchRoutine(list: any[], dept: string, words: string): any {
  const w = String(words).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2 && !['the', 'one', 'now', 'routine', 'and', 'please'].includes(x));
  let best: any = null, bestN = 0;
  for (const r of list.filter(r => r.dept === dept)) {
    const hay = (r.title + ' ' + r.text + ' ' + r.desc + ' ' + (r.when.at || '')).toLowerCase();
    const n = w.filter(x => hay.includes(x)).length;
    if (n > bestN) { bestN = n; best = r; }
  }
  return bestN ? best : null;
}
