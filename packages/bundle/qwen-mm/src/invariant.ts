/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-qwen-mm`.
 * @module @deepseek-ai/dsh-qwen-mm/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-qwen-mm'

/** Cordis companion plugin name. */
export const name = 'qwen-mm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns one immutable provider registration,
 * while the skill registry owns registration uniqueness and lifecycle checks,
 * and the loader owns the MCP server rows mounted from the bundle patch.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
