// Dedicated 3D Office Worker for offloading complex Mesh vertex generation, spline calculations, and kinematics
self.onmessage = (e: MessageEvent) => {
  const { type, payload, id } = e.data || {};

  if (type === 'PING') {
    self.postMessage({ type: 'PONG', ts: Date.now() });
    return;
  }

  // 1. Procedural Extruded Rounded-Box Mesh Vertex Generation
  if (type === 'GEN_RBOX_GEOMETRY') {
    const { w, d, h, r = 0.35, curveSegments = 6 } = payload;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Construct 2D rounded-rectangle outline
    const halfW = w / 2;
    const halfD = d / 2;
    const points: Array<[number, number]> = [];

    // Helper for 90 deg corner arc points
    const addArc = (cx: number, cy: number, startAngle: number) => {
      for (let i = 0; i <= curveSegments; i++) {
        const theta = startAngle + (i / curveSegments) * (Math.PI / 2);
        points.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
      }
    };

    // Top-right, top-left, bottom-left, bottom-right
    addArc(halfW - r, halfD - r, 0);
    addArc(-halfW + r, halfD - r, Math.PI / 2);
    addArc(-halfW + r, -halfD + r, Math.PI);
    addArc(halfW - r, -halfD + r, (3 * Math.PI) / 2);

    const numPoints = points.length;

    // Top cap vertices (Y = h)
    const topStartIndex = 0;
    for (let i = 0; i < numPoints; i++) {
      positions.push(points[i][0], h, points[i][1]);
      normals.push(0, 1, 0);
      uvs.push((points[i][0] + halfW) / w, (points[i][1] + halfD) / d);
    }
    // Simple fan triangulation for top cap
    for (let i = 1; i < numPoints - 1; i++) {
      indices.push(topStartIndex, topStartIndex + i, topStartIndex + i + 1);
    }

    // Bottom cap vertices (Y = 0)
    const botStartIndex = positions.length / 3;
    for (let i = 0; i < numPoints; i++) {
      positions.push(points[i][0], 0, points[i][1]);
      normals.push(0, -1, 0);
      uvs.push((points[i][0] + halfW) / w, (points[i][1] + halfD) / d);
    }
    for (let i = 1; i < numPoints - 1; i++) {
      indices.push(botStartIndex, botStartIndex + i + 1, botStartIndex + i);
    }

    // Side walls
    const sideStartIndex = positions.length / 3;
    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;
      const p1 = points[i];
      const p2 = points[next];
      const dx = p2[0] - p1[0];
      const dz = p2[1] - p1[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len;
      const nz = -dx / len;

      const idx = positions.length / 3;
      // 4 vertices per side quad
      positions.push(p1[0], 0, p1[1]);
      positions.push(p2[0], 0, p2[1]);
      positions.push(p2[0], h, p2[1]);
      positions.push(p1[0], h, p1[1]);

      normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);

      indices.push(idx, idx + 1, idx + 2);
      indices.push(idx, idx + 2, idx + 3);
    }

    const posArray = new Float32Array(positions);
    const normArray = new Float32Array(normals);
    const uvArray = new Float32Array(uvs);
    const indexArray = new Uint16Array(indices);

    (self as any).postMessage(
      {
        type: 'GEN_RBOX_GEOMETRY_RESULT',
        id,
        payload: {
          positions: posArray,
          normals: normArray,
          uvs: uvArray,
          indices: indexArray
        }
      },
      [posArray.buffer, normArray.buffer, uvArray.buffer, indexArray.buffer]
    );
    return;
  }

  // 2. Bezier Cable & Conduit Spline Point Sampling
  if (type === 'COMPUTE_SPLINE_POINTS') {
    const { p0, p1, p2, p3, segments = 32 } = payload;
    const curvePoints = new Float32Array((segments + 1) * 3);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const it = 1 - t;
      const b0 = it * it * it;
      const b1 = 3 * it * it * t;
      const b2 = 3 * it * t * t;
      const b3 = t * t * t;

      const x = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
      const y = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];
      const z = b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2];

      const offset = i * 3;
      curvePoints[offset] = x;
      curvePoints[offset + 1] = y;
      curvePoints[offset + 2] = z;
    }

    (self as any).postMessage(
      {
        type: 'COMPUTE_SPLINE_POINTS_RESULT',
        id,
        payload: { curvePoints }
      },
      [curvePoints.buffer]
    );
    return;
  }

  // 3. Ambient Simulation & Kinematics Tick
  if (type === 'SIM_TICK') {
    const { now, dt, agents } = payload;
    const updates: Record<string, { bob: number; walkStep: number; headAngle: number }> = {};

    if (Array.isArray(agents)) {
      for (let i = 0; i < agents.length; i++) {
        const agId = agents[i].id;
        const bob = Math.sin(now * 0.003 + i * 0.7) * 0.12;
        const walkStep = Math.cos(now * 0.005 + i * 0.4) * 0.08;
        const headAngle = Math.sin(now * 0.002 + i * 1.1) * 0.05;
        updates[agId] = { bob, walkStep, headAngle };
      }
    }

    self.postMessage({
      type: 'SIM_TICK_RESULT',
      now,
      updates
    });
  }
};
