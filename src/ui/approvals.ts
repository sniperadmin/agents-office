import { APPROVAL_ASKS, APPROVAL_BY_AGENT } from '../data.ts';

export function getApprovalAsk(agentId: string, deptKey: string) {
  if (APPROVAL_BY_AGENT[agentId]) return APPROVAL_BY_AGENT[agentId];
  return APPROVAL_ASKS[deptKey] || {
    title: 'TASK APPROVAL NEEDED',
    action: 'Confirm and authorize outbound execution',
    preview: 'Agent prepared draft and requires verification before proceeding.'
  };
}

export function formatMockup(ask: any) {
  return `
    <div class="ap-mockup">
      <div class="ap-head">
        <span class="ap-badge">APPROVAL REQUIRED</span>
        <h3>${ask.title}</h3>
      </div>
      <div class="ap-body">
        <p class="ap-action"><strong>Action:</strong> ${ask.action}</p>
        <div class="ap-preview-box">
          <pre>${ask.preview}</pre>
        </div>
      </div>
    </div>
  `;
}
