/**
 * `@deepseek-ai/dsh-qwen-mm` — bundled provider registration, vendored
 * catalog integrity, and the bundle patch's MCP server rows.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import * as QwenMm from '@deepseek-ai/dsh-qwen-mm'
import { SKILL_ENTRIES, provider } from '../src/skills.ts'

const PATCH_URL = new URL('../cordis.patch.yml', import.meta.url)
const ASSET_DIR = fileURLToPath(new URL('../assets/skills/', import.meta.url))

/** Distinctive marker each vendored skill body must contain. */
const BODY_MARKERS: Readonly<Record<string, string>> = {
  'qwen-mm-plugins-core': 'read_image',
  'qwen-mm-plugins-api': 'vision_chat',
  'qwen-mm-plugins-search': 'web_search',
  'qwen-mm-plugins-video-memory': 'Graph Memory',
  'qwen-mm-plugins-video-edit': 'Video Edit',
  'qwen-mm-plugins-blender': 'execute_blender_code',
  'qwen-mm-plugins-freecad': 'FreeCAD',
  'qwen-mm-plugins-edu-agent': 'Math Tutorial Video Generator',
}

describe('dsh-qwen-mm plugin', () => {
  it('registers and disposes the bundled skill provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(QwenMm)

    const listed = await ctx.skills.list()
    expect(listed.map(skill => skill.name)).toEqual(
      [...SKILL_ENTRIES.map(entry => entry.name)].sort(),
    )
    for (const skill of listed) {
      expect(skill.provider).toBe('qwen-mm')
      expect(skill.source).toBe('bundled')
      expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
      expect(skill.resourceBase).toEqual({ kind: 'directory', path: ASSET_DIR })
      expect(skill.name).toMatch(/^qwen-mm-plugins-[a-z-]+$/)
    }

    for (const entry of SKILL_ENTRIES) {
      const loaded = await ctx.skills.get(entry.name)
      expect(loaded?.description).toBe(entry.description)
      expect(loaded?.content).toContain(BODY_MARKERS[entry.name])
    }

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('rejects an unknown skill through the provider', async () => {
    await expect(provider.get({ name: 'not-a-skill', description: '', invocation: { modelInvocable: true, userInvocable: true }, provider: 'qwen-mm', source: 'bundled', rank: 600, locator: null }, {})).resolves.toBeUndefined()
  })

  it('ships an asset file for every catalog entry', () => {
    for (const entry of SKILL_ENTRIES) {
      const body = readFileSync(`${ASSET_DIR}${entry.file}`, 'utf8')
      expect(body.length).toBeGreaterThan(0)
      expect(body).toContain(BODY_MARKERS[entry.name])
      expect(entry.file).toBe(`${entry.name}.md`)
    }
  })
})

describe('dsh-qwen-mm bundle patch', () => {
  it('declares a parseable patch with the skill rows and one MCP row per server capability', () => {
    const parsed = yaml.load(readFileSync(PATCH_URL, 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as { insert?: { id?: string; name?: string; config?: Record<string, unknown> }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBe(9)

    const skillRow = rows.find(row => row.id === 'qwen-mm')
    expect(skillRow?.name).toBe('@deepseek-ai/dsh-qwen-mm')

    const attachmentsRow = rows.find(row => row.id === 'qwen-mm-attachments')
    expect(attachmentsRow?.name).toBe('@deepseek-ai/dsh-qwen-mm/attachments')

    const mcpRows = rows.filter(row => row.id?.startsWith('mcp-qwen-mm-'))
    expect(mcpRows).toHaveLength(7)
    const serverNames = new Set(SKILL_ENTRIES.map(entry => entry.name))
    for (const row of mcpRows) {
      expect(row.name).toBe('@deepseek-ai/dsh-mcp-client')
      const config = row.config!
      expect(config.transport).toBe('stdio')
      expect(config.command).toBe('uvx')
      const args = config.args as string[]
      expect(args[0]).toBe('--from')
      expect(args[1]).toMatch(/^qwen-mm-plugins\[[a-z-]+\] @ git\+https:\/\/github\.com\/QwenLM\/Qwen-MM-Plugins\.git@qwen-mm-plugins-[a-z-]+-v\d+\.\d+\.\d+$/)
      expect(args[2]).toBe(config.serverName)
      expect(serverNames.has(config.serverName as string)).toBe(true)
      expect(config.cwd).toEqual({ __jsExpr: 'process.cwd()' })
    }
    // edu-agent is skill-only upstream: no MCP row, but its skill is vendored.
    expect(serverNames.has('qwen-mm-plugins-edu-agent')).toBe(true)
  })
})

describe('dsh-qwen-mm real loader composition', () => {
  it('mounts the qwen-mm row through the Loader and lists the skills', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qwen-mm-loader-'))
    // Row modules must be importable by the Loader; delegate to the already-imported plugins.
    writeFileSync(join(dir, 'skills.mjs'), `
      export const name = 'skills'
      export const apply = ctx => globalThis.__skillsApply(ctx)
    `)
    writeFileSync(join(dir, 'qwen.mjs'), `
      export const name = 'qwen-mm'
      export const inject = ['skills']
      export const apply = ctx => globalThis.__qwenApply(ctx)
    `)
    writeFileSync(join(dir, 'cordis.yml'), [
      '- id: skills',
      `  name: ${pathToFileURL(join(dir, 'skills.mjs')).href}`,
      '- id: qwen-mm',
      `  name: ${pathToFileURL(join(dir, 'qwen.mjs')).href}`,
      '',
    ].join('\n'))
    const globals = globalThis as unknown as {
      __skillsApply: (ctx: Context) => unknown
      __qwenApply: (ctx: Context) => unknown
    }
    globals.__skillsApply = ctx => { ctx.plugin(SkillRegistry) }
    globals.__qwenApply = QwenMm.apply
    const ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
    await ctx.loader.await()
    try {
      const names = (await ctx.skills.list()).map(skill => skill.name)
      expect(names).toContain('qwen-mm-plugins-core')
      expect(names).toHaveLength(8)
      const loaded = await ctx.skills.get('qwen-mm-plugins-core')
      expect(loaded?.content).toContain('read_image')
    } finally {
      await ctx.fiber.dispose()
    }
  }, 60000)
})
