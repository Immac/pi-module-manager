---
name: module-manager
description: >
  Manage pi modules — install, uninstall, list, update, and rebuild extensions and skills
  from a shared vault. Use when you need to add/remove modules from the pi configuration.
---

# Module Manager

## Overview

This skill teaches you how to use the `module_manager` tool to manage pi modules.

Pi modules are extensions, skills, and prompts stored in a shared vault (`~/.pi-modules-vault/`).
Modules are explicitly declared in `settings.json` and loaded at startup.

## Module Types

| Type | Purpose | Files |
|------|---------|-------|
| **Extension** | Adds tools, commands, event handlers | `package.json`, `src/*.ts` |
| **Skill** | Teaches the LLM how to do something | `SKILL.md` |
| **Prompt** | Expandable `/command` templates | `prompts/*.md` |
| **Hybrid** | Multiple types combined | Any combination above |

Note: Themes are NOT managed by the module system. They live in `~/.pi/agent/themes/`.

## Module Vault

- **Global vault:** `~/.pi-modules-vault/`
- **Project vault:** `<project>/.pi/modules/` (overrides global)

Each module is a directory containing:
- `MODULE.json` — metadata (required)
- Resource files based on type

## Using the Tool

### Install a module to vault
```
module_manager install --name my-module --from /path/to/source
```

### List all modules in vault
```
module_manager list
```

### Get module info
```
module_manager info --name my-module
```

### Activate a module in a project (creates symlinks)
```
module_manager activate --name bg-promises --project ~/my-project
```

### Deactivate a module in a project (removes symlinks)
```
module_manager deactivate --name bg-promises --project ~/my-project
```

### Update a module
```
module_manager update --name my-module
```

### Rebuild native dependencies
```
module_manager rebuild --name my-module
```

### Uninstall a module from vault
```
module_manager uninstall --name my-module
```

## Activation

Activate a module in a project by creating symlinks:

```bash
module_manager activate --name my-module --project ~/my-project
```

This creates:
- `~/my-project/.pi/extensions/my-module` → `~/.pi-modules-vault/my-module`
- `~/my-project/.pi/skills/my-module` → `~/.pi-modules-vault/my-module`

Pi auto-discovers the symlinks. No settings.json changes needed!

To deactivate:
```bash
module_manager deactivate --name my-module --project ~/my-project
```

## How It Works

The module system uses **symlinks** to work with pi's auto-discovery:

1. **Shared vault** at `~/.pi-modules-vault/` (single source of truth)
2. **Activate per-project** by creating symlinks
3. **Pi auto-discovers** the symlinked modules
4. **Deactivate** by removing symlinks

No settings.json modifications needed — just symlinks!
