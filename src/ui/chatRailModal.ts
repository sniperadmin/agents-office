import { AGENTS, DEPTS } from '../data.ts';
import { V1 } from '../v1data.ts';

export function createChatRail(options: {
  R: Record<string, any>;
  chatHist: Record<string, any[]>;
  chatPush: (agentId: string, who: string, text: string) => void;
  openAgent: (agentId: string, tab?: string) => void;
  enterFocus: (deptKey: string) => void;
}) {
  const { R, chatHist, chatPush, openAgent, enterFocus } = options;

  let modalOpen: string | null = null;
  let modalTab = 'chat';
  const chatRail = document.getElementById('chat-rail');
  const chatName = document.getElementById('cr-name');
  const chatRole = document.getElementById('cr-role');
  const chatDept = document.getElementById('cr-dept');
  const chatDoes = document.getElementById('cr-does');
  const chatMsgs = document.getElementById('cr-messages');
  const chatInput = document.getElementById('cr-input') as HTMLInputElement;
  const chatClose = document.getElementById('cr-close');
  const crTabChat = document.getElementById('cr-tab-chat');
  const crTabAct = document.getElementById('cr-tab-act');
  const crTabBrief = document.getElementById('cr-tab-brief');
  const crBodyChat = document.getElementById('cr-body-chat');
  const crBodyAct = document.getElementById('cr-body-act');
  const crBodyBrief = document.getElementById('cr-body-brief');
  const crBriefText = document.getElementById('cr-brief-text') as HTMLTextAreaElement;
  const crBriefSave = document.getElementById('cr-brief-save');
  const crFeed = document.getElementById('cr-feed');

  function renderMessages(agentId: string) {
    if (!chatMsgs) return;
    const hist = chatHist[agentId] || [];
    chatMsgs.innerHTML = hist.map(m => `
      <div class="cr-msg ${m.who}">
        <div class="cr-msg-body">${m.text}</div>
      </div>
    `).join('');
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  function renderActivity(agentId: string) {
    if (!crFeed) return;
    const r = R[agentId];
    if (!r || !r.feed) return;
    crFeed.innerHTML = r.feed.map((f: any) => `
      <div class="feed-item">
        <span class="feed-icon">${f.i}</span>
        <span class="feed-text">${f.text}</span>
        <span class="feed-time">${new Date(f.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `).join('');
  }

  function setTab(tab: string) {
    modalTab = tab;
    if (crTabChat) crTabChat.classList.toggle('active', tab === 'chat');
    if (crTabAct) crTabAct.classList.toggle('active', tab === 'activity');
    if (crTabBrief) crTabBrief.classList.toggle('active', tab === 'brief');
    if (crBodyChat) crBodyChat.style.display = tab === 'chat' ? 'flex' : 'none';
    if (crBodyAct) crBodyAct.style.display = tab === 'activity' ? 'block' : 'none';
    if (crBodyBrief) crBodyBrief.style.display = tab === 'brief' ? 'block' : 'none';

    if (modalOpen && tab === 'activity') renderActivity(modalOpen);
  }

  function openAgentRail(agentId: string, tab = 'chat', autoFocus = true) {
    const a = AGENTS.find(x => x.id === agentId);
    if (!a) return;
    modalOpen = agentId;
    const r = R[agentId] || {};
    const d = DEPTS[a.dept] || { name: a.dept, chip: '#8FD3F4' };

    if (chatName) chatName.textContent = a.name;
    if (chatRole) chatRole.textContent = a.role || '';
    if (chatDept) {
      chatDept.textContent = d.name;
      chatDept.style.color = d.chip;
    }
    if (chatDoes) chatDoes.textContent = a.does || '';
    if (crBriefText) crBriefText.value = a.brief || '';

    if (!chatHist[agentId] || !chatHist[agentId].length) {
      chatHist[agentId] = [{
        who: 'agent',
        text: (r.v1 && r.v1.greeting) || `Hello, I'm ${a.name}. How can I assist you?`
      }];
    }

    renderMessages(agentId);
    setTab(tab);

    if (chatRail) {
      chatRail.classList.add('open');
    }
    if (autoFocus && chatInput) {
      chatInput.focus();
    }
  }

  function closeAgentRail() {
    modalOpen = null;
    if (chatRail) {
      chatRail.classList.remove('open');
    }
  }

  chatClose?.addEventListener('click', closeAgentRail);
  crTabChat?.addEventListener('click', () => setTab('chat'));
  crTabAct?.addEventListener('click', () => setTab('activity'));
  crTabBrief?.addEventListener('click', () => setTab('brief'));

  return {
    openAgentRail,
    closeAgentRail,
    getModalOpen: () => modalOpen,
    getModalTab: () => modalTab,
    renderMessages,
    renderActivity
  };
}
