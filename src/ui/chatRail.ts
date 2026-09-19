import * as THREE from 'three';
import { DEPTS, AGENTS } from '../data.ts';
import { FILE_GEN, P, rnd, ri, person } from '../v1data.ts';

export interface ChatRailOptions {
  R: Record<string, any>;
  deptRT: Record<string, any>;
  chatHist: Record<string, any[]>;
  RAIL_SIDE: Record<string, string>;
  getTasks: () => any;
  getMcp: () => any;
  getBrain: () => any;
  getFocused: () => string | null;
  flyTo: (pos: number[], zoom: number, dur?: number, opts?: any) => void;
  focusTarget: (k: string, atPos?: any) => { pos: number[]; zoom: number };
  resolveApproval: (id: string, approved: boolean) => void;
  stuckIn: (dept: string) => any[];
  esc: (s: string) => string;
}

export function createChatRail(options: ChatRailOptions) {
  const {
    R, deptRT, chatHist, RAIL_SIDE, getTasks, getMcp, getBrain, getFocused,
    flyTo, focusTarget, resolveApproval, stuckIn, esc
  } = options;

  const rail = document.getElementById('rail');
  const mMsgs = document.getElementById('mMsgs');
  let modalOpen: string | null = null;
  let modalTab = 'chat';

  function ago(ts: number) {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
  }

  function ensureChat(id: string) {
    if (chatHist[id]) return;
    const r = R[id];
    const v = r?.v1 || { greeting: `Hello, I am ${id}.` };
    const tasks = getTasks();
    chatHist[id] = [
      { who: 'agent', text: v.greeting || 'Hello.' },
      { who: 'work', i: '⏺', text: 'session attached — live work stream below' },
    ];
    if (FILE_GEN[id] && !(tasks && tasks.isLive())) {
      chatHist[id].push({ who: 'file', ...FILE_GEN[id]() });
    }
  }

  function chatPush(id: string, msg: any) {
    ensureChat(id);
    chatHist[id].push(msg);
    if (chatHist[id].length > 80) chatHist[id].splice(2, 1);
    if (modalOpen === id && modalTab === 'chat') renderChat(id);
  }

  function renderChat(id: string | null) {
    if (!id || !chatHist[id] || !mMsgs) return;
    mMsgs.innerHTML = chatHist[id].map((m, i) => {
      if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}</div>`;
      if (m.who === 'user') return `<div class="m-user">${esc(m.text)}</div>`;
      if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
      if (m.who === 'file') return `
        <div class="m-file" data-i="${i}">
          <div class="f-head"><span>${m.icon}</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.meta)}</div></div></div>
          <pre>${esc(m.content)}</pre>
        </div>`;
      if (m.who === 'appr') return `
        <div class="m-appr" data-i="${i}">
          <div class="a-who">needs your approval</div>
          <div class="a-ask">${esc(m.text)}</div>
          ${m.mock ? `<div class="a-mock">${m.mock}</div>` : ''}
          ${m.pending
            ? '<div class="a-btns"><button class="a-yes">APPROVE</button><button class="a-no">REJECT</button></div>'
            : `<div class="a-done">${m.approved ? '✓ Approved' : '✗ Rejected'} by AJ</div>`}
        </div>`;
      return '';
    }).join('');
    mMsgs.querySelectorAll('.m-file').forEach(el =>
      el.addEventListener('click', () => el.classList.toggle('exp')));
    mMsgs.querySelectorAll('.m-appr .a-yes').forEach(el =>
      el.addEventListener('click', () => resolveApproval(id, true)));
    mMsgs.querySelectorAll('.m-appr .a-no').forEach(el =>
      el.addEventListener('click', () => resolveApproval(id, false)));
    mMsgs.scrollTop = mMsgs.scrollHeight;
  }

  function renderActivity(id: string | null) {
    if (!id) return;
    const r = R[id];
    if (!r) return;
    const v = r.v1 || {};
    const task = rnd(v.tasks || ['Working through the queue'])
      .replace('{co}', rnd(P.co)).replace('{person}', person()).replace('{count}', ri(3, 9));
    const nowEl = document.getElementById('mNow');
    const statsEl = document.getElementById('mStats');
    const feedEl = document.getElementById('mFeed');
    const chLbl = document.querySelector('#mChart .ch-lbl');
    const chBars = document.querySelector('#mChart .ch-bars');

    if (nowEl) nowEl.innerHTML = `NOW &nbsp;<b>${esc(task)}</b>`;
    if (statsEl) statsEl.innerHTML = (v.stats || []).map(([l, val]: any) => `
      <div class="st"><div class="st-l">${esc(l)}</div><div class="st-v">${esc(String(typeof val === 'function' ? val() : val))}</div></div>`).join('');
    const chip = DEPTS[r.a?.dept]?.chip || '#8FD3F4';
    const mx = Math.max(...(v.chart || [1]));
    if (chLbl) chLbl.textContent = v.chartLbl || '';
    if (chBars) chBars.innerHTML = (v.chart || []).map((n: number) =>
      `<i style="height:${Math.round(n / mx * 100)}%;background:${chip}"></i>`).join('');
    if (feedEl) feedEl.innerHTML = (r.feed || []).map((f: any) => `
      <div class="fe"><span class="fi">${f.i}</span><span>${esc(f.text)}</span><span class="ft">${ago(f.ts)}</span></div>`).join('');
  }

  function setTab(tab: string) {
    modalTab = tab;
    document.querySelectorAll('#rail .mtabs button').forEach((b: any) =>
      b.classList.toggle('on', b.dataset.tab === tab));
    const cEl = document.getElementById('mChat');
    const aEl = document.getElementById('mAct');
    if (cEl) cEl.style.display = tab === 'chat' ? 'flex' : 'none';
    if (aEl) aEl.style.display = tab === 'activity' ? 'flex' : 'none';
    if (tab === 'chat') renderChat(modalOpen); else renderActivity(modalOpen);
  }
  document.querySelectorAll('#rail .mtabs button').forEach((b: any) =>
    b.addEventListener('click', () => setTab(b.dataset.tab)));

  function openAgentRail(id: string, tab = 'chat', fly = true) {
    const r = R[id];
    if (!r) return;
    ensureChat(id);
    modalOpen = id;
    const dept = DEPTS[r.a?.dept] || { chip: '#888', name: r.a?.dept || 'Team' };
    const dot = document.querySelector('#railAgent .mh-dot') as HTMLElement;
    if (dot) dot.style.background = dept.chip;
    const nameEl = document.querySelector('#railAgent .mh-name');
    if (nameEl) {
      nameEl.innerHTML = (r.a?.lead ? '<span class="star">★ </span>' : '') + (r.a?.name || id);
    }
    const roleEl = document.querySelector('#railAgent .mh-role');
    if (roleEl) roleEl.textContent = `${r.v1?.role || r.a?.role || 'Agent'} · ${dept.name}`;
    const tagEl = document.querySelector('#railAgent .mh-tag');
    if (tagEl) tagEl.textContent = r.v1?.tagline || r.a?.bio || '';
    const chipsEl = document.getElementById('mChips');
    if (chipsEl) {
      chipsEl.innerHTML = (r.v1?.chips || []).map((c: string) =>
        `<button>${esc(c)}</button>`).join('');
      chipsEl.querySelectorAll('button').forEach(b =>
        b.addEventListener('click', () => sendChat(b.textContent || '')));
    }
    if (rail) rail.classList.add('agentOpen');
    setTab(tab);
    const tasks = getTasks();
    if (tasks && tasks.railFor) tasks.railFor(id);
    if (fly && r.seat && focusTarget) {
      const t = focusTarget(r.a?.dept, r.seat);
      if (t) flyTo(t.pos, t.zoom, 500);
    }
  }

  function sendChat(text: string) {
    const id = modalOpen;
    if (!id || !text.trim()) return;
    const r = R[id];
    chatPush(id, { who: 'user', text });
    const input = document.getElementById('mIn') as HTMLInputElement;
    if (input) input.value = '';
    const low = text.toLowerCase();
    const tasks = getTasks();
    const mcp = getMcp();
    const brain = getBrain();

    setTimeout(() => {
      if (tasks && tasks.pendingReject && tasks.pendingReject(id)) {
        tasks.rejectLive(id, text);
        return;
      }
      if (r.state === 'stuck' && /\b(approve|reject)\b/.test(low)) {
        resolveApproval(id, /approve/.test(low));
        return;
      }
      const rv = tasks && tasks.isLive && tasks.isLive() && text.match(/^\s*revise\s*[:\-–]\s*(.+)$/i);
      if (rv && tasks.revise && tasks.revise(id, rv[1].trim())) {
        chatPush(id, { who: 'agent', text: 'On it — revising now. It will land here when it is ready.' });
        return;
      }
      const tr = tasks && tasks.handleChat && tasks.handleChat(id, text);
      if (tr) {
        chatPush(id, { who: 'agent', text: tr });
        return;
      }
      if (tasks && tasks.isLive && tasks.isLive()) {
        chatPush(id, { who: 'work', i: '…', text: `${r.a.name} is thinking` });
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agent: id,
            text,
            history: chatHist[id].filter(m => m.who === 'user' || m.who === 'agent').slice(-8)
          })
        })
          .then(async res => {
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            return res.json();
          })
          .then(j => {
            const h = chatHist[id];
            const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} is thinking`);
            if (k >= 0) h.splice(k, 1);
            chatPush(id, { who: 'agent', text: j.reply });
            if (j.routines && tasks.refresh) tasks.refresh();
            if (j.read && brain) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
            if (j.tools && j.tools.length && mcp) mcp.onToolsUsed(id, j.tools);
          })
          .catch(e => chatPush(id, { who: 'agent', text: `I couldn't reach the AI engine (${e.message}).` }));
        return;
      }
      const hit = ((r.v1 && r.v1.chat) || []).find((c: any) => c.k.some((k: string) => low.includes(k)));
      const reply = hit ? rnd(hit.r) : rnd((r.v1 && r.v1.fallback) || ['On it.']);
      chatPush(id, { who: 'agent', text: reply });
    }, 450 + Math.random() * 500);
  }

  document.getElementById('mSend')?.addEventListener('click', () => {
    const inp = document.getElementById('mIn') as HTMLInputElement;
    if (inp) sendChat(inp.value);
  });
  document.getElementById('mIn')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat((e.target as HTMLInputElement).value);
    e.stopPropagation();
  });

  function buildDeptRail(k: string, getBbRows: (k: string) => any[]) {
    const dept = DEPTS[k];
    const n = AGENTS.filter(a => a.dept === k).length;
    const rh = document.getElementById('railHeader');
    if (!rh) return;
    rh.classList.remove('show');
    const tasks = getTasks();
    rh.innerHTML = `
      <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.name}<span class="live"></span></div>
      <div class="b-count"><span class="b-num">${n}</span><span class="b-lab">AGENTS</span></div>
      <div class="b-metrics">${getBbRows(k).map((row, i) => `
        <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-rm="${k}-${i}">${row[1]()}</span></div>`).join('')}</div>
      ${tasks ? tasks.rowHTML(k) : ''}
      <div class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}">⚠ <span class="ap-n">${stuckIn(k).length}</span> WAITING APPROVAL</div>`;
    const trow = rh.querySelector('.b-tasks');
    if (trow && tasks) trow.addEventListener('click', () => tasks.toggle());
    rh.querySelector('.b-appr')?.addEventListener('click', () => {
      const s = stuckIn(k)[0];
      if (s) openAgentRail(s.a.id);
    });
  }

  function cascadeRows() {
    document.querySelectorAll('#railRows .arow').forEach((el: any, i) => {
      el.style.transitionDelay = (280 + i * 85) + 'ms';
      requestAnimationFrame(() => el.classList.add('in'));
      setTimeout(() => { el.style.transitionDelay = '0ms'; }, 1600);
    });
  }

  function flyBillboardIntoRail(k: string) {
    const badge = deptRT[k] ? deptRT[k].badge : null;
    if (!badge || !rail) return;
    const from = badge.getBoundingClientRect();
    badge.style.display = 'none';
    const side = RAIL_SIDE[k];
    const railW = rail.offsetWidth;
    const tLeft = side === 'left' ? 18 : window.innerWidth - railW + 18;
    const clone = badge.cloneNode(true) as HTMLElement;
    clone.style.cssText = `position:fixed;box-sizing:border-box;left:${from.left}px;top:${from.top}px;` +
      `width:${from.width}px;margin:0;transform:none;transition:all .72s var(--ease);z-index:40;pointer-events:none;opacity:1;`;
    document.body.appendChild(clone);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clone.style.left = tLeft + 'px';
      clone.style.top = (52 + 18) + 'px';
      clone.style.width = (railW - 36) + 'px';
    }));
    setTimeout(() => {
      clone.remove();
      document.getElementById('railHeader')?.classList.add('show');
    }, 740);
  }

  function railBack() {
    const focused = getFocused();
    if (!focused || focused === 'brain') return;
    const lead = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
    if (!lead || !R[lead.id]) return;
    openAgentRail(lead.id, 'chat', false);
    const t = focusTarget(focused);
    if (t) flyTo(t.pos, t.zoom, 500);
  }
  document.getElementById('railBack')?.addEventListener('click', railBack);

  return {
    ensureChat,
    chatPush,
    renderChat,
    renderActivity,
    openAgentRail,
    sendChat,
    setTab,
    buildDeptRail,
    cascadeRows,
    flyBillboardIntoRail,
    railBack,
    getModalOpen: () => modalOpen,
    getModalTab: () => modalTab,
    setModalOpen: (id: string | null) => { modalOpen = id; },
    ago
  };
}
