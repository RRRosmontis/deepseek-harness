# Agent Note: Qwen-MM-Plugins 集成 bundle

Status: implemented

[English](2026-08-13-qwen-mm-bundle.md) | 中文

## 问题

Qwen-MM-Plugins 通过"每个能力一个 `SKILL.md` 加 stdio MCP 服务器"的方式让 agent harness 具备多模态能力，但它的安装器不支持 DeepSeek Harness：上游项目把 dsh 留在手工配置路径（profile 的 `cordis.patch.yml` 配置行加 checkout 复制的 skill）。dsh 用户一次安装既得不到 skill 目录，也得不到 MCP 配置行，更没有更新方案。另外，`dsh-mcp-client` 桥接会把媒体块替换为占位符，因此 MCP 工具返回的媒体无法到达纯文本的 DeepSeek 模型。

## 决策

**提供一个可安装的 bundle：`@deepseek-ai/dsh-qwen-mm`，位于 `packages/bundle/qwen-mm`。** 其补丁插入一条 `qwen-mm` 插件行和七条 `mcp-qwen-mm-<capability>` 行，因此执行一次 `dsh plugin --profile <name> add @deepseek-ai/dsh-qwen-mm` 即可启用全部能力；与上游一致，`edu-agent` 只贡献 skill。

**把八个能力 skill 作为内置 skill provider 随包提供。** `assets/skills/` 存放去除 frontmatter 的 `SKILL.md` 正文，固定到 MCP 配置行安装的上游 release tag（`qwen-mm-plugins-<cap>-v<version>`）。`src/skills.ts` 硬编码目录（name 与 description 逐字取自所固定的 frontmatter），并从随包资产读取正文，遵循 `dsh-skill-badge` provider 模板：每个 skill 一个不可变候选、`BUNDLED_SKILL_RANK`、`source: 'bundled'`、目录型 `resourceBase`。README 记录了刷新流程；随包引入的 Apache-2.0 内容保留署名。

**MCP 服务器用静态补丁行挂载，而不是程序化挂载。** 每行都是内置 `@deepseek-ai/dsh-mcp-client` 实例，带 `serverName: qwen-mm-plugins-<cap>`、`uvx` stdio 传输与固定的 git ref；这些行会出现在 `--dump-config` 中，用户可在自己的 profile 补丁中按 id 禁用某个能力。桥接原样复用——本笔记不修改 `dsh-mcp-client`。

**把补丁引用的桥接声明为依赖。** `@deepseek-ai/dsh-mcp-client` 位于 `dependencies`，使树外安装即便在内置解析不可用时也能解析它，与 `dsh-headless` 列出其配置行挂载的包的做法一致。

## 曾考虑的替代方案

**用一个可配置插件程序化注册 MCP 服务器。** 不采用：静态行符合 `dsh-base`/`dsh-headless` 的 bundle 先例，保持可见且可逐个覆盖，也避免了在插件内部动态 `ctx.plugin()` 挂载带 Config 的插件。

**从 Qwen-MM-Plugins checkout 发现 skill 而不是随包提供。** 不采用：bundle 将不再自包含，skill 可用性依赖用户 checkout，目录元数据还需要运行时解析 frontmatter。

**让桥接把媒体块透传给模型。** 本次不采用：DeepSeek provider 只支持文本，透传没有消费方；此事在上游保持暂缓，并作为已知限制记录。

## 后果

一次 `dsh plugin add` 就为 profile 提供完整 skill 目录与全部服务器工具；每个启用的能力在启动时拉起一个 `uvx` 进程（首次运行后缓存），服务器失败时其行在桥接默认行为下以无工具状态激活。skill 固定在上游 tag，上游发布新版本时需要执行文档所述的刷新。返回文本的工具（`visualize`、`media_info`、视觉/OCR/ASR 回答、搜索）可完整使用；返回媒体的工具受桥接占位符投影的限制，已记录在包 README 的模型体验与已知限制中。由于桥接会过滤子进程环境中的凭据类变量，凭据必须写入上游共享配置文件。
