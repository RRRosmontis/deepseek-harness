/**
 * Bundled Qwen-MM-Plugins skill provider.
 *
 * @module @deepseek-ai/dsh-qwen-mm
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'qwen-mm'
const ASSET_DIR = fileURLToPath(new URL('../assets/skills/', import.meta.url))
const RESOURCE_BASE = { kind: 'directory', path: ASSET_DIR } as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** One vendored Qwen-MM-Plugins capability skill. */
interface SkillEntry {
  /** Kebab-case skill name, identical to the upstream frontmatter `name`. */
  readonly name: string
  /** Routing description, identical to the upstream frontmatter `description`. */
  readonly description: string
  /** Asset file name under `assets/skills/`. */
  readonly file: string
}

/** The vendored capability catalog, generated from the pinned upstream release tags. */
export const SKILL_ENTRIES: readonly SkillEntry[] = [
  {
    name: 'qwen-mm-plugins-core',
    description: 'Local MCP tools to read and visualize any file — images, video, documents, code, data, 3D, notebooks, and more — plus image tools for cropping, annotating, and extracting frames.',
    file: 'qwen-mm-plugins-core.md',
  },
  {
    name: 'qwen-mm-plugins-api',
    description: 'Cloud MCP tools for understanding media, by model family. VL model: vision_chat (caption/VQA), ocr, grounding (detect/locate objects). Omni model (reads frames + audio together): timestamped captioning, ASR (plain / controllable / multi-speaker diarized), temporal grounding, event counting, music captioning. Plus transcribe_audio (ASR) and segmentation (SAM3). Use when a question about an image/video/audio needs an external model, not just local reading.',
    file: 'qwen-mm-plugins-api.md',
  },
  {
    name: 'qwen-mm-plugins-search',
    description: 'Web search and page extraction MCP tools (Serper, Exa, or Tavily) plus Serper Lens reverse-image search for confirming facts — web_search (find facts), web_extractor (read a page in depth), image_search (reverse-search a frame to identify an entity). Use to verify anything you cannot confirm from the media alone.',
    file: 'qwen-mm-plugins-search.md',
  },
  {
    name: 'qwen-mm-plugins-video-memory',
    description: 'Triggered for long videos (30+ minutes), whether a single file or a directory of multiple videos. Vision-language MCP tools designed for efficient reading and semantic analysis of long videos (30+ minutes), supporting memory construction and semantic search.',
    file: 'qwen-mm-plugins-video-memory.md',
  },
  {
    name: 'qwen-mm-plugins-video-edit',
    description: 'Editing-director skill that OWNS every video task built from EXISTING REAL FOOTAGE the user supplies (vlog, montage, intro, recap, eating/travel/family edits, style replication, compositing, subtitles, voiceover, B-roll). When footage files are the input, use THIS skill first — not the generic hyperframes entry and not the general-video workflow: it contributes footage judgment (selection, pacing, beat-sync, sound, looks, per-scene design) and then hands the designed composition to the HyperFrames pipeline for assembly and rendering, so the two are complementary rather than alternatives. It enforces the taste contract, scene-loop assembly with a Scene Ledger, and evidence-based independent review via its own plan-gate and review-gate scripts. Only tasks with NO real footage at all (a motion graphic or promo invented from a brief) go straight to hyperframes. Governance scales by mode instead of confirming every step.',
    file: 'qwen-mm-plugins-video-edit.md',
  },
  {
    name: 'qwen-mm-plugins-blender',
    description: 'Use whenever a task involves building or editing a 3D scene or asset in Blender — modeling, characters/people, architecture/interiors, terrain/landscapes, props, materials, lighting, or rendering. Covers discovering installed add-ons, using generators, importing and REFINING ready-made assets, and matching the result to the spec. Requires a running Blender instance with the blender-mcp addon (see Prerequisite).',
    file: 'qwen-mm-plugins-blender.md',
  },
  {
    name: 'qwen-mm-plugins-freecad',
    description: 'Use whenever a task involves parametric CAD in FreeCAD — modeling parts and assemblies, editing object properties, technical drawings, importing/exporting STEP/STL/OBJ/DXF, PDF/Excel reports from a model, or finite-element (FEM/CalculiX) analysis. Requires a running FreeCAD instance with the FreeCADMCP addon (see Prerequisite).',
    file: 'qwen-mm-plugins-freecad.md',
  },
  {
    name: 'qwen-mm-plugins-edu-agent',
    description: 'Generate step-by-step math problem-solving tutorial videos in Chinese (Mandarin). Use when: (1) a user provides a math problem and wants an explanation video, (2) someone says "make a math tutorial", "explain this equation", "create a teaching video for this problem", "讲解这道题", "生成解题视频", (3) the user wants a Chinese-language math lesson covering formulas, equations, or geometric figures, (4) the user shares a math problem in text or LaTeX and asks for a video walkthrough, (5) the input is an image_assets/ folder containing problem images — the skill will extract the problem via visual recognition, solve it, and generate a tutorial video. Teaching components are rendered as realistic objects (solid opaque panels, 3D cards, SVG figures) with a modern aurora mesh aesthetic.',
    file: 'qwen-mm-plugins-edu-agent.md',
  },
]

/**
 * One immutable candidate per vendored capability, mirroring the badge provider's shape.
 * @returns the full candidate list, one entry per `SKILL_ENTRIES` capability.
 */
function createCandidates(): readonly SkillCandidate[] {  return SKILL_ENTRIES.map(entry => ({
    name: entry.name,
    description: entry.description,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL(`../assets/skills/${entry.file}`, import.meta.url),
  }))
}

const candidates = createCandidates()

/** The Qwen-MM-Plugins bundled skill provider. */
export const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(candidates),
  async get(candidate): Promise<SkillDefinition | undefined> {
    const entry = SKILL_ENTRIES.find(skill => skill.name === candidate.name)
    if (entry === undefined) return undefined
    return {
      name: entry.name,
      description: entry.description,
      invocation: INVOCATION,
      provider: PROVIDER_NAME,
      source: 'bundled',
      resourceBase: RESOURCE_BASE,
      content: await readFile(new URL(`../assets/skills/${entry.file}`, import.meta.url), 'utf8'),
    }
  },
}
