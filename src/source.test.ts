import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { isGitSource, normalizeGitUrl, resolveGitSource, resolveSourceToDir } from './source.js';

describe('isGitSource', () => {
  it('detects URL schemes', () => {
    expect(isGitSource('https://github.com/Immac/pi-web-search')).toBe(true);
    expect(isGitSource('https://github.com/Immac/pi-web-search.git')).toBe(true);
    expect(isGitSource('http://example.com/repo.git')).toBe(true);
    expect(isGitSource('ssh://git@github.com/user/repo.git')).toBe(true);
    expect(isGitSource('git://github.com/user/repo.git')).toBe(true);
    expect(isGitSource('file:///tmp/repo')).toBe(true);
  });

  it('detects scp-like and npm/github shorthand forms', () => {
    expect(isGitSource('git@github.com:user/repo.git')).toBe(true);
    expect(isGitSource('git+https://github.com/user/repo.git')).toBe(true);
    expect(isGitSource('github:user/repo')).toBe(true);
  });

  it('rejects local paths', () => {
    expect(isGitSource('/home/user/modules/web-search')).toBe(false);
    expect(isGitSource('./relative/path')).toBe(false);
    expect(isGitSource('web-search')).toBe(false);
    expect(isGitSource('')).toBe(false);
  });
});

describe('normalizeGitUrl', () => {
  it('expands github: shorthand', () => {
    expect(normalizeGitUrl('github:Immac/pi-web-search')).toBe('https://github.com/Immac/pi-web-search');
  });

  it('strips npm-style git+ prefix', () => {
    expect(normalizeGitUrl('git+https://github.com/user/repo.git')).toBe('https://github.com/user/repo.git');
  });

  it('leaves plain URLs and scp-like forms alone', () => {
    expect(normalizeGitUrl('https://github.com/user/repo')).toBe('https://github.com/user/repo');
    expect(normalizeGitUrl('git@github.com:user/repo.git')).toBe('git@github.com:user/repo.git');
  });

  it('drops trailing slash after .git', () => {
    expect(normalizeGitUrl('https://github.com/user/repo.git/')).toBe('https://github.com/user/repo.git');
  });
});

describe('resolveGitSource (local file:// fixture)', () => {
  let tmp: string;
  let repo: string;
  let vault: string;
  let savedVault: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-source-'));
    repo = path.join(tmp, 'origin');
    fs.mkdirSync(repo);
    execSync('git init -q -b main .', { cwd: repo });
    execSync('git config user.email t@t.local && git config user.name t', { cwd: repo });
    fs.writeFileSync(path.join(repo, 'MODULE.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }));
    execSync('git add . && git commit -qm init', { cwd: repo });
    // control the vault location so the cache lands in a temp dir
    vault = path.join(tmp, 'vault');
    savedVault = process.env.PI_MODULES_VAULT;
    process.env.PI_MODULES_VAULT = vault;
  });

  afterEach(() => {
    if (savedVault === undefined) delete process.env.PI_MODULES_VAULT;
    else process.env.PI_MODULES_VAULT = savedVault;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('clones a git URL into the vault cache and returns the checkout', () => {
    const dir = resolveGitSource(`file://${repo}`);
    expect(dir).toBeTruthy();
    expect(dir!.startsWith(path.join(vault, '.git-cache'))).toBe(true);
    expect(fs.existsSync(path.join(dir!, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(dir!, 'MODULE.json'))).toBe(true);
  });

  it('is idempotent and picks up new commits on refresh', () => {
    const first = resolveGitSource(`file://${repo}`);
    expect(first).toBeTruthy();
    // new commit upstream
    fs.writeFileSync(path.join(repo, 'MARKER'), 'v2');
    execSync('git add . && git commit -qm v2', { cwd: repo });
    const second = resolveGitSource(`file://${repo}`);
    expect(second).toBe(first);
    expect(fs.existsSync(path.join(second!, 'MARKER'))).toBe(true);
  });

  it('returns null for an unreachable source', () => {
    expect(resolveGitSource(`file://${path.join(tmp, 'does-not-exist')}`)).toBeNull();
  });

  it('resolveSourceToDir routes git vs path sources correctly', () => {
    // existing local path resolves directly
    expect(resolveSourceToDir(repo)).toBe(repo);
    // git URL goes through the cache
    const dir = resolveSourceToDir(`file://${repo}`);
    expect(dir).toBeTruthy();
    expect(fs.existsSync(path.join(dir!, '.git'))).toBe(true);
    // dead local path → null (no git-looking scheme)
    expect(resolveSourceToDir(path.join(tmp, 'missing-dir'))).toBeNull();
  });
});
