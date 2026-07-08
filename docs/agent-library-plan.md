# Agent library — a browsable catalog of importable agents

**Status:** **Proposed** (Phase 0 — not started). The pattern this spec asks for already ships twice,
for *skills*: a **local bundled catalog** (`config/skills` → Settings → Skills → Install) and a
**remote GitHub registry** (`src/edge/skill-registry.ts` — `npx skills add owner/repo` / skills.sh).
Agents have neither. This plan mirrors both mechanisms for agents, and — as the migration that proves
them out — moves today's *hardcoded* built-in agents into the catalog as data.

## The gap

A workspace ships with five built-in agents, and **every one of them is TypeScript, not data**:

- `src/edge/agent-author.ts` → the `agent-author` system agent (manifest + `CLAUDE.md` as string literals).
- `src/edge/generalists.ts` → `engineer`, `support`, `marketer`, `researcher` (four more, same shape).

They are *code-provisioned* at boot: `ensureAgentAuthor(os)` / `ensureGeneralists(os)` (`src/kernel.ts:303-304`)
idempotently write `<home>/agents/<id>/{agent.json,CLAUDE.md}` on every start. `config/agents/` exists as
a load path (`src/home.ts:86`, `loadAgentsFrom` at `src/kernel.ts:298`) but ships **empty**.

Contrast that with skills, which arrive **three** ways, all as data an operator can browse and choose:

1. Hand-authored in the console.
2. Installed from the **bundled catalog** — `config/skills/` → `SkillsStore.catalog()`/`install()`
   (`src/governance/skills.ts:234,251`), surfaced at `GET /api/skills/catalog` +
   `POST /api/skills/catalog/:name/install` (`src/server.ts:2266,2270`), with an "Install / Installed"
   UI on the Skills page.
3. Pulled from a **remote GitHub repo** — `src/edge/skill-registry.ts` (trees API + `raw.githubusercontent.com`,
   zero-dep, owner/admin-gated, file-count/size capped), with featured `PRESET_SOURCES`.

So the console can present a *library of skills to import*, but there is no library of *agents* to import.
Getting a new agent in means: hand-author it, self-create it via the `agent_create` MCP tool, or import a
one-off **bundle** zip (`POST /api/agents/import`, `src/governance/bundle-import.ts`). All three produce
**one** agent; none is a browsable, curated, installable **catalog**.

**This plan builds that catalog** — and closes the loop by making the built-in fleet the catalog's first
entries instead of compiled-in strings.

## Design principle — compose two patterns we already ship

Nothing here is new infrastructure. It's the two proven skills-distribution patterns pointed at a new
payload (a whole agent bundle instead of a `SKILL.md` folder), reusing the importer we already have:

1. **Local bundled catalog** — exactly `SkillsStore.catalog()`/`install()` over `config/skills`. We add
   `config/agents/` as the software's read-only **agent** catalog and give `AgentStore` the same
   `catalog()` / `installFromCatalog(name)` pair.
2. **Remote registry** — exactly `skill-registry.ts` over a public GitHub repo. An agent library repo is
   a repo of bundle folders (`<agent-id>/{agent.json,CLAUDE.md,memory.jsonl,skills/,knowledge/}`) plus a
   small `library.json` index. Detection mirrors "any dir with a `SKILL.md`": **any dir with an
   `agent.json`** is an installable agent.

And the import itself is **already written**: `parseBundle()` + the sanitize/rebuild path behind
`POST /api/agents/import` (`src/server.ts`) turn one bundle into a live, governed agent — validating the
id, re-deriving `principal`/`policyContext`/`budget` with safe defaults, installing `skills/`, replaying
`memory.jsonl` and `knowledge/`, and auditing `agent.imported`. The catalog and registry are just
**sources that feed bytes into that same pipe.**

## The on-disk shape (aligns with the Claude Code marketplace standard)

The ecosystem has consolidated on the Claude Code *marketplace* format — a repo with
`.claude-plugin/marketplace.json` listing `plugins/<name>/` folders. We deliberately keep the agent-os
**bundle** as canonical (it is *richer* — it carries `memory.jsonl`, `knowledge/`, `budget`,
`policyContext`, `principal`, `shellSecrets`, which a plain Claude Code agent `.md` has nowhere to hold),
and treat marketplace-format as an **export/interop** target, not the source of truth. A bundled catalog
entry is just a bundle folder that lives in the software instead of a zip:

```
config/agents/                         # the software's read-only agent catalog
  library.json                         # registry index (the marketplace.json analogue)
  engineer/
    agent.json                         # manifest (id, description, category, icon, budget, model?…)
    CLAUDE.md                          # system prompt
    memory.jsonl                       # optional — seed memories (one JSON fact per line)
    skills/<name>/SKILL.md             # optional — bundled procedures
    knowledge/<section>/<slug>.md      # optional — seed KB pages
  support/ …  marketer/ …  researcher/ …  agent-author/ …
```

`library.json` is the browse index — one entry per agent, mirroring `marketplace.json`/`CatalogSkill`:

```json
{
  "name": "agent-os built-ins",
  "version": "1.0.0",
  "agents": [
    { "id": "engineer",  "category": "Engineering", "description": "…", "icon": "Code2",
      "keywords": ["code","debug","review"], "source": "./engineer" }
  ]
}
```

(It can be *generated* from the folders at build time so a catalog author never hand-syncs it — same
trick the wshobson marketplace uses.)

## The migration — built-ins become catalog data

This is the change that proves the catalog and deletes prompt strings from the codebase:

1. **Author `config/agents/<id>/`** for `engineer`, `support`, `marketer`, `researcher`, `agent-author`
   — `agent.json` + `CLAUDE.md` lifted verbatim out of `generalists.ts` / `agent-author.ts`.
2. **Reduce `ensureGeneralists`/`ensureAgentAuthor` to a catalog seed.** They keep their *contract* —
   "a fresh home boots with these five, idempotently, and user edits survive" — but the source of truth
   moves from string literals to `config/agents/<id>/`. Implementation becomes: on boot, for each
   **seed** id not already present in `<home>/agents/`, `installFromCatalog(id)`. (Keep the code entry
   points so callers/tests don't churn; they just delegate.)
3. **Net effect:** the same five agents ship, but now they are (a) editable data, (b) the first rows of
   a browsable catalog, and (c) removable/re-installable from the console like any other library agent.
   Prompts stop being TypeScript.

> Decision to make: is the built-in fleet **auto-seeded** on first boot (today's behaviour — a fresh
> home is useful immediately) or **install-on-demand** from the catalog (empty home, operator picks)?
> Recommend: keep auto-seed for the five built-ins (preserve the "useful the moment it boots" promise);
> everything *else* in the catalog is install-on-demand.

## Surface area

**Store** — `AgentStore` (or extend the kernel's agent registry) gains, mirroring `SkillsStore`:
- `catalog(): CatalogAgent[]` — read `config/agents/*/agent.json` (+ `library.json`), each flagged
  `installed` (does `<home>/agents/<id>/` exist?). `CatalogAgent` ≈ `CatalogSkill` (id, description,
  category, icon, keywords, installed).
- `installFromCatalog(id): AgentManifest` — deep-copy the catalog folder into `<home>/agents/<id>/`,
  then run it through the **same** sanitize/replay path as bundle import (skills, memories, knowledge),
  register live, audit `agent.installed { source: 'catalog' }`.

**Remote registry** — `src/edge/agent-registry.ts`, a near-clone of `skill-registry.ts`: list a public
repo via the trees API, detect installable agents (`agent.json` present), fetch bytes from
`raw.githubusercontent.com`, hand each folder to `parseBundle()` → the import path. Owner/admin only,
file-count/size capped, `PRESET_SOURCES` for a curated featured set. Audit `agent.installed { source:
'github:<repo>' }`.

**Routes** (copy the skills-catalog routes, agent nouns):
- `GET  /api/agents/catalog` — the bundled catalog (owner/admin).
- `POST /api/agents/catalog/:id/install` — install one built-in/catalog agent.
- `POST /api/agents/registry/install` — `{ repo, id? }` remote install (owner/admin).
- (existing `POST /api/agents/import` for one-off zips stays as-is — the manual lane.)

**Console** — an **Agent Library** view (cards: icon, name, category, description, Install / Installed),
next to the existing "Import bundle" button on the Agents page. Same component shape as the Skills
catalog list; a "From GitHub" input mirrors the skills remote-source UI.

## The differentiator — a *governed* library

Public agent marketplaces (2,500+ Claude Code registries; directories with 100–200+ subagents) compete
on breadth. agent-os's edge is that **every imported agent lands behind the gateway** — policy, budget
caps, `principal`, audit — and the importer already refuses secrets / absolute paths / `.claude/`
internals and re-derives every governance field with safe defaults rather than trusting the bundle. The
registries enterprises actually adopt are converging on exactly what agent-os has natively: eval
signals, a promotion lifecycle, supply-chain visibility, and **security scanning before publish**
(prompt-injection / secret-exfil / dangerous-command checks). Because agent-os owns the *runtime*, not
just the listing, it can offer a "verified, sandboxed on install" library no gallery can match. That is
the story to lead with, and the sanitize path in `bundle-import.ts` is its first brick.

## Phasing

- **Phase 1 — bundled catalog + migration (this doc's core).** `config/agents/` catalog, `AgentStore.catalog()`/
  `installFromCatalog()`, the two catalog routes, the Agent Library console view, and the five built-ins
  moved out of TypeScript into `config/agents/`. Self-contained, no new external surface, ships the whole
  "browse & import built-ins" experience.
- **Phase 2 — remote registry.** `agent-registry.ts` + `PRESET_SOURCES` + the "From GitHub" install lane.
  Reuses Phase 1's import path end-to-end; the only new code is repo listing/fetch (a clone of
  `skill-registry.ts`).
- **Phase 3 — interop & publish.** Marketplace-format **export** (`marketplace.json` + `plugins/`) and an
  A2A `/.well-known/agent-card.json` so an agent-os library is discoverable/consumable by the wider
  ecosystem; a **publish-with-scan** flow (the governed-library differentiator) that runs the security
  checklist before an agent is offered for install.

## Open decisions

1. **Format allegiance** — keep the agent-os bundle canonical + offer marketplace export (recommended:
   preserves budget/policy/principal the plugin format can't hold), or adopt `plugin.json`/`marketplace.json`
   as the on-disk truth (loses governance fields).
2. **Auto-seed vs install-on-demand** for the built-in five (recommended: auto-seed the five, on-demand
   for the rest — see the migration note).
3. **`library.json`: authored or generated** from the folders at build time (recommended: generated —
   no hand-sync).
4. **Registry trust** — do remote-installed agents require the Phase 3 scan before they can run, or is
   the existing sanitize path enough for Phase 2? (Recommended: sanitize is the Phase 2 floor; scan is a
   Phase 3 gate for a "verified" badge, not a hard block.)

## Touch points (reference)

| Concern | Skills (exists) | Agents (to build) |
|---|---|---|
| Bundled catalog dir | `config/skills` (`home.ts:87` `bundledSkills`) | `config/agents` (`home.ts:86` `bundledAgents`, today empty) |
| Catalog store methods | `SkillsStore.catalog()`/`install()` (`skills.ts:234,251`) | `AgentStore.catalog()`/`installFromCatalog()` |
| Catalog routes | `GET /api/skills/catalog`, `POST …/catalog/:name/install` (`server.ts:2266,2270`) | `GET /api/agents/catalog`, `POST …/catalog/:id/install` |
| Remote registry | `src/edge/skill-registry.ts` (GitHub trees API, `PRESET_SOURCES`) | `src/edge/agent-registry.ts` (clone) |
| One-off import | — | `parseBundle()` + `POST /api/agents/import` (`bundle-import.ts`, exists — reused) |
| Built-in provisioning | n/a | `ensureGeneralists`/`ensureAgentAuthor` (`kernel.ts:303-304`) → thin catalog seed |
| Manifest schema | `SKILL.md` frontmatter | `AgentManifest` (`types.ts:667-698`) |

See also `docs/procedural-skills-plan.md` (the skills-distribution patterns this mirrors) and
`web/src/docs/import-into-aos.md` (the bundle format).
