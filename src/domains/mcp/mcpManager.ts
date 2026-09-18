/**
 * Domain Module: MCP Server & Connector Manager.
 * 
 * Handles listing, adding, editing, deleting, and status syncing for MCP (Model Context Protocol) servers.
 */

import { McpServerRecord } from '../../core/Types.ts';

export class McpManager {
  private servers: McpServerRecord[] = [];

  constructor(initialServers: McpServerRecord[] = []) {
    this.servers = [...initialServers];
  }

  /**
   * Returns all registered MCP servers.
   */
  public getServers(): McpServerRecord[] {
    return [...this.servers];
  }

  /**
   * Adds a new MCP server configuration.
   */
  public addServer(server: Omit<McpServerRecord, 'id'>): McpServerRecord {
    const id = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const record: McpServerRecord = { id, ...server };
    this.servers.push(record);
    return record;
  }

  /**
   * Updates an existing MCP server configuration.
   */
  public updateServer(id: string, updates: Partial<McpServerRecord>): McpServerRecord | null {
    const index = this.servers.findIndex(s => s.id === id);
    if (index === -1) return null;
    this.servers[index] = { ...this.servers[index], ...updates };
    return this.servers[index];
  }

  /**
   * Deletes an MCP server configuration by ID.
   */
  public deleteServer(id: string): boolean {
    const initialLen = this.servers.length;
    this.servers = this.servers.filter(s => s.id !== id);
    return this.servers.length < initialLen;
  }

  /**
   * Syncs server status from API connector response.
   */
  public syncStatus(statusList: Array<{ id: string; status: 'connected' | 'needs-auth' | 'error' | 'disconnected' }>): void {
    statusList.forEach(item => {
      const server = this.servers.find(s => s.id === item.id);
      if (server) {
        server.status = item.status;
      }
    });
  }
}
