# @deepseek-ai/dsh-qwen-mm

English | [中文](README.zh.md)

Bundle integrating [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) (Apache-2.0) into a DeepSeek Harness profile. It ships the eight upstream capability skills as a bundled skill provider and mounts the seven server capabilities as `@deepseek-ai/dsh-mcp-client` rows, so one `dsh plugin` install makes the model multimodal-aware over local media, cloud Qwen VL/Omni APIs, web search, video memory/editing, Blender, and FreeCAD. `edu-agent` is skill-only upstream and has no MCP server.

## Install

Prerequisite: [`uv`](https://docs.astral.sh/uv/) (provides `uvx`, which runs each capability's MCP server on demand).

```sh
dsh plugin --profile web add @deepseek-ai/dsh-qwen-mm
```

Or from a git host (pin a commit) or a local checkout. Then restart `dsh --profile web` and open a new session. The bundle patch inserts the `qwen-mm` skill-provider row and seven `mcp-qwen-mm-<capability>` rows; `--dump-config` shows them.

### Credentials

The MCP bridge scrubs credential-like variables from child environments, so write provider keys to the upstream shared config instead of the environment:

```sh
curl -fsSL https://raw.githubusercontent.com/QwenLM/Qwen-MM-Plugins/main/install.sh | bash -s -- configure
```

`core` works without any key. `api`/`video-memory`/`video-edit`/`edu-agent` need a DashScope key; `search` needs Serper, Exa, or Tavily. System applications (ffmpeg, LibreOffice, Chromium, Blender, FreeCAD) are needed only by the capabilities that call them.

## Usage

Reference a file and ask naturally; the matching skill routes to the right MCP tool:

```text
@report.pdf          Summarize page 3 and extract its table.
@meeting.mp4         Transcribe this with speaker labels and timestamps.
@place.jpg           Identify where this photo was taken and verify it on the web.
```

The model sees the skills in its skill catalog and the tools under server-qualified names (`mcp__qwen-mm-plugins-core__read_image`, …).

## Dragged images

Dropping or pasting an image into the Web composer exports it to `<dshHome>/qwen-mm/attachments/` and, on text-only model routes (the DeepSeek route), rewrites the message's image into a path reference plus a guidance reminder, so the model reads the picture through the qwen-mm MCP tools (`mcp__qwen-mm-plugins-api__vision_chat` for cloud understanding, `mcp__qwen-mm-plugins-core__read_image` for local reading). Image-capable routes keep the native image block and read it directly; the bridge does not touch them.

- The default export dir is `<dshHome>/qwen-mm/attachments`; override it with `config.exportDir` on the `qwen-mm-attachments` row.
- The rewritten user message shows `[Image attachment exported to: <path>]` in history; the original bytes stay content-addressed in the attachment store, and the exported copy is a plain file any qwen-mm MCP tool can read.
- Disable the bridge by id in the profile patch (`- id: qwen-mm-attachments` plus `disabled: true`) to keep native image blocks on every route.

The bridge also registers an image-intake consumer on `ctx.attachments`, so the host admits image uploads on a text-only route while the bridge is active (and keeps rejecting them when it is disabled).

## Capabilities

| Skill | MCP server row | Upstream tag | Requires |
|---|---|---|---|
| `qwen-mm-plugins-core` | `mcp-qwen-mm-core` | `qwen-mm-plugins-core-v1.0.1` | ffmpeg for media; app per format |
| `qwen-mm-plugins-api` | `mcp-qwen-mm-api` | `qwen-mm-plugins-api-v1.0.2` | DashScope |
| `qwen-mm-plugins-search` | `mcp-qwen-mm-search` | `qwen-mm-plugins-search-v1.0.2` | Serper / Exa / Tavily |
| `qwen-mm-plugins-video-memory` | `mcp-qwen-mm-video-memory` | `qwen-mm-plugins-video-memory-v1.0.1` | DashScope + ffmpeg |
| `qwen-mm-plugins-video-edit` | `mcp-qwen-mm-video-edit` | `qwen-mm-plugins-video-edit-v1.0.1` | DashScope + ffmpeg + Node/Chromium |
| `qwen-mm-plugins-blender` | `mcp-qwen-mm-blender` | `qwen-mm-plugins-blender-v1.0.1` | Blender (+ Xvfb headless) |
| `qwen-mm-plugins-freecad` | `mcp-qwen-mm-freecad` | `qwen-mm-plugins-freecad-v1.0.1` | FreeCAD (+ CalculiX for FEM) |
| `qwen-mm-plugins-edu-agent` | — (skill-only) | `qwen-mm-plugins-edu-agent-v1.0.1` | Node/Chromium + ffmpeg + DashScope |

Disable an unwanted capability in your profile's `cordis.patch.yml` by row id:

```yaml
- id: mcp-qwen-mm-blender
  disabled: true
```

## Vendored skills

`assets/skills/` holds the eight `SKILL.md` bodies stripped of frontmatter, pinned to the upstream release tags in the table above. Refreshing a capability means replacing its asset file with the body from the same tag the MCP row pins, then updating the matching `SKILL_ENTRIES` description in `src/skills.ts` if the frontmatter changed. The pinned content is vendored from the Apache-2.0 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) repository; upstream retains its copyright and license, and the MCP commands install the same tagged releases from the upstream git repository at runtime.

## Model Experience

### Skill catalog

#### What the model sees

The eight `qwen-mm-plugins-*` skills appear in the session skill catalog with the vendored frontmatter descriptions. Loading one injects its full instruction body — capability routing, tool-selection guidance, and prerequisites — into the request context through the `skill` tool.

#### Token effect

Eight catalog entries add a fixed description cost at the first model step of a session that observes a non-empty catalog; bodies are zero-cost until loaded, then retained until compaction.

#### KV Cache effect

The catalog message is append-only and prefix-stable while the eight entries are unchanged. Loaded bodies follow the reusable request prefix and do not invalidate existing cache entries.

### MCP tools

#### What the model sees

Each mounted server publishes its tools as `mcp__qwen-mm-plugins-<capability>__<tool>` with the server-provided description and input schema. Text results (vision/OCR/ASR answers, extracted documents, search results) are retained in history.

#### Token effect

Data-dependent schema cost is paid on every request while a server's tools are registered. Text results are retained until compaction; binary media returned by a server is not added to context.

#### KV Cache effect

Prefix-stable while the discovered tool set and schemas are unchanged. A re-sync that changes a tool replaces definitions and may invalidate reuse from the first changed schema token.

### Attachment bridge

#### What the model sees

On a text-only route, each step claiming a user message with image blocks receives a rewritten user message whose image blocks became `[Image attachment exported to: <path>]` text, plus one appended `<system-reminder>` naming the exported paths and the qwen-mm MCP tools that read them. The model reads the picture by calling those tools with the paths.

#### Token effect

The rewrite replaces image blocks with short path text (zero bytes for the media itself). The reminder adds one line per exported file, retained until compaction.

#### KV Cache effect

Append-only per new attachment; the reminder follows the reusable request prefix and does not invalidate existing cache entries. Re-exporting the same attachment is idempotent and emits no new message.

## Known Limitations and Deferred Work

- **Media returned by MCP tools is discarded from model context.** The `dsh-mcp-client` bridge projects image, audio, and resource blocks as placeholders, so `read_image`/`read_video` payloads cannot reach a text-only DeepSeek model; text-returning tools (`visualize`, `media_info`, vision/OCR/ASR answers, search) work fully. Rich multimedia projection is deferred upstream, and genuine multimodal input needs an image-capable LLM backend.
- **Dragged images are rewritten to path text on text-only routes.** The in-chat thumbnail is replaced by the exported-path note (the file stays on disk and in the attachment store); the bridge is disabled on image-capable routes, which read the block natively.
- **Every server capability boots at profile start.** Each `mcp-qwen-mm-*` row spawns a uvx process (cached after first run); a missing `uvx` or a failing server activates the row with no tools (the bridge's default), leaving per-capability disable to the user patch shown above.
- **Vendored skills and MCP refs are pinned, not live.** Refresh both together as documented; upstream tags are immutable, so a newer release requires the manual refresh procedure.
- **`edu-agent` contributes a skill only.** It needs its own Node/Chromium + DashScope setup and has no MCP row in this bundle.
