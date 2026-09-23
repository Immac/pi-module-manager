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
  return path.join(os.homedir(), 'pi-base', 'trust.json');
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

/**
 * Read active modules from settings.json
 */
export function readActiveModules(projectDir?: string): string[] {
  const settingsPath = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.modules || [];
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Resolve module names to active modules with vault paths
 */
export function resolveActiveModules(projectDir?: string): ResolvedModule[] {
  const activeNames = readActiveModules(projectDir);
  const vaultDirs = resolveVaultDirs(projectDir);
  const resolved: ResolvedModule[] = [];
  const seen = new Set<string>();

  for (const ref of activeNames) {
    const { name } = parseModuleRef(ref);
    if (seen.has(name)) continue;
    seen.add(name);

    for (const vaultDir of vaultDirs) {
      const moduleDir = path.join(vaultDir, name);
      if (!fs.existsSync(moduleDir)) continue;

      const manifest = readManifest(moduleDir);
      if (!manifest) continue;

      resolved.push({
        name: manifest.name,
        path: moduleDir,
        manifest,
        type: detectModuleType(moduleDir),
        active: true,
      });
      break;
    }
  }

  return resolved;
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
 */
export function listActiveModules(projectDir: string): Array<{ name: string; scope: 'global' | 'project' }> {
  const results: Array<{ name: string; scope: 'global' | 'project' }> = [];
  const seen = new Set<string>();

  // Global: ~/pi-base/extensions/ and ~/pi-base/skills/
  const globalExtDir = path.join(os.homedir(), 'pi-base', 'extensions');
  const globalSkillDir = path.join(os.homedir(), 'pi-base', 'skills');

  for (const dir of [globalExtDir, globalSkillDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (seen.has(entry.name)) continue;
      // Skip node_modules and the module-manager bootstrap
      if (entry.name === 'node_modules' || entry.name === 'module-manager') continue;
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) continue;
      seen.add(entry.name);
      results.push({ name: entry.name, scope: 'global' });
    }
  }

  // Project-local: <project>/.pi/extensions/ and <project>/.pi/skills/
  // Only symlinks count as activated modules in a project
  const projExtDir = path.join(projectDir, '.pi', 'extensions');
  const projSkillDir = path.join(projectDir, '.pi', 'skills');

  for (const dir of [projExtDir, projSkillDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      results.push({ name: entry.name, scope: 'project' });
    }
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
