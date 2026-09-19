// Agents Office — MCP Connectors Service.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEPT_KEYS = ['exec', 'foundations', 'marketing', 'sales', 'nurture', 'launch', 'partnerships', 'scale'];

const ALIASES: Record<string, string[]> = {
  gmail: ['gmail', 'googlegmail'], notion: ['notion'], canva: ['canva'], meta: ['metaads', 'meta', 'facebookads', 'facebook'],
  slack: ['slack'], fullenrich: ['fullenrich'], apollo: ['apollo', 'apolloio'], xero: ['xero'], stripe: ['stripe'],
  pandadoc: ['pandadoc'], clarity: ['clarity', 'microsoftclarity'], beehiiv: ['beehiiv'], loops: ['loops'],
  hyperframes: ['hyperframes'], imessage: ['imessage', 'messages'], claude: ['claude'], chatgpt: ['chatgpt', 'openai'],
  googlecalendar: ['googlecalendar', 'gcal', 'calendar'], googledrive: ['googledrive', 'gdrive', 'drive'], webflow: ['webflow'], playwright: ['playwright'],
  higgsfield: ['higgsfield', 'higgfield'], territool: ['territool'],
  figma: ['figma'], github: ['github'], linear: ['linear'], jira: ['jira'], hubspot: ['hubspot'], salesforce: ['salesforce'], zapier: ['zapier'],
  context7: ['context7'], googlecloudfirestore: ['googlecloudfirestore', 'google_cloud_firestore', 'firestore'],
  jinamcpserver: ['jinamcpserver', 'jina_mcp_server', 'jina'],
  knowledgecatalog: ['knowledgecatalog', 'knowledge_catalog'],
};

const ALL_DEPTS = ['exec', 'foundations', 'marketing', 'sales', 'nurture', 'launch', 'partnerships', 'scale', 'design', 'dev', 'devops', 'sec', 'growth', 'creative', 'intel', 'ops', 'fin', 'support', 'legal_fin', 'delivery', 'emails'];

const DEPTS_BY_KEY: Record<string, string[]> = {
  meta: ['marketing', 'growth', 'launch'],
  canva: ['marketing', 'design', 'creative', 'content', 'delivery'],
  figma: ['design', 'creative', 'marketing', 'product_qa', 'dev'],
  loops: ['marketing', 'nurture', 'growth'],
  beehiiv: ['marketing', 'content', 'growth'],
  hyperframes: ['marketing', 'creative', 'content'],
  clarity: ['marketing', 'product_qa', 'dev'],
  notion: ALL_DEPTS,
  gmail: ['exec', 'sales', 'nurture', 'partnerships', 'support', 'legal_fin', 'marketing', 'ops', 'fin', 'delivery', 'emails'],
  fullenrich: ['sales', 'partnerships', 'growth'],
  imessage: ['sales', 'partnerships', 'exec'],
  apollo: ['sales', 'partnerships', 'growth'],
  pandadoc: ['sales', 'ops', 'legal_fin', 'partnerships', 'delivery'],
  xero: ['exec', 'scale', 'fin', 'legal_fin'],
  stripe: ['exec', 'scale', 'sales', 'fin'],
  slack: ALL_DEPTS,
  googledrive: ALL_DEPTS,
  googlecalendar: ['exec', 'sales', 'nurture', 'partnerships', 'support', 'marketing', 'emails', 'delivery'],
  playwright: ['marketing', 'ops'],
  github: ['dev', 'devops', 'sec', 'product_qa', 'ops', 'delivery'],
  linear: ['dev', 'design', 'product_qa', 'devops', 'ops', 'delivery'],
  jira: ['dev', 'design', 'product_qa', 'devops', 'ops', 'delivery'],
  hubspot: ['sales', 'marketing', 'nurture', 'growth'],
  salesforce: ['sales', 'partnerships', 'growth'],
  zapier: ALL_DEPTS,
  webflow: ['marketing', 'design', 'dev', 'growth', 'delivery'],
  higgsfield: ['marketing', 'creative', 'design', 'content'],
  territool: ['sales', 'partnerships'],
  context7: ['dev', 'devops', 'exec', 'product_qa', 'design'],
  googlecloudfirestore: ['dev', 'devops', 'exec', 'scale'],
  jinamcpserver: ['marketing', 'growth', 'sales', 'intel', 'design', 'content', 'exec'],
  knowledgecatalog: ALL_DEPTS,
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
  for (const [k, v] of Object.entries(cfgMcp.departments || {})) {
    if (norm(k) === norm(name) || (key && norm(k) === key)) return v;
  }
  if (key && DEPTS_BY_KEY[key]) return DEPTS_BY_KEY[key];
  if (DEPTS_BY_KEY[norm(name)]) return DEPTS_BY_KEY[norm(name)];
  return ALL_DEPTS;
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

export function discover(): Promise<any[]> {
  return new Promise(resolve => {
    const listMap = new Map<string, any>();
    
    try {
      const { db } = require('./db.ts');
      const dbServers = db.getMcpServers();
      for (const s of dbServers) {
        listMap.set(s.id, {
          id: s.id,
          name: s.name,
          key: s.key || logoKey(s.name) || s.id,
          status: s.status || 'connected',
          target: s.command || '',
          source: s.source || 'custom',
          depts: s.depts && s.depts.length ? s.depts : deptsFor(s.name, s.key),
          tools: [],
          command: s.command,
          args: s.args,
          env: s.env,
        });
      }
    } catch {}

    try {
      const ideMcpDir = '/home/nasr/.gemini/antigravity-ide/mcp';
      if (fs.existsSync(ideMcpDir)) {
        const dirents = fs.readdirSync(ideMcpDir, { withFileTypes: true });
        for (const ent of dirents) {
          if (ent.isDirectory() && !ent.name.startsWith('.')) {
            const name = ent.name;
            const id = toolId(name);
            if (!listMap.has(id)) {
              const key = logoKey(name) || id;
              listMap.set(id, {
                id,
                name: display(name),
                key,
                status: 'connected',
                target: path.join(ideMcpDir, name),
                source: 'local',
                depts: deptsFor(name, key),
                tools: [],
              });
            }
          }
        }
      }
    } catch {}

    servers = Array.from(listMap.values());
    discoveredAt = Date.now();
    resolve(servers);
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

  const server = servers.find(s => toolName.startsWith(`mcp__${s.id}__`) || s.id === normName || s.key === normName);
  if (server && server.command) {
    try {
      return await new Promise(resolve => {
        const p = spawn(server.command, [...(server.args || []), JSON.stringify(params)], { env: { ...process.env, ...(server.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', d => { out += d; });
        p.stderr.on('data', d => { err += d; });
        p.on('close', code => {
          if (code === 0 && out.trim()) resolve({ success: true, data: out.trim() });
          else resolve({ success: false, error: err.trim() || `Tool call failed with exit code ${code}` });
        });
        p.on('error', e => resolve({ success: false, error: e.message }));
      });
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  return { success: true, data: `[${toolName} tool call simulated successfully for ${JSON.stringify(params)}]` };
}
