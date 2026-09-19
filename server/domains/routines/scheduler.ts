import { db } from '../../infrastructure/db.ts';
import * as routines from './routines.ts';
import { parseWhen, describe, valid as validWhen, untilText } from '../../../src/when.ts';
import { normModel, normEffort } from '../../../src/models.ts';
import { route } from '../orchestrator/orchestrator.ts';

const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const slug = (t: any) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const uniqueId = (base: string, list: any[]) => {
  let id = base || 'routine', n = 2;
  while (list.some(r => r.id === id)) id = `${base}-${n++}`;
  return id;
};

export class RoutineScheduler {
  brainPath: string;
  dataDir: string;
  rstate: any;
  rlist: { routines: any[]; problems: string[]; path: string };
  enqueue: (fn: () => Promise<any>) => Promise<any>;
  runServerTask: (id: string, opts?: any) => Promise<any>;

  constructor(options: {
    brainPath: string;
    dataDir: string;
    agents: any[];
    enqueue: (fn: () => Promise<any>) => Promise<any>;
    runServerTask: (id: string, opts?: any) => Promise<any>;
  }) {
    this.brainPath = options.brainPath;
    this.dataDir = options.dataDir;
    this.enqueue = options.enqueue;
    this.runServerTask = options.runServerTask;
    this.rstate = routines.loadState(this.dataDir);
    this.rlist = { routines: [], problems: [], path: routines.file(this.brainPath) };
  }

  loadRoutines(agents: any[]) {
    const r = routines.load(this.brainPath, agents);
    if (r.problems.join() !== this.rlist.problems.join()) {
      for (const w of r.problems) console.warn('routines:', w);
    }
    this.rlist = r;
    const { list, changed } = routines.withState(r.routines, this.rstate);
    if (changed) routines.saveState(this.dataDir, this.rstate);
    return list;
  }

  routinesOut(agents: any[]) {
    const list = this.loadRoutines(agents);
    return { routines: list, depts: routines.ALLOWED, path: this.rlist.path, problems: this.rlist.problems };
  }

  fire(r: any, agents: any[], { due = Date.now(), late = false, by = 'routine' } = {}) {
    const task = {
      id: nid(),
      dept: r.dept,
      agent: r.agent,
      title: r.title,
      text: r.text,
      plan: r.plan || [],
      eta: 15,
      why: '',
      state: 'next',
      addedAt: Date.now(),
      by,
      routine: r.id,
      when: r.desc || describe(r.when),
      needsOk: r.needsOk,
      due,
      late,
      routineModel: r.model || undefined,
      routineEffort: r.effort || undefined
    };
    db.addTask(task);
    routines.advance(this.rstate, r, Date.now(), task.id, late);
    routines.saveState(this.dataDir, this.rstate);
    console.log(`⏱ ${task.id} → ${task.agent}: ${task.title}${late ? ' (LATE · was due ' + new Date(due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}`);
    this.enqueue(() => this.runServerTask(task.id));
    return task;
  }

  tickRoutines(agents: any[]) {
    let list: any[];
    try {
      list = this.loadRoutines(agents);
    } catch (e: any) {
      console.warn('routines:', e.message);
      return;
    }
    for (const { routine, due, late } of routines.due(list, this.rstate)) {
      this.fire(routine, agents, { due, late });
    }
  }

  editRoutine(id: string, patch: any, agents: any[]) {
    const r = this.rlist.routines.find(x => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    routines.save(this.brainPath, this.rlist.routines);
    return this.loadRoutines(agents).find((x: any) => x.id === id);
  }

  removeRoutine(id: string, agents: any[]) {
    const n = this.rlist.routines.length;
    this.rlist.routines = this.rlist.routines.filter(x => x.id !== id);
    if (this.rlist.routines.length !== n) routines.save(this.brainPath, this.rlist.routines);
    this.loadRoutines(agents);
    return this.rlist.routines.length !== n;
  }

  async makeRoutine(
    { dept, text, when, agent, needsOk, model, effort }: { dept: string; text?: string; when?: any; agent?: string; needsOk?: boolean; model?: string; effort?: string },
    options: {
      agents: any[];
      depts: Record<string, any>;
      businessName: string;
      officeModel: string;
      refreshSkills: () => any;
    }
  ) {
    const { agents, depts, businessName, officeModel, refreshSkills } = options;
    let taskText = String(text || '').trim(), w = when, parsed: any = null;
    if (!w) {
      parsed = parseWhen(taskText);
      if (!parsed) return { error: 'No schedule in that sentence. Say when: "every weekday at 8am, …", "Mondays 9am, …", "every hour 9-5, …".', noSchedule: true };
      if (parsed.needsDay) return { error: 'Which day? Say "every Monday …" or "Mon and Thu …".', needsDay: true };
      if (parsed.needsTime) return { error: 'What time? Say "… at 8am" or "… at 17:30".', needsTime: true };
      w = parsed.when;
      taskText = parsed.text;
    }
    if (!validWhen(w)) return { error: 'That schedule is not complete.' };
    if (!taskText) return { error: 'What should happen? The sentence has a time but no task.' };
    this.loadRoutines(agents);
    const r = await route(dept, taskText, { agents, depts, businessName, officeModel, refreshSkills });
    const a = agent && agents.find(x => x.id === agent && x.department === dept) ? agent : r.agent;
    const v = routines.validate(
      {
        id: uniqueId(slug(r.title).slice(0, 40), this.rlist.routines),
        dept,
        agent: a,
        title: r.title,
        text: taskText,
        when: w,
        needsOk: typeof needsOk === 'boolean' ? needsOk : r.needsOk,
        plan: r.plan,
        model: normModel(model) || undefined,
        effort: normEffort(effort) || undefined
      },
      agents,
      this.rlist.routines
    );
    if (v.problems.length) return { error: v.problems.join('; ') };
    this.rlist.routines.push(v.routine);
    routines.save(this.brainPath, this.rlist.routines);
    const out = this.loadRoutines(agents).find((x: any) => x.id === v.routine.id);
    console.log(`⏱ routine ${out.id} → ${out.agent}: ${out.title} (${out.desc} · next ${untilText(out.nextAt)}${out.needsOk ? ' · waits for the OK' : ''})`);
    return { ok: true, routine: out, why: r.why, guessed: parsed?.guessed ? parsed.guessWord : null };
  }
}
