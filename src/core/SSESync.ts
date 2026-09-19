/**
 * Real-time SSE Sync Client
 * Connects to /api/events and synchronizes server & DB state changes
 * directly with the OfficeStore and EventBus.
 *
 * @module core/SSESync
 */

import { events } from './EventBus.ts';
import { store } from './Store.ts';

export class SSESync {
  private static instance: SSESync;
  private es: EventSource | null = null;
  private reconnectTimer: any = null;
  private backoffMs = 1000;
  private isConnecting = false;

  private constructor() {}

  public static getInstance(): SSESync {
    if (!SSESync.instance) {
      SSESync.instance = new SSESync();
    }
    return SSESync.instance;
  }

  public start(): void {
    if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) return;
    if (typeof EventSource === 'undefined') return;
    if (this.es || this.isConnecting) return;

    this.connect();
  }

  private connect(): void {
    this.isConnecting = true;
    try {
      this.es = new EventSource('/api/events');

      this.es.onopen = () => {
        this.isConnecting = false;
        this.backoffMs = 1000;
        store.setConnected(true);
      };

      this.es.onmessage = (e) => {
        if (!e.data || e.data.startsWith(':')) return;
        try {
          const payload = JSON.parse(e.data);
          this.handleEvent(payload);
        } catch (err) {
          console.warn('[SSESync] Failed to parse SSE event data:', err);
        }
      };

      this.es.onerror = () => {
        this.isConnecting = false;
        store.setConnected(false);
        if (this.es) {
          this.es.close();
          this.es = null;
        }
        this.scheduleReconnect();
      };
    } catch (err) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 1.5, 15000);
  }

  private handleEvent(event: any): void {
    if (!event || !event.type) return;

    // Emit typed event on client EventBus
    events.emit(event.type, event);

    // Sync Store accordingly
    switch (event.type) {
      case 'department_created':
        if (event.key) {
          // Re-fetch departments to guarantee complete schema sync
          fetch('/api/departments')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                const depts = data.depts || data.departments || {};
                const keys = data.keys || data.coreDepts || Object.keys(depts);
                store.setDepartments(depts, keys);
                if (Array.isArray(data.agents)) {
                  store.setAgents(data.agents);
                }
              }
            })
            .catch(() => {});
        }
        break;

      case 'department_deleted':
        if (event.key) {
          store.removeDepartment(event.key);
        }
        break;

      case 'agent_updated':
        if (event.agent) {
          store.addOrUpdateAgent(event.agent);
        }
        break;

      case 'agent_removed':
        if (event.agentId) {
          store.removeAgent(event.agentId);
        }
        break;

      case 'task_start':
      case 'task_update':
      case 'task_done':
        events.emit('TASK_STREAM_EVENT', event);
        break;
    }
  }

  public stop(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.isConnecting = false;
    store.setConnected(false);
  }
}

export const sseSync = SSESync.getInstance();
