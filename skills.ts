// Agents Office — skills (Beta).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.ts';
import { DEPT_KEYS } from './src/data.ts';

export const SHIPPED = path.join(ROOT, 'skills');
export const GLOBAL_SKILLS = '/home/nasr/.gemini/config/skills';
export const brainDir = (brainPath: string): string => path.join(brainPath, 'Agents Office', 'skills');
const LIMITS = { body: 6000, files: 8000, perFile: 4000 };
const TEXT = /\.(md|txt|csv|json|ya?ml|html?|xml|tsv)$/i;

export function parseSkill(text: string) {
  const meta: Record<string, any> = {}; let body = text;
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = text.slice(m[0].length);
    let key: string | null = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (kv) {
        key = kv[1].toLowerCase(); const v = kv[2].trim();
        if (v.startsWith('[')) meta[key] = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        else if (v === '') meta[key] = [];
        else meta[key] = v.replace(/^["']|["']$/g, '');
      } else if (key && /^\s*-\s+/.test(line)) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, '')); }
    }
  }
  return { meta, body: body.trim() };
}

function readOne(where: string, entry: fs.Dirent, agents: any[], problems: string[]) {
  const p = path.join(where, entry.name);
  let file: string, dir: string | null = null;
  if (entry.isDirectory()) { file = path.join(p, 'SKILL.md'); dir = p; if (!fs.existsSync(file)) { problems.push(`${entry.name}: missing SKILL.md`); return null; } }
  else if (/\.md$/i.test(entry.name) && entry.name.toUpperCase() !== 'README.MD') file = p;
  else return null;
  const { meta, body } = parseSkill(fs.readFileSync(file, 'utf8'));
  const name = String(meta.name || (dir ? entry.name : entry.name.replace(/\.md$/i, ''))).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const label = dir ? entry.name + '/SKILL.md' : entry.name;
  if (!body) return null;
  const list = (v: any) => v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'none') : String(v).split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'none');
  const ids = new Set(agents.map(a => a.id));
  const rawAgents = [...list(meta.agents), ...(meta.id ? [String(meta.id)] : [])];
  const bound: string[] = [];
  for (const ag of rawAgents) {
    const low = ag.toLowerCase();
    if (ids.has(low)) { if (!bound.includes(low)) bound.push(low); }
    else problems.push(`${label}: agent "${ag}" does not exist — ignored`);
  }
  const rawDepts = [...list(meta.departments), ...list(meta.department)];
  const depts: string[] = [];
  for (const dp of rawDepts) {
    const low = dp.toLowerCase();
    if (DEPT_KEYS.includes(low)) { if (!depts.includes(low)) depts.push(low); }
    else problems.push(`${label}: department "${dp}" does not exist — ignored`);
  }
  for (const k of Object.keys(meta)) if (!['name', 'description', 'agents', 'departments', 'department', 'risk', 'source', 'date_added', 'id', 'role', 'title', 'reportsto', 'budget', 'color', 'emoji', 'adapter', 'signal', 'tools', 'skills', 'context_tier'].includes(k)) problems.push(`${label}: unknown field "${k}" — ignored`);
  const hasExplicitTarget = rawAgents.length > 0 || rawDepts.length > 0;
  if (hasExplicitTarget && bound.length === 0 && depts.length === 0) return null;
  const everyone = !hasExplicitTarget;
  let text = body.length > LIMITS.body ? body.slice(0, LIMITS.body) + '\n[… trimmed]' : body;
  if (body.length > LIMITS.body && where !== GLOBAL_SKILLS) problems.push(`${label}: over ${LIMITS.body} characters — trimmed; move detail into files beside it`);
  const files: { name: string; text: string | null }[] = [];
  if (dir) {
    let used = 0;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f === 'SKILL.md' || f.startsWith('.')) continue;
      const fp = path.join(dir, f); if (!fs.statSync(fp).isFile()) continue;
      if (!TEXT.test(f)) { files.push({ name: f, text: null }); continue; }
      let t = fs.readFileSync(fp, 'utf8').trim();
      if (used >= LIMITS.files) { files.push({ name: f, text: null }); problems.push(`${entry.name}/${f}: skill files over ${LIMITS.files} characters — listed by name only`); continue; }
      if (t.length > LIMITS.perFile) { t = t.slice(0, LIMITS.perFile) + '\n[… trimmed]'; problems.push(`${entry.name}/${f}: over ${LIMITS.perFile} characters — trimmed`); }
      used += t.length; files.push({ name: f, text: t });
    }
  }
  return { name, description: String(meta.description || '').trim().slice(0, 160), agents: bound, departments: depts, everyone, text, files, path: path.relative(ROOT, file), source: where === SHIPPED ? 'shipped' : where === GLOBAL_SKILLS ? 'global' : 'brain' };
}

export function loadSkills(brainPath: string, agents: any[]) {
  const problems: string[] = []; const byName = new Map<string, any>();
  for (const where of [GLOBAL_SKILLS, SHIPPED, brainDir(brainPath)]) {
    if (!fs.existsSync(where)) continue;
    let ents: fs.Dirent[]; try { ents = fs.readdirSync(where, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { if (e.name.startsWith('.')) continue; const s = readOne(where, e, agents, problems); if (s) byName.set(s.name, s); }
  }
  const skills = [...byName.values()];
  const forAgent = (a: any, taskText?: string) => {
    const direct = skills.filter(s => s.agents.includes(a.id) || s.departments.includes(a.department));
    const general = skills.filter(s => s.everyone);
    const query = ((a.id || '') + ' ' + (a.role || '') + ' ' + (a.name || '') + ' ' + (taskText || '')).toLowerCase();
    const relevantGeneral = general.filter(s => {
      const sName = s.name.toLowerCase();
      const sDesc = s.description.toLowerCase();
      return query.includes(sName) || sName.includes(a.id) || (sDesc && query.split(' ').some(w => w.length > 3 && sDesc.includes(w)));
    }).slice(0, 5);
    return [...direct, ...relevantGeneral];
  };
  return {
    skills, problems,
    forAgent,
    names: (a: any) => forAgent(a).map(s => s.name),
    promptText(a: any, taskText?: string) {
      const mine = forAgent(a, taskText); if (!mine.length) return '';
      let txt = 'SKILLS — how the owner wants this kind of work done. When a task matches a skill, follow it exactly: its steps, its format, its wording rules. Say which skill you followed in one line at the end ("Skill: proposal").\n\n' +
        mine.map(s => `### ${s.name}${s.description ? ' — ' + s.description : ''}\n${s.text}` +
          s.files.map(f => f.text === null ? `\n\n(attached file: ${f.name} — not readable here)` : `\n\n--- ${f.name} ---\n${f.text}`).join('')).join('\n\n');
      if (txt.length > 35000) txt = txt.slice(0, 35000) + '\n[… skills context capped]';
      return txt;
    },
    summary: () => ({ count: skills.length, shipped: skills.filter(s => s.source === 'shipped').length, brain: skills.filter(s => s.source === 'brain').length, problems,
      skills: skills.map(s => ({ name: s.name, description: s.description, agents: s.agents, departments: s.departments, everyone: s.everyone, files: s.files.map(f => f.name), source: s.source, path: s.path })) }),
  };
}
