import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { ModuleManifest, ModuleType, ResolvedModule, InstallResult } from './types.js';

// ── Paths ────────────────────────────────────────────────────────────────────

export function getVaultDir(): string {
  const envVault = process.env.PI_MODULES_VAULT;
  if (envVault && path.isAbsolute(envVault)) return envVault;
  return path.join(os.homedir(), '.pi-modules-vault');
}

/** The pi agent directory (global activation lives here: <agent>/skills and
 *  <agent>/extensions). PI_CODING_AGENT_DIR is what pi itself runs with —
 *  follow it instead of hardcoding, with ~/pi-base as the documented default. */
export function getAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env && path.isAbsolute(env)) return env;
  return path.join(os.homedir(), 'pi-base');
}

export function projectVaultDir(projectDir?: string): string | null {
  if (!projectDir) return null;
  return path.resolve(projectDir, '.pi', 'modules');
}

export function resolveVaultDirs(projectDir?: string): string[] {
  const dirs: string[] = [];
  const project = projectVaultDir(projectDir);
  if (project) dirs.push(project);
  dirs.push(getVaultDir());
  return dirs;
}

// ── Trust File Operations ────────────────────────────────────────────────────

function trustFilePath(): string {
  return path.join(getAgentDir(), 'trust.json');
}

export function readTrustFile(): Record<string, boolean | null> {
  const filePath = trustFilePath();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // corrupted — start fresh
  }
  return {};
}

function writeTrustFile(data: Record<string, boolean | null>): void {
  const filePath = trustFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function isTrusted(projectPath: string): boolean {
  const resolved = path.resolve(projectPath);
  const data = readTrustFile();
  return data[resolved] === true;
}

export function addTrust(projectPath: string): { success: boolean; message: string } {
  const resolved = path.resolve(projectPath);
  const data = readTrustFile();
  if (data[resolved] === true) {
    return { success: true, message: `Project "${resolved}" is already trusted.` };
  }
  data[resolved] = true;
  writeTrustFile(data);
  return { success: true, message: `Project "${resolved}" added to trust list.` };
}

export function removeTrust(projectPath: string): { success: boolean; message: string } {
  const resolved = path.resolve(projectPath);
  const data = readTrustFile();
  if (data[resolved] === undefined || data[resolved] === null) {
    return { success: true, message: `Project "${resolved}" was not in the trust list.` };
  }
  data[resolved] = null;
  writeTrustFile(data);
  return { success: true, message: `Project "${resolved}" removed from trust list.` };
}

export function listTrust(): Array<{ path: string; decision: boolean | null }> {
  const data = readTrustFile();
  return Object.entries(data).map(([p, d]) => ({ path: p, decision: d }));
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

const MODULE_JSON = 'MODULE.json';

export function readManifest(moduleDir: string): ModuleManifest | null {
  const manifestPath = path.join(moduleDir, MODULE_JSON);
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as ModuleManifest;
  } catch {
    return null;
  }
}

export function writeManifest(moduleDir: string, manifest: ModuleManifest): void {
  const manifestPath = path.join(moduleDir, MODULE_JSON);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// ── Resource Detection ───────────────────────────────────────────────────────

/** Check if directory has extension resources */
export function hasExtension(moduleDir: string): boolean {
  const packageJsonPath = path.join(moduleDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.pi?.extensions?.length) return true;
      if (pkg.main || pkg.index) return true;
    } catch {
      // ignore
    }
  }
  return fs.existsSync(path.join(moduleDir, 'index.ts')) ||
         fs.existsSync(path.join(moduleDir, 'index.js'));
}

/** Check if directory has skill resources */
export function hasSkill(moduleDir: string): boolean {
  if (fs.existsSync(path.join(moduleDir, 'SKILL.md'))) return true;
  const skillsDir = path.join(moduleDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    // Check for .md files directly in skills/
    if (fs.readdirSync(skillsDir).some(f => f.endsWith('.md'))) return true;
    // Check for subdirectories containing SKILL.md
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const subDir = path.join(skillsDir, entry.name);
        if (fs.existsSync(path.join(subDir, 'SKILL.md'))) return true;
      }
    }
  }
  return false;
}

/** Check if directory has prompt resources */
export function hasPrompts(moduleDir: string): boolean {
  const promptsDir = path.join(moduleDir, 'prompts');
  if (!fs.existsSync(promptsDir)) return false;
  return fs.readdirSync(promptsDir).some(f => f.endsWith('.md'));
}

// ── Module Type Detection ────────────────────────────────────────────────────

export function detectModuleType(moduleDir: string): ModuleType {
  const ext = hasExtension(moduleDir);
  const skill = hasSkill(moduleDir);
  const prompt = hasPrompts(moduleDir);

  const count = [ext, skill, prompt].filter(Boolean).length;
  if (count > 1) return 'hybrid';
  if (ext) return 'extension';
  if (skill) return 'skill';
  if (prompt) return 'prompt';
  return 'skill'; // default fallback
}

// ── Vault Operations ─────────────────────────────────────────────────────────

/**
 * List all modules in a vault directory
 */
export function listModules(vaultDir: string): ResolvedModule[] {
  if (!fs.existsSync(vaultDir)) return [];

  const modules: ResolvedModule[] = [];
  const entries = fs.readdirSync(vaultDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const moduleDir = path.join(vaultDir, entry.name);
    const manifest = readManifest(moduleDir);
    if (!manifest) continue; // skip dirs without MODULE.json

    modules.push({
      name: manifest.name,
      path: moduleDir,
      manifest,
      type: detectModuleType(moduleDir),
      active: false, // filled in by resolver
    });
  }

  return modules;
}

/** Where a module is activated globally (always loaded), if at all. */
export function activeGlobalPath(name: string): string | null {
  const agent = getAgentDir();
  for (const dir of ['extensions', 'skills']) {
    const p = path.join(agent, dir, name);
    if (fs.existsSync(p) || isLink(p)) return p;
  }
  return null;
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Copies of `name` that live OUTSIDE the vault while the vault has the same
 *  module — the divergence hazard: updates touch only the vault copy, so the
 *  others silently rot (and pi may load the wrong one first). Checks the
 *  agent dirs (incl. the legacy ~/.pi/agent location when the agent dir has
 *  moved on) and the project's .pi dirs. Symlinks resolving to the vault are
 *  correct activations, not copies. */
export function divergentCopies(name: string, projectDir?: string): string[] {
  const vaultPath = path.join(getVaultDir(), name);
  if (!fs.existsSync(vaultPath)) return [];
  let vaultReal = vaultPath;
  try {
    vaultReal = fs.realpathSync(vaultPath);
  } catch { /* keep raw */ }

  const agent = getAgentDir();
  const roots = [path.join(agent, 'skills'), path.join(agent, 'extensions')];
  const legacy = path.join(os.homedir(), '.pi', 'agent');
  if (path.resolve(legacy) !== path.resolve(agent)) {
    roots.push(path.join(legacy, 'skills'), path.join(legacy, 'extensions'));
  }
  if (projectDir) {
    roots.push(path.join(projectDir, '.pi', 'skills'), path.join(projectDir, '.pi', 'extensions'));
  }

  const hits: string[] = [];
  for (const root of roots) {
    const p = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        if (fs.realpathSync(p) === vaultReal) continue; // correct activation
      } catch { /* broken link → flagged below */ }
      try {
        hits.push(`${p} (symlink → ${fs.readlinkSync(p)})`);
      } catch {
        hits.push(`${p} (broken symlink)`);
      }
    } else {
      hits.push(`${p} (real copy — only the vault copy is updated)`);
    }
  }
  return hits;
}

/**
 * Find a module by name across vault directories
 */
export function findModule(name: string, projectDir?: string): ResolvedModule | null {
  const vaultDirs = resolveVaultDirs(projectDir);

  for (const vaultDir of vaultDirs) {
    const moduleDir = path.join(vaultDir, name);
    if (!fs.existsSync(moduleDir)) continue;

    const manifest = readManifest(moduleDir);
    if (!manifest) continue;

    return {
      name: manifest.name,
      path: moduleDir,
      manifest,
      type: detectModuleType(moduleDir),
      active: false,
    };
  }

  return null;
}

/**
 * Resolve version from module name (e.g., "comfyui@1.2.0")
 */
export function parseModuleRef(ref: string): { name: string; version?: string } {
  // Handle scoped packages: @scope/name@version
  if (ref.startsWith('@')) {
    const secondAt = ref.indexOf('@', 1);
    if (secondAt === -1) return { name: ref };
    return {
      name: ref.slice(0, secondAt),
      version: ref.slice(secondAt + 1),
    };
  }
  // Regular packages: name@version
  const atIndex = ref.indexOf('@');
  if (atIndex === -1) return { name: ref };
  return {
    name: ref.slice(0, atIndex),
    version: ref.slice(atIndex + 1),
  };
}

/**
 * Check if a module version matches a requirement
 */
export function versionMatches(installed: string, required?: string): boolean {
  if (!required) return true; // no requirement = any version OK
  // Simple exact match for now — can add semver later
  return installed === required;
}

// ── npm Operations ───────────────────────────────────────────────────────────

export function runNpmInstall(moduleDir: string): { success: boolean; error?: string } {
  const packageJsonPath = path.join(moduleDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { success: true }; // no package.json = nothing to install
  }

  try {
    execSync('npm install --production --legacy-peer-deps', {
      cwd: moduleDir,
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export function runNpmRebuild(moduleDir: string): { success: boolean; error?: string } {
  try {
    execSync('npm rebuild', {
      cwd: moduleDir,
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ── Install / Uninstall ──────────────────────────────────────────────────────

export function installModule(
  sourceDir: string,
  name: string,
  manifest: ModuleManifest,
  projectDir?: string,
): InstallResult {
  const vaultDir = projectDir
    ? path.resolve(projectDir, '.pi', 'modules')
    : getVaultDir();

  // Ensure vault exists
  fs.mkdirSync(vaultDir, { recursive: true });

  const targetDir = path.join(vaultDir, name);

  // Check if already installed
  if (fs.existsSync(targetDir)) {
    return {
      success: false,
      message: `Module "${name}" already installed at ${targetDir}. Remove it first.`,
    };
  }

  // Copy source to vault
  try {
    fs.cpSync(sourceDir, targetDir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to copy module: ${message}` };
  }

  // Write manifest
  writeManifest(targetDir, manifest);

  // Auto npm install
  const npmResult = runNpmInstall(targetDir);

  const resolved: ResolvedModule = {
    name,
    path: targetDir,
    manifest,
    type: detectModuleType(targetDir),
    active: false,
  };

  if (!npmResult.success) {
    const manifestData = readManifest(targetDir);
    if (manifestData?.native) {
      return {
        success: true,
        message: `Module "${name}" installed but native build failed. Run module_manager rebuild ${name} to retry.`,
        module: resolved,
      };
    }
    return {
      success: true,
      message: `Module "${name}" installed but npm install failed: ${npmResult.error}`,
      module: resolved,
    };
  }

  return {
    success: true,
    message: `Module "${name}" installed successfully`,
    module: resolved,
  };
}

export function uninstallModule(name: string, projectDir?: string): InstallResult {
  const vaultDirs = resolveVaultDirs(projectDir);

  for (const vaultDir of vaultDirs) {
    const moduleDir = path.join(vaultDir, name);
    if (!fs.existsSync(moduleDir)) continue;

    try {
      fs.rmSync(moduleDir, { recursive: true, force: true });
      return {
        success: true,
        message: `Module "${name}" uninstalled from ${moduleDir}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to uninstall: ${message}` };
    }
  }

  return { success: false, message: `Module "${name}" not found` };
}

// ── Symlink Operations ──────────────────────────────────────────────────────

/**
 * Activate a module in a project by creating symlinks.
 * Also auto-trusts the project (writes to trust.json).
 *
 * Dedupe rule: a module registers in exactly ONE place. Activation refuses
 * (a) when the module is already active globally — a project copy would
 * double-register it and pi reports tool conflicts at session start — and
 * (b) when divergent out-of-vault copies exist, so they can't silently
 * shadow the vault copy that updates actually touch.
 */
export function activateModule(
  moduleName: string,
  projectDir: string,
): { success: boolean; message: string; trustResult?: { success: boolean; message: string } } {
  const vaultDir = getVaultDir();
  const modulePath = path.join(vaultDir, moduleName);
  if (!fs.existsSync(modulePath)) {
    return { success: false, message: `Module "${moduleName}" not found in vault` };
  }

  const globalPath = activeGlobalPath(moduleName);
  if (globalPath) {
    return {
      success: false,
      message:
        `"${moduleName}" is already active GLOBALLY at ${globalPath} (always loaded in every project). ` +
        `A project symlink would double-register it (tool conflicts at session start). ` +
        `Remove the global entry first if you want it project-only.`,
    };
  }
  const divergent = divergentCopies(moduleName, projectDir);
  if (divergent.length > 0) {
    return {
      success: false,
      message:
        `Refusing to activate "${moduleName}" — divergent copies exist outside the vault:\n  - ${divergent.join('\n  - ')}\n` +
        `The vault copy is the single source of truth; remove the copies above first.`,
    };
  }

  const moduleType = detectModuleType(modulePath);
  const results: string[] = [];

  // Create symlinks based on module type
  if (moduleType === 'extension' || moduleType === 'hybrid') {
    const extDir = path.join(projectDir, '.pi', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    const linkPath = path.join(extDir, moduleName);
    if (!fs.existsSync(linkPath)) {
      fs.symlinkSync(modulePath, linkPath);
      results.push(`extensions/${moduleName}`);
    }
  }

  if (moduleType === 'skill' || moduleType === 'hybrid') {
    const skillDir = path.join(projectDir, '.pi', 'skills');
    fs.mkdirSync(skillDir, { recursive: true });
    const linkPath = path.join(skillDir, moduleName);
    if (!fs.existsSync(linkPath)) {
      fs.symlinkSync(modulePath, linkPath);
      results.push(`skills/${moduleName}`);
    }
  }

  // Auto-trust the project
  const trustResult = addTrust(projectDir);

  if (results.length === 0) {
    return {
      success: true,
      message: `Module "${moduleName}" already active`,
      trustResult,
    };
  }

  return {
    success: true,
    message: `Created symlink(s) for "${moduleName}" in ${projectDir} (${results.join(', ')})`,
    trustResult,
  };
}

/**
 * Deactivate a module in a project by removing symlinks.
 * Does NOT modify the trust file.
 */
export function deactivateModule(
  moduleName: string,
  projectDir: string,
): { success: boolean; message: string } {
  const results: string[] = [];

  // Remove extension symlink
  const extLink = path.join(projectDir, '.pi', 'extensions', moduleName);
  if (fs.existsSync(extLink) && fs.lstatSync(extLink).isSymbolicLink()) {
    fs.unlinkSync(extLink);
    results.push(`extensions/${moduleName}`);
  }

  // Remove skill symlink
  const skillLink = path.join(projectDir, '.pi', 'skills', moduleName);
  if (fs.existsSync(skillLink) && fs.lstatSync(skillLink).isSymbolicLink()) {
    fs.unlinkSync(skillLink);
    results.push(`skills/${moduleName}`);
  }

  if (results.length === 0) {
    return { success: true, message: `Module "${moduleName}" not active in project` };
  }

  return {
    success: true,
    message: `Deactivated "${moduleName}" in ${projectDir} (removed ${results.join(', ')})`,
  };
}

/**
 * List active modules in a project (via symlinks), tagged by scope.
 * Returns the union of global and project-local modules.
 *
 * When a name is active in BOTH scopes (shouldn't happen — activate refuses
 * it), the spec says list it once under project-local with a note that it is
 * also global, so the double-registration is the thing you see.
 */
export function listActiveModules(
  projectDir: string,
): Array<{ name: string; scope: 'global' | 'project'; alsoGlobal?: boolean }> {
  // Global: <agent>/extensions/ and <agent>/skills/ (symlinks and real entries)
  const globalNames = new Set<string>();
  const agent = getAgentDir();
  for (const dir of [path.join(agent, 'extensions'), path.join(agent, 'skills')]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      // Skip node_modules and the module-manager bootstrap
      if (entry.name === 'node_modules' || entry.name === 'module-manager') continue;
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) continue;
      globalNames.add(entry.name);
    }
  }

  // Project-local: <project>/.pi/extensions/ and <project>/.pi/skills/
  // Only symlinks count as activated modules in a project
  const projectNames = new Set<string>();
  for (const dir of [path.join(projectDir, '.pi', 'extensions'), path.join(projectDir, '.pi', 'skills')]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue;
      projectNames.add(entry.name);
    }
  }

  const results: Array<{ name: string; scope: 'global' | 'project'; alsoGlobal?: boolean }> = [];
  for (const name of globalNames) {
    if (!projectNames.has(name)) results.push({ name, scope: 'global' });
  }
  for (const name of projectNames) {
    results.push({
      name,
      scope: 'project',
      ...(globalNames.has(name) ? { alsoGlobal: true } : {}),
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if project .pi/extensions/ or .pi/skills/ exist and are empty
 */
export function projectHasActivatedModules(projectDir: string): boolean {
  const extDir = path.join(projectDir, '.pi', 'extensions');
  const skillDir = path.join(projectDir, '.pi', 'skills');

  for (const dir of [extDir, skillDir]) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    if (entries.length > 0) return true;
  }
  return false;
}
