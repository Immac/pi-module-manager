import fs from 'node:fs';
import path from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  getVaultDir,
  getAgentDir,
  projectVaultDir,
  findModule,
  listModules,
  installModule,
  uninstallModule,
  activateModule,
  deactivateModule,
  listActiveModules,
  divergentCopies,
  runNpmRebuild,
  addTrust,
  removeTrust,
  listTrust,
} from './vault.js';
import { resolveSourceToDir, isGitSource } from './source.js';
import type { ModuleManifest } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMessage(result: { success: boolean; message: string }): string {
  return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
}

function ensureVault(): void {
  const vaultDir = getVaultDir();
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
  }
}

// ── Suggest Logic ────────────────────────────────────────────────────────────

interface SuggestedModule {
  name: string;
  type: string;
  reason: string;
}

function detectProjectType(projectDir: string): { type: string; extras: SuggestedModule[] } {
  const markers: Array<{ pattern: string; type: string; extras: SuggestedModule[] }> = [
    {
      pattern: 'package.json',
      type: 'Node.js',
      extras: [
        { name: 'web-search', type: 'hybrid', reason: 'Web search for Node.js projects' },
        { name: 'code-review-workflow', type: 'skill', reason: 'Code review for JavaScript/TypeScript' },
      ],
    },
    {
      pattern: 'Cargo.toml',
      type: 'Rust',
      extras: [
        { name: 'code-review-workflow', type: 'skill', reason: 'Code review for Rust projects' },
      ],
    },
    {
      pattern: 'pyproject.toml',
      type: 'Python',
      extras: [
        { name: 'debug-with-screenshots', type: 'skill', reason: 'Visual debugging for Python apps' },
      ],
    },
    {
      pattern: 'requirements.txt',
      type: 'Python',
      extras: [
        { name: 'debug-with-screenshots', type: 'skill', reason: 'Visual debugging for Python apps' },
      ],
    },
    {
      pattern: 'setup.py',
      type: 'Python',
      extras: [
        { name: 'debug-with-screenshots', type: 'skill', reason: 'Visual debugging for Python apps' },
      ],
    },
    {
      pattern: 'go.mod',
      type: 'Go',
      extras: [
        { name: 'code-review-workflow', type: 'skill', reason: 'Code review for Go projects' },
      ],
    },
  ];

  // Check for .csproj or .sln files
  try {
    const entries = fs.readdirSync(projectDir);
    for (const entry of entries) {
      if (entry.endsWith('.csproj') || entry.endsWith('.sln')) {
        return {
          type: '.NET',
          extras: [
            { name: 'code-review-workflow', type: 'skill', reason: 'Code review for .NET projects' },
          ],
        };
      }
    }
  } catch {
    // ignore
  }

  for (const marker of markers) {
    if (fs.existsSync(path.join(projectDir, marker.pattern))) {
      // For Python, also check for images/ directory for find-booru-tags
      const extras = [...marker.extras];
      if (marker.type === 'Python' && fs.existsSync(path.join(projectDir, 'images'))) {
        extras.push({ name: 'find-booru-tags', type: 'skill', reason: 'Image tag lookup for Python image projects' });
      }
      return { type: marker.type, extras };
    }
  }

  return { type: 'generic', extras: [] };
}

function getSuggestedModules(projectDir: string): SuggestedModule[] {
  const vaultDir = getVaultDir();
  const { type, extras } = detectProjectType(projectDir);

  const generic: SuggestedModule[] = [
    { name: 'edit-assist', type: 'extension', reason: 'Helps recover from edit tool failures — useful in every project' },
    { name: 'pragmatic-coding', type: 'skill', reason: 'Pragmatic Programmer workflow — language-agnostic' },
    { name: 'twelve-factor-app', type: 'skill', reason: 'Methodology reminder for app design' },
    { name: 'zero-to-implemented', type: 'skill', reason: 'Build from scratch workflow' },
  ];

  const all = [...generic, ...extras];

  // Get already-activated modules for this project
  const activeModules = listActiveModules(projectDir);
  const activeNames = new Set(activeModules.map(m => m.name));

  // Filter out already-active and non-existent modules
  return all.filter(m => {
    if (activeNames.has(m.name)) return false;
    const moduleDir = path.join(vaultDir, m.name);
    return fs.existsSync(moduleDir) && fs.existsSync(path.join(moduleDir, 'MODULE.json'));
  });
}

// ── Main Extension ───────────────────────────────────────────────────────────

export default function moduleManager(pi: ExtensionAPI) {
  ensureVault();

  pi.registerTool({
    name: 'module_manager',
    label: 'Module Manager',
    description: 'Manage modules (extensions + skills) in the shared vault — install, uninstall, list, info, update, rebuild, activate, deactivate. Use `list` without project to see all vault modules, or with project to see active modules in that project.',
    parameters: Type.Object({
      action: Type.String({
        description: 'Action: install | uninstall | list | info | update | rebuild | activate | deactivate | suggest | trust',
      }),
      name: Type.Optional(Type.String({
        description: 'Module name (required for most actions)',
      })),
      from: Type.Optional(Type.String({
        description: 'Source to install from (path, git URL). Required for install.',
      })),
      version: Type.Optional(Type.String({
        description: 'Version/tag to pin (for install/update)',
      })),
      scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('project')], {
        description: 'Install scope: "user" (default, global) or "project" (local vault)',
      })),
      project: Type.Optional(Type.String({
        description: 'Project directory path (required for activate/deactivate, optional for list/suggest)',
      })),
    }),
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx: any) {
      const action = (params.action as string || '').toLowerCase();
      const name = params.name as string | undefined;
      const from = params.from as string | undefined;
      const version = params.version as string | undefined;
      const explicitScope = (params.scope as string | undefined) || undefined;
      const scope = (explicitScope || 'user') as 'user' | 'project';
      const projectDir = (params.project as string) || (ctx?.cwd as string) || undefined;

      switch (action) {
        // ── INSTALL ──
        case 'install': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for install.' }], details: {} };
          }
          if (!from) {
            return { content: [{ type: 'text', text: 'Error: "from" is required for install.' }], details: {} };
          }

          // Resolve source to a local directory (local path, or git URL
          // cloned into the vault cache — optionally pinned to `version`)
          const sourceDir = resolveSourceToDir(from, projectDir, version);
          if (!sourceDir) {
            return {
              content: [{
                type: 'text',
                text: `Error: Could not resolve source "${from}". For a path: check it exists. For a git URL: check the URL/branch/tag and that git can clone it.`,
              }],
              details: {},
            };
          }

          // Create manifest
          const manifest: ModuleManifest = {
            name,
            version: version || '0.0.1',
            source: from,
            installedAt: new Date().toISOString(),
          };

          const installDir = scope === 'project' ? projectDir : undefined;
          const result = installModule(sourceDir, name, manifest, installDir);

          return {
            content: [{ type: 'text', text: formatMessage(result) }],
            details: { result },
          };
        }

        // ── UNINSTALL ──
        case 'uninstall': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for uninstall.' }], details: {} };
          }

          const uninstallDir = scope === 'project' ? projectDir : undefined;
          const result = uninstallModule(name, uninstallDir);
          return {
            content: [{ type: 'text', text: formatMessage(result) }],
            details: { result },
          };
        }

        // ── LIST ──
        case 'list': {
          // Explicit project param → show active modules in that project, grouped by scope
          if (params.project) {
            const active = listActiveModules(projectDir!);
            let text = `## Active Modules in ${projectDir}\n\n`;

            const globalModules = active.filter(m => m.scope === 'global');
            const projectModules = active.filter(m => m.scope === 'project');

            text += '### Global (always loaded)\n';
            if (globalModules.length > 0) {
              text += globalModules.map(m => `- ${m.name}`).join('\n') + '\n';
            } else {
              text += '(empty — lean by default)\n';
            }

            text += '\n### Project-local (activated in this project)\n';
            if (projectModules.length > 0) {
              text += projectModules
                .map(m => `- ${m.name}${m.alsoGlobal ? ' (also global — double-registered; remove one copy)' : ''}`)
                .join('\n') + '\n';
            } else {
              text += '(none)\n';
            }

            return {
              content: [{ type: 'text', text }],
              details: { active },
            };
          }

          // Default: show all modules from the vault, with an active marker
          const vaultDir = getVaultDir();
          const modules = listModules(vaultDir);
          const active = projectDir ? listActiveModules(projectDir) : [];
          const activeMap = new Map(active.map(m => [m.name, m]));

          let text = '## Module Vault\n\n';

          if (modules.length > 0) {
            text += `**${modules.length} modules installed:**\n\n`;
            text += '| Module | Version | Type | Active |\n';
            text += '|--------|---------|------|--------|\n';
            for (const m of modules) {
              const a = activeMap.get(m.name);
              const mark = !a
                ? '—'
                : a.scope === 'global'
                  ? 'global'
                  : a.alsoGlobal
                    ? 'project + global'
                    : 'project';
              text += `| ${m.name} | v${m.manifest.version} | ${m.type} | ${mark} |\n`;
            }
            text += `\n_Active_ = always loaded globally (\`${getAgentDir()}/skills\` or \`extensions\`)` +
              ` or symlinked in ${projectDir ?? 'the current project'}. Use \`list --project <path>\` for the grouped view.\n`;
          } else {
            text += 'No modules installed. Use `module_manager install` to add modules.\n';
          }

          return {
            content: [{ type: 'text', text }],
            details: { modules },
          };
        }

        // ── INFO ──
        case 'info': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for info.' }], details: {} };
          }

          const module = findModule(name, projectDir);
          if (!module) {
            return { content: [{ type: 'text', text: `Module "${name}" not found in vault.` }], details: {} };
          }

          const entryExists = (p: string): boolean => {
            if (fs.existsSync(p)) return true;
            try {
              return fs.lstatSync(p).isSymbolicLink(); // broken link still counts as an entry
            } catch {
              return false;
            }
          };

          // Activation: where (if anywhere) pi loads this module from
          const agent = getAgentDir();
          const gPaths = ['skills', 'extensions']
            .map(d => path.join(agent, d, module.name))
            .filter(entryExists);
          const pPaths = projectDir
            ? ['skills', 'extensions']
                .map(d => path.join(projectDir, '.pi', d, module.name))
                .filter(entryExists)
            : [];
          const activation = [
            gPaths.length
              ? `global — always loaded: ${gPaths.join(', ')}`
              : 'not active globally',
            pPaths.length
              ? `project — ${pPaths.join(', ')}`
              : projectDir
                ? gPaths.length
                  ? 'no project-local copy (global already covers this project)'
                  : 'not active in this project'
                : 'no project context',
          ];

          // Health: source resolvable? copies diverging from the vault?
          const src = module.manifest.source ?? '';
          const health: string[] = [];
          if (!src) {
            health.push('⚠️ no source recorded — update will fail; reinstall with `install --from <path-or-git-url>`');
          } else if (isGitSource(src)) {
            health.push(`git source (not probed): ${src}`);
          } else {
            const ok = fs.existsSync(src) || fs.existsSync(path.resolve(src));
            health.push(
              ok
                ? `local source OK: ${src}`
                : `⚠️ local source MISSING: ${src} — update will fail; reinstall with \`install --from <path-or-git-url>\``,
            );
          }
          const divergent = divergentCopies(module.name, projectDir);
          for (const d of divergent) health.push(`⚠️ divergent copy outside the vault: ${d}`);
          if (divergent.length === 0) health.push('single copy — the vault is the only location');

          const text = [
            `## ${module.name}`,
            `Version: ${module.manifest.version}`,
            `Type: ${module.type}`,
            `Source: ${module.manifest.source}`,
            `Path: ${module.path}`,
            `Installed: ${module.manifest.installedAt}`,
            module.manifest.updatedAt ? `Updated: ${module.manifest.updatedAt}` : null,
            module.manifest.native ? '⚠️ Has native dependencies' : null,
            '',
            'Activation:',
            ...activation.map(l => `  - ${l}`),
            '',
            'Health:',
            ...health.map(l => `  - ${l}`),
          ].filter((l): l is string => l !== null).join('\n');

          return {
            content: [{ type: 'text', text }],
            details: { module },
          };
        }

        // ── UPDATE ──
        case 'update': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for update.' }], details: {} };
          }

          const existing = findModule(name, projectDir);
          if (!existing) {
            return { content: [{ type: 'text', text: `Module "${name}" not found in vault.` }], details: {} };
          }

          // Re-fetch from source (git URLs are cloned/pulled in the vault
          // cache; local paths must still exist on disk)
          const sourceDir = resolveSourceToDir(existing.manifest.source, projectDir, version);
          if (!sourceDir) {
            return {
              content: [{
                type: 'text',
                text: `Error: Could not resolve source "${existing.manifest.source}" for module "${name}". The stored source is stale (e.g. a local path that no longer exists) — reinstall with a resolvable source: module_manager install --name ${name} --from <path-or-git-url>`,
              }],
              details: {},
            };
          }

          // Remember which vault the module lives in so `update` re-installs it
          // to the same place (never silently moves it between vaults).
          const projectVault = projectVaultDir(projectDir);
          const installedInProject = projectVault !== null && existing.path.startsWith(projectVault + path.sep);

          // Remove old version
          uninstallModule(name, projectDir);

          // Install new version
          const newVersion = version || existing.manifest.version;
          const manifest: ModuleManifest = {
            ...existing.manifest,
            version: newVersion,
            updatedAt: new Date().toISOString(),
          };

          // Explicit scope wins; otherwise keep the module where it was found
          const installDir = explicitScope
            ? (explicitScope === 'project' ? projectDir : undefined)
            : (installedInProject ? projectDir : undefined);
          const result = installModule(sourceDir, name, manifest, installDir);

          return {
            content: [{ type: 'text', text: formatMessage(result) }],
            details: { result },
          };
        }

        // ── REBUILD ──
        case 'rebuild': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for rebuild.' }], details: {} };
          }

          const rebuildModule = findModule(name, projectDir);
          if (!rebuildModule) {
            return { content: [{ type: 'text', text: `Module "${name}" not found in vault.` }], details: {} };
          }

          const rebuildResult = runNpmRebuild(rebuildModule.path);
          const rebuildMessage = rebuildResult.success
            ? `✅ Module "${name}" rebuilt successfully`
            : `❌ Rebuild failed: ${rebuildResult.error}`;

          return {
            content: [{ type: 'text', text: rebuildMessage }],
            details: { success: rebuildResult.success, error: rebuildResult.error },
          };
        }

        // ── ACTIVATE ──
        case 'activate': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for activate.' }], details: {} };
          }
          if (!projectDir) {
            return { content: [{ type: 'text', text: 'Error: "project" parameter is required for activate.' }], details: {} };
          }

          const activateResult = activateModule(name, projectDir);
          const messages: string[] = [formatMessage(activateResult)];
          if (activateResult.trustResult) {
            if (activateResult.trustResult.message.includes('already trusted')) {
              messages.push(`ℹ️ ${activateResult.trustResult.message}`);
            } else {
              messages.push(`✅ ${activateResult.trustResult.message}`);
            }
          }
          return {
            content: [{ type: 'text', text: messages.join('\n') }],
            details: { result: activateResult },
          };
        }

        // ── DEACTIVATE ──
        case 'deactivate': {
          if (!name) {
            return { content: [{ type: 'text', text: 'Error: "name" is required for deactivate.' }], details: {} };
          }
          if (!projectDir) {
            return { content: [{ type: 'text', text: 'Error: "project" parameter is required for deactivate.' }], details: {} };
          }

          const deactivateResult = deactivateModule(name, projectDir);
          return {
            content: [{ type: 'text', text: formatMessage(deactivateResult) }],
            details: { result: deactivateResult },
          };
        }

        // ── SUGGEST ──
        case 'suggest': {
          const targetDir = projectDir || (ctx?.cwd as string);
          if (!targetDir) {
            return { content: [{ type: 'text', text: 'Error: "project" parameter or cwd is required for suggest.' }], details: {} };
          }

          const { type: projectType } = detectProjectType(targetDir);
          const suggested = getSuggestedModules(targetDir);

          let text = `## Suggested Modules for ${projectType} project\n\n`;

          if (suggested.length > 0) {
            text += '| Module | Type | Why |\n';
            text += '|--------|------|-----|\n';
            for (const m of suggested) {
              text += `| ${m.name} | ${m.type} | ${m.reason} |\n`;
            }
          } else {
            text += 'No additional modules to suggest — all compatible modules are already active.\n';
          }

          text += `\nActivate any of these with:\n  module_manager activate --name <module> --project ${targetDir}\n`;

          return {
            content: [{ type: 'text', text }],
            details: { suggested, projectType },
          };
        }

        // ── TRUST ──
        case 'trust': {
          // Parse subcommand from name (trust add <path>, trust remove <path>, trust list)
          // The name param is overloaded: "add", "remove", or "list"
          const subcommand = (name || '').toLowerCase();

          switch (subcommand) {
            case 'add': {
              // The path is passed via 'from' for convenience (name is used for subcommand)
              const trustPath = params.from as string | undefined;
              if (!trustPath) {
                return { content: [{ type: 'text', text: 'Error: path is required for "trust add". Use: module_manager trust add --name <path>' }], details: {} };
              }
              const result = addTrust(trustPath);
              return {
                content: [{ type: 'text', text: formatMessage(result) }],
                details: { result },
              };
            }

            case 'remove': {
              const trustPath = params.from as string | undefined;
              if (!trustPath) {
                return { content: [{ type: 'text', text: 'Error: path is required for "trust remove". Use: module_manager trust remove --name <path>' }], details: {} };
              }
              const result = removeTrust(trustPath);
              return {
                content: [{ type: 'text', text: formatMessage(result) }],
                details: { result },
              };
            }

            case 'list': {
              const entries = listTrust();
              let text = '## Trust List\n\n';
              if (entries.length > 0) {
                text += '| Path | Decision |\n';
                text += '|------|----------|\n';
                for (const e of entries) {
                  const decision = e.decision === true ? '✅ trusted' : e.decision === false ? '❌ denied' : 'null (cleared)';
                  text += `| ${e.path} | ${decision} |\n`;
                }
              } else {
                text += 'No trust decisions recorded.\n';
              }
              return {
                content: [{ type: 'text', text }],
                details: { entries },
              };
            }

            default:
              return {
                content: [{ type: 'text', text: `Error: Unknown trust subcommand "${subcommand}". Valid: add, remove, list` }],
                details: {},
              };
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown action "${action}". Valid: install, uninstall, list, info, update, rebuild, activate, deactivate, suggest, trust` }],
            details: {},
          };
      }
    },
  });
}

// (Source resolution lives in ./source.ts — local paths and git URLs.)
