# Agent Note: Qwen-MM 图片附件桥接

Status: implemented

[English](2026-08-13-qwen-mm-attachment-bridge.md) | 中文

## 问题

Web 输入框接受拖拽与粘贴的图片，Host 会把它们提交到内容寻址附件库，并以持久的 `ImageBlock` 引用写入日志。在随附的 DeepSeek 路由上——它声明 `inputModalities: ['text']`——适配器会显式拒绝图片内容（`UNSUPPORTED_CONTENT`），因此任何含图片的用户消息都会让下一个请求失败。用户无法在附加图片后让纯文本模型理解它，尽管 qwen-mm MCP 工具（`vision_chat`、`read_image`）在给定路径时能读取任何本地文件。

## 决策

**在 `@deepseek-ai/dsh-qwen-mm` bundle 中新增第二个插件：`qwen-mm-attachments`（模块 `@deepseek-ai/dsh-qwen-mm/attachments`）。** 其补丁行与 skill provider 行及 MCP 服务器行并列。

**在 `agent/pre-step` 上，仅在纯文本路由，桥接把每个图片块导出到 `<dshHome>/qwen-mm/attachments/` 并改写步骤消息。** 它先等待瀑布，原样透传 `reject`；通过会话 request header 或 agent options 加 `llm.resolveModelInfo` 解析路由，完全跳过支持图片的路由。`ctx.attachments.readImage` 提供已验证字节；文件按媒体类型命名为 `<sha256-hex>.<ext>`，在同名存在性检查后用 `wx` 写入，因此重复导出同一附件是幂等的，内容寻址命名不会冲突。改写后的用户消息把每个图片块替换为 `[Image attachment exported to: <path>]` 文本，并附加一条 `<system-reminder>`，列出导出路径与可读取它们的两个 qwen-mm MCP 工具。

**改写是插件级投影，不是核心变更。** 它发生在 `agent/pre-step` 决策中——这正是循环写入 `user/message` 的内容；因此 `deriveMessages()` 重放的是纯文本历史，DeepSeek 序列化器永远不会看到图片块。支持图片的路由不会进入改写路径，保留原生图片块。

**桥接向 host 图片准入闸宣告自己。** `AttachmentStore` 新增一个小注册表（`registerImageIntakeConsumer` / `hasImageIntakeConsumer`）；桥接在 apply 时注册、dispose 时注销。host 的 `prompt` 处理器只有在"模型声明 `image` 输入"或"至少有一个消费方注册"时才在纯文本路由上放行图片，因此桥接启用时上传可用、禁用时仍被拒绝。这是唯一的核心改动——host 准入闸的一处条件加附件服务的注册表——而"会话已有图片历史时切换模型"的闸门保持严格，因为桥接只改写新认领的消息，不改写已记录的历史。

## 曾考虑的替代方案

**在请求边界投影而不是日志边界。** 不采用：`deriveMessages()` 没有插件钩子，改它意味着 agent-loop 核心改动加架构文档更新；pre-step 决策已经精确控制循环记录的内容。

**在历史中保留图片块，只在适配器里剥离。** 不采用：DeepSeek 适配器的 `assertTextOnly` 就是显式的 modality 强制，而包装适配器对一个 bundle 功能来说不成比例。

**只导出、不改写（路径说明仅作为附加指引）。** 不采用：未改写的图片块仍会到达文本适配器并使请求失败，因此改写是该功能成立的必要条件。

## 后果

在 DeepSeek 路由上，拖入图片现在可用了：文件落在 `<dshHome>/qwen-mm/attachments/`，消息历史显示路径引用而不是缩略图（字节仍保留在附件库中），模型通过用路径调用 `mcp__qwen-mm-plugins-api__vision_chat` 或 `mcp__qwen-mm-plugins-core__read_image` 读取图片。支持图片的路由（带视觉模型的 pi-ai）不受影响。导出目录可通过行的 `config.exportDir` 配置，整个桥接可按行 id 禁用。文本路由上会话内缩略图的取舍已记录在包 README 的模型体验与已知限制中。
