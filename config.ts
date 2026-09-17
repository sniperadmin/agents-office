// Agents Office — configuration (Beta).
// office.config.json is the shipped default; office.config.local.json (gitignored) overrides it;
// environment variables override both: AO_NAME, AO_BRAIN, PORT, AO_MODEL.
// V3.1 keys: mcp { allow, deny, departments } · tools { web } · timeout (seconds per agent run) — see mcp.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OfficeConfig {
  name: string;
  brain: string;
  port: number;
  model: string;
  mcp: {
    allow: string[];
    deny: string[];
    departments: Record<string, any>;
  };
  tools: {
    web: boolean;
  };
  brainPath: string;
  [key: string]: any;
}

export const ROOT: string = path.dirname(fileURLToPath(import.meta.url));

function readJSON(p: string): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function loadConfig(): OfficeConfig {
  const base = readJSON(path.join(ROOT, 'office.config.json'));
  const local = readJSON(path.join(ROOT, 'office.config.local.json'));
  const c: OfficeConfig = {
    name: 'Agents Office',
    brain: './brain',
    port: 4520,
    model: 'sonnet',
    ...base,
    ...local,
    mcp: { allow: [], deny: [], departments: {}, ...(base.mcp || {}), ...(local.mcp || {}) },
    tools: { web: true, ...(base.tools || {}), ...(local.tools || {}) },
    brainPath: ''
  }; // V3.6: model = sonnet · opus · fable
  if (process.env.AO_NAME) c.name = process.env.AO_NAME;
  if (process.env.AO_BRAIN) c.brain = process.env.AO_BRAIN;
  if (process.env.PORT) c.port = +process.env.PORT;
  if (process.env.AO_MODEL) c.model = process.env.AO_MODEL;
  c.port = +c.port || 4520;
  c.brainPath = path.resolve(ROOT, c.brain);
  return c;
}
