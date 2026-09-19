import { DEPTS, AGENTS } from '../data.ts';
import { getApprovalAsk, formatMockup } from './approvals.ts';

export function setupFocusRail(options: {
  onClose: () => void;
  onSendChat: (agentId: string, text: string) => Promise<any>;
}) {
  const { onClose, onSendChat } = options;
  const rail = document.getElementById('rail');
  const chatInput = document.getElementById('chat-input') as HTMLInputElement;
  const sendBtn = document.getElementById('chat-send');

  let currentAgent: any = null;
  let currentDept: string | null = null;

  function openDept(deptKey: string) {
    currentDept = deptKey;
    currentAgent = null;
    if (rail) {
      rail.classList.add('open');
    }
  }

  function openAgent(agentId: string) {
    const a = AGENTS.find(x => x.id === agentId);
    if (!a) return;
    currentAgent = a;
    currentDept = a.dept;
    if (rail) {
      rail.classList.add('open');
    }
  }

  function close() {
    currentAgent = null;
    currentDept = null;
    if (rail) {
      rail.classList.remove('open');
    }
    onClose();
  }

  return {
    openDept,
    openAgent,
    close,
    getCurrentDept: () => currentDept,
    getCurrentAgent: () => currentAgent
  };
}
