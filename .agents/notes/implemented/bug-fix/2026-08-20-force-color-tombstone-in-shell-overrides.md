# Agent Note: Shell env overrides tombstone an ambient FORCE_COLOR

Status: implemented

English | [中文](2026-08-20-force-color-tombstone-in-shell-overrides.zh.md)

## Problem

Node ignores `NO_COLOR` whenever `FORCE_COLOR` is also set, keeps colors on, and prints a warning naming the conflict to stderr. `dsh-bash-local` and `dsh-pwsh-local` set `NO_COLOR: '1'` in `ENV_OVERRIDES` to keep tool output free of escape sequences, but merged it over an inherited environment that still carried any ambient `FORCE_COLOR`. A `dsh` launched from a color-forcing terminal therefore returned escape sequences plus two warning lines for every Node-based command the model ran, defeating the stated purpose of the overrides and making model-visible tool output depend on the launching environment.

The same conflict failed `scripts/oxlint-contract.spec.ts`, whose two spawn helpers built their env the same way and assert an empty stderr from a successful `--fix` run. That failure is deterministic on any host exporting `FORCE_COLOR` — which includes the agent harnesses this repository recommends for development — and invisible in CI, which does not set it.

The recorded keyless snapshot corpus was unaffected: it holds no escape sequences and no warning text. Three acp-agent scenarios (`bash-spill`, `code-mode-read-image`, `cancel-tool-calls`) run `node -e` through the shell, so re-recording from a color-forcing terminal would have written both artifacts into the expected output of the tier that exists to pin model-visible bytes.

## Decision

Both `ENV_OVERRIDES` tables carry `FORCE_COLOR: undefined` beside `NO_COLOR: '1'`. `childEnv()` already defines a present key holding `undefined` as a tombstone that removes an ordinary ambient entry, so the child sees no `FORCE_COLOR` at all rather than a competing value.

`scripts/oxlint-contract.spec.ts` hoists one `inheritedEnv` base with `FORCE_COLOR` deleted and shares it between both spawn helpers, keeping the empty-stderr assertion: clean output channels on a successful fix are the contract under test.

## Alternatives considered

**Relax the spec's empty-stderr assertion.** Rejected because it asserts a real contract and the pollution was environmental; weakening it would hide the product defect the same conflict causes.

**Set `FORCE_COLOR: '0'` rather than a tombstone.** Rejected although it is sufficient for Node, which treats `0` as "no color" and issues no warning. It leaves the variable set, and tools that test only for presence still force color, so the tombstone is the stronger guarantee and reuses vocabulary `childEnv()` already owns.

**Drop `FORCE_COLOR` inside `scrubbedParentEnv()`.** Rejected because that function owns credential-shaped names and the `DSH_` prefix. Color policy belongs to the shell backends that declare it, and a subprocess consumer that deliberately wants inherited color keeps it.

## Consequences

Tool output for Node-based commands is now independent of the launching terminal, which is what `ENV_OVERRIDES` claimed and did not deliver. A caller that passes its own `FORCE_COLOR` through `spec.env` or `spec.dshEnv` still wins, because the overrides merge first.

`dsh-pwsh-local` is a call-for-call mirror of `dsh-bash-local`, so the tombstone lands in both or the two drift. Each side carries a test that fails without it: bash asserts through a real command that the child sees no `FORCE_COLOR` while `NO_COLOR` survives, and pwsh asserts the tombstone on the captured spawn spec, which runs on hosts with no `pwsh` installed.
