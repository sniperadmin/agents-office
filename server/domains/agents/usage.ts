// Agents Office V3.6 — Usage Service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
export const WINDOW = 5 * 3600 * 1000;
export const stateFile = (dataDir: string): string => path.join(dataDir, 'usage.json');

export function readToken(): string | null {
  if (process.platform === 'darwin') {
    const r = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) { try { const t = JSON.parse(r.stdout).claudeAiOauth?.accessToken; if (t) return t; } catch {} }
  }
  try { const t = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth?.accessToken; if (t) return t; } catch {}
  return null;
}

export function parseUsage(j: any) {
  const pick = (x: any) => x && typeof x.utilization === 'number'
    ? { percent: Math.max(0, Math.min(100, Math.round(x.utilization))), resetsAt: x.resets_at ? Date.parse(x.resets_at) || null : null } : null;
  const session = pick(j?.five_hour), week = pick(j?.seven_day);
  if (!session && !week) return null;
  return { session, week };
}

export async function fetchUsage() {
  const token = readToken();
  if (!token) return { ok: false, reason: 'using office engine token count' };
  try {
    const r = await fetch(ENDPOINT, { headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: `Usage endpoint answered ${r.status}` };
    const u = parseUsage(await r.json());
    if (!u) return { ok: false, reason: "Usage endpoint answered in a shape the office does not know" };
    return { ok: true, source: 'claude', ...u };
  } catch (e: any) { return { ok: false, reason: e.name === 'TimeoutError' ? "Usage endpoint timed out" : e.message }; }
}

export const loadState = (dataDir: string): any => { try { return JSON.parse(fs.readFileSync(stateFile(dataDir), 'utf8')); } catch { return {}; } };
export function saveState(dataDir: string, st: any) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile(dataDir), JSON.stringify(st)); }
export function windowState(st: any, now = Date.now()) {
  if (!st.startedAt || now - st.startedAt >= WINDOW) return { startedAt: null, tokens: 0, runs: 0 };
  return { startedAt: st.startedAt, tokens: st.tokens || 0, runs: st.runs || 0 };
}
export function record(st: any, usage: any, now = Date.now()) {
  const w = windowState(st, now);
  if (!w.startedAt) w.startedAt = now;
  const u = usage || {};
  w.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  w.runs += 1;
  return w;
}
export function fallback(st: any, now = Date.now()) {
  const w = windowState(st, now);
  return { ok: true, source: 'office', window: { tokens: w.tokens, runs: w.runs, startedAt: w.startedAt, resetsAt: w.startedAt ? w.startedAt + WINDOW : null } };
}
