/**
 * Dedicated 3D Office Simulation & Computation Worker Client
 * Spawns and manages the background worker thread to offload heavy mesh and math calculations.
 */
import * as THREE from 'three';

export interface OfficeWorkerClient {
  postSimTick: (now: number, dt: number, agents: any[]) => void;
  onSimTickResult: (callback: (data: any) => void) => void;
  generateRboxGeometry: (w: number, d: number, h: number, r?: number) => Promise<THREE.BufferGeometry>;
  computeSplinePoints: (p0: number[], p1: number[], p2: number[], p3: number[], segments?: number) => Promise<Float32Array>;
  terminate: () => void;
}

const WORKER_SCRIPT = `
self.onmessage = function(e) {
  var data = e.data;
  if (!data) return;
  var type = data.type;
  var payload = data.payload || {};
  var id = data.id;

  if (type === 'PING') {
    self.postMessage({ type: 'PONG', ts: Date.now() });
    return;
  }

  if (type === 'GEN_RBOX_GEOMETRY') {
    var w = payload.w, d = payload.d, h = payload.h, r = payload.r || 0.35, segs = payload.curveSegments || 6;
    var positions = [], normals = [], uvs = [], indices = [];
    var halfW = w / 2, halfD = d / 2;
    var points = [];

    function addArc(cx, cy, startAngle) {
      for (var i = 0; i <= segs; i++) {
        var theta = startAngle + (i / segs) * (Math.PI / 2);
        points.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
      }
    }

    addArc(halfW - r, halfD - r, 0);
    addArc(-halfW + r, halfD - r, Math.PI / 2);
    addArc(-halfW + r, -halfD + r, Math.PI);
    addArc(halfW - r, -halfD + r, (3 * Math.PI) / 2);

    var numPoints = points.length;

    // Top cap (Y = h)
    var topStart = 0;
    for (var i = 0; i < numPoints; i++) {
      positions.push(points[i][0], h, points[i][1]);
      normals.push(0, 1, 0);
      uvs.push((points[i][0] + halfW) / w, (points[i][1] + halfD) / d);
    }
    for (var i = 1; i < numPoints - 1; i++) {
      indices.push(topStart, topStart + i, topStart + i + 1);
    }

    // Bottom cap (Y = 0)
    var botStart = positions.length / 3;
    for (var i = 0; i < numPoints; i++) {
      positions.push(points[i][0], 0, points[i][1]);
      normals.push(0, -1, 0);
      uvs.push((points[i][0] + halfW) / w, (points[i][1] + halfD) / d);
    }
    for (var i = 1; i < numPoints - 1; i++) {
      indices.push(botStart, botStart + i + 1, botStart + i);
    }

    // Side walls
    for (var i = 0; i < numPoints; i++) {
      var next = (i + 1) % numPoints;
      var p1 = points[i], p2 = points[next];
      var dx = p2[0] - p1[0], dz = p2[1] - p1[1];
      var len = Math.hypot(dx, dz) || 1;
      var nx = dz / len, nz = -dx / len;

      var idx = positions.length / 3;
      positions.push(p1[0], 0, p1[1]);
      positions.push(p2[0], 0, p2[1]);
      positions.push(p2[0], h, p2[1]);
      positions.push(p1[0], h, p1[1]);

      normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);

      indices.push(idx, idx + 1, idx + 2);
      indices.push(idx, idx + 2, idx + 3);
    }

    var posArray = new Float32Array(positions);
    var normArray = new Float32Array(normals);
    var uvArray = new Float32Array(uvs);
    var idxArray = new Uint16Array(indices);

    self.postMessage(
      {
        type: 'GEN_RBOX_GEOMETRY_RESULT',
        id: id,
        payload: {
          positions: posArray,
          normals: normArray,
          uvs: uvArray,
          indices: idxArray
        }
      },
      [posArray.buffer, normArray.buffer, uvArray.buffer, idxArray.buffer]
    );
    return;
  }

  if (type === 'COMPUTE_SPLINE_POINTS') {
    var p0 = payload.p0, p1 = payload.p1, p2 = payload.p2, p3 = payload.p3, segs = payload.segments || 32;
    var curvePoints = new Float32Array((segs + 1) * 3);
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var it = 1 - t;
      var b0 = it * it * it;
      var b1 = 3 * it * it * t;
      var b2 = 3 * it * t * t;
      var b3 = t * t * t;

      var x = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
      var y = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];
      var z = b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2];

      var off = i * 3;
      curvePoints[off] = x;
      curvePoints[off + 1] = y;
      curvePoints[off + 2] = z;
    }

    self.postMessage(
      {
        type: 'COMPUTE_SPLINE_POINTS_RESULT',
        id: id,
        payload: { curvePoints: curvePoints }
      },
      [curvePoints.buffer]
    );
    return;
  }

  if (type === 'SIM_TICK') {
    var now = payload.now;
    var agents = payload.agents || [];
    var updates = {};
    for (var i = 0; i < agents.length; i++) {
      var id = agents[i].id;
      updates[id] = {
        bob: Math.sin(now * 0.003 + i * 0.7) * 0.12,
        walkStep: Math.cos(now * 0.005 + i * 0.4) * 0.08,
        headAngle: Math.sin(now * 0.002 + i * 1.1) * 0.05
      };
    }
    self.postMessage({
      type: 'SIM_TICK_RESULT',
      now: now,
      updates: updates
    });
  }
};
`;

export function createOfficeWorker(): OfficeWorkerClient {
  let worker: Worker | null = null;
  let listeners: Array<(data: any) => void> = [];
  let pendingPromises = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  let reqId = 0;

  try {
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    worker = new Worker(blobUrl, { name: 'Office3DSimulationWorker' });
    worker.postMessage({ type: 'PING' });
  } catch (e) {
    console.warn('Worker initialization fallback:', e);
  }

  if (worker) {
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      if (data.type === 'SIM_TICK_RESULT') {
        for (const cb of listeners) {
          cb(data);
        }
      } else if (data.id && pendingPromises.has(data.id)) {
        const { resolve } = pendingPromises.get(data.id)!;
        pendingPromises.delete(data.id);
        resolve(data.payload);
      }
    };
  }

  return {
    postSimTick: (now: number, dt: number, agents: any[]) => {
      if (!worker) return;
      worker.postMessage({
        type: 'SIM_TICK',
        payload: { now, dt, agents: agents.map(a => ({ id: a.id })) }
      });
    },
    onSimTickResult: (callback: (data: any) => void) => {
      listeners.push(callback);
    },
    generateRboxGeometry: async (w: number, d: number, h: number, r = 0.35): Promise<THREE.BufferGeometry> => {
      if (!worker) {
        // Fallback: local calculation
        return new THREE.BoxGeometry(w, h, d);
      }
      const id = 'geo_' + (++reqId);
      const payload: any = await new Promise((resolve, reject) => {
        pendingPromises.set(id, { resolve, reject });
        worker!.postMessage({
          type: 'GEN_RBOX_GEOMETRY',
          id,
          payload: { w, d, h, r }
        });
      });

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(payload.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));
      return geometry;
    },
    computeSplinePoints: async (p0: number[], p1: number[], p2: number[], p3: number[], segments = 32): Promise<Float32Array> => {
      if (!worker) {
        return new Float32Array(0);
      }
      const id = 'spline_' + (++reqId);
      const res: any = await new Promise((resolve, reject) => {
        pendingPromises.set(id, { resolve, reject });
        worker!.postMessage({
          type: 'COMPUTE_SPLINE_POINTS',
          id,
          payload: { p0, p1, p2, p3, segments }
        });
      });
      return res.curvePoints;
    },
    terminate: () => {
      if (worker) {
        worker.terminate();
        worker = null;
      }
    }
  };
}
