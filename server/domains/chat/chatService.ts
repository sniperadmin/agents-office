import { db } from '../../infrastructure/db.ts';
import * as mcp from '../../infrastructure/mcp.ts';
import { getAgentContext } from '../agents/context.ts';
import { modelFor, effortFor } from '../../../src/models.ts';
import { askX } from '../../infrastructure/llm.ts';
import { agentBrief } from '../orchestrator/taskRunner.ts';
import * as routines from '../routines/routines.ts';
import { parseWhen, untilText } from '../../../src/when.ts';

const toolKeys = (names: string[]) => [...new Set(names.map(n => /^mcp__/.test(n) ? mcp.keyOf(n) : n === 'WebSearch' || n === 'WebFetch' ? 'web' : null).filter(Boolean) as string[])];

export async function chat(
  agentId: string,
  text: string,
  history: any[] | undefined,
  options: {
    agents: any[];
    depts: Record<string, any>;
    brainPath: string;
    businessName: string;
    officeModel: string;
    officeEffort: string;
    refreshSkills: () => any;
  }
) {
  const { agents, depts, brainPath, businessName, officeModel, officeEffort, refreshSkills } = options;
  const a = agents.find(x => x.id === agentId);
  if (!a) throw new Error('unknown agent');
  const d = depts[a.department] || { name: a.department };
  const skills = refreshSkills();
  const ctx = await getAgentContext(a.id, a.department, text, brainPath, businessName);
  const mine = db.getTasksByDept(a.department).filter(t => t.agent === agentId).slice(0, 6).map(t => `- [${t.state}] ${t.title}`).join('\n');
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${businessName}. ${a.does}\n${agentBrief(a, brainPath, skills)}` +
    'You are talking to the owner. Answer as this agent, in first person, briefly (under 120 words unless asked for detail), plainly, no hype. ' +
    'Use the company notes; say when something is not in them. If the owner asks you to look something up, use your tools. Nothing outbound is sent without the owner\'s explicit say-so.\n\n' +
    `${mcp.promptText(a.tools)}\n\nCOMPANY NOTES\n${ctx.businessContext}\n\nMEMORIES & RELEVANT NOTES\n${ctx.relevantMemories}\n\nYOUR RECENT TASKS\n${mine || '—'}`;
  const convo = (history || []).slice(-8).map(m => `${m.who === 'user' ? 'Owner' : a.name}: ${m.text}`).join('\n');
  const pick = modelFor({ agent: a.model, office: officeModel });
  const eff = effortFor({ agent: a.effort, office: officeEffort, model: pick.model });
  const { text: reply, tools } = await askX(
    system,
    (convo ? convo + '\n' : '') + `Owner: ${text}\n${a.name}:`,
    {
      maxTokens: 1200,
      model: pick.model,
      effort: eff.effort
    }
  );
  return { reply, read: ctx.readNames, tools: toolKeys(tools), used: mcp.namesOf(tools) };
}

export async function routinesChat(
  a: any,
  text: string,
  options: {
    agents: any[];
    loadRoutines: () => any[];
    editRoutine: (id: string, patch: any) => any;
    removeRoutine: (id: string) => boolean;
    fire: (r: any, opts?: any) => any;
    makeRoutine: (opts: any) => Promise<any>;
  }
) {
  const { agents, loadRoutines, editRoutine, removeRoutine, fire, makeRoutine } = options;
  const t = String(text).trim(), dept = a.department, allowed = routines.ALLOWED.includes(dept);
  const agentName = (id: string) => agents.find(ag => ag.id === id)?.name || id;

  if (/^\s*(routines?|schedule|timetable|what(?:'s| is) (?:scheduled|on the (?:schedule|timetable)))\s*\??\s*$/i.test(t)) {
    return { reply: allowed ? routines.listText(loadRoutines(), dept, agents) : routines.refusal(dept) };
  }
  const cmd = /^\s*(pause|stop|resume|start|unpause|delete|remove|run)\b\s*(?:the\s+)?(.*?)\s*[.!]?$/i.exec(t);
  if (cmd && allowed && !parseWhen(t)) {
    const list = loadRoutines();
    const words = cmd[2].replace(/\s+(routine|one)$/i, '');
    const r = routines.matchRoutine(list, dept, words);
    if (!r) return { reply: (list.some((x: any) => x.dept === dept) ? 'Which one? ' : '') + routines.listText(list, dept, agents) };
    const verb = cmd[1].toLowerCase();
    if (verb === 'run') {
      const task = fire(r, { by: 'you' });
      return { reply: `Running "${r.title}" now — ${r.agent === a.id ? 'I have it' : agentName(r.agent) + ' has it'}. It lands in the panel${r.needsOk ? ' and waits for your OK before anything is sent' : ''}.`, task };
    }
    if (/pause|stop/.test(verb)) {
      editRoutine(r.id, { paused: true });
      return { reply: `Paused "${r.title}". It stays on the timetable; say "resume ${r.title.toLowerCase()}" to start it again.` };
    }
    if (/resume|start|unpause/.test(verb)) {
      const n = editRoutine(r.id, { paused: false });
      return { reply: `"${r.title}" is back on — next ${untilText(n.nextAt)}.` };
    }
    if (/delete|remove/.test(verb)) {
      removeRoutine(r.id);
      return { reply: `Deleted "${r.title}". It is off the timetable.` };
    }
  }
  const p = parseWhen(t);
  if (!p) return null;
  if (!allowed) return { reply: routines.refusal(dept) };
  if (p.needsDay) return { reply: 'Which day? Say it again with the day: "every Monday at 9am, …".' };
  if (p.needsTime) return { reply: `What time? Say it again with the time, e.g. "every weekday at 8am, ${p.text ? p.text.slice(0, 60) : '…'}".` };
  if (!p.text) return { reply: 'I have the time but not the task. Say it again with what should happen.' };
  const made = await makeRoutine({ dept, text: p.text, when: p.when, agent: a.lead ? undefined : a.id });
  if (made.error) return { reply: made.error };
  const r: any = made.routine, who = r.agent === a.id ? 'I have it' : `${agentName(r.agent)} has it`;
  return { reply: `Done. ${r.desc.charAt(0).toUpperCase() + r.desc.slice(1)}, ${who}.${made.guessed ? ` I took "${made.guessed}" as ${r.when.at}; say a time to change it.` : ''} ${r.needsOk ? 'Anything to send waits for your OK first.' : 'It only reads, so it will not wait for you.'} Next run ${untilText(r.nextAt)}. Say "routines" to see the list, "pause ${r.title.toLowerCase()}" to stop it.`, routine: r };
}
