/**
 * `@deepseek-ai/dsh-qwen-mm/attachments` — image export, text-route
 * rewriting, and reminder injection through the pre-step waterfall.
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import * as Attachments from '@deepseek-ai/dsh-qwen-mm/attachments'

const signal = new AbortController().signal

function imageRef(id: string, mediaType: ImageAttachmentRef['mediaType'] = 'image/png'): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${id}` as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes: 4,
    width: 2,
    height: 2,
  }
}

function messageWithImage(id: string, mediaType?: ImageAttachmentRef['mediaType']): UserMessage {
  return createUserMessage({
    content: [{ type: 'image', attachment: imageRef(id, mediaType) }, { type: 'text', text: '看这张图' }],
    source: { kind: 'user' },
  })
}

function textMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function tempDir(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `dsh-${name}-`))
}

function stubAgent(options: { provider?: string; model?: string; header?: { provider: string; model: string } }): Agent {
  const session = Session.create(SessionId('attachments-agent'), [], { version: 0, id: SessionId('attachments-agent'), createdAt: 0, cwd: tmpdir() })
  const sessionWithHeader = Object.assign(session, {
    requestHeader: () => options.header === undefined ? undefined : { config: options.header },
  })
  return {
    ctx: new Context(),
    id: SessionId('attachments-agent'),
    options: options.provider === undefined ? {} : {
      provider: options.provider,
      ...(options.model === undefined ? {} : { model: options.model }),
    },
    session: sessionWithHeader,
    inbox: new Inbox(sessionWithHeader, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('attachment bridge helpers', () => {
  it('maps media types to deterministic file names', () => {
    expect(Attachments.exportFileName(imageRef('a'.repeat(64), 'image/png'))).toBe(`${'a'.repeat(64)}.png`)
    expect(Attachments.exportFileName(imageRef('b'.repeat(64), 'image/jpeg'))).toBe(`${'b'.repeat(64)}.jpg`)
    expect(Attachments.exportFileName(imageRef('c'.repeat(64), 'image/webp'))).toBe(`${'c'.repeat(64)}.webp`)
    expect(Attachments.exportFileName(imageRef('d'.repeat(64), 'image/gif'))).toBe(`${'d'.repeat(64)}.gif`)
  })

  it('exports unique image blocks, skipping existing files', async () => {
    const dir = await tempDir('attach-export')
    const written = new Set<string>()
    const reader = async (ref: ImageAttachmentRef) => {
      written.add(String(ref.attachmentId))
      return { data: new Uint8Array([1, 2, 3]) }
    }
    const messages = [messageWithImage('a'.repeat(64)), messageWithImage('a'.repeat(64)), messageWithImage('b'.repeat(64))]
    const exported = await Attachments.exportImages(reader, dir, messages, signal)
    expect(exported.map(file => file.id)).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(written).toEqual(new Set([`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`]))
    expect((await readFile(join(dir, `${'a'.repeat(64)}.png`))).length).toBe(3)
    // Re-export: existing files are not rewritten.
    const again = await Attachments.exportImages(reader, dir, messages, signal)
    expect(again).toHaveLength(2)
    expect(written.size).toBe(2)
  })

  it('rewrites image blocks into path references and passes other messages through', () => {
    const byId = new Map<string, string>([[`${'a'.repeat(64)}`, '/tmp/export/a.png']])
    const withImage = messageWithImage('a'.repeat(64))
    const plain = textMessage('hello')
    const [rewritten, untouched] = Attachments.rewriteMessages([withImage, plain], byId)
    if (rewritten === undefined) throw new Error('expected a rewritten message')
    expect(rewritten.content).toEqual([
      { type: 'text', text: `[Image attachment exported to: /tmp/export/a.png]` },
      { type: 'text', text: '看这张图' },
    ])
    expect(untouched).toBe(plain)
  })

  it('renders a missing-path marker when no export exists for an id', () => {
    const [rewritten] = Attachments.rewriteMessages([messageWithImage('b'.repeat(64))], new Map())
    expect(rewritten?.content[0]).toEqual({ type: 'text', text: '[Image attachment exported to: <missing>]' })
  })

  it('renders the reminder verbatim with exported paths', () => {
    const text = Attachments.renderReminder([
      { id: 'a'.repeat(64), path: '/tmp/export/a.png' },
      { id: 'b'.repeat(64), path: '/tmp/export/b.png' },
    ])
    expect(text).toContain('<system-reminder>')
    expect(text).toContain('mcp__qwen-mm-plugins-api__vision_chat')
    expect(text).toContain('mcp__qwen-mm-plugins-core__read_image')
    expect(text).toContain('- /tmp/export/a.png')
    expect(text).toContain('- /tmp/export/b.png')
    expect(text.endsWith('</system-reminder>')).toBe(true)
  })
})

describe('route modality resolution', () => {
  const textOnly = { resolveModelInfo: async () => ({ inputModalities: ['text'] }) }
  const imageCapable = { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }
  const unresolvable = { resolveModelInfo: async () => { throw new Error('no adapter') } }

  it('detects image-capable routes from the session header', async () => {
    const agent = stubAgent({ header: { provider: 'pi-ai', model: 'qwen-vl' } })
    await expect(Attachments.routeSupportsImage(imageCapable as never, agent, signal)).resolves.toBe(true)
  })

  it('detects text-only routes from agent options', async () => {
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    await expect(Attachments.routeSupportsImage(textOnly as never, agent, signal)).resolves.toBe(false)
  })

  it('treats an unresolvable route as text-only', async () => {
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    await expect(Attachments.routeSupportsImage(unresolvable as never, agent, signal)).resolves.toBe(false)
  })

  it('treats a route without declared modalities as text-only', async () => {
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    const noModalities = { resolveModelInfo: async () => ({}) }
    await expect(Attachments.routeSupportsImage(noModalities as never, agent, signal)).resolves.toBe(false)
  })

  it('returns false without a resolvable provider or model', async () => {
    const agent = stubAgent({})
    await expect(Attachments.routeSupportsImage(textOnly as never, agent, signal)).resolves.toBe(false)
  })
})

describe('attachment bridge plugin', () => {
  async function setup(exportDir: string, llm: { resolveModelInfo: () => Promise<{ inputModalities: string[] }> }): Promise<{ ctx: Context; imageBytes: Uint8Array }> {
    const ctx = new Context()
    const imageBytes = new Uint8Array([9, 8, 7])
    ctx.provide('attachments', { readImage: async () => ({ ref: imageRef('a'.repeat(64)), data: imageBytes }), registerImageIntakeConsumer: () => () => {}, hasImageIntakeConsumer: () => false } as never)
    ctx.provide('agents', {} as never)
    ctx.provide('llm', llm as never)
    await ctx.plugin(Attachments, { exportDir })
    return { ctx, imageBytes }
  }

  async function firePreStep(ctx: Context, agent: Agent, messages: UserMessage[]): Promise<{ kind: 'enter'; messages: UserMessage[] } | { kind: 'reject' }> {
    return await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages, turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages }),
    )
  }

  it('exports and rewrites images on a text-only route, appending a reminder', async () => {
    const dir = await tempDir('attach-plugin')
    const { ctx } = await setup(dir, { resolveModelInfo: async () => ({ inputModalities: ['text'] }) })
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    const imageMessage = messageWithImage('a'.repeat(64))
    const decision = await firePreStep(ctx, agent, [imageMessage, textMessage('普通文字')])
    if (decision.kind !== 'enter') throw new Error('expected enter decision')
    const [rewritten, plain, reminder] = decision.messages
    if (rewritten === undefined || plain === undefined || reminder === undefined) throw new Error('expected three messages')
    expect(rewritten.content[0]).toEqual({ type: 'text', text: `[Image attachment exported to: ${join(dir, `${'a'.repeat(64)}.png`)}]` })
    expect(plain.content).toEqual([{ type: 'text', text: '普通文字' }])
    expect(reminder.content[0]?.type).toBe('text')
    expect((reminder.content[0] as { text: string }).text).toContain(join(dir, `${'a'.repeat(64)}.png`))
  })

  it('leaves messages untouched on an image-capable route', async () => {
    const dir = await tempDir('attach-plugin-image')
    const { ctx } = await setup(dir, { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) })
    const agent = stubAgent({ provider: 'pi-ai', model: 'qwen-vl' })
    const imageMessage = messageWithImage('a'.repeat(64))
    const decision = await firePreStep(ctx, agent, [imageMessage])
    if (decision.kind !== 'enter') throw new Error('expected enter decision')
    expect(decision.messages[0]?.content[0]).toEqual({ type: 'image', attachment: imageRef('a'.repeat(64)) })
  })

  it('passes a downstream reject through untouched', async () => {
    const dir = await tempDir('attach-plugin-reject')
    const { ctx } = await setup(dir, { resolveModelInfo: async () => ({ inputModalities: ['text'] }) })
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [messageWithImage('a'.repeat(64))], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'reject' }),
    )
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('leaves a text-only step untouched when no message carries an image', async () => {
    const dir = await tempDir('attach-plugin-plain')
    const { ctx } = await setup(dir, { resolveModelInfo: async () => ({ inputModalities: ['text'] }) })
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    const plain = textMessage('普通文字')
    const decision = await firePreStep(ctx, agent, [plain])
    if (decision.kind !== 'enter') throw new Error('expected enter decision')
    expect(decision.messages).toEqual([plain])
  })

  it('falls back to the default export dir when config omits it', async () => {
    const ctx = new Context()
    ctx.provide('attachments', { readImage: async () => ({ ref: imageRef('a'.repeat(64)), data: new Uint8Array([1]) }), registerImageIntakeConsumer: () => () => {}, hasImageIntakeConsumer: () => false } as never)
    ctx.provide('agents', {} as never)
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }) } as never)
    await ctx.plugin(Attachments, {})
    const agent = stubAgent({ provider: 'deepseek', model: 'deepseek-chat' })
    const decision = await firePreStep(ctx, agent, [textMessage('no image')])
    if (decision.kind !== 'enter') throw new Error('expected enter decision')
    expect(decision.messages).toHaveLength(1)
  })

  it('registers an image-intake consumer on apply', async () => {
    const dir = await tempDir('attach-plugin-consumer')
    const ctx = new Context()
    let registered: string | undefined
    let disposed = false
    ctx.provide('attachments', {
      readImage: async () => ({ ref: imageRef('a'.repeat(64)), data: new Uint8Array([1]) }),
      registerImageIntakeConsumer: (plugin: string) => {
        registered = plugin
        return () => { disposed = true }
      },
      hasImageIntakeConsumer: () => registered !== undefined,
    } as never)
    ctx.provide('agents', {} as never)
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }) } as never)
    await ctx.plugin(Attachments, { exportDir: dir })
    expect(registered).toBe('qwen-mm-attachments')
    await ctx.fiber.dispose()
    expect(disposed).toBe(true)
  })
})
