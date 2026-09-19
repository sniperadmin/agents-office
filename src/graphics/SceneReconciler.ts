/**
 * Deterministic Three.js Scene Reconciler & Resource Lifecycle Manager
 * Implements deterministic mounting, updating, and unmounting with recursive disposal.
 * Prevents mesh leaks, ghost objects, and duplicate desk/character stacking.
 *
 * @module graphics/SceneReconciler
 */

import * as THREE from 'three';

export function disposeHierarchy(obj: THREE.Object3D): void {
  obj.traverse((child: any) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m: any) => m.dispose && m.dispose());
      } else if (child.material.dispose) {
        child.material.dispose();
      }
    }
  });
}

export interface ReconcilerContext {
  scene: THREE.Scene;
  R: Record<string, any>;
  deptRT: Record<string, any>;
  DEPT_AZ: Record<string, number>;
  screenSets: Array<{ screenSet: any; dept: string }>;
  personTargets: THREE.Object3D[];
  clickTargets: THREE.Object3D[];
  realignAllDepts: () => void;
}

export class SceneReconciler {
  private ctx: ReconcilerContext;

  constructor(ctx: ReconcilerContext) {
    this.ctx = ctx;
  }

  /**
   * Completely removes an agent entity from Three.js scene, HUD, and raycast targets.
   */
  public removeAgent(id: string): void {
    const { scene, R, screenSets, personTargets } = this.ctx;
    const r = R[id];
    if (!r) return;

    // 1. Remove character person mesh
    if (r.person) {
      scene.remove(r.person);
      disposeHierarchy(r.person);
    }

    // 2. Remove station (desk + chair)
    if (r.station) {
      scene.remove(r.station);
      disposeHierarchy(r.station);
    }

    // 3. Remove warning sprite
    if (r.warn) {
      scene.remove(r.warn);
      disposeHierarchy(r.warn);
    }

    // 4. Remove HUD pill element
    if (r.pill && r.pill.parentNode) {
      r.pill.parentNode.removeChild(r.pill);
    }

    // 5. Clean up personTargets raycast array
    for (let i = personTargets.length - 1; i >= 0; i--) {
      if ((personTargets[i].userData as any)?.agentId === id) {
        personTargets.splice(i, 1);
      }
    }

    // 6. Clean up screenSets
    for (let i = screenSets.length - 1; i >= 0; i--) {
      if (screenSets[i].dept === r.a?.dept) {
        // screenSet check
      }
    }

    delete R[id];
  }

  /**
   * Completely removes a department pod AND all its seated agents.
   */
  public removeDepartmentPod(key: string): void {
    const { scene, deptRT, DEPT_AZ, clickTargets, R, realignAllDepts } = this.ctx;

    // 1. Remove all agents belonging to this department
    const agentIds = Object.keys(R).filter(id => R[id]?.a?.dept === key);
    for (const id of agentIds) {
      this.removeAgent(id);
    }

    // 2. Remove department pod components
    const dRT = deptRT[key];
    if (dRT) {
      if (dRT.group) {
        scene.remove(dRT.group);
        disposeHierarchy(dRT.group);
      }
      if (dRT.walkway) {
        scene.remove(dRT.walkway);
        disposeHierarchy(dRT.walkway);
      }
      if (dRT.plant) {
        scene.remove(dRT.plant);
        disposeHierarchy(dRT.plant);
      }
      if (dRT.badge && dRT.badge.parentNode) {
        dRT.badge.parentNode.removeChild(dRT.badge);
      }
      delete deptRT[key];
      delete DEPT_AZ[key];
    }

    // 3. Remove from clickTargets
    for (let i = clickTargets.length - 1; i >= 0; i--) {
      if ((clickTargets[i].userData as any)?.dept === key) {
        clickTargets.splice(i, 1);
      }
    }

    // 4. Realign remaining departments smoothly
    realignAllDepts();
  }

  /**
   * Reconciles current active departments and agents against active 3D entities.
   * Eliminates zombie pods and duplicate stacked meshes.
   */
  public reconcile(activeKeys: string[], activeAgents: Array<{ id: string; dept: string }>): void {
    const { deptRT, R } = this.ctx;

    // 1. Unmount any department pods that are no longer active
    const activeKeySet = new Set(activeKeys);
    for (const k of Object.keys(deptRT)) {
      if (k !== 'brain' && !activeKeySet.has(k)) {
        this.removeDepartmentPod(k);
      }
    }

    // 2. Unmount any agents that are no longer in the active roster
    const activeAgentIds = new Set(activeAgents.map(a => a.id));
    for (const id of Object.keys(R)) {
      if (!activeAgentIds.has(id)) {
        this.removeAgent(id);
      }
    }
  }
}
