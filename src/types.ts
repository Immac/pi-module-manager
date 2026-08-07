/**
 * MODULE.json schema — metadata for every module in the vault
 */
export interface ModuleManifest {
  /** Module identifier (matches directory name) */
  name: string;
  /** Semver version */
  version: string;
  /** Where it was installed from (git URL, path, kb slug) */
  source: string;
  /** ISO timestamp of installation */
  installedAt: string;
  /** ISO timestamp of last update */
  updatedAt?: string;
  /** Whether module has native dependencies */
  native?: boolean;
  /** npm dependencies */
  dependencies?: Record<string, string>;
}

/**
 * Module type — what the module provides
 */
export type ModuleType = 'extension' | 'skill' | 'prompt' | 'hybrid';

/**
 * Resource types that can exist in a module
 */
export type ResourceType = 'extension' | 'skill' | 'prompt';

/**
 * Resolved module — full info after vault lookup
 */
export interface ResolvedModule {
  /** Module name */
  name: string;
  /** Path to module in vault */
  path: string;
  /** MODULE.json manifest */
  manifest: ModuleManifest;
  /** Detected module type */
  type: ModuleType;
  /** Whether this module is active in current config */
  active: boolean;
}

/**
 * Module source — where to install from
 */
export interface ModuleSource {
  /** Source type */
  type: 'path' | 'git' | 'kb';
  /** Source reference (path, git URL, or KB slug) */
  ref: string;
  /** Optional version/tag to pin */
  version?: string;
}

/**
 * Install result
 */
export interface InstallResult {
  success: boolean;
  message: string;
  module?: ResolvedModule;
}

/**
 * Module mode — how project relates to global
 */
export type ModuleMode = 'standalone' | 'extends';
