# 🔧 Module Manager — Pi Extension

A unified module system for pi — manages extensions and skills from a shared vault.

## ✨ Features

- 📦 **Single vault** — `~/.pi/modules/` for all extensions and skills
- 🎯 **Explicit loading** — modules declared in `settings.json`, no auto-discovery
- 🔄 **Module modes** — standalone (project only) or extends (global + project)
- 📋 **Version pinning** — load specific versions via `modules@version`
- 🔨 **Auto npm install** — dependencies installed on module add
- ⚠️ **Native dep handling** — warn on build failure, allow retry with rebuild

## 📦 Tools

| Tool | Description |
|---|---|
| `module_manager` | Install, uninstall, list, info, update, rebuild modules |

## 🚀 Quick Start

### Install

```bash
# From local path
pi extension install ./module-manager

# Or add to settings.json
```

### First Use

```json
// ~/.pi/agent/settings.json
{
  "modules": ["module-manager", "bg-promises", "web-search"]
}
```

Restart pi, then:

```
List all installed modules
```

## 📂 Module Structure

### Skill module
```
~/.pi/modules/my-skill/
├── MODULE.json
└── SKILL.md
```

### Extension module
```
~/.pi/modules/my-extension/
├── MODULE.json
├── package.json
├── src/
│   └── index.ts
└── node_modules/
```

### Hybrid module (extension + skill)
```
~/.pi/modules/bg-promises/
├── MODULE.json
├── package.json
├── src/
│   └── index.ts
├── skills/
│   └── bg-promises/
│       └── SKILL.md
└── node_modules/
```

## 📋 MODULE.json

Required for every module:

```json
{
  "name": "comfyui",
  "version": "1.2.0",
  "source": "github:Immac/pi-extension-comfyui",
  "installedAt": "2025-08-05T10:00:00Z",
  "native": false
}
```

## 🔧 Settings Schema

```json
{
  "modules": ["comfyui", "anime-prompting@1.0.0"],
  "moduleMode": "extends"
}
```

| `moduleMode` | Behavior |
|---|---|
| *(omitted)* | Standalone — only project modules |
| `"standalone"` | Same as omitted (explicit) |
| `"extends"` | Global + project, project wins conflicts |

## 🛠️ Development

```bash
npm install
npm run build
npm test
```

## 📄 License

MIT
