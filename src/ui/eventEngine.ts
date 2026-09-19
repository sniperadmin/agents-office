import { V1, FILE_GEN, STATS, KPIS, rnd, ri } from '../v1data.ts';
import { DEPTS } from '../data.ts';

export function setupEventEngine(options: {
  onEvent: (event: any) => void;
  deptRT: Record<string, any>;
}) {
  const { onEvent, deptRT } = options;

  let lastTick = Date.now();
  function tick() {
    const now = Date.now();
    if (now - lastTick > 4500) {
      lastTick = now;
      const deptKeys = Object.keys(DEPTS).filter(k => k !== 'brain');
      if (deptKeys.length > 0) {
        const dKey = deptKeys[Math.floor(Math.random() * deptKeys.length)];
        onEvent({
          type: 'ambient',
          dept: dKey,
          text: `Ambient activity in ${DEPTS[dKey]?.name || dKey}`
        });
      }
    }
  }

  return { tick };
}
