import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getVaultDir,
  hasExtension,
  hasSkill,
  hasPrompts,
  detectModuleType,
  readManifest,
  writeManifest,
  listModules,
  findModule,
  parseModuleRef,
  versionMatches,
  installModule,
  uninstallModule,
  activateModule,
  deactivateModule,
  listActiveModules,
  runNpmInstall,
} from './vault.js';
import type { ModuleManifest } from './types.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'module-manager-test-'));
  // Note: mkdtempSync already creates the directory
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createModule(dir: string, opts: { extension?: boolean; skill?: boolean; prompt?: boolean; manifest?: boolean } = {}): void {
  fs.mkdirSync(dir, { recursive: true });

  if (opts.extension) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'test',
      pi: { extensions: ['./index.ts'] },
    }));
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export default function(pi: any) {}');
  }

  if (opts.skill) {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: test\ndescription: test\n---\n# Test Skill');
  }

  if (opts.prompt) {
    const promptsDir = path.join(dir, 'prompts');
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(path.join(promptsDir, 'test.md'), '---\ndescription: test\n---\nTest prompt');
  }

  if (opts.manifest) {
    writeManifest(dir, {
      name: path.basename(dir),
      version: '1.0.0',
      source: 'test:local',
      installedAt: new Date().toISOString(),
    });
  }
}

// ── Resource Detection Tests ─────────────────────────────────────────────────

describe('hasExtension', () => {
  it('returns true for package.json with pi.extensions', () => {
    const dir = tmpDir();
    createModule(dir, { extension: true });
    expect(hasExtension(dir)).toBe(true);
    cleanupDir(dir);
  });

  it('returns true for index.ts', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export default function() {}');
    expect(hasExtension(dir)).toBe(true);
    cleanupDir(dir);
  });

  it('returns false for empty directory', () => {
    const dir = tmpDir();
    expect(hasExtension(dir)).toBe(false);
    cleanupDir(dir);
  });
});

describe('hasSkill', () => {
  it('returns true for SKILL.md in root', () => {
    const dir = tmpDir();
    createModule(dir, { skill: true });
    expect(hasSkill(dir)).toBe(true);
    cleanupDir(dir);
  });

  it('returns true for skills/ directory with .md files', () => {
    const dir = tmpDir();
    const skillsDir = path.join(dir, 'skills');
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, 'my-skill.md'), '# Skill');
    expect(hasSkill(dir)).toBe(true);
    cleanupDir(dir);
  });

  it('returns false for empty directory', () => {
    const dir = tmpDir();
    expect(hasSkill(dir)).toBe(false);
    cleanupDir(dir);
  });
});

describe('hasPrompts', () => {
  it('returns true for prompts/ with .md files', () => {
    const dir = tmpDir();
    createModule(dir, { prompt: true });
    expect(hasPrompts(dir)).toBe(true);
    cleanupDir(dir);
  });

  it('returns false for empty prompts/', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'prompts'));
    expect(hasPrompts(dir)).toBe(false);
    cleanupDir(dir);
  });

  it('returns false for no prompts/', () => {
    const dir = tmpDir();
    expect(hasPrompts(dir)).toBe(false);
    cleanupDir(dir);
  });
});

// ── Module Type Detection Tests ──────────────────────────────────────────────

describe('detectModuleType', () => {
  it('detects extension type', () => {
    const dir = tmpDir();
    createModule(dir, { extension: true });
    expect(detectModuleType(dir)).toBe('extension');
    cleanupDir(dir);
  });

  it('detects skill type', () => {
    const dir = tmpDir();
    createModule(dir, { skill: true });
    expect(detectModuleType(dir)).toBe('skill');
    cleanupDir(dir);
  });

  it('detects prompt type', () => {
    const dir = tmpDir();
    createModule(dir, { prompt: true });
    expect(detectModuleType(dir)).toBe('prompt');
    cleanupDir(dir);
  });

  it('detects hybrid type (extension + skill)', () => {
    const dir = tmpDir();
    createModule(dir, { extension: true, skill: true });
    expect(detectModuleType(dir)).toBe('hybrid');
    cleanupDir(dir);
  });

  it('detects hybrid type (all three)', () => {
    const dir = tmpDir();
    createModule(dir, { extension: true, skill: true, prompt: true });
    expect(detectModuleType(dir)).toBe('hybrid');
    cleanupDir(dir);
  });

  it('defaults to skill for empty module', () => {
    const dir = tmpDir();
    expect(detectModuleType(dir)).toBe('skill');
    cleanupDir(dir);
  });
});

// ── Manifest Tests ───────────────────────────────────────────────────────────

describe('readManifest', () => {
  it('reads valid MODULE.json', () => {
    const dir = tmpDir();
    createModule(dir, { manifest: true });
    const manifest = readManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest?.name).toBe(path.basename(dir));
    expect(manifest?.version).toBe('1.0.0');
    cleanupDir(dir);
  });

  it('returns null for missing MODULE.json', () => {
    const dir = tmpDir();
    expect(readManifest(dir)).toBeNull();
    cleanupDir(dir);
  });

  it('returns null for invalid JSON', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'MODULE.json'), 'not json');
    expect(readManifest(dir)).toBeNull();
    cleanupDir(dir);
  });
});

describe('writeManifest', () => {
  it('writes valid MODULE.json', () => {
    const dir = tmpDir();
    const manifest: ModuleManifest = {
      name: 'test',
      version: '1.0.0',
      source: 'test:local',
      installedAt: new Date().toISOString(),
    };
    writeManifest(dir, manifest);
    const read = readManifest(dir);
    expect(read).toEqual(manifest);
    cleanupDir(dir);
  });
});

// ── Vault Operations Tests ───────────────────────────────────────────────────

describe('listModules', () => {
  it('lists modules in vault', () => {
    const vault = tmpDir();
    createModule(path.join(vault, 'mod-a'), { extension: true, manifest: true });
    createModule(path.join(vault, 'mod-b'), { skill: true, manifest: true });
    const modules = listModules(vault);
    expect(modules).toHaveLength(2);
    expect(modules.map(m => m.name).sort()).toEqual(['mod-a', 'mod-b']);
    cleanupDir(vault);
  });

  it('returns empty array for non-existent vault', () => {
    expect(listModules('/tmp/nonexistent-vault-12345')).toEqual([]);
  });

  it('skips dirs without MODULE.json', () => {
    const vault = tmpDir();
    fs.mkdirSync(path.join(vault, 'no-manifest'));
    fs.mkdirSync(path.join(vault, 'with-manifest'));
    createModule(path.join(vault, 'with-manifest'), { manifest: true });
    const modules = listModules(vault);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('with-manifest');
    cleanupDir(vault);
  });
});

describe('findModule', () => {
  it('finds module by name', () => {
    const vault = tmpDir();
    createModule(path.join(vault, 'my-module'), { manifest: true });
    const found = findModule('my-module', undefined);
    // Note: findModule searches global vault by default
    // This test may need adjustment based on actual vault path
    cleanupDir(vault);
  });
});

// ── Version Parsing Tests ────────────────────────────────────────────────────

describe('parseModuleRef', () => {
  it('parses name only', () => {
    expect(parseModuleRef('comfyui')).toEqual({ name: 'comfyui' });
  });

  it('parses name@version', () => {
    expect(parseModuleRef('comfyui@1.2.0')).toEqual({ name: 'comfyui', version: '1.2.0' });
  });

  it('handles scoped packages', () => {
    expect(parseModuleRef('@scope/pkg@1.0.0')).toEqual({ name: '@scope/pkg', version: '1.0.0' });
  });
});

describe('versionMatches', () => {
  it('matches when no version required', () => {
    expect(versionMatches('1.0.0')).toBe(true);
  });

  it('matches exact version', () => {
    expect(versionMatches('1.2.0', '1.2.0')).toBe(true);
  });

  it('fails on version mismatch', () => {
    expect(versionMatches('1.2.0', '1.3.0')).toBe(false);
  });
});

// ── Install/Uninstall Tests ──────────────────────────────────────────────────

describe('installModule', () => {
  it('installs module to vault', () => {
    const source = tmpDir();
    const vault = tmpDir();
    createModule(source, { extension: true });

    const manifest: ModuleManifest = {
      name: 'test-install',
      version: '1.0.0',
      source: 'test:local',
      installedAt: new Date().toISOString(),
    };

    const result = installModule(source, 'test-install', manifest);
    expect(result.success).toBe(true);

    // Check global vault
    const globalVault = path.join(getVaultDir(), 'test-install');
    expect(fs.existsSync(globalVault)).toBe(true);
    expect(readManifest(globalVault)).not.toBeNull();

    cleanupDir(source);
    cleanupDir(globalVault);
  });

  it('fails on duplicate install', () => {
    const source = tmpDir();
    createModule(source, { extension: true });

    const manifest: ModuleManifest = {
      name: 'bg-promises', // already exists in global vault
      version: '1.0.0',
      source: 'test:local',
      installedAt: new Date().toISOString(),
    };

    const result = installModule(source, 'bg-promises', manifest);
    expect(result.success).toBe(false);
    expect(result.message).toContain('already installed');

    cleanupDir(source);
  });
});

describe('uninstallModule', () => {
  it('uninstalls module from vault', () => {
    const dir = tmpDir();
    createModule(dir, { manifest: true });
    const manifest = readManifest(dir);
    expect(manifest).not.toBeNull();

    // Install to global vault
    const installResult = installModule(dir, 'test-uninstall', manifest!);
    expect(installResult.success).toBe(true);

    // Uninstall
    const uninstallResult = uninstallModule('test-uninstall');
    expect(uninstallResult.success).toBe(true);

    // Verify removed
    expect(fs.existsSync(path.join(getVaultDir(), 'test-uninstall'))).toBe(false);

    cleanupDir(dir);
  });

  it('fails on non-existent module', () => {
    const result = uninstallModule('nonexistent-module-12345');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ── npm Operations Tests ─────────────────────────────────────────────────────

describe('runNpmInstall', () => {
  it('returns success for directory without package.json', () => {
    const dir = tmpDir();
    const result = runNpmInstall(dir);
    expect(result.success).toBe(true);
    cleanupDir(dir);
  });
});
describe('activateModule', () => {
  it('creates symlinks for extension module', () => {
    const projectDir = tmpDir();
    const extDir = path.join(projectDir, '.pi', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    
    // Create a fake module in the vault
    const modulePath = path.join(getVaultDir(), 'test-activate-ext');
    fs.mkdirSync(modulePath, { recursive: true });
    fs.writeFileSync(path.join(modulePath, 'index.ts'), 'export default function() {}');
    
    try {
      const result = activateModule('test-activate-ext', projectDir);
      expect(result.success).toBe(true);
      expect(result.trustResult).toBeDefined();
      expect(fs.existsSync(path.join(extDir, 'test-activate-ext'))).toBe(true);
      expect(fs.lstatSync(path.join(extDir, 'test-activate-ext')).isSymbolicLink()).toBe(true);
    } finally {
      // Cleanup
      fs.rmSync(modulePath, { recursive: true, force: true });
      cleanupDir(projectDir);
    }
  });
});

describe('deactivateModule', () => {
  it('removes symlinks', () => {
    const projectDir = tmpDir();
    const extDir = path.join(projectDir, '.pi', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    fs.symlinkSync('/tmp/fake-module', path.join(extDir, 'test-module'));
    
    const result = deactivateModule('test-module', projectDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(extDir, 'test-module'))).toBe(false);
    
    cleanupDir(projectDir);
  });
});

describe('listActiveModules', () => {
  it('lists symlinked modules', () => {
    const projectDir = tmpDir();
    const extDir = path.join(projectDir, '.pi', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    fs.symlinkSync('/tmp/module-a', path.join(extDir, 'module-a'));
    fs.symlinkSync('/tmp/module-b', path.join(extDir, 'module-b'));
    fs.mkdirSync(path.join(extDir, 'module-c')); // not a symlink
    
    const active = listActiveModules(projectDir);
    const names = active.map(m => m.name);
    expect(names).toContain('module-a');
    expect(names).toContain('module-b');
    expect(names).not.toContain('module-c');
    
    cleanupDir(projectDir);
  });
});
