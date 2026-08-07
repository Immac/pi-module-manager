import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import path from 'node:path';
import moduleManager from './module-manager.js';
import { hasExtension, hasSkill, hasPrompts, getVaultDir, isTrusted, projectHasActivatedModules } from './vault.js';

/**
 * Read .pi-project file from directory
 */
function readPiProject(cwd: string): { agentDir?: string; modules?: string[] } | null {
  const piProjectPath = path.join(cwd, '.pi-project');
  if (!fs.existsSync(piProjectPath)) return null;

  try {
    const content = fs.readFileSync(piProjectPath, 'utf-8');
    const result: { agentDir?: string; modules?: string[] } = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();

      if (key === 'agentDir') {
        result.agentDir = value;
      } else if (key === 'modules') {
        result.modules = value.split(',').map(m => m.trim()).filter(Boolean);
      }
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Resolve module name to vault path
 */
function resolveModulePath(moduleName: string): string | null {
  const modulePath = path.join(getVaultDir(), moduleName);
  if (fs.existsSync(modulePath)) {
    return modulePath;
  }
  return null;
}

export default function moduleManagerExtension(pi: ExtensionAPI) {
  // Register module_manager tool
  moduleManager(pi);

  // Read .pi-project and add modules via resources_discover
  pi.on('resources_discover', async (event, _ctx) => {
    const config = readPiProject(event.cwd);
    if (!config?.modules || config.modules.length === 0) {
      return {};
    }

    const skillPaths: string[] = [];
    const promptPaths: string[] = [];

    for (const moduleName of config.modules) {
      const modulePath = resolveModulePath(moduleName);
      if (!modulePath) continue;

      // Add skill if module has one
      if (hasSkill(modulePath)) {
        skillPaths.push(modulePath);
      }

      // Add prompts if module has them
      if (hasPrompts(modulePath)) {
        promptPaths.push(path.join(modulePath, 'prompts'));
      }
    }

    return { skillPaths, promptPaths };
  });

  // Session-start soft hint: suggest modules if project has none activated
  pi.on('session_start', async (event, ctx) => {
    try {
      // Skip in non-interactive modes
      if (ctx?.hasUI === false) return;

      const cwd = ctx?.cwd;
      if (!cwd) return;

      // Only show hint if project is trusted
      if (!isTrusted(cwd)) return;

      // Only show hint if project has no activated modules
      if (projectHasActivatedModules(cwd)) return;

      const hint = '💡 No modules activated in this project. Run `module_manager suggest` for recommendations.';
      if (ctx?.ui?.notify) {
        ctx.ui.notify(hint);
      } else {
        console.log(hint);
      }
    } catch {
      // Non-critical — never block session start
    }
  });
}
