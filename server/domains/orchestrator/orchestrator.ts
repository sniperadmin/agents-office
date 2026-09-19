import { db } from '../../infrastructure/db.ts';
import { ask, parseJSON } from '../../infrastructure/llm.ts';
import * as routines from '../routines/routines.ts';
import { DEFAULT_MODEL } from '../../../src/models.ts';
import { runTask, writeNote } from './taskRunner.ts';
import { saveTaskAsMemory } from '../agents/context.ts';

const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const persona = (a: any) => `${a.name}${a.lead ? ' (lead)' : ''} · ${a.role} · ${a.does}`;

export function rosterText(dept: string, agents: any[], skills: any): string {
  return agents
    .filter(a => a.department === dept)
    .map(a => {
      const sk = skills.names(a);
      return `- ${a.id} · ${persona(a)}${sk.length ? ' · skills: ' + sk.join(', ') : ''}`;
    })
    .join('\n');
}

export async function route(
  dept: string,
  text: string,
  options: {
    agents: any[];
    depts: Record<string, any>;
    businessName: string;
    officeModel: string;
    refreshSkills: () => any;
  }
) {
  const { agents, depts, businessName, officeModel, refreshSkills } = options;
  const d = depts[dept] || { name: dept };
  const skills = refreshSkills();
  const system = `You are the router for ${businessName}, a business whose departments are run by AI agents. ` +
    'Pick the single best agent for the owner\'s request — an agent whose skills match the request is the right one — and return ONLY a JSON object — no prose, no code fences.';
  const user = `Department: ${d.name}\nAgents (id · name · role · what they do):\n${rosterText(dept, agents, skills)}\n\nOwner's request: "${text}"\n\n` +
    'Return: {"agent":"<id from the list>","title":"<clean imperative task title, max 70 characters>","plan":["<step>","<step>","<step>"],"eta_minutes":<integer>,"why":"<one short sentence>","needs_ok":<true if doing this involves sending, posting, paying, deleting or changing anything outside this machine; false if it only reads and reports>}';
  const j = parseJSON(await ask(system, user, { maxTokens: 800, timeout: 150000, model: officeModel || DEFAULT_MODEL }));
  const valid = agents.find(a => a.id === j.agent && a.department === dept);
  const agent = valid ? valid.id : (agents.find(a => a.department === dept && a.lead) || agents.find(a => a.department === dept)!).id;
  return {
    agent,
    title: String(j.title || text).slice(0, 90),
    plan: Array.isArray(j.plan) ? j.plan.slice(0, 4).map(String) : [],
    eta: Number.isFinite(j.eta_minutes) ? j.eta_minutes : 30,
    why: String(j.why || ''),
    needsOk: typeof j.needs_ok === 'boolean' ? j.needs_ok : routines.guessNeedsOk(text)
  };
}

export async function orchestrate(
  text: string,
  parentTaskId: string,
  options: {
    model?: string;
    agents: any[];
    depts: Record<string, any>;
    deptKeys: string[];
    brainPath: string;
    notesDir: string;
    businessName: string;
    officeModel: string;
    officeEffort: string;
    pushEvent: (t: string, p: any) => void;
    rebuildGraph: () => Promise<any>;
    refreshSkills: () => any;
  }
): Promise<string> {
  const { model, agents, depts, deptKeys, brainPath, notesDir, businessName, officeModel, officeEffort, pushEvent, rebuildGraph, refreshSkills } = options;
  const activeDepts = deptKeys.filter(k => k !== 'brain' && k !== 'exec' && agents.some(a => a.department === k));
  const ceo = agents.find(a => a.is_ceo || a.id === 'ceo') || agents.find(a => a.department === 'exec')!;
  const decompSystem = `You are ${ceo.name}, CEO of ${businessName}. Decompose the owner's request into targeted sub-tasks for each relevant department. Return ONLY a JSON array — no prose, no code fences.`;
  const decompUser = `Request: "${text}"\nDepartments available: ${activeDepts.map(k => `${k} (${depts[k]?.name || k})`).join(', ')}\n` +
    'Return: [{"dept":"<key>","task":"<specific task for that department, one sentence>"},...] — only include departments that are genuinely needed. Maximum 6 items.';
  let subTasks: { dept: string; task: string }[] = [];
  try {
    const raw = await ask(decompSystem, decompUser, { maxTokens: 600, timeout: 90000, model: model || officeModel });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    subTasks = Array.isArray(parsed) ? parsed.filter(x => x.dept && x.task && depts[x.dept]) : [];
  } catch (e: any) {
    console.warn('orchestrate: decompose failed:', e.message);
    subTasks = activeDepts.map(dept => ({ dept, task: text }));
  }
  if (!subTasks.length) return `CEO: no department sub-tasks identified for "${text}".`;

  console.log(`🎯 CEO orchestrating "${text.slice(0, 60)}" → ${subTasks.length} departments`);
  db.logAgentEvent('orchestrate', ceo.id, { taskId: parentTaskId, payload: { subTasks } });

  const results = await Promise.allSettled(subTasks.map(async ({ dept, task }) => {
    const r = await route(dept, task, { agents, depts, businessName, officeModel, refreshSkills });
    const subTask: any = {
      id: nid(),
      dept,
      agent: r.agent,
      title: r.title,
      text: task,
      plan: r.plan,
      eta: r.eta,
      why: r.why,
      priority: 'HIGH',
      state: 'doing',
      addedAt: Date.now(),
      startedAt: Date.now(),
      by: 'ceo',
      model: model || undefined
    };
    db.addTask(subTask);
    db.linkTaskGraph(subTask.id, parentTaskId, dept, depts[dept]?.name || dept);
    db.logAgentEvent('handoff', ceo.id, { toAgent: r.agent, taskId: subTask.id, payload: { dept, task } });
    pushEvent('agent_event', { eventType: 'handoff', fromAgent: ceo.id, toAgent: r.agent, taskId: subTask.id, dept });
    try {
      const out = await runTask(subTask, { agents, depts, brainPath, businessName, officeModel, officeEffort, refreshSkills });
      Object.assign(subTask, { state: 'done', doneAt: Date.now(), result: out.result, read: out.read, tools: out.tools, used: out.used, error: false });
      db.addTask(subTask);
      db.logAgentEvent('result', r.agent, { toAgent: ceo.id, taskId: subTask.id, payload: { dept, result: out.result.slice(0, 200) } });
      pushEvent('task_done', { taskId: subTask.id, dept, agent: r.agent, title: subTask.title });
      saveTaskAsMemory(subTask, r.agent, dept);
      return { dept, deptName: depts[dept]?.name || dept, agent: r.agent, title: r.title, result: out.result };
    } catch (e: any) {
      Object.assign(subTask, { state: 'done', doneAt: Date.now(), result: `Error: ${e.message}`, error: true });
      db.addTask(subTask);
      return { dept, deptName: depts[dept]?.name || dept, agent: r.agent, title: r.title, result: `[error] ${e.message}` };
    }
  }));

  const settled = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { dept: subTasks[i].dept, deptName: depts[subTasks[i].dept]?.name || subTasks[i].dept, agent: '?', title: '?', result: `[failed] ${(r as any).reason?.message}` }
  );

  const synSystem = `You are ${ceo.name}, CEO of ${businessName}. Synthesize the department reports below into a single executive summary for the owner. Plain text: one short heading per department, then an overall conclusion. Under 350 words total.`;
  const synUser = `Original request: "${text}"\n\nDepartment Results:\n${settled.map(s => `## ${s.deptName} (${s.agent})\n${s.result}`).join('\n\n')}`;
  const summary = await ask(synSystem, synUser, { maxTokens: 1000, timeout: 120000, model: model || officeModel });
  return summary;
}
