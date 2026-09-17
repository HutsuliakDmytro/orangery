# CLAUDE.md — Orangery (monorepo)

Office suite with OOXML as the native format. Two apps today, more later:

- `apps/docs/` — Orangery Docs (word processor, `.docx` native) — see `apps/docs/CLAUDE.md`, `apps/docs/PLAN.md`, `apps/docs/PLAN-2.md`
- `apps/slides/` — Orangery Slides (presentations, `.pptx` native) — see `apps/slides/CLAUDE.md`, `apps/slides/PLAN.md`

Shared code lives in `packages/` (see `apps/slides/CLAUDE.md` → Monorepo for the package map). Rules that apply everywhere:

- **Each app is its own product**: own bundle id, own binary, own icon, own release tag (`docs-vX.Y.Z`, `slides-vX.Y.Z`), own updater channel. Nothing in one app requires the other to be installed.
- **`packages/*` are app-agnostic.** No `if (app === 'docs')`. If a package needs an app-specific branch, fix the abstraction.
- **OS-specific code only in `packages/platform/`** (TS) and `packages/tauri-shared` behind traits (Rust).
- **Round-trip preservation** of OOXML packages is a hard requirement in every app.
- Any change under `packages/` must keep every app green: `pnpm check` at root runs all packages and apps.

Tooling: pnpm workspace + cargo workspace, Node 22, Rust stable. Conventional Commits with scopes = package or app name.

```
pnpm install
pnpm check                          # everything
pnpm --filter docs tauri dev
pnpm --filter slides tauri dev
pnpm --filter "...[origin/main]" check   # only what changed (CI)
```

When working on a task, read the app's own CLAUDE.md and PLAN.md first; this file only sets the workspace-wide rules.
