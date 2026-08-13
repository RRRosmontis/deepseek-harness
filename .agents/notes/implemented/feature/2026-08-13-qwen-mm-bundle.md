# Agent Note: Qwen-MM-Plugins integration bundle

Status: implemented

English | [中文](2026-08-13-qwen-mm-bundle.zh.md)

## Problem

Qwen-MM-Plugins makes agent harnesses multimodal-native through per-capability `SKILL.md` files plus stdio MCP servers, but its installer does not target DeepSeek Harness: the upstream project keeps dsh on a hand-edited manual path (profile `cordis.patch.yml` rows plus a checkout-copied skill). A dsh user gets no skills catalog, no MCP rows, and no update story from one install. Separately, the `dsh-mcp-client` bridge replaces media blocks with placeholders, so media returned by MCP tools cannot reach a text-only DeepSeek model.

## Decision

**Ship one installable bundle, `@deepseek-ai/dsh-qwen-mm`, under `packages/bundle/qwen-mm`.** Its patch inserts one `qwen-mm` plugin row and seven `mcp-qwen-mm-<capability>` rows, so `dsh plugin --profile <name> add @deepseek-ai/dsh-qwen-mm` enables every capability at once; `edu-agent` contributes a skill only, mirroring upstream.

**Vendor the eight capability skills as a bundled skill provider.** `assets/skills/` holds the `SKILL.md` bodies stripped of frontmatter, pinned to the upstream release tags the MCP rows install (`qwen-mm-plugins-<cap>-v<version>`). `src/skills.ts` hardcodes the catalog (name and description taken verbatim from the pinned frontmatter) and reads bodies from the packaged assets, following the `dsh-skill-badge` provider template: one immutable candidate per skill, `BUNDLED_SKILL_RANK`, `source: 'bundled'`, directory `resourceBase`. The README documents the refresh procedure; the vendored Apache-2.0 content stays attributed.

**Mount the MCP servers with static patch rows, not programmatic mounting.** Each row is an in-box `@deepseek-ai/dsh-mcp-client` instance with `serverName: qwen-mm-plugins-<cap>`, `uvx` stdio transport, and the pinned git ref; rows appear in `--dump-config` and users disable a capability by id in their profile patch. The bridge is reused unchanged — this note makes no `dsh-mcp-client` change.

**Declare the patch-referenced bridge as a dependency.** `@deepseek-ai/dsh-mcp-client` sits in `dependencies` so an out-of-tree install resolves it even where in-box resolution is not available, matching how `dsh-headless` lists the packages its rows mount.

## Alternatives considered

**Register MCP servers programmatically from one configurable plugin.** Rejected: static rows match the `dsh-base`/`dsh-headless` bundle precedent, stay visible and individually overridable, and avoid dynamic `ctx.plugin()` mounting of a config-ful plugin from inside a plugin.

**Discover skills from a Qwen-MM-Plugins checkout instead of vendoring.** Rejected: the bundle would not be self-contained, skill availability would depend on a user checkout, and catalog metadata would need runtime frontmatter parsing.

**Make the bridge pass media blocks through to the model.** Rejected for this change: the DeepSeek provider is text-only, so the passthrough would have no consumer; it remains deferred upstream and documented as a known limitation.

## Consequences

One `dsh plugin add` gives a profile the full skill catalog and all server tools; each enabled capability spawns one `uvx` process at boot (cached after first run), and a failing server activates its row with no tools under the bridge's default. Skills are pinned to upstream tags and need the documented refresh when upstream releases. Text-returning tools (`visualize`, `media_info`, vision/OCR/ASR answers, search) are fully usable; media-returning tools are limited by the bridge's placeholder projection, recorded in the package README's Model Experience and Known Limitations. Credentials must live in the upstream shared config file because the bridge scrubs credential-like child environments.
