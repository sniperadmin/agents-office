/**
 * Entity Component System (ECS) — Logic Systems.
 * 
 * Systems process entities with specific components per frame:
 * - DeskLayoutSystem: Calculates grid coordinates and floor bounds.
 * - RosterPositionSystem: Realigns agent seats when department size changes.
 */

import * as THREE from 'three';
import { DeptFloorDimensions } from '../core/Types.ts';
import { getDeptDimensions } from '../data.ts';

export interface DeskStation {
  seatIndex: number;
  gx: number;
  gz: number;
}

/**
 * Calculates desk grid stations for a department floor based on dynamic bounds.
 * 
 * @param deptKey - Unique identifier of the department (e.g., 'sales', 'dev')
 * @param rosterCount - Number of active agents in roster
 * @returns Array of station positions ({ seatIndex, gx, gz })
 */
export function calculateDeskStations(deptKey: string, rosterCount: number): {
  dimensions: DeptFloorDimensions;
  stations: DeskStation[];
} {
  const dim = getDeptDimensions(deptKey, rosterCount);
  const stations: DeskStation[] = [];

  for (let i = 0; i < rosterCount; i++) {
    const col = i % dim.cols;
    const row = Math.floor(i / dim.cols);

    const startX = -((dim.cols - 1) * dim.spacingX) / 2;
    const startZ = -(dim.d / 2 - 5.5);

    const gx = startX + col * dim.spacingX;
    const gz = startZ + row * dim.spacingZ;

    stations.push({ seatIndex: i, gx, gz });
  }

  return { dimensions: dim, stations };
}

/**
 * Realigns agent entity seat positions based on dynamic layout calculation.
 */
export function realignAgentSeats(
  agentsGroup: THREE.Group,
  stations: DeskStation[]
): void {
  const children = agentsGroup.children;
  children.forEach((child, index) => {
    if (stations[index]) {
      const station = stations[index];
      child.position.x = station.gx;
      child.position.z = station.gz;
    }
  });
}
