/**
 * Centralized Type Definitions & Interfaces for Agents Office
 * @module core/Types
 */

/**
 * Configuration schema for a department.
 */
export interface DeptConfig {
  /** Unique key of the department (e.g. 'sales', 'dev', 'marketing') */
  key: string;
  /** Display name of the department (e.g. 'SALES', 'DEVELOPMENT') */
  name: string;
  /** Short abbreviation or label */
  short: string;
  /** Hex color for UI badge & chip (e.g. '#3B82F6') */
  chip: string;
  /** Hex color for primary UI text/ink */
  ink: string;
  /** Hex color for 3D floor slab */
  floor: string;
  /** Assigned AI model for this department */
  model?: string;
  /** Name of the lead agent */
  leadName?: string;
}

/**
 * Schema for an AI agent in the office roster.
 */
export interface AgentRecord {
  /** Unique agent identifier (e.g. 'piper', 'dev_lead') */
  id: string;
  /** Display name (e.g. 'PROPOSALS', 'DEV LEAD') */
  name: string;
  /** Department key where this agent is seated */
  department: string;
  /** Alias for department key */
  dept: string;
  /** True if this agent is the department lead */
  lead: boolean;
  /** True if this agent is the Executive CEO */
  is_ceo?: boolean;
  /** Role title (e.g. 'Backend Architect') */
  role: string;
  /** Functional description of what this agent does */
  does: string;
  /** Array of tool/MCP names bound to this agent */
  tools: string[];
  /** Detailed system brief / prompt instructions */
  brief?: string;
  /** Override AI model for this agent */
  model?: string;
  /** Override effort level ('low', 'medium', 'high', 'max') */
  effort?: string;
  /** Grid position [col, row] on the department floor */
  grid?: [number, number];
  /** Hair color hex */
  hair?: string;
  /** Skin color hex */
  skin?: string;
}

/**
 * Calculated 3D floor geometry for a department.
 */
export interface DeptFloorDimensions {
  /** Floor width in 3D scene units */
  w: number;
  /** Floor depth in 3D scene units */
  d: number;
  /** Number of desk columns */
  cols: number;
  /** Number of desk rows */
  rows: number;
  /** Spacing between desk columns */
  spacingX: number;
  /** Spacing between desk rows */
  spacingZ: number;
}

/**
 * Record representing an MCP server integration.
 */
export interface McpServerRecord {
  /** Unique ID of the MCP server */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Key alias */
  key: string;
  /** Executable command (e.g. 'npx', 'node') */
  command: string;
  /** Command line arguments */
  args: string[];
  /** Environment variables dictionary */
  env: Record<string, string>;
  /** Departments allowed to access this server */
  depts: string[];
  /** Health status ('connected', 'needs-auth', 'disconnected') */
  status: string;
  /** Discovery source ('local', 'config', 'custom') */
  source: string;
  /** True if server is enabled/allowed */
  allowed: boolean;
}

/**
 * Template schema for pre-configured Reserve Teams.
 */
export interface ReserveTeamTemplate {
  /** Department key (e.g. 'dev') */
  key: string;
  /** Department display name (e.g. 'DEVELOPMENT') */
  name: string;
  /** Default lead agent name */
  leadName: string;
  /** Hex chip color */
  chip: string;
  /** Default AI model */
  model: string;
  /** Team description */
  desc: string;
  /** Skills count label */
  skills: string;
  /** Sample specialist roles */
  roles: string[];
}
