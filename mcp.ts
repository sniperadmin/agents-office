// Agents Office — connectors (Beta).
import { spawn } from 'node:child_process';

export const DEPT_KEYS = ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery'];

const ALIASES: Record<string, string[]> = {
  gmail: ['gmail', 'googlegmail'], notion: ['notion'], canva: ['canva'], meta: ['metaads', 'meta', 'facebookads', 'facebook'],
  slack: ['slack'], fullenrich: ['fullenrich'], apollo: ['apollo', 'apolloio'], xero: ['xero'], stripe: ['stripe'],
  pandadoc: ['pandadoc'], clarity: ['clarity', 'microsoftclarity'], beehiiv: ['beehiiv'], loops: ['loops'],
  hyperframes: ['hyperframes'], imessage: ['imessage', 'messages'], claude: ['claude'], chatgpt: ['chatgpt', 'openai'],
  googlecalendar: ['googlecalendar', 'gcal', 'calendar'], googledrive: ['googledrive', 'gdrive', 'drive'], webflow: ['webflow'], playwright: ['playwright'],
  higgsfield: ['higgsfield', 'higgfield'], territool: ['territool'],
};

const DEPTS_BY_KEY: Record<string, string[]> = {
  meta: ['marketing'], canva: ['marketing', 'delivery'], loops: ['marketing'], beehiiv: ['marketing'], hyperframes: ['marketing'],
  clarity: ['marketing'], notion: DEPT_KEYS, gmail: ['emails', 'sales', 'ops', 'fin', 'delivery'],
  fullenrich: ['sales'], imessage: ['sales'], apollo: ['sales'], pandadoc: ['ops', 'delivery'], xero: ['fin'], stripe: ['fin'],
  slack: ['emails', 'ops', 'delivery'], googledrive: ['ops', 'delivery', 'fin'], googlecalendar: ['emails', 'sales', 'delivery'],
  playwright: ['marketing', 'ops'], github: ['ops', 'delivery'], linear: ['ops', 'delivery'], jira: ['ops', 'delivery'],
  hubspot: ['sales', 'marketing'], salesforce: ['sales'], zapier: DEPT_KEYS, figma: ['marketing', 'delivery'],
  webflow: ['marketing', 'delivery'], higgsfield: ['marketing'], territool: ['sales'],
};

export const norm = (s: any): string => String(s).toLowerCase().replace(/^claude\.ai\s+/, '').replace(/\s+mcp$/, '').replace(/[^a-z0-9]/g, '');
export const toolId = (name: any): string => String(name).replace(/[^A-Za-z0-9_]+/g, '_');
const display = (name: any): string => String(name).replace(/^claude\.ai\s+/, '').replace(/\s+MCP$/, '');

function logoKey(name: string): string | null {
  const n = norm(name);
  for (const [key, list] of Object.entries(ALIASES)) if (list.includes(n)) return key;
  return null;
}

const STATUS: Record<string, string> = { '✔': 'connected', '✓': 'connected', '!': 'needs-auth', '✗': 'failed', '✘': 'failed', '⏸': 'pending' };

let servers: any[] = [];
let discoveredAt = 0;
let cfgMcp: { allow: string[]; deny: string[]; departments: Record<string, string[]> } = { allow: [], deny: [], departments: {} };
let cfgWeb = true;

export function configure(cfg: any) {
  cfgMcp = { allow: [], deny: [], departments: {}, ...(cfg.mcp || {}) };
  cfgWeb = cfg.tools?.web !== false;
}

const matches = (s: any, x: string) => { const n = norm(x); return n && (norm(s.name) === n || s.id === x || s.key === n || toolId(x) === s.id); };
const denied = (s: any) => cfgMcp.deny.some(x => matches(s, x));
const allowed = (s: any) => !denied(s) && (!cfgMcp.allow.length || cfgMcp.allow.some(x => matches(s, x)));

function deptsFor(name: string, key: string | null): string[] {
  for (const [k, v] of Object.entries(cfgMcp.departments || {})) if (norm(k) === norm(name) || (key && norm(k) === key)) return v.filter(d => DEPT_KEYS.includes(d));
  return DEPTS_BY_KEY[key || norm(name)] || DEPT_KEYS;
}

function make(name: string, target: string, status: string) {
  const key = logoKey(name);
  return { id: toolId(name), name: display(name), key, status, target: target || '', source: /^claude\.ai\s/i.test(name) ? 'claude.ai' : 'local',
    depts: deptsFor(name, key), tools: [] as string[] };
}

export function parseList(text: string): any[] {
  const out: any[] = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const m = line.match(/^(.+?):\s+(.+?)\s+-\s+(\S)\s*(.*)$/);
    if (!m) continue;
    out.push(make(m[1], m[2], STATUS[m[3]] || (/connected/i.test(m[4]) ? 'connected' : /auth/i.test(m[4]) ? 'needs-auth' : 'failed')));
  }
  return out;
}

export function discover({ timeout = 45000 } = {}): Promise<any[]> {
  return new Promise(resolve => {
    const env = { ...process.env }; delete env.CLAUDECODE;
    let out = '', done = false;
    const finish = (list: any[]) => { if (done) return; done = true; if (list) { servers = list; discoveredAt = Date.now(); } resolve(servers); };
    let p: any;
    try { p = spawn('claude', ['mcp', 'list'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return finish([]); }
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish(parseList(out)); }, timeout);
    p.stdout.on('data', (d: any) => { out += d; }); p.stderr.on('data', (d: any) => { out += d; });
    p.on('error', () => { clearTimeout(timer); finish([]); });
    p.on('close', () => { clearTimeout(timer); finish(parseList(out)); });
  });
}

export function fromInit(init: any) {
  if (!init || !Array.isArray(init.mcp_servers)) return;
  const tools = Array.isArray(init.tools) ? init.tools : [];
  for (const m of init.mcp_servers) {
    let s = servers.find(x => x.id === toolId(m.name));
    if (!s) { s = make(m.name, '', 'connected'); servers.push(s); }
    if (m.status === 'connected' || m.status === 'needs-auth' || m.status === 'failed') s.status = m.status;
    else if (m.status === 'pending' && s.status !== 'connected') s.status = 'pending';
    const mine = tools.filter(t => t.startsWith(`mcp__${s.id}__`)).map(t => t.slice(s.id.length + 7));
    if (mine.length) { s.tools = mine; s.status = 'connected'; }
  }
  discoveredAt = discoveredAt || Date.now();
}

export function list() { return servers; }
export function usable() { return servers.filter(s => s.status === 'connected' && allowed(s)); }
export function allowedTools() {
  const t = usable().map(s => `mcp__${s.id}`);
  if (cfgWeb) t.push('WebSearch', 'WebFetch');
  return t;
}

export const keyOf = (toolName: string): string | null => { const m = /^mcp__(.+?)__/.exec(toolName); if (!m) return null; const s = servers.find(x => x.id === m[1]); return s ? (s.key || s.id) : m[1]; };
export const namesOf = (toolNames: string[]): string[] => [...new Set(toolNames.map(n => { const m = /^mcp__(.+?)__/.exec(n); if (m) { const s = servers.find(x => x.id === m[1]); return s ? s.name : m[1]; } return n === 'WebSearch' ? 'web search' : n === 'WebFetch' ? 'web fetch' : null; }).filter(Boolean) as string[])];

export function summary() {
  return { discoveredAt, web: cfgWeb, servers: servers.map(s => ({ ...s, allowed: allowed(s), denied: denied(s) })) };
}

export function promptText(agentTools: string[] = []): string {
  const u = usable();
  if (!u.length) return cfgWeb ? 'TOOLS\nYou have web search and web fetch. No business connectors are connected yet.' : 'TOOLS\nNone. Work from the notes.';
  const lines = u.map(s => `- ${s.name} (mcp__${s.id}__*)${s.tools.length ? ': ' + s.tools.slice(0, 12).join(', ') + (s.tools.length > 12 ? '…' : '') : ''}`);
  const mine = u.filter(s => agentTools.some(k => k === s.key || norm(k) === norm(s.name)));
  return 'TOOLS\nYou can call these connectors:\n' + lines.join('\n') + (cfgWeb ? '\n- Web search and web fetch' : '') +
    (mine.length ? `\nYour usual tools: ${mine.map(s => s.name).join(', ')}.` : '') +
    '\nRules: read freely (search, list, fetch) when it makes the work better. Anything that sends, posts, pays, deletes or changes data outside this machine — do it ONLY when the owner\'s request explicitly asks for that exact action; otherwise prepare it and say what you would send. Never ask the owner a question mid-task; make a reasonable assumption and mark it (assumed).';
}

export async function executeTool(toolName: string, params: Record<string, any> = {}): Promise<{ success: boolean; data?: any; error?: string }> {
  const normName = norm(toolName);
  if (normName === 'websearch' || toolName === 'WebSearch') {
    return { success: true, data: `[WebSearch executed for "${params.query || params.q || ''}"]` };
  }
  if (normName === 'webfetch' || toolName === 'WebFetch') {
    return { success: true, data: `[WebFetch executed for "${params.url || ''}"]` };
  }

  // MCP tool call invocation via CLI if available
  try {
    return await new Promise(resolve => {
      const p = spawn('claude', ['mcp', 'call', toolName, JSON.stringify(params)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('close', code => {
        if (code === 0 && out.trim()) {
          resolve({ success: true, data: out.trim() });
        } else {
          resolve({ success: false, error: err.trim() || `Tool call failed with code ${code}` });
        }
      });
    });
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

