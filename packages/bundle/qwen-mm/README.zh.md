# @deepseek-ai/dsh-qwen-mm

[English](README.md) | 中文

将 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)（Apache-2.0）集成进 DeepSeek Harness profile 的 bundle。它随包提供上游八个能力的 skill（作为内置 skill provider），并把七个服务器能力挂载为 `@deepseek-ai/dsh-mcp-client` 配置行；执行一次 `dsh plugin` 安装，即可让模型具备多模态感知能力——覆盖本地媒体读取、云端 Qwen VL/Omni API、网络搜索、长视频记忆/剪辑、Blender 与 FreeCAD。`edu-agent` 上游仅含 skill，没有 MCP 服务器。

## 安装

前置条件：[`uv`](https://docs.astral.sh/uv/)（提供 `uvx`，按需运行各能力的 MCP 服务器）。

```sh
dsh plugin --profile web add @deepseek-ai/dsh-qwen-mm
```

或从 git 托管地址（锁定 commit）或本地 checkout 安装。然后重启 `dsh --profile web` 并打开新会话。该 bundle 的补丁会插入 `qwen-mm` skill provider 行和七个 `mcp-qwen-mm-<capability>` 行；可用 `--dump-config` 查看。

### 凭据

MCP 桥接会从子进程环境中过滤凭据类变量，因此请把各 provider 的密钥写入上游共享配置文件，而不是环境变量：

```sh
curl -fsSL https://raw.githubusercontent.com/QwenLM/Qwen-MM-Plugins/main/install.sh | bash -s -- configure
```

`core` 无需任何密钥即可使用。`api`/`video-memory`/`video-edit`/`edu-agent` 需要 DashScope 密钥；`search` 需要 Serper、Exa 或 Tavily。系统应用（ffmpeg、LibreOffice、Chromium、Blender、FreeCAD）仅由调用它们的能力按需使用。

## 用法

引用文件并自然提问即可；匹配的 skill 会把任务路由到对应的 MCP 工具：

```text
@report.pdf          Summarize page 3 and extract its table.
@meeting.mp4         Transcribe this with speaker labels and timestamps.
@place.jpg           Identify where this photo was taken and verify it on the web.
```

模型会在其 skill 目录中看到这些 skill，并以服务器限定名（`mcp__qwen-mm-plugins-core__read_image` 等）看到对应工具。

## 拖拽图片

把图片拖入或粘贴到 Web 输入框后，桥接会把它导出到 `<dshHome>/qwen-mm/attachments/`，并在纯文本模型路由（DeepSeek 路由）上把消息中的图片改写为路径引用并附加一条使用指引，使模型能够通过 qwen-mm MCP 工具读取图片（云端理解用 `mcp__qwen-mm-plugins-api__vision_chat`，本地读取用 `mcp__qwen-mm-plugins-core__read_image`）。支持图片的路由保留原生图片块直接读取，桥接不触碰它们。

- 默认导出目录为 `<dshHome>/qwen-mm/attachments`；可在 `qwen-mm-attachments` 行的 `config.exportDir` 覆盖。
- 改写后的用户消息在历史中显示为 `[Image attachment exported to: <path>]`；原始字节仍以内容寻址方式保存在附件库中，导出副本是任何 qwen-mm MCP 工具都能读取的普通文件。
- 在 profile 补丁中按 id 禁用桥接（`- id: qwen-mm-attachments` 加 `disabled: true`），即可在所有路由上保留原生图片块。

桥接还会在 `ctx.attachments` 上注册一个图片准入消费方，因此 host 会在桥接启用时于纯文本路由上放行图片上传（禁用时仍拒绝）。

## 能力

| Skill | MCP 服务器行 | 上游 tag | 依赖 |
|---|---|---|---|
| `qwen-mm-plugins-core` | `mcp-qwen-mm-core` | `qwen-mm-plugins-core-v1.0.1` | 媒体需 ffmpeg；按格式需要相应应用 |
| `qwen-mm-plugins-api` | `mcp-qwen-mm-api` | `qwen-mm-plugins-api-v1.0.2` | DashScope |
| `qwen-mm-plugins-search` | `mcp-qwen-mm-search` | `qwen-mm-plugins-search-v1.0.2` | Serper / Exa / Tavily |
| `qwen-mm-plugins-video-memory` | `mcp-qwen-mm-video-memory` | `qwen-mm-plugins-video-memory-v1.0.1` | DashScope + ffmpeg |
| `qwen-mm-plugins-video-edit` | `mcp-qwen-mm-video-edit` | `qwen-mm-plugins-video-edit-v1.0.1` | DashScope + ffmpeg + Node/Chromium |
| `qwen-mm-plugins-blender` | `mcp-qwen-mm-blender` | `qwen-mm-plugins-blender-v1.0.1` | Blender（无头环境需 Xvfb） |
| `qwen-mm-plugins-freecad` | `mcp-qwen-mm-freecad` | `qwen-mm-plugins-freecad-v1.0.1` | FreeCAD（FEM 需 CalculiX） |
| `qwen-mm-plugins-edu-agent` | —（仅 skill） | `qwen-mm-plugins-edu-agent-v1.0.1` | Node/Chromium + ffmpeg + DashScope |

在 profile 的 `cordis.patch.yml` 中按行 id 禁用不需要的能力：

```yaml
- id: mcp-qwen-mm-blender
  disabled: true
```

## 内置 skills

`assets/skills/` 存放八个去除 frontmatter 的 `SKILL.md` 正文，固定在上表所列的上游 release tag。刷新某个能力意味着：用 MCP 行锁定的同一 tag 下的正文替换对应的资产文件；若 frontmatter 有变化，再同步更新 `src/skills.ts` 中对应的 `SKILL_ENTRIES` 描述。所固定的内容取自 Apache-2.0 协议的 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) 仓库；上游保留其版权与许可证，MCP 命令在运行时从上游 git 仓库安装同一 tag 的发布版本。

## 模型体验

### Skill 目录

#### 模型看到的内容

八个 `qwen-mm-plugins-*` skill 会以内置的 frontmatter 描述出现在会话 skill 目录中。加载某个 skill 时，其完整指令正文——能力路由、工具选择指引与前置条件——会通过 `skill` 工具注入请求上下文。

#### Token 影响

八个目录条目在观察到非空目录的会话的第一个模型步骤产生固定的描述成本；正文在加载前零成本，加载后保留至压缩。

#### KV Cache 影响

目录消息在八个条目不变时是追加式且前缀稳定的。已加载正文遵循可复用的请求前缀，不会使既有缓存条目失效。

### MCP 工具

#### 模型看到的内容

每个已挂载服务器都会以 `mcp__qwen-mm-plugins-<capability>__<tool>` 发布其工具，带服务器提供的描述与输入 schema。文本结果（视觉/OCR/ASR 回答、抽取出的文档、搜索结果）会保留在历史中。

#### Token 影响

服务器工具注册期间，每个请求都会付出与数据相关的 schema 成本。文本结果保留至压缩；服务器返回的二进制媒体不会进入上下文。

#### KV Cache 影响

已发现的工具集与 schema 不变时前缀稳定。改变某个工具的重新同步会替换定义，并可能使从首个变更的 schema token 起的复用失效。

### 附件桥接

#### 模型看到的内容

在纯文本路由上，每个认领了含图片块用户消息的步骤，都会收到一条改写后的用户消息（图片块变成 `[Image attachment exported to: <path>]` 文本），外加一条附加的 `<system-reminder>`，列出导出路径与可读取它们的 qwen-mm MCP 工具。模型通过用这些路径调用工具来读取图片。

#### Token 影响

改写把图片块替换为简短路径文本（媒体本身零字节）。指引每条导出文件增加一行，保留至压缩。

#### KV Cache 影响

每个新附件追加式出现；指引遵循可复用的请求前缀，不会使既有缓存条目失效。重复导出同一附件是幂等的，不会产生新消息。

## 已知限制与暂缓事项

- **MCP 工具返回的媒体不会进入模型上下文。** `dsh-mcp-client` 桥接会把 image/audio/resource 块投影为占位符，因此 `read_image`/`read_video` 的载荷无法到达纯文本的 DeepSeek 模型；返回文本的工具（`visualize`、`media_info`、视觉/OCR/ASR 回答、搜索）可完整使用。更丰富的多媒体投影在上游暂缓，真正的多模态输入需要支持图片的 LLM 后端。
- **拖拽图片在纯文本路由上会被改写为路径文本。** 会话中的缩略图会被替换为导出路径说明（文件仍保留在磁盘与附件库中）；支持图片的路由不受影响，桥接直接读取原生图片块。
- **每个服务器能力都会在 profile 启动时启动。** 每个 `mcp-qwen-mm-*` 行都会拉起一个 uvx 进程（首次运行后缓存）；缺少 `uvx` 或服务器失败时，该行会以无工具状态激活（桥接的默认行为），按能力禁用则交给上文所示的用户补丁。
- **内置 skills 与 MCP ref 是固定的，不会实时更新。** 按文档同步刷新两者；上游 tag 不可变，因此新版本发布需要手动执行刷新流程。
- **`edu-agent` 只贡献 skill。** 它需要自身的 Node/Chromium + DashScope 配置，本 bundle 中没有它的 MCP 行。
