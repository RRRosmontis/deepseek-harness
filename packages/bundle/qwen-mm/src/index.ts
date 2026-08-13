/**
 * Qwen-MM-Plugins integration bundle plugin: registers the bundled skill
 * provider on `ctx.skills`. The MCP server rows live in the bundle patch and
 * mount through `@deepseek-ai/dsh-mcp-client`.
 *
 * @module @deepseek-ai/dsh-qwen-mm
 */

import type { Context } from '@deepseek-ai/cordis'
import { provider } from './skills.ts'

/** Cordis plugin name. */
export const name = 'qwen-mm'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled Qwen-MM-Plugins skill provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
