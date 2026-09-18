// Agents Office — Roster Service.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig } from '../../infrastructure/config.ts';
import { db } from '../../infrastructure/db.ts';
import { AGENTS, DEPTS } from '../../../src/data.ts';
import { V1 } from '../../../src/v1data.ts';
import { MODEL_KEYS, normModel } from '../../../src/models.ts';

export const FILE = path.join(ROOT, 'office.agents.json');
export const LOCAL = path.join(ROOT, 'office.agents.local.json');
export const brainFile = (brainPath: string): string => path.join(brainPath, 'Agents Office', 'agents.json');
const EDITABLE = ['name', 'role', 'does', 'tools', 'brief', 'model', 'effort', 'is_ceo'];
const BRIEF_MAX = 2000;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function defaults() {
  return AGENTS.map(a => { const p = V1.find(x => x.id === a.id) || {}; return { id: a.id, department: a.dept || a.department, lead: !!a.lead, name: a.name, role: a.role || p.role || `${a.name} Specialist`, does: a.does || p.tagline || `Drives ${a.name.toLowerCase()} strategy, execution, and deliverables for the department.`, tools: (a.tools || []) as string[], brief: a.brief || '', model: a.model || '', effort: a.effort || '' }; });
}

export function validate(doc: any, base = defaults()) {
  const problems: string[] = [];
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.agents) ? doc.agents : null;
  if (!list) return { agents: base, problems: ['the file must be {"agents": [...]}'] };
  const out = base.map(a => ({ ...a, tools: [...a.tools] }));
  const seen = new Set<string>();
  for (const e of list) {
    if (!e || typeof e !== 'object' || !e.id) { problems.push('an entry has no "id" — skipped'); continue; }
    let a = out.find(x => x.id === e.id);
    if (!a) {
      if (base.some(x => x.id === 'elead') && !doc.allowCustomSeats && !doc.allowCustomAgents && (!e.department || ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery', 'exec'].includes(e.department))) {
        problems.push(`"${e.id}" is not one of the seats — skipped`);
        continue;
      }
      a = { id: e.id, department: e.department || e.dept || 'ops', lead: !!e.lead, name: String(e.name || e.id).toUpperCase(), role: String(e.role || ''), does: String(e.does || ''), tools: [], brief: '', model: '', effort: '' };
      out.push(a);
    }
    if (seen.has(e.id)) problems.push(`"${e.id}" appears twice — the later entry wins`);
    seen.add(e.id);
    if (e.department !== undefined && a.department && e.department !== a.department && base.some(x => x.id === e.id)) problems.push(`"${e.id}": department cannot change (${a.department} → ${e.department}) — ignored`);
    else if (e.department) a.department = e.department;
    if (e.lead !== undefined && base.some(x => x.id === e.id) && !!e.lead !== a.lead) problems.push(`"${e.id}": lead cannot change — ignored`);
    else if (e.lead !== undefined) a.lead = !!e.lead;
    for (const k of Object.keys(e)) if (!['id', 'department', 'lead', ...EDITABLE].includes(k)) problems.push(`"${e.id}": unknown field "${k}" — ignored`);
    if (e.name !== undefined) { const n = String(e.name).trim(); if (!n) problems.push(`"${e.id}": empty name — kept "${a.name}"`); else a.name = n.slice(0, 32).toUpperCase(); }
    if (e.role !== undefined) a.role = String(e.role).trim().slice(0, 80);
    if (e.does !== undefined) a.does = String(e.does).trim().slice(0, 400);
    if (e.tools !== undefined) { if (!Array.isArray(e.tools)) problems.push(`"${e.id}": tools must be a list — ignored`); else a.tools = e.tools.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12); }
    if (e.model !== undefined) {
      const m = normModel(e.model);
      if (!e.model || e.model === '') a.model = '';
      else if (m) a.model = m;
      else problems.push(`"${e.id}": model must be one of ${MODEL_KEYS.join(', ')} (got "${e.model}") — kept ${a.model || 'the office default'}`);
    }
    if (e.effort !== undefined) {
      const v = String(e.effort || '').toLowerCase().trim();
      if (!v) a.effort = ''; else if (EFFORTS.includes(v)) a.effort = v; else problems.push(`"${e.id}": effort must be low, medium, high, xhigh or max (got "${e.effort}") — kept ${a.effort || 'the default'}`);
    }
    if (e.brief !== undefined) {
      const b = (Array.isArray(e.brief) ? e.brief.map(String).join('\n') : String(e.brief)).trim();
      if (b.length > BRIEF_MAX) problems.push(`"${e.id}": brief is over ${BRIEF_MAX} characters — trimmed (put the long version in a skill)`);
      a.brief = b.slice(0, BRIEF_MAX);
    }
  }
  return { agents: out, problems };
}

function read(p: string): any { if (!fs.existsSync(p)) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e: any) { return { __error: e.message }; } }

export function loadRoster(brainPath = loadConfig().brainPath) {
  let agents = defaults(); const problems: string[] = [];

  try {
    const defs = defaults();
    db.syncHeuresisRoster(defs as any);
    const dbAgents = db.getAgents();
    if (dbAgents.length > 0) {
      const out = defs.map(a => ({ ...a }));
      for (const da of dbAgents) {
        const idx = out.findIndex(x => x.id === da.id);
        if (idx >= 0) {
          Object.assign(out[idx], { name: da.name, role: da.role, does: da.does, tools: da.tools, brief: da.brief, model: da.model || '', effort: da.effort || '' });
        } else {
          out.push({ id: da.id, department: da.department, lead: da.lead, name: da.name, role: da.role, does: da.does, tools: da.tools, brief: da.brief || '', model: da.model || '', effort: da.effort || '' } as any);
        }
      }
      const defaultIds = new Set(defs.map(a => a.id));
      const dbIds = new Set(dbAgents.map(a => a.id));
      const filtered = out.filter(a => defaultIds.has(a.id) || dbIds.has(a.id));
      const bf = brainFile(brainPath);
      if (fs.existsSync(bf)) {
        const bdoc = read(bf);
        const list = Array.isArray(bdoc) ? bdoc : Array.isArray(bdoc?.agents) ? bdoc.agents : null;
        if (list) {
          for (const ba of list) {
            const target = filtered.find(x => x.id === ba.id);
            if (target && ba.brief !== undefined) {
              target.brief = ba.brief;
            }
          }
        }
      }
      const customised = filtered.filter((a, i) => { const d = defs[i]; return !d || a.name !== d.name || a.role !== d.role || a.does !== d.does || a.brief; }).length;
      return { agents: filtered, problems, customised, briefed: filtered.filter(a => a.brief).length, files: ['office.db (live)'] };
    }
  } catch (e: any) {
    problems.push(`db: could not read agents (${e.message}) — loading from files`);
  }

  const sources = [FILE, brainFile(brainPath), LOCAL];
  const label = (p: string) => p === FILE || p === LOCAL ? path.basename(p) : 'brain/Agents Office/agents.json';
  for (const p of sources) {
    const doc = read(p); if (!doc) continue;
    const rel = label(p);
    if (doc.__error) { problems.push(`${rel}: not valid JSON (${doc.__error.split('\n')[0]}) — ignored`); continue; }
    const r = validate(doc, agents); agents = r.agents; problems.push(...r.problems.map(x => `${rel}: ${x}`));
    try { for (const a of agents) db.addOrUpdateAgent(a as any); } catch {}
  }
  const customised = agents.filter((a, i) => { const d = defaults()[i]; return !d || a.name !== d.name || a.role !== d.role || a.does !== d.does || a.brief; }).length;
  return { agents, problems, customised, briefed: agents.filter(a => a.brief).length, files: sources.filter(p => fs.existsSync(p)).map(label) };
}
export const deptName = (k: string): string => DEPTS[k]?.name || k;
