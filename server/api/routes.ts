import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../infrastructure/db.ts';
import * as mcp from '../infrastructure/mcp.ts';
import * as learn from '../domains/agents/learn.ts';
import * as onboard from '../domains/skills/onboard.ts';
import * as routines from '../domains/routines/routines.ts';
import { getUsage, ask } from '../infrastructure/llm.ts';
import { route, orchestrate } from '../domains/orchestrator/orchestrator.ts';
import { runTask, writeNote, runServerTask } from '../domains/orchestrator/taskRunner.ts';
import { chat, routinesChat } from '../domains/chat/chatService.ts';
import { RoutineScheduler } from '../domains/routines/scheduler.ts';
import { normModel, normEffort, modelName, MODELS, MODEL_KEYS, EFFORT_KEYS } from '../../src/models.ts';
import { valid as validWhen } from '../../src/when.ts';

const json = (res: http.ServerResponse, code: number, body: any) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const body = (req: http.IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); }
      catch (e) { reject(e); }
    });
  });

const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export interface AppContext {
  cfg: any;
  version: string;
  backend: string;
  brainPath: string;
  notesDir: string;
  htmlPath: string;
  agents: any[];
  depts: Record<string, any>;
  deptKeys: string[];
  reserveRoles: Record<string, string[]>;
  ensureDepartmentAgents: (k: string, name: string, lead?: string, model?: string, roles?: string[]) => void;
  graph: any;
  rebuildGraph: () => Promise<any>;
  roster: any;
  skills: any;
  refreshSkills: () => any;
  scheduler: RoutineScheduler;
  sseClients: Set<http.ServerResponse>;
  pushEvent: (type: string, payload: any) => void;
  enqueue: (fn: () => Promise<any>) => Promise<any>;
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, ctx: AppContext) {
  const url = new URL(req.url!, 'http://x');
  const {
    cfg, version, backend, brainPath, notesDir, htmlPath,
    agents, depts, deptKeys, reserveRoles, ensureDepartmentAgents,
    graph, rebuildGraph, roster, refreshSkills, scheduler,
    sseClients, pushEvent, enqueue
  } = ctx;

  const leadOf = (dept: string) => agents.find(a => a.department === dept && a.lead) || agents.find(a => a.department === dept)!;
  const setupMap = () => Object.fromEntries(
    Object.keys(depts).concat(deptKeys).filter((v, i, a) => a.indexOf(v) === i && v !== 'brain')
      .map(k => [k, onboard.isSetUp(agents, ctx.skills, k)])
  );
  const agentsOut = () => {
    const setup = setupMap();
    return agents.map(a => ({
      id: a.id, name: a.name, role: a.role, does: a.does, tools: a.tools,
      brief: a.brief || '', model: a.model || '', effort: a.effort || '',
      skills: ctx.skills.names(a), lessons: learn.count(brainPath, a.id),
      department: a.department, lead: a.lead,
      interviewer: leadOf(a.department).id === a.id, setUp: setup[a.department]
    }));
  };
  const agentName = (id: string) => agents.find(a => a.id === id)?.name || id;

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/command-centre-v2.html' || url.pathname === '/dark')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    const page = fs.readFileSync(htmlPath, 'utf8');
    return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page);
  }

  if (url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true, version, backend, provider: MODELS[cfg.model]?.provider || 'antigravity',
      model: cfg.model, modelName: modelName(cfg.model), models: MODEL_KEYS,
      effort: cfg.effort || '', efforts: EFFORT_KEYS, name: cfg.name,
      brain: brainPath, notes: graph.notes, depts: deptKeys,
      agents: agentsOut(), setup: setupMap(),
      routines: (l => ({ count: l.length, paused: l.filter(r => r.paused).length, depts: routines.ALLOWED }))(scheduler.loadRoutines(agents)),
      roster: { customised: roster.customised, briefed: roster.briefed, files: roster.files, problems: roster.problems },
      skills: (({ count, shipped, brain, problems }) => ({ count, shipped, brain, problems }))(ctx.skills.summary()),
      tools: backend === 'claude-cli', mcp: mcp.summary(), db: db.getStats(), sseClients: sseClients.size
    });
  }

  if (url.pathname === '/api/company' && req.method === 'POST') {
    const b = await body(req);
    if (b.name) cfg.name = String(b.name).trim();
    if (b.model) cfg.model = normModel(b.model) || cfg.model;
    return json(res, 200, { ok: true, name: cfg.name, model: cfg.model });
  }

  if (url.pathname === '/api/departments' && req.method === 'GET') {
    const deptsMap: Record<string, any> = {};
    for (const k of deptKeys) {
      if (depts[k]) {
        deptsMap[k] = { ...depts[k], activeCount: agents.filter(a => a.department === k).length };
      }
    }
    return json(res, 200, { ok: true, depts: deptsMap, keys: deptKeys, departments: deptsMap, coreDepts: deptKeys });
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
      roles: Array.isArray(b.roles) ? b.roles : (reserveRoles[k] || [])
    };
    db.addOrUpdateDepartment(deptObj);
    if (!deptKeys.includes(k)) deptKeys.push(k);
    if (!deptKeys.includes('exec')) deptKeys.unshift('exec');
    depts[k] = { name: deptObj.name, short: deptObj.short, chip: deptObj.chip, ink: deptObj.ink, floor: deptObj.floor };
    depts['exec'] = depts['exec'] || { name: 'EXECUTIVE', short: 'EXEC', chip: '#F59E0B', ink: '#B45309', floor: '#FEF3C7' };
    ensureDepartmentAgents(k, deptObj.name, deptObj.leadName, deptObj.model, deptObj.roles);
    pushEvent('department_created', { key: k });
    const deptsMap: Record<string, any> = {};
    for (const dk of deptKeys) {
      if (depts[dk]) {
        deptsMap[dk] = { ...depts[dk], activeCount: agents.filter(a => a.department === dk).length };
      }
    }
    return json(res, 200, { ok: true, department: deptObj, keys: deptKeys, depts: deptsMap, departments: deptsMap, coreDepts: deptKeys, agents: agentsOut() });
  }

  const dm = url.pathname.match(/^\/api\/departments\/([^/]+)$/);
  if (dm && req.method === 'DELETE') {
    const deptKey = dm[1];
    const result = db.deleteDepartment(deptKey);
    if (!result.ok) return json(res, 400, { error: 'Cannot delete core department' });
    const kIdx = deptKeys.indexOf(deptKey);
    if (kIdx >= 0) deptKeys.splice(kIdx, 1);
    delete depts[deptKey];
    for (const rId of result.removedAgents) {
      const aIdx = agents.findIndex(a => a.id === rId);
      if (aIdx >= 0) agents.splice(aIdx, 1);
    }
    pushEvent('department_deleted', { key: deptKey });
    const deptsMap: Record<string, any> = {};
    for (const k of deptKeys) {
      if (depts[k]) {
        deptsMap[k] = { ...depts[k], activeCount: agents.filter(a => a.department === k).length };
      }
    }
    return json(res, 200, { ok: true, deleted: deptKey, agents: agentsOut(), keys: deptKeys, depts: deptsMap, departments: deptsMap, coreDepts: deptKeys });
  }

  const am = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (am && req.method === 'POST') {
    const agentId = am[1];
    const agentObj = agents.find(a => a.id === agentId);
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
    const agentObj = agents.find(a => a.id === agentId);
    if (!agentObj) return json(res, 404, { error: 'Agent not found' });
    const CORE_LEADS = ['ceo', 'elead', 'lexi', 'mlead', 'olead', 'alead', 'dlead'];
    if (CORE_LEADS.includes(agentId)) return json(res, 400, { error: 'Core leads cannot be deleted' });
    if (agentObj.lead && agents.filter(a => a.department === agentObj.department).length > 1) {
      return json(res, 400, { error: 'Remove sub-agents from this department before deleting its lead' });
    }
    db.deleteAgent(agentId);
    const aIdx = agents.findIndex(a => a.id === agentId);
    if (aIdx >= 0) agents.splice(aIdx, 1);
    console.log(`- agent ${agentId} deleted`);
    pushEvent('agent_removed', { agentId, dept: agentObj.department });
    return json(res, 200, { ok: true, deleted: agentId, agents: agentsOut() });
  }

  const hm = url.pathname.match(/^\/api\/agents\/([^/]+)\/message$/);
  if (hm && req.method === 'POST') {
    const fromId = hm[1];
    const b = await body(req);
    const toAgent = agents.find(a => a.id === b.toAgent);
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
      id, name: String(b.name).trim(),
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
    const tasks = db.getTasks();
    const activeAgents = new Set(tasks.filter(t => t.state === 'doing').map(t => t.agent));
    const status = Object.fromEntries(agents.map(a => [a.id, { online: true, state: activeAgents.has(a.id) ? 'working' : 'idle' }]));
    return json(res, 200, { ok: true, status });
  }

  if (url.pathname === '/api/agents') return json(res, 200, { agents: agentsOut(), problems: roster.problems, files: roster.files });
  if (url.pathname === '/api/skills') return json(res, 200, refreshSkills().summary());
  if (url.pathname === '/api/lessons') return json(res, 200, { dir: learn.dir(brainPath), agents: agents.map(a => ({ id: a.id, name: a.name, ...learn.read(brainPath, a.id) })).filter(x => x.rules.length || x.oneOffs.length) });
  if (url.pathname === '/api/mcp') {
    if (url.searchParams.get('refresh') === '1') await mcp.discover();
    return json(res, 200, { ...mcp.summary(), tools: backend === 'claude-cli' });
  }
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

  if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, db.getTasks());
  if (url.pathname === '/api/routines' && req.method === 'GET') return json(res, 200, scheduler.routinesOut(agents));
  if (url.pathname === '/api/routines' && req.method === 'POST') {
    const b = await body(req);
    if (!depts[b.dept] || b.dept === 'brain') return json(res, 400, { error: 'unknown department' });
    if (!routines.ALLOWED.includes(b.dept)) return json(res, 400, { error: routines.refusal(b.dept), refused: true });
    const r = await scheduler.makeRoutine({ dept: b.dept, text: b.text, when: b.when, agent: b.agent, needsOk: b.needsOk, model: b.model, effort: b.effort }, { agents, depts, businessName: cfg.name, officeModel: cfg.model, refreshSkills });
    return json(res, r.error ? 400 : 200, r);
  }

  const rm = url.pathname.match(/^\/api\/routines\/([^/]+)(?:\/(run|pause|resume))?$/);
  if (rm) {
    const r = scheduler.loadRoutines(agents).find((x: any) => x.id === rm[1]);
    if (!r) return json(res, 404, { error: 'no such routine' });
    if (req.method === 'DELETE') { scheduler.removeRoutine(r.id, agents); return json(res, 200, { ok: true, routines: scheduler.loadRoutines(agents) }); }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST or DELETE' });
    if (rm[2] === 'run') return json(res, 200, { ok: true, task: scheduler.fire(r, agents, { by: 'you' }), routines: scheduler.loadRoutines(agents) });
    if (rm[2] === 'pause' || rm[2] === 'resume') { scheduler.editRoutine(r.id, { paused: rm[2] === 'pause' }, agents); return json(res, 200, { ok: true, routines: scheduler.loadRoutines(agents) }); }
    const b = await body(req); const patch: any = {};
    if (typeof b.needsOk === 'boolean') patch.needsOk = b.needsOk; if (typeof b.paused === 'boolean') patch.paused = b.paused;
    if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim(); if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 90);
    if (b.when && validWhen(b.when)) patch.when = b.when;
    if (b.model !== undefined) patch.model = normModel(b.model) || '';
    if (b.effort !== undefined) patch.effort = normEffort(b.effort) || '';
    scheduler.editRoutine(r.id, patch, agents);
    return json(res, 200, { ok: true, routines: scheduler.loadRoutines(agents) });
  }

  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const { dept, text, model, effort, priority } = await body(req);
    if (!depts[dept] || dept === 'brain') return json(res, 400, { error: 'unknown department' });
    if (!text || !String(text).trim()) return json(res, 400, { error: 'empty task' });

    if (dept === 'exec') {
      const ceo = agents.find(a => a.is_ceo || a.id === 'ceo') || agents.find(a => a.department === 'exec')!;
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
          const result = await orchestrate(String(text).trim(), orchestratorTask.id, {
            model: normModel(model) || undefined, agents, depts, deptKeys, brainPath, notesDir,
            businessName: cfg.name, officeModel: cfg.model, officeEffort: cfg.effort,
            pushEvent, rebuildGraph, refreshSkills
          });
          Object.assign(orchestratorTask, { state: 'done', doneAt: Date.now(), result, error: false });
          db.addTask(orchestratorTask);
          writeNote(orchestratorTask, agents, depts, notesDir);
          await rebuildGraph();
        } catch (e: any) {
          Object.assign(orchestratorTask, { state: 'done', doneAt: Date.now(), result: `Orchestration failed: ${e.message}`, error: true });
          db.addTask(orchestratorTask);
        }
        pushEvent('task_update', { taskId: orchestratorTask.id, state: orchestratorTask.state, agent: ceo.id, dept: 'exec' });
      }).catch(e => console.warn('orchestrate:', e.message));
      return json(res, 200, orchestratorTask);
    }

    const r = await route(dept, String(text).trim(), { agents, depts, businessName: cfg.name, officeModel: cfg.model, refreshSkills });
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
    enqueue(() => runServerTask(task.id, {
      feedback: m[2] === 'reject' ? (note || 'Not this. Rework it.') : undefined,
      approve: m[2] === 'approve',
      agents, depts, brainPath, notesDir, businessName: cfg.name,
      officeModel: cfg.model, officeEffort: cfg.effort,
      pushEvent, rebuildGraph, refreshSkills
    }))
      .then(t => {
        if (m[2] === 'reject' && note && t && !t.error) {
          const a = agents.find(x => x.id === t.agent);
          return learn.classify(ask, a, t, note).then(v => {
            const r = learn.record(brainPath, a, t, note, v);
            console.log(`  ↳ ${a.name} ${r.standing ? 'learned a rule' : 'noted a one-off'}: ${r.line.slice(0, 100)}`);
          });
        }
      })
      .catch(e => console.warn('approval:', e.message));
    return json(res, 200, { ok: true, id: task.id, state: 'doing' });
  }

  if (m && req.method === 'POST' && (m[2] === 'run' || m[2] === 'revise')) {
    const task = db.getTaskById(m[1]);
    if (!task) return json(res, 404, { error: 'no such task' });
    const { feedback } = m[2] === 'revise' ? await body(req) : {};
    task.state = 'doing';
    task.startedAt = Date.now();
    db.updateTask(task.id, { state: 'doing', startedAt: task.startedAt });
    pushEvent('task_start', { taskId: task.id, agent: task.agent, dept: task.dept });
    try {
      const { result, read, tools, used, skills: sk, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom } = await runTask(task, {
        feedback, agents, depts, brainPath, businessName: cfg.name,
        officeModel: cfg.model, officeEffort: cfg.effort, refreshSkills
      });
      Object.assign(task, { state: 'done', doneAt: Date.now(), result, read, tools, used, skills: sk, error: false, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom });
      task.note = writeNote(task, agents, depts, notesDir);
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
      const a = agents.find(x => x.id === task.agent);
      learn.classify(ask, a, task, feedback).then(v => {
        const r = learn.record(brainPath, a, task, feedback, v);
        console.log(`  ↳ ${a.name} ${r.standing ? 'learned a rule' : 'noted a one-off'}: ${r.line.slice(0, 100)}`);
      }).catch(e => console.warn('learn:', e.message));
    }
    return;
  }

  if (m && req.method === 'DELETE') {
    db.deleteTask(m[1]);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const { agent, text, history } = await body(req);
    if (!text || !String(text).trim()) return json(res, 400, { error: 'empty message' });
    const a = agents.find(x => x.id === agent);
    if (!a) return json(res, 400, { error: 'unknown agent' });
    if (!onboard.active(notesDir, a.department)) {
      const rc = await routinesChat(a, String(text).trim(), {
        agents,
        loadRoutines: () => scheduler.loadRoutines(agents),
        editRoutine: (id, patch) => scheduler.editRoutine(id, patch, agents),
        removeRoutine: (id) => scheduler.removeRoutine(id, agents),
        fire: (r, opts) => scheduler.fire(r, agents, opts),
        makeRoutine: (opts) => scheduler.makeRoutine(opts, { agents, depts, businessName: cfg.name, officeModel: cfg.model, refreshSkills })
      });
      if (rc) return json(res, 200, { reply: rc.reply, read: [], tools: [], interview: false, routine: (rc as any).routine || null, routines: true });
    }
    if (leadOf(a.department).id === a.id) {
      refreshSkills();
      const o = await onboard.handle(String(text).trim(), {
        dept: a.department, deptName: depts[a.department].name, lead: a,
        agents: agents.filter(x => x.department === a.department),
        connected: mcp.summary().servers?.filter(x => x.status === 'connected').map((x: any) => x.name || x.key) || [],
        brainPath, dataDir: path.join(notesDir, '..'), ask, business: cfg.name, afterWrite: refreshSkills
      });
      if (o) {
        if (o.wrote) console.log(`★ ${a.name} set up ${depts[a.department].name}: ${o.wrote.briefs.length} briefs${o.wrote.skill ? ', skill ' + o.wrote.skill.name : ''}`);
        return json(res, 200, { reply: o.reply, read: [], tools: [], interview: !o.wrote, setup: setupMap() });
      }
    }
    const r = await chat(agent, String(text).trim(), history, {
      agents, depts, brainPath, businessName: cfg.name,
      officeModel: cfg.model, officeEffort: cfg.effort, refreshSkills
    });
    return json(res, 200, { ...r, interview: false });
  }

  json(res, 404, { error: 'not found' });
}
