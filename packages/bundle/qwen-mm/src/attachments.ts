/**
 * Qwen-MM image attachment bridge: exports user-attached images to local
 * files and, on text-only model routes, rewrites the image blocks into
 * path-reference text so the model can read them through the qwen-mm MCP
 * tools (`mcp__qwen-mm-plugins-api__vision_chat`,
 * `mcp__qwen-mm-plugins-core__read_image`). Image-capable routes keep the
 * blocks untouched and read them natively.
 *
 * @module @deepseek-ai/dsh-qwen-mm/attachments
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { TextBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'qwen-mm-attachments'
/** Services required by the bridge. */
export const inject = ['attachments', 'agents', 'llm']

/** Bridge configuration. */
export interface Config {
  /** Directory exported image files land in; defaults to `<dshHome>/qwen-mm/attachments`. */
  readonly exportDir?: string
}

/** Config schema for the loader; an omitted `exportDir` falls back to `<dshHome>/qwen-mm/attachments`. */
export const Config: Schema<Config> = z.object({
  exportDir: z.string(),
})

const MEDIA_EXT: Record<ImageAttachmentRef['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** One exported image file. */
export interface ExportedImage {
  /** Content-addressed attachment id with any `sha256:` scheme stripped. */
  readonly id: string
  /** Absolute path of the exported file. */
  readonly path: string
}

/** Bytes reader abstraction, kept separate so tests can inject a fake. */
export type ImageReader = (
  ref: ImageAttachmentRef,
  signal: AbortSignal,
) => Promise<{ readonly data: Uint8Array }>

/**
 * Deterministic on-disk name for one attachment: `<sha256-hex>.<ext>`.
 * Content addressing makes the name stable, so re-exporting the same image
 * is idempotent and never duplicates a file.
 * @param ref - the durable image reference.
 * @returns the file name for the exported copy.
 */
export function exportFileName(ref: ImageAttachmentRef): string {
  const id = String(ref.attachmentId).replace(/^sha256:/, '')
  return `${id}.${MEDIA_EXT[ref.mediaType]}`
}

/**
 * Export every image block in the messages to `exportDir`, returning the
 * exported files in first-seen order. Existing files are skipped (idempotent
 * by content addressing).
 * @param reader - reads one attachment's verified bytes.
 * @param exportDir - destination directory; created on first write.
 * @param messages - the claimed user messages scanned for image blocks.
 * @param signal - the current step's abort signal.
 * @returns the exported files, one per unique image block.
 */
export async function exportImages(
  reader: ImageReader,
  exportDir: string,
  messages: readonly UserMessage[],
  signal: AbortSignal,
): Promise<ExportedImage[]> {
  const exported: ExportedImage[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'image') continue
      const id = String(block.attachment.attachmentId).replace(/^sha256:/, '')
      if (seen.has(id)) continue
      seen.add(id)
      const file = exportFileName(block.attachment)
      const path = join(exportDir, file)
      try {
        await access(path)
      } catch {
        const { data } = await reader(block.attachment, signal)
        signal.throwIfAborted()
        await mkdir(exportDir, { recursive: true })
        await writeFile(path, data, { flag: 'wx' })
      }
      exported.push({ id, path })
    }
  }
  return exported
}

/**
 * Rewrite messages, replacing each image block with a text block naming its
 * exported path, so a text-only route never receives an image block.
 * @param messages - the messages to rewrite.
 * @param pathById - exported path per stripped attachment id.
 * @returns rewritten copies for messages that contained images; other
 *   messages pass through unchanged.
 */
export function rewriteMessages(
  messages: readonly UserMessage[],
  pathById: ReadonlyMap<string, string>,
): UserMessage[] {
  return messages.map(message => {
    if (!message.content.some(block => block.type === 'image')) return message
    const content = message.content.map(block => {
      if (block.type !== 'image') return block
      const id = String(block.attachment.attachmentId).replace(/^sha256:/, '')
      const path = pathById.get(id)
      const text: TextBlock = { type: 'text', text: `[Image attachment exported to: ${path ?? '<missing>'}]` }
      return text
    })
    return createUserMessage({ content, source: message.source })
  })
}

/**
 * Render the injected guidance reminder naming the exported files and the
 * qwen-mm MCP tools that read them.
 * @param files - the exported image files.
 * @returns the verbatim `<system-reminder>` body.
 */
export function renderReminder(files: readonly ExportedImage[]): string {
  return [
    '<system-reminder>',
    'Images in the user\'s latest message were exported to local files because the active model route is text-only. Read them through the qwen-mm MCP tools: call `mcp__qwen-mm-plugins-api__vision_chat` with `images: ["<path>"]` to understand a picture via cloud Qwen VL, or `mcp__qwen-mm-plugins-core__read_image` with `image_path: "<path>"` for local reading. Exported files:',
    ...files.map(file => `- ${file.path}`),
    '</system-reminder>',
  ].join('\n')
}

/**
 * Whether the agent's route declares image input. An unresolvable route is
 * treated as text-only so the bridge still exports and rewrites.
 * @param llm - the LLM service resolving route metadata.
 * @param agent - the agent whose route is inspected.
 * @param signal - the current step's abort signal.
 * @returns true when the route declares `image` input modality.
 */
export async function routeSupportsImage(
  llm: LlmRuntime,
  agent: Agent,
  signal: AbortSignal,
): Promise<boolean> {
  const header = agent.session.requestHeader()
  const provider = header?.config.provider ?? agent.options.provider
  const model = header?.config.model ?? agent.options.model
  if (provider === undefined || model === undefined) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    return info.inputModalities?.includes('image') ?? false
  } catch {
    return false
  }
}

/** Register the attachment bridge: export images and rewrite them on text-only routes. */
export function apply(ctx: Context, config: Config): void {
  const exportDir = config.exportDir ?? join(resolveDshHome(), 'qwen-mm', 'attachments')
  // Advertise to the host image-intake gate that this plugin consumes image
  // blocks, so uploads are admitted on text-only routes and rewritten here.
  ctx.effect(() => ctx.attachments.registerImageIntakeConsumer(name))
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (await routeSupportsImage(ctx.llm, agent, signal)) return decision
    const exported = await exportImages(
      (ref, sig) => ctx.attachments.readImage(ref, sig),
      exportDir,
      messages,
      signal,
    )
    if (exported.length === 0) return decision
    const pathById = new Map(exported.map(file => [file.id, file.path]))
    const rewritten = rewriteMessages(decision.messages, pathById)
    const reminder = createUserMessage({
      content: [{ type: 'text', text: renderReminder(exported) }],
      source: { kind: 'plugin', plugin: 'qwen-mm' },
    })
    return { kind: 'enter', messages: [...rewritten, reminder] }
  })
}
