# Module System Migration Plan

## Overview

Migrate from the current dual-system (extension-manager + skill-manager) to a unified module system using **symlinks** to work with pi's existing auto-discovery framework.

## Key Insight

Pi auto-discovers extensions from `<project>/.pi/extensions/` and skills from `<project>/.pi/skills/`. Instead of fighting this design, we **use it** by creating symlinks from project directories to the shared vault.

---

## Phase 0: Current State (completed)

✅ All extensions and skills migrated to `~/.pi/modules/`
✅ MODULE.json created for each module
✅ Bootstrap extension installed at `~/.pi/agent/extensions/module-manager/`
✅ `settings.json` updated with `packages` and `skills` arrays pointing to vault

## Current Architecture (Post-Migration)

```
~/.pi/modules/                    ← Shared vault (source of truth)
├── bg-promises/                  # MODULE.json + extension/skill files
├── web-search/
├── comfyui/
└── ... (27 modules)

~/.pi/agent/extensions/           ← Bootstrap (auto-loaded)
├── module-manager/               # Our extension
├── scoped-agents.ts
└── pi-vscode-context.ts

~/.pi/agent/settings.json         ← Points to vault
├── "packages": ["~/.pi/modules/*"]
└── "skills": ["~/.pi/modules/*"]
```

---

## Phase 1: Test Module Manager ✅

**Completed.** Module manager tested and working:
- `module_manager list` — shows all modules
- `module_manager install` — adds modules to vault
- `module_manager info` — shows module details
- `module_manager uninstall` — removes modules
- Type detection (extension, skill, hybrid, prompt)
- 34 unit tests passing

---

## Phase 2: Bootstrap Directory ✅

**Completed.** Module manager installed to `~/.pi/agent/extensions/module-manager/`.

---

## Phase 3: Create Module Vault ✅

**Completed.** 27 modules migrated to `~/.pi/modules/` with MODULE.json metadata.

---

## Phase 4: Update Settings ✅

**Completed.** Settings.json updated with:
- `packages` array pointing to vault modules
- `skills` array pointing to vault modules
- `modules` array for module_manager tracking

---

## Phase 5: Cleanup ✅

**Completed.** Old directories removed:
- `~/.extension-manager/extensions/`
- `~/.skill-manager/skills/`
- `~/.pi/agent/skills/`
- Registry files

## Phase 6: Symlink Activation (New Approach)

**Goal:** Use symlinks to activate modules per-project, working with pi's auto-discovery.

### How it works:

1. **Shared vault** at `~/.pi/modules/` (single source of truth)
2. **Activate per-project** by creating symlinks:
   ```
   ~/my-project/.pi/extensions/bg-promises -> ~/.pi/modules/bg-promises
   ~/my-project/.pi/skills/pragmatic-coding -> ~/.pi/modules/pragmatic-coding
   ```
3. **Pi auto-discovers** the symlinked modules
4. **Deactivate** by removing symlinks

### Module manager commands:

```bash
# Activate a module in a project
module_manager activate --name bg-promises --project ~/my-project

# Deactivate a module
module_manager deactivate --name bg-promises --project ~/my-project

# List active modules in a project
module_manager list --project ~/my-project
```

### Benefits:
- ✅ Shared vault (no copies)
- ✅ Per-project control
- ✅ Pi auto-discovery (no env vars)
- ✅ Clean deactivation (remove symlinks)
- ✅ Works with pi's existing framework

---

## Rollback Plan

If migration fails:

1. Restore `settings.json` from backup
2. Restore old directories from backup
3. Remove `~/.pi/modules/`
4. Remove module_manager from `~/.pi/agent/extensions/`

---

## Timeline

- **Phase 0-5:** ✅ Completed
- **Phase 6:** In progress (symlink activation)
