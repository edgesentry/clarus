# Contributing

## Scope

clarus is the **Tauri GUI application layer** for edgesentry-rs. The engine, CLI, and all pipeline crates live in edgesentry-rs. Do not add pipeline logic or Rust crates here.

## Layering

| Layer | Where | What belongs there |
|---|---|---|
| IoT security primitives | [edgesentry-rs](https://github.com/edgesentry/edgesentry-rs) | Signing, audit chain, physics engine, rule evaluation |
| GUI application | this repo | Tauri commands, frontend, demo profiles, fixtures |

## Checkout requirement

Both repos must be siblings (`edgesentry-rs/` and `clarus/` in the same parent directory).

## Language

English is the single source of truth for all documentation.

## Documentation rules

1. **README.md** — human-facing, high-level only
2. **AGENTS.md** — agent-facing: directory map, design decisions, skills
3. **Agent Skills** — step-by-step procedures (`npx skills add edgesentry/clarus`)
4. **`docs/`** — reference material only (design decisions, data layout, personas)
5. **No duplication** — each fact lives in exactly one place
6. **No business use cases from other repos** — don't duplicate edgesentry-rs docs

### File naming

All files under `docs/` use `kebab-case.md` with role prefixes:

| Prefix | Use for |
|---|---|
| `ref-` | Design references, data layout, architecture |
| `ui-` | UI/UX specifications and personas |

### Skill-first policy

Before adding a procedure to `docs/`, create a Skill instead. Only reference material (facts, schemas, design decisions) goes in `docs/`.

## Agent Skills

Skills use the `clarus-` prefix, follow the [agentskills.io](https://agentskills.io/specification) spec, and live in `.agents/skills/`.

## Issues

Add every new issue to the relevant [project board](https://github.com/orgs/edgesentry/projects) with a priority set.

| Label | Meaning |
|---|---|
| `priority:P0` | Blocks a release or core functionality |
| `priority:P1` | High value, scheduled near-term |
| `priority:P2` | Valuable but deferrable |
