# 0001 — One repository for the suite: pnpm workspace + cargo workspace

- Status: accepted
- Date: 2026-09-17

## Context

Orangery Docs shipped as a single-app repository: `v0.1.0` is published, 1446 unit
tests are green, and the DOCX round-trip corpus passes. Orangery Slides starts now,
and it is not a new product built on new foundations — it is the same product shape
pointed at a different OOXML part.

The overlap is not incidental, it is most of the hard work already done:

- **The package layer.** A `.pptx` and a `.docx` are the same thing: a zip with
  `[Content_Types].xml`, relationship parts, and a content part. Reading, writing,
  part naming, relationship ids, content-type registration — Docs has all of it.
- **Passthrough.** The machinery that keeps unmodelled XML verbatim and writes it
  back in schema order is the single most valuable thing in the Docs codebase, and
  Slides needs it more, not less: a deck carries animations, charts, SmartArt and
  embedded OLE that we will not model for years.
- **DrawingML.** Docs already parses `a:*`, `wp:*` and `pic:*` for images, anchors
  and transforms. In Slides that same namespace is the whole document.
- **Text.** `w:p`/`w:r` and `a:p`/`a:r` are the same model with different tag
  names: paragraphs of runs with properties. One ProseMirror schema serves both.
- **Everything around the document.** Command registry, palette, toolbar, theme
  tokens, atomic writes, autosave, crash recovery, updater, native menus — none of
  it is word-processor-specific.

So the question is not whether to share code, it is how.

## Alternatives considered

**Separate repositories, shared code published as packages.** The honest version
of this costs a release of `@orangery/ooxml-core` for every change to it, and the
first weeks of Slides are going to change it constantly — Slides is precisely the
thing that will show which parts of Docs' package layer were secretly
word-processor-shaped. Version skew between two repos, during the period when the
abstraction is least settled, buys nothing.

**Git submodules.** Moves the skew from versions to commits and adds a checkout
ritual. The failure mode — a submodule pointer that is behind and a CI run that is
therefore testing something nobody has — is worse than what it prevents.

**Copy the code into Slides.** Two divergent copies of the passthrough logic is a
guarantee that a fidelity bug gets fixed once and stays alive in the other app.

## Decision

One repository, one pnpm workspace, one cargo workspace.

```
apps/docs      apps/slides      packages/*
```

**The shared code moves into `packages/` by extraction, not by rewrite.** Each
package is carved out of the working Docs codebase with its tests, and Docs must be
green after every extraction — the phase 0.1 definition of done is the existing
test count and the round-trip corpus, unchanged. A package that needed Docs to be
rewritten to accommodate it would be an abstraction invented ahead of its second
user, which is the thing this repository layout exists to avoid.

**`packages/*` are app-agnostic, enforced by review, not by tooling.** No
`if (app === 'docs')`. A package that wants an app-specific branch is a package
whose abstraction is wrong, and the fix is the abstraction.

**Apps stay separate products.** Own bundle id, own binary, own icon, own release
tag (`docs-vX.Y.Z`, `slides-vX.Y.Z`), own updater channel. Nothing in one app
requires the other to be installed, and no tag ships an app that merely happened to
build alongside it. Living in one repository is a development-time decision; it is
invisible to anyone downloading a `.dmg`.

**One cargo workspace at the root.** Profiles and shared metadata live there,
`target/` is shared, and one `cargo clippy --all-targets` covers every app.

**The existing repository becomes the monorepo.** Docs moves into `apps/docs` as a
rename, so history, the published release and the issue history survive; a fresh
repository would have thrown away the only thing that cannot be rebuilt.

## Consequences

- A change to a package is atomic with the changes it forces in both apps: one
  commit, one review, one CI run. No publish step, no version negotiation.
- CI has to run everything on every change, because everything can break on every
  change. `pnpm check` at the root is the gate; a package change also runs
  `pnpm --filter docs check` explicitly, because Docs is the app with a corpus and
  is therefore the one that notices fidelity regressions first.
- One lockfile. Apps cannot drift onto different versions of React or Tiptap, which
  is a constraint and is meant to be.
- The repository gets large and the test suite gets slow. Accepted: the alternative
  spends that time on release choreography instead, and produces less signal.
- **The real risk is `packages/` quietly becoming "Docs' internals, relocated".**
  Extraction happens before Slides can exercise it, so for a few weeks the only
  consumer is the app the code came from. The mitigation is sequencing, not
  intention: `ooxml-core` and `editor-text` are extracted with the `w:`-specific
  parts left behind in an adapter inside Docs, and anything ambiguous stays in the
  app until Slides asks for it. Pulling code up later is cheap; pulling a wrong
  abstraction apart is not.
