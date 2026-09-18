/**
 * Entity Component System (ECS) — Component Definitions.
 * 
 * Lightweight component schemas for 3D diorama entities (Agents, Desks, Dept Floors, Badges).
 */

import * as THREE from 'three';
import { AgentRecord, DeptFloorDimensions } from '../core/Types.ts';

export type EntityId = string;

/**
 * 3D Spatial Transform Component.
 */
export interface TransformComponent {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

/**
 * Three.js Mesh Attachment Component.
 */
export interface MeshComponent {
  group: THREE.Group;
  mesh?: THREE.Mesh;
}

/**
 * Agent Seat & Roster Metadata Component.
 */
export interface AgentRosterSeatComponent {
  agentId: string;
  deptKey: string;
  seatIndex: number;
  gridX: number;
  gridZ: number;
  record: AgentRecord;
  isLead: boolean;
}

/**
 * Department Floor Plinth Geometry Component.
 */
export interface DeptFloorPodComponent {
  deptKey: string;
  dimensions: DeptFloorDimensions;
  plinthMesh: THREE.Mesh;
  group: THREE.Group;
  activeRosterCount: number;
}

/**
 * Animated Agent Emote & Work State Component.
 */
export interface AgentStateComponent {
  state: 'idle' | 'working' | 'thinking' | 'waiting' | 'error';
  targetState: string;
  headRotation: number;
  glowOpacity: number;
}
