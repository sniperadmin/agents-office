// Agents Office V3.6 — the three models, by name. Shared by the page and the server.
// AJ (9 Sep 2026): "it is either Opus, Sonnet, or Fable. That's it." Sonnet is the default for
// everything, including the routing call. Effort lives inside the name (Opus runs at high); nobody
// sees an effort setting. Four places, one precedence: the task beats the routine beats the agent
// beats the office default.
// V3.6.1 (10 Sep 2026): AJ asked for an EFFORT selection beside the model. Five levels as the CLI
// names them; AUTO (empty) = the model's own default (Opus runs at high). Same four places, same
// precedence as the model, then the model's own.

export interface ModelDef {
  key: string;
  name: string;
  flag: string;
  id: string;
  provider: 'anthropic' | 'antigravity' | 'hermes';
  effort?: string;
}

export const MODELS: Record<string, ModelDef> = {
  sonnet: { key: 'sonnet', name: 'Sonnet', flag: 'sonnet', id: 'claude-sonnet-5', provider: 'anthropic' },
  opus:   { key: 'opus',   name: 'Opus',   flag: 'opus',   id: 'claude-opus-5', effort: 'high', provider: 'anthropic' },
  fable:  { key: 'fable',  name: 'Fable',  flag: 'fable',  id: 'claude-fable-5-1', provider: 'anthropic' },
  'antigravity-flash': { key: 'antigravity-flash', name: 'Antigravity Flash 3.6', flag: 'antigravity-flash', id: 'gemini-3.6-flash', provider: 'antigravity' },
  'antigravity-pro': { key: 'antigravity-pro', name: 'Antigravity Pro 3.5', flag: 'antigravity-pro', id: 'gemini-3.5-pro', provider: 'antigravity', effort: 'high' },
  'antigravity-thinking': { key: 'antigravity-thinking', name: 'Antigravity Thinking 3.1', flag: 'antigravity-thinking', id: 'gemini-3.1-thinking', provider: 'antigravity', effort: 'max' },
  'hermes-3-405b': { key: 'hermes-3-405b', name: 'Hermes 3 (405B)', flag: 'hermes-3-405b', id: 'hermes-3-llama-3.1-405b', provider: 'hermes', effort: 'high' },
  'hermes-3-70b': { key: 'hermes-3-70b', name: 'Hermes 3 (70B)', flag: 'hermes-3-70b', id: 'hermes-3-llama-3.1-70b', provider: 'hermes' },
  'hermes-2-pro': { key: 'hermes-2-pro', name: 'Hermes 2 Pro', flag: 'hermes-2-pro', id: 'hermes-2-pro-mistral-7b', provider: 'hermes' },
};

export const MODEL_KEYS: string[] = ['sonnet', 'opus', 'fable', 'antigravity-flash', 'antigravity-pro', 'antigravity-thinking', 'hermes-3-405b', 'hermes-3-70b', 'hermes-2-pro'];
export const DEFAULT_MODEL = 'antigravity-flash';
export const FROM_TEXT: Record<string, string> = { task: 'this task', routine: 'this routine', agent: 'this agent', dept: 'this department', office: 'office default', model: 'the model\'s own' };
export const EFFORT_KEYS: string[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORT_NAME: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high', max: 'Max' };

export const MODEL_ALIASES: Record<string, string> = {
  flash: 'antigravity-flash',
  'gemini-flash': 'antigravity-flash',
  'gemini-3.6-flash': 'antigravity-flash',
  'antigravity-flash': 'antigravity-flash',
  pro: 'antigravity-pro',
  'gemini-pro': 'antigravity-pro',
  'gemini-3.5-pro': 'antigravity-pro',
  'antigravity-pro': 'antigravity-pro',
  thinking: 'antigravity-thinking',
  'gemini-thinking': 'antigravity-thinking',
  'gemini-3.1-thinking': 'antigravity-thinking',
  'antigravity-thinking': 'antigravity-thinking',
  hermes: 'hermes-3-70b',
  'hermes-3': 'hermes-3-70b',
  'hermes-405b': 'hermes-3-405b',
  'hermes-70b': 'hermes-3-70b',
  'hermes-pro': 'hermes-2-pro',
  'hermes-3-405b': 'hermes-3-405b',
  'hermes-3-70b': 'hermes-3-70b',
  'hermes-2-pro': 'hermes-2-pro',
  sonnet: 'sonnet',
  'claude-sonnet-5': 'sonnet',
  opus: 'opus',
  'claude-opus-5': 'opus',
  fable: 'fable',
  'claude-fable-5-1': 'fable',
};

/** "High" · "xhigh" · "extra high" → the CLI level; empty/auto/unknown → null. */
export function normEffort(s?: any): string | null {
  const t = String(s || '').toLowerCase().replace(/[\s_-]+/g, '').trim();
  if (!t || t === 'auto' || t === 'default') return null;
  if (t === 'extrahigh' || t === 'veryhigh') return 'xhigh';
  if (t === 'maximum') return 'max';
  return EFFORT_KEYS.includes(t) ? t : null;
}
export const effortName = (k: string) => EFFORT_NAME[k] || 'Auto';

export interface ModelContext {
  task?: any;
  routine?: any;
  agent?: any;
  dept?: any;
  office?: any;
  model?: any;
}

/** The effort that wins, and where it was set; falls through to the model's own default (may be null = the CLI decides). */
export function effortFor({ task, routine, agent, dept, office, model }: ModelContext = {}): { effort: string | null; from: string } {
  if (normEffort(task)) return { effort: normEffort(task), from: 'task' };
  if (normEffort(routine)) return { effort: normEffort(routine), from: 'routine' };
  if (normEffort(agent)) return { effort: normEffort(agent), from: 'agent' };
  if (normEffort(dept)) return { effort: normEffort(dept), from: 'dept' };
  if (normEffort(office)) return { effort: normEffort(office), from: 'office' };
  const m = MODELS[normModel(model) || DEFAULT_MODEL] || MODELS[DEFAULT_MODEL];
  return { effort: m.effort || null, from: 'model' };
}

/** Resolves model key or alias to canonical model key, or null. */
export function normModel(s?: any): string | null {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return null;
  if (MODEL_ALIASES[t]) return MODEL_ALIASES[t];
  for (const k of MODEL_KEYS) if (t === k || t.includes(k)) return k;
  return null;
}
export const modelName = (k: string) => (MODELS[normModel(k) || DEFAULT_MODEL] || MODELS[DEFAULT_MODEL]).name;
export const modelId = (k: string) => (MODELS[normModel(k) || DEFAULT_MODEL] || MODELS[DEFAULT_MODEL]).id;

/** The one that wins, and where it was set. Precedence: Task > Routine > Agent > Dept > Office Default. */
export function modelFor({ task, routine, agent, dept, office }: ModelContext = {}): { model: string; from: string } {
  if (normModel(task)) return { model: normModel(task)!, from: 'task' };
  if (normModel(routine)) return { model: normModel(routine)!, from: 'routine' };
  if (normModel(agent)) return { model: normModel(agent)!, from: 'agent' };
  if (normModel(dept)) return { model: normModel(dept)!, from: 'dept' };
  return { model: normModel(office) || DEFAULT_MODEL, from: 'office' };
}

/** The CLI flags for a model key (+ an explicit effort level, else the model's own). */
export function modelArgs(key: string, effort?: any): string[] {
  const m = MODELS[normModel(key) || DEFAULT_MODEL] || MODELS[DEFAULT_MODEL];
  const a = ['--model', m.flag];
  const e = normEffort(effort) || m.effort;
  if (e) a.push('--effort', e);
  return a;
}
