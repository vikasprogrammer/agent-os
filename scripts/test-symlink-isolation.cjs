#!/usr/bin/env node
/**
 * Unit test for `externalSymlinkAbsoluteTarget` — decides whether a copied agent symlink escapes the
 * agent dir (the shared tool bundle) and, if so, the absolute target to repoint it at so it survives the
 * per-member copy under uid isolation. Run: node scripts/test-symlink-isolation.cjs
 */
const path = require('path');
const assert = require('assert');
const { externalSymlinkAbsoluteTarget } = require(path.join(__dirname, '..', 'dist/edge/launcher'));

const SRC = '/srv/aos/data/agents/billing-ops';
let pass = 0;
const eq = (got, want, label) => { assert.strictEqual(got, want, `FAIL ${label}: got ${got}`); pass++; console.log('  ok  ' + label); };

// Shared-bundle symlinks (the real case) → rewrite to absolute, resolved against the source.
eq(externalSymlinkAbsoluteTarget(SRC, 'iwp', '../../tools/iwp'), '/srv/aos/data/tools/iwp', 'iwp → absolute bundle path');
eq(externalSymlinkAbsoluteTarget(SRC, 'tools', '../../tools/tools'), '/srv/aos/data/tools/tools', 'tools/ dir symlink → absolute');
eq(externalSymlinkAbsoluteTarget(SRC, 'eng-repo', '../../tools/eng-repo'), '/srv/aos/data/tools/eng-repo', 'eng-repo → absolute');

// Absolute link → leave alone.
eq(externalSymlinkAbsoluteTarget(SRC, 'iwp', '/opt/tools/iwp'), null, 'already-absolute → null');

// In-tree relative link (stays valid after the copy) → leave alone.
eq(externalSymlinkAbsoluteTarget(SRC, '.claude/skills/x', '../../CLAUDE.md'), null, 'in-tree link (resolves inside agent dir) → null');
eq(externalSymlinkAbsoluteTarget(SRC, 'a/b', '../c'), null, 'in-tree sibling link → null');

// Degenerate: link to the agent dir itself → treated as in-tree (null).
eq(externalSymlinkAbsoluteTarget(SRC, 'self', '.'), null, 'link to agent dir itself → null');

console.log(`\nsymlink-isolation: ${pass}/7 checks passed`);
process.exit(0);
