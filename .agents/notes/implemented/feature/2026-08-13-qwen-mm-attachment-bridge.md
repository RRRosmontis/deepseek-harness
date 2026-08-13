# Agent Note: Qwen-MM image attachment bridge

Status: implemented

English | [中文](2026-08-13-qwen-mm-attachment-bridge.zh.md)

## Problem

The Web composer accepts dragged and pasted images, which the host commits to the content-addressed attachment store and logs as durable `ImageBlock` references. On the shipped DeepSeek route — which declares `inputModalities: ['text']` — the adapter explicitly rejects image content (`UNSUPPORTED_CONTENT`), so any image-bearing user message makes the next request fail. Users could not attach an image and have the text-only model understand it, even though the qwen-mm MCP tools (`vision_chat`, `read_image`) can read any local file when given a path.

## Decision

**Ship a second plugin in the `@deepseek-ai/dsh-qwen-mm` bundle: `qwen-mm-attachments` (module `@deepseek-ai/dsh-qwen-mm/attachments`).** Its patch row sits beside the skill-provider row and the MCP server rows.

**At `agent/pre-step`, on text-only routes only, the bridge exports every image block to `<dshHome>/qwen-mm/attachments/` and rewrites the step's messages.** It awaits the waterfall first and leaves `reject` untouched; it resolves the route through the session request header or agent options and `llm.resolveModelInfo`, skipping image-capable routes entirely. `ctx.attachments.readImage` provides the verified bytes; files are named `<sha256-hex>.<ext>` by media type, written with `wx` after a same-name existence check, so re-exporting the same attachment is idempotent and content-addressed naming never collides. The rewritten user message replaces each image block with `[Image attachment exported to: <path>]` text, and one appended `<system-reminder>` names the exported paths and the two qwen-mm MCP tools that read them.

**The rewrite is a plugin-level projection, not a core change.** It happens in the `agent/pre-step` decision, which is what the loop logs as `user/message`; `deriveMessages()` therefore replays text-only history and the DeepSeek serializer never sees an image block. Image-capable routes never enter the rewrite path and keep the native block.

**The bridge advertises itself to the host image-intake gate.** `AttachmentStore` gains a small registry (`registerImageIntakeConsumer` / `hasImageIntakeConsumer`); the bridge registers at apply and unregisters on disposal. The host `prompt` handler admits images on a text-only route only when the model declares `image` input or at least one consumer is registered, so uploading works with the bridge active and stays rejected when it is disabled. This is the one core change — one condition in the host gate plus the attachment-service registry — while the model-switch gate over existing image history stays strict, because the bridge rewrites only newly claimed messages, not logged history.

## Alternatives considered

**Project at the request boundary instead of the log.** Rejected: `deriveMessages()` has no plugin hook, and changing it means agent-loop core work plus an architecture-doc update; the pre-step decision already controls exactly what the loop logs.

**Keep the image block in history and strip it only in the adapter.** Rejected: the DeepSeek adapter's `assertTextOnly` is the explicit modality enforcement, and a wrapper adapter is disproportionate for one bundle feature.

**Always export, never rewrite (path note only as an injected reminder).** Rejected: the unrewritten image block would still reach the text adapter and fail the request, so the rewrite is required for the feature to work at all.

## Consequences

On the DeepSeek route, dragging an image now works: the file lands in `<dshHome>/qwen-mm/attachments/`, the message history shows the path reference instead of the thumbnail (the bytes remain in the attachment store), and the model reads the picture by calling `mcp__qwen-mm-plugins-api__vision_chat` or `mcp__qwen-mm-plugins-core__read_image` with the path. Image-capable routes (pi-ai with a vision model) are untouched. The export dir is configurable via the row's `config.exportDir`, and the whole bridge can be disabled by row id. The in-chat thumbnail tradeoff on text routes is documented in the package README's Model Experience and Known Limitations.
