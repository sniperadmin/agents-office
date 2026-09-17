// Agents Office — World-Class Native SQLite Database Engine (Beta).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, loadConfig } from './config.ts';

const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'office.db');
const CONFIG_FILE = path.join(ROOT, 'office.config.json');
const AGENTS_FILE = path.join(ROOT, 'office.agents.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

export interface DeptRecord {
  key: string;
  name: string;
  short: string;
  chip: string;
  ink: string;
  floor: string;
  model?: string;
  leadName?: string;
}

export interface AgentRecord {
  id: string;
  department: string;
  lead: boolean;
  is_ceo?: boolean;
  name: string;
  role: string;
  does: string;
  tools: string[];
  brief: string;
  model?: string;
  effort?: string;
}

export interface TaskRecord {
  id: string;
  dept: string;
  agent: string;
  title: string;
  text: string;
  plan?: string;
  eta?: string;
  why?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  state: string; // 'next' | 'doing' | 'waiting' | 'done' | 'sched'
  addedAt: number;
  changedAt?: number;
  startedAt?: number;
  doneAt?: number;
  by?: string;
  model?: string;
  effort?: string;
  result?: string;
  read?: string[];
  tools?: string[];
  used?: string[];
  error?: boolean;
  draft?: string;
}

export interface MemoryRecord {
  id: string;
  agentId: string;
  department: string;
  title: string;
  content: string;
  memoryType: 'note' | 'decision' | 'handoff' | 'rule';
  createdAt: number;
  updatedAt: number;
}

export interface McpServerRecord {
  id: string;
  name: string;
  key: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  depts: string[];
  status: string;
  source: string;
  allowed: boolean;
}

export class Database {
  private db: DatabaseSync;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    this.db = new DatabaseSync(DB_FILE);
    this.initTables();
    this.autoMigrateLegacyData();
  }

  private initTables(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short TEXT NOT NULL,
        chip TEXT NOT NULL,
        ink TEXT NOT NULL,
        floor TEXT NOT NULL,
        model TEXT,
        lead_name TEXT
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        department TEXT NOT NULL,
        lead INTEGER NOT NULL DEFAULT 0,
        is_ceo INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        does TEXT NOT NULL,
        brief TEXT NOT NULL DEFAULT '',
        tools TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        effort TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        dept TEXT NOT NULL,
        agent TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        plan TEXT,
        eta TEXT,
        why TEXT,
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        state TEXT NOT NULL DEFAULT 'next',
        added_at INTEGER NOT NULL,
        changed_at INTEGER,
        started_at INTEGER,
        done_at INTEGER,
        by_who TEXT,
        model TEXT,
        effort TEXT,
        result TEXT,
        read_notes TEXT,
        used_tools TEXT,
        tools TEXT,
        error INTEGER NOT NULL DEFAULT 0,
        draft TEXT
      );

      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        dept TEXT NOT NULL,
        agent TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        when_json TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        needs_ok INTEGER NOT NULL DEFAULT 1,
        model TEXT,
        effort TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        department TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL DEFAULT 'note',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        val TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        command TEXT NOT NULL DEFAULT '',
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        depts TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'connected',
        source TEXT NOT NULL DEFAULT 'custom',
        allowed INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS task_graph (
        task_id TEXT NOT NULL,
        parent_task_id TEXT,
        dept TEXT NOT NULL,
        role TEXT,
        PRIMARY KEY (task_id)
      );

      CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        task_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_states (
        task_id TEXT PRIMARY KEY,
        dept TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        qa_score INTEGER,
        qa_feedback TEXT,
        history TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
    `);
  }

  private autoMigrateLegacyData(): void {
    // Migrate config if table empty
    const cfgCount = (this.db.prepare('SELECT COUNT(*) as count FROM config').get() as any)?.count || 0;
    if (cfgCount === 0 && fs.existsSync(CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        this.saveConfig(JSON.parse(raw));
      } catch (e: any) {
        console.warn('db: migration warning for office.config.json:', e.message);
      }
    }

    // Migrate agents if table empty
    const agentCount = (this.db.prepare('SELECT COUNT(*) as count FROM agents').get() as any)?.count || 0;
    if (agentCount === 0 && fs.existsSync(AGENTS_FILE)) {
      try {
        const raw = fs.readFileSync(AGENTS_FILE, 'utf8');
        const doc = JSON.parse(raw);
        if (Array.isArray(doc.agents)) {
          for (const a of doc.agents) {
            this.addOrUpdateAgent(a);
          }
        }
      } catch (e: any) {
        console.warn('db: migration warning for office.agents.json:', e.message);
      }
    }

    // Migrate tasks if table empty
    const taskCount = (this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as any)?.count || 0;
    if (taskCount === 0 && fs.existsSync(TASKS_FILE)) {
      try {
        const raw = fs.readFileSync(TASKS_FILE, 'utf8');
        const tasks = JSON.parse(raw);
        if (Array.isArray(tasks)) {
          this.saveTasks(tasks);
        }
      } catch (e: any) {
        console.warn('db: migration warning for tasks.json:', e.message);
      }
    }
  }

  public syncHeuresisRoster(heuresisAgents: AgentRecord[]): void {
    const validIds = new Set(heuresisAgents.map(a => a.id));
    for (const a of heuresisAgents) {
      this.addOrUpdateAgent(a);
    }
    const current = this.getAgents();
    for (const ca of current) {
      if (!validIds.has(ca.id) && !ca.id.includes('_spec_')) {
        this.db.prepare('DELETE FROM agents WHERE id = ?').run(ca.id);
      }
    }
  }

  /* ---------- Config & Departments ---------- */
  public readConfig(): any {
    const row = this.db.prepare('SELECT val FROM config WHERE key = ?').get('main') as any;
    if (row && row.val) {
      try { return JSON.parse(row.val); } catch (e) {}
    }
    if (fs.existsSync(CONFIG_FILE)) {
      try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
    }
    return {};
  }

  public saveConfig(cfg: any): void {
    const val = JSON.stringify(cfg, null, 2);
    this.db.prepare('INSERT INTO config (key, val) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET val = excluded.val').run('main', val);
    try {
      fs.writeFileSync(CONFIG_FILE, val);
    } catch (e: any) {
      console.warn('db: sync warning for office.config.json:', e.message);
    }
  }

  public getCustomDepartments(): DeptRecord[] {
    const rows = this.db.prepare('SELECT * FROM departments').all() as any[];
    if (rows && rows.length > 0) {
      return rows.map(r => ({
        key: r.key,
        name: r.name,
        short: r.short,
        chip: r.chip,
        ink: r.ink,
        floor: r.floor,
        model: r.model || undefined,
        leadName: r.lead_name || undefined
      }));
    }
    const cfg = this.readConfig();
    return Array.isArray(cfg.customDepartments) ? cfg.customDepartments : [];
  }

  public addOrUpdateDepartment(dept: DeptRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO departments (key, name, short, chip, ink, floor, model, lead_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        short = excluded.short,
        chip = excluded.chip,
        ink = excluded.ink,
        floor = excluded.floor,
        model = excluded.model,
        lead_name = excluded.lead_name
    `);
    stmt.run(dept.key, dept.name, dept.short, dept.chip, dept.ink, dept.floor, dept.model || null, dept.leadName || null);

    const cfg = this.readConfig();
    cfg.customDepartments = Array.isArray(cfg.customDepartments) ? cfg.customDepartments : [];
    const idx = cfg.customDepartments.findIndex((d: any) => d.key === dept.key);
    if (idx >= 0) cfg.customDepartments[idx] = dept;
    else cfg.customDepartments.push(dept);
    this.saveConfig(cfg);
  }

  public deleteDepartment(deptKey: string): { ok: boolean; removedAgents: string[] } {
    const CORE_DEPTS = ['exec', 'foundations', 'marketing', 'sales', 'nurture', 'launch', 'partnerships', 'scale', 'brain'];
    if (CORE_DEPTS.includes(deptKey)) {
      return { ok: false, removedAgents: [] };
    }
    this.db.prepare('DELETE FROM departments WHERE key = ?').run(deptKey);
    const agentRows = this.db.prepare('SELECT id FROM agents WHERE department = ?').all() as any[];
    const toRemove = agentRows.map(r => r.id);
    this.db.prepare('DELETE FROM agents WHERE department = ?').run(deptKey);
    this.db.prepare('DELETE FROM tasks WHERE dept = ?').run(deptKey);

    const cfg = this.readConfig();
    cfg.customDepartments = (cfg.customDepartments || []).filter((d: any) => d.key !== deptKey);
    this.saveConfig(cfg);

    const agentsDoc = this.readAgentsDoc();
    agentsDoc.agents = agentsDoc.agents.filter((a: any) => a.department !== deptKey);
    this.saveAgentsDoc(agentsDoc);

    return { ok: true, removedAgents: toRemove };
  }

  /* ---------- Agents Roster ---------- */
  public readAgentsDoc(): { allowCustomSeats: boolean; agents: AgentRecord[] } {
    const agents = this.getAgents();
    return { allowCustomSeats: true, agents };
  }

  public saveAgentsDoc(doc: { allowCustomSeats?: boolean; agents: AgentRecord[] }): void {
    this.db.exec('DELETE FROM agents');
    for (const a of doc.agents) {
      this.addOrUpdateAgent(a);
    }
    try {
      doc.allowCustomSeats = true;
      fs.writeFileSync(AGENTS_FILE, JSON.stringify(doc, null, 2));
    } catch (e: any) {
      console.warn('db: sync warning for office.agents.json:', e.message);
    }
  }

  public getAgents(): AgentRecord[] {
    const rows = this.db.prepare('SELECT * FROM agents').all() as any[];
    if (rows && rows.length > 0) {
      return rows.map(r => ({
        id: r.id,
        department: r.department,
        lead: Boolean(r.lead),
        is_ceo: Boolean(r.is_ceo),
        name: r.name,
        role: r.role,
        does: r.does,
        tools: JSON.parse(r.tools || '[]'),
        brief: r.brief || '',
        model: r.model || undefined,
        effort: r.effort || undefined
      }));
    }
    if (fs.existsSync(AGENTS_FILE)) {
      try {
        const doc = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
        return Array.isArray(doc.agents) ? doc.agents : [];
      } catch (e) {}
    }
    return [];
  }

  public addOrUpdateAgent(agent: AgentRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, department, lead, is_ceo, name, role, does, brief, tools, model, effort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        department = excluded.department,
        lead = excluded.lead,
        is_ceo = excluded.is_ceo,
        name = excluded.name,
        role = excluded.role,
        does = excluded.does,
        brief = excluded.brief,
        tools = excluded.tools,
        model = excluded.model,
        effort = excluded.effort
    `);
    stmt.run(
      agent.id,
      agent.department,
      agent.lead ? 1 : 0,
      agent.is_ceo || agent.id === 'ceo' ? 1 : 0,
      agent.name,
      agent.role,
      agent.does,
      agent.brief || '',
      JSON.stringify(agent.tools || []),
      agent.model || null,
      agent.effort || null
    );
  }

  public deleteAgent(agentId: string): boolean {
    const result = this.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
    if (result.changes > 0) {
      const doc = this.readAgentsDoc();
      doc.agents = doc.agents.filter(a => a.id !== agentId);
      try { fs.writeFileSync(AGENTS_FILE, JSON.stringify(doc, null, 2)); } catch (e) {}
      return true;
    }
    return false;
  }

  /* ---------- Tasks ---------- */
  public getTasks(): TaskRecord[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY added_at DESC').all() as any[];
    return rows.map(r => ({
      id: String(r.id),
      dept: r.dept,
      agent: r.agent,
      title: r.title,
      text: r.text,
      plan: r.plan || undefined,
      eta: r.eta || undefined,
      why: r.why || undefined,
      priority: (r.priority || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      state: r.state,
      addedAt: r.added_at,
      changedAt: r.changed_at || undefined,
      startedAt: r.started_at || undefined,
      doneAt: r.done_at || undefined,
      by: r.by_who || undefined,
      model: r.model || undefined,
      effort: r.effort || undefined,
      result: r.result || undefined,
      read: JSON.parse(r.read_notes || '[]'),
      tools: JSON.parse(r.tools || '[]'),
      used: JSON.parse(r.used_tools || '[]'),
      error: Boolean(r.error),
      draft: r.draft || undefined
    }));
  }

  public saveTasks(tasks: TaskRecord[]): void {
    this.db.exec('DELETE FROM tasks');
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, dept, agent, title, text, plan, eta, why, priority, state, added_at, changed_at, started_at, done_at, by_who, model, effort, result, read_notes, used_tools, tools, error, draft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of tasks) {
      stmt.run(
        String(t.id),
        t.dept,
        t.agent,
        t.title,
        t.text || t.title,
        t.plan || null,
        t.eta || null,
        t.why || null,
        t.priority || 'MEDIUM',
        t.state || 'next',
        t.addedAt || Date.now(),
        t.changedAt || Date.now(),
        t.startedAt || null,
        t.doneAt || null,
        t.by || null,
        t.model || null,
        t.effort || null,
        t.result || null,
        JSON.stringify(t.read || []),
        JSON.stringify(t.used || []),
        JSON.stringify(t.tools || []),
        t.error ? 1 : 0,
        t.draft || null
      );
    }
    // NOTE: tasks.json write removed — SQLite is now the single source of truth
  }

  /** Insert a single task record. Idempotent via ON CONFLICT. */
  public addTask(t: any): void {
    this.db.prepare(`
      INSERT INTO tasks (id, dept, agent, title, text, plan, eta, why, priority, state, added_at, changed_at, started_at, done_at, by_who, model, effort, result, read_notes, used_tools, tools, error, draft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        changed_at = excluded.changed_at,
        started_at = COALESCE(excluded.started_at, started_at),
        done_at = COALESCE(excluded.done_at, done_at),
        result = COALESCE(excluded.result, result),
        read_notes = COALESCE(excluded.read_notes, read_notes),
        used_tools = COALESCE(excluded.used_tools, used_tools),
        tools = COALESCE(excluded.tools, tools),
        error = excluded.error,
        draft = COALESCE(excluded.draft, draft)
    `).run(
      String(t.id), t.dept, t.agent, t.title, t.text || t.title,
      t.plan ? JSON.stringify(t.plan) : null,
      t.eta || null, t.why || null, t.priority || 'MEDIUM',
      t.state || 'next', t.addedAt || t.added_at || Date.now(),
      t.changedAt || t.changed_at || Date.now(),
      t.startedAt || t.started_at || null,
      t.doneAt || t.done_at || null,
      t.by || null, t.model || null, t.effort || null,
      t.result || null,
      JSON.stringify(t.read || []),
      JSON.stringify(t.used || []),
      JSON.stringify(t.tools || []),
      t.error ? 1 : 0, t.draft || null
    );
  }

  /** Patch any subset of fields on an existing task. */
  public updateTask(id: string, patch: Record<string, any>): void {
    const map: Record<string, string> = {
      state: 'state', result: 'result', startedAt: 'started_at', doneAt: 'done_at',
      changedAt: 'changed_at', error: 'error', draft: 'draft',
      read: 'read_notes', tools: 'tools', used: 'used_tools',
      note: 'draft', // store note name in draft column when result already set
      needsOk: 'error', // not stored separately; handled in memory
    };
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (!(k in patch)) continue;
      if (k === 'error') { sets.push(`${col} = ?`); vals.push(patch[k] ? 1 : 0); }
      else if (k === 'read' || k === 'tools' || k === 'used') { sets.push(`${col} = ?`); vals.push(JSON.stringify(patch[k] || [])); }
      else { sets.push(`${col} = ?`); vals.push(patch[k] ?? null); }
    }
    if (!sets.length) return;
    sets.push('changed_at = ?'); vals.push(Date.now());
    vals.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  public getTaskById(id: string): any | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: String(r.id), dept: r.dept, agent: r.agent, title: r.title,
      text: r.text, plan: r.plan ? (() => { try { return JSON.parse(r.plan); } catch { return []; } })() : [],
      eta: r.eta, why: r.why, priority: r.priority || 'MEDIUM',
      state: r.state, addedAt: r.added_at, changedAt: r.changed_at,
      startedAt: r.started_at, doneAt: r.done_at, by: r.by_who,
      model: r.model, effort: r.effort, result: r.result,
      read: JSON.parse(r.read_notes || '[]'),
      tools: JSON.parse(r.tools || '[]'),
      used: JSON.parse(r.used_tools || '[]'),
      error: Boolean(r.error), draft: r.draft
    };
  }

  public getTasksByDept(dept: string): any[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE dept = ? ORDER BY added_at DESC').all(dept) as any[];
    return rows.map(r => ({
      id: String(r.id), dept: r.dept, agent: r.agent, title: r.title,
      text: r.text, state: r.state, addedAt: r.added_at, result: r.result,
      error: Boolean(r.error), priority: r.priority
    }));
  }

  public deleteTask(taskId: string): boolean {
    const res = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    return res.changes > 0;
  }

  /* ---------- Task Graph (parent/child for CEO orchestration) ---------- */
  public linkTaskGraph(taskId: string, parentTaskId: string | null, dept: string, role?: string): void {
    this.db.prepare(`
      INSERT INTO task_graph (task_id, parent_task_id, dept, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET parent_task_id = excluded.parent_task_id, dept = excluded.dept, role = COALESCE(excluded.role, role)
    `).run(taskId, parentTaskId || null, dept, role || null);
  }

  public getChildTasks(parentTaskId: string): any[] {
    const rows = this.db.prepare('SELECT tg.*, t.state, t.result, t.agent, t.title FROM task_graph tg LEFT JOIN tasks t ON tg.task_id = t.id WHERE tg.parent_task_id = ?').all(parentTaskId) as any[];
    return rows.map(r => ({ taskId: r.task_id, dept: r.dept, role: r.role, state: r.state, result: r.result, agent: r.agent, title: r.title }));
  }

  /* ---------- Agent Events (handoffs, messages, delegation) ---------- */
  public logAgentEvent(type: 'handoff' | 'message' | 'result' | 'orchestrate', fromAgent: string, opts: { toAgent?: string; taskId?: string; payload?: any } = {}): void {
    const id = 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    this.db.prepare('INSERT INTO agent_events (id, event_type, from_agent, to_agent, task_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, type, fromAgent, opts.toAgent || null, opts.taskId || null, JSON.stringify(opts.payload || {}), Date.now());
  }

  public getAgentEvents(limit = 50, taskId?: string): any[] {
    let sql = 'SELECT * FROM agent_events';
    const params: any[] = [];
    if (taskId) { sql += ' WHERE task_id = ?'; params.push(taskId); }
    sql += ' ORDER BY created_at DESC LIMIT ?'; params.push(limit);
    return (this.db.prepare(sql).all(...params) as any[]).map(r => ({
      id: r.id, type: r.event_type, fromAgent: r.from_agent, toAgent: r.to_agent,
      taskId: r.task_id, payload: JSON.parse(r.payload || '{}'), createdAt: r.created_at
    }));
  }

  /* ---------- DB Stats ---------- */
  public getStats(): Record<string, number> {
    const tables = ['tasks', 'agents', 'departments', 'memories', 'routines', 'task_graph', 'agent_events'];
    const out: Record<string, number> = {};
    for (const t of tables) {
      try { out[t] = (this.db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any)?.c || 0; } catch { out[t] = 0; }
    }
    return out;
  }

  /* ---------- Memories & Cross-Team Graph Memory ---------- */
  public addMemory(mem: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>): MemoryRecord {
    const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const now = Date.now();
    const record: MemoryRecord = { id, ...mem, createdAt: now, updatedAt: now };
    this.db.prepare(`
      INSERT INTO memories (id, agent_id, department, title, content, memory_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, mem.agentId, mem.department, mem.title, mem.content, mem.memoryType || 'note', now, now);
    return record;
  }

  public getMemories(dept?: string, agentId?: string): MemoryRecord[] {
    let sql = 'SELECT * FROM memories';
    const params: any[] = [];
    if (dept && agentId) {
      sql += ' WHERE department = ? OR agent_id = ?';
      params.push(dept, agentId);
    } else if (dept) {
      sql += ' WHERE department = ?';
      params.push(dept);
    } else if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      department: r.department,
      title: r.title,
      content: r.content,
      memoryType: r.memory_type as any,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public searchMemories(query: string): MemoryRecord[] {
    const q = `%${query.toLowerCase()}%`;
    const rows = this.db.prepare('SELECT * FROM memories WHERE LOWER(title) LIKE ? OR LOWER(content) LIKE ? ORDER BY created_at DESC').all(q, q) as any[];
    return rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      department: r.department,
      title: r.title,
      content: r.content,
      memoryType: r.memory_type as any,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  /* ---------- Graph State Persistence (LangGraph Harness) ---------- */
  public saveGraphState(state: {
    taskId: string;
    dept: string;
    agentId: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    qaScore?: number;
    qaFeedback?: string;
    history: any[];
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO graph_states (task_id, dept, agent_id, status, attempts, max_attempts, qa_score, qa_feedback, history, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        dept = excluded.dept,
        agent_id = excluded.agent_id,
        status = excluded.status,
        attempts = excluded.attempts,
        max_attempts = excluded.max_attempts,
        qa_score = excluded.qa_score,
        qa_feedback = excluded.qa_feedback,
        history = excluded.history,
        updated_at = excluded.updated_at
    `).run(
      state.taskId,
      state.dept,
      state.agentId,
      state.status,
      state.attempts,
      state.maxAttempts,
      state.qaScore !== undefined ? state.qaScore : null,
      state.qaFeedback || null,
      JSON.stringify(state.history || []),
      now
    );
  }

  public getGraphState(taskId: string): any {
    const row = this.db.prepare('SELECT * FROM graph_states WHERE task_id = ?').get(taskId) as any;
    if (!row) return null;
    return {
      taskId: row.task_id,
      dept: row.dept,
      agentId: row.agent_id,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      qaScore: row.qa_score,
      qaFeedback: row.qa_feedback,
      history: JSON.parse(row.history || '[]'),
      updatedAt: row.updated_at
    };
  }

  public getMcpServers(): McpServerRecord[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      key: r.key,
      command: r.command,
      args: JSON.parse(r.args || '[]'),
      env: JSON.parse(r.env || '{}'),
      depts: JSON.parse(r.depts || '[]'),
      status: r.status,
      source: r.source,
      allowed: !!r.allowed,
    }));
  }

  public saveMcpServer(s: McpServerRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO mcp_servers (id, name, key, command, args, env, depts, status, source, allowed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        key = excluded.key,
        command = excluded.command,
        args = excluded.args,
        env = excluded.env,
        depts = excluded.depts,
        status = excluded.status,
        source = excluded.source,
        allowed = excluded.allowed
    `);
    stmt.run(s.id, s.name, s.key || s.id, s.command || '', JSON.stringify(s.args || []), JSON.stringify(s.env || {}), JSON.stringify(s.depts || []), s.status || 'connected', s.source || 'custom', s.allowed ? 1 : 0);
  }

  public deleteMcpServer(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  }
}

export const db = new Database();

