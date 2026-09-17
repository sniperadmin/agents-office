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
    try {
      fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    } catch (e: any) {
      console.warn('db: sync warning for tasks.json:', e.message);
    }
  }

  public deleteTask(taskId: string): boolean {
    const res = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    if (res.changes > 0) {
      this.saveTasks(this.getTasks());
      return true;
    }
    return false;
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
}

export const db = new Database();
