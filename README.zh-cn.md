# Unified Proxy for Copilot Chat

**在 GitHub Copilot Chat 的模型选择器中，通过配置文件切换多个 OpenAI 兼容后端。**

本插件基于 **[DeepSeek V4 for Copilot Chat v0.8.2](https://github.com/Vizards/deepseek-v4-for-copilot)**（作者 Vizards）二次开发，并已移植上游 vision 相关能力（含 tool-result 图片、描述 session、vision timeout）及 `low` 轻量推理、BYOK 等；另 cherry-pick 了 **0.9.x** 两处修复（取消 128 工具硬上限、deactivate 不再强制 `selectChatModels`）。保留 Copilot 原生的 Agent、工具调用、思考模式菜单等能力，并增加 **多后端配置驱动** 与 **OpenCode Go `x-opencode-session`** 支持。

> 除下文「配置文件」章节外，Agent 模式、视觉代理、工具列表稳定、调试模式等通用行为请参阅 **DeepSeek V4 for Copilot Chat v0.8.2** 官方文档与源码说明。

**本插件有什么优势？** 见 [docs/WHY_UNIFIED_PROXY.zh-cn.md](./docs/WHY_UNIFIED_PROXY.zh-cn.md)（定位、与同类扩展对比、适用场景）；英文版 [docs/WHY_UNIFIED_PROXY.md](./docs/WHY_UNIFIED_PROXY.md)。

**如何搜到本仓库？** 在 **About → Topics** 粘贴空格分隔的一行（常见 **整行仅约 50 字符**，见 [docs/GITHUB_TOPICS_SETUP.zh-cn.md](./docs/GITHUB_TOPICS_SETUP.zh-cn.md)）。

## 与原版的关系

| 项目 | DeepSeek V4 v0.8.2（原版） | Unified Proxy（本插件） |
|------|---------------------------|-------------------------|
| 模型来源 | 固定 DeepSeek V4 Flash / Pro / Vision Exp | `proxy_configs.json` 中每个键 = 一个模型 |
| API 地址 | 设置项 `deepseek-copilot.baseUrl` | 每个代理的 `base_url` |
| API Key | SecretStorage 或设置 | 写在配置文件的 `api_key` |
| 上下文 | 约 1M | 默认 128K，可 per-model 配置 |
| 视觉代理 | VS Code LM / Vision Proxy；支持 tool-result 图 | 同：VS Code LM / HTTP 端点；v1.3.1 起支持 tool-result 图 |
| OpenCode Go session | 上游 [#264](https://github.com/Vizards/deepseek-v4-for-copilot/issues/264) 待合并 | **v1.3.0 已支持** `x-opencode-session` |
| 提供商 ID | `deepseek` | `unified-proxy`（可与原版并存） |

## 本插件新增 / 强化的功能

1. **多模型条目**：配置里有几个代理，Copilot 模型列表里就出现几个模型。
2. **`proxy_configs.json` 驱动**：默认路径 `%USERPROFILE%\.vscode\proxy_configs.json`（可通过设置 `unified-proxy-copilot.proxyConfigPath` 覆盖）。
3. **按模型可选参数**：图片支持（0/1/2 三档）、上下文窗口、最大输出、温度、思考模式默认值。
4. **上游 `/v1/models` 自动探测**（v1.3.3–1.3.5）：省略或写 **`0`** 的 `context_window_size` / `max_output_tokens` / `supports_images` / `supports_tools` / `supports_thinking` 会按 OpenCode 风格目录自动填充；**仅内存、不回写配置**；强制关闭用 `false`/`off`。见下方「可选字段」表。
5. **OpenCode Go 用量**（v1.4.0+）：状态栏显示 `GET …/v1/usage` 的 5 小时 / 周 / 月配额百分比。**请求驱动刷新**（v1.4.2）：一轮对话 API 停歇约 1.2s 后刷新，或累计 `usageRefreshEveryNRequests`（默认 3）次带 usage 的转发后立即刷新；定时轮询默认关（`usagePollMinutes=0`）。命令 **Show Usage** / **Refresh Usage**。
6. **可配置视觉代理**（v1.1.0）：每个后端可独立指定视觉来源——VS Code LM 或 HTTP 端点（OpenAI Chat / Anthropic Messages / OpenAI Responses）。
7. **Streaming usage 去重**（v1.2.0）：累计 per-chunk usage，流结束时仅上报一次，防止 token 数虚高。
8. **OpenCode Go 会话亲和**（v1.3.0）：对 `opencode.ai` / `/zen/go` 自动注入 `x-opencode-session`（按对话 segment 稳定）、`x-opencode-client`、`User-Agent`，修复 `MissingSessionID`。
9. **Vision tool-result 对齐 0.8.2**（v1.3.1）：工具返回的截图也可经 vision proxy 描述；`vision_proxy.timeout_ms` 可配。
10. **取消 128 工具硬上限**（v1.3.2）：对齐上游 0.9.4 #291；deactivate 不再 `selectChatModels`（0.9.1 #271）。
11. **OpenAI 兼容工具调用**：对 Copilot 工具 schema 做规范化，适配多数自建代理。
12. **局域网直连**：子进程 SSE 桥接，自动绕过系统 HTTP 代理访问内网 `base_url`。
13. **思考模式菜单**：与原版一致（停用 / 轻量 / 标准 / 深度），配置文件可设默认档。

## 快速开始

1. 安装本插件（VSIX 或复制到扩展目录）。
2. 创建或编辑 `~/.vscode/proxy_configs.json`（见下文，**勿使用真实 IP 与 Key 的示例抄进文档外泄**）。
3. 执行 **Unified Proxy: Reload Config**。
4. 打开 Copilot Chat，在模型选择器中选择 **Unified Proxy** 下的模型。

## 命令

| 命令 | 说明 |
|------|------|
| **Unified Proxy: Reload Config** | 重新读取 `proxy_configs.json` |
| **Unified Proxy: Show Logs** | 查看输出通道日志 |
| **Unified Proxy: Open Settings** | 打开插件设置 |
| **Unified Proxy: Set / Clear API Key** | （遗留命令，已不使用；API Key 写在 `proxy_configs.json` 的 `api_key`） |

## 配置文件 `proxy_configs.json`

> **本节示例一律使用占位符**，请勿在文档、截图、Issue 中粘贴真实内网 IP 或 API Key。

### 文件位置

- 默认：`%USERPROFILE%\.vscode\proxy_configs.json`（Windows）或 `~/.vscode/proxy_configs.json`
- 自定义：VS Code 设置 `unified-proxy-copilot.proxyConfigPath`

首次缺失时，插件会尝试从安装目录下的 `proxy_configs.json.example` 生成模板。

### 整体结构

```json
{
  "proxies": {
    "模型ID": {
      "name": "显示名称",
      "description": "下拉菜单顶部说明文字",
      "base_url": "http://proxy.example.com:8080/v1",
      "api_key": "YOUR_API_KEY",
      "model_id": "upstream-model-id"
    }
  }
}
```

- **`proxies` 下的键名**（如 `claude`）= Copilot 模型列表里的 **模型 ID**，改名后需在 Copilot 中重新选择。
- **`name`**：模型选择器中的显示名。
- **`description`**：思考模式下拉菜单顶部的说明（不是模型行第三段；第三段为思考档位说明，与原版一致）。
- **`base_url`**：OpenAI 兼容 API 根路径，需包含 `/v1`。
- **`api_key`**：发给上游的 Bearer Token。
- **`model_id`**：请求体里的 `model` 字段。

### 可选字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `supports_images` | `0` / `1` / `2` | **自动** → 上游 `modalities` 含图则为 `2`，否则 `0` | 省略或 `0`=自动；`1`/`2` 手写；强制关图用 `false`/`off`（不要用裸 `0`） |
| `supports_tools` | 布尔 | **自动** → 上游 `capabilities.tools.supported`；无字段则 `true` | 省略或 `0`=自动；强制关用 `false`/`off` |
| `supports_thinking` | 布尔 | **自动** → 上游 `capabilities.reasoning.supported`；无字段则 `true` | 省略或 `0`=自动；强制关用 `false`/`off` |
| `context_window_size` | 数字或 `"128K"` | **自动** → 上游 `limit.context`；失败则 `128K` | 省略或 `0`=自动 |
| `max_output_tokens` | 数字 | **自动** → 上游 `limit.output`；失败则不限制 | 省略或 `0`=自动 |

> **自动填充只在内存**：不会改写 `proxy_configs.json`。每次启动 / Reload Config 重新向 `{base_url}/models` 探测。省略与数值 **`0` 均视为自动检测**。
| `temperature` | 数字 | `0.5` | 采样温度 |
| `thinking_mode` | 字符串 | `停用` | 思考模式菜单默认值，见下表（不自动改默认档，只自动「是否支持」） |
| `custom_headers` | 对象 | 无 | 额外 HTTP 头（会覆盖自动注入的同名头） |
| `opencode_session` | 字符串 | 无 | 固定 OpenCode session；省略则用对话 segment id |

**OpenCode Go（`https://opencode.ai/zen/go/v1`）**：v1.3.0 起默认 `openCodeSession=auto`，自动附加：

- `x-opencode-session`：默认 `local-openai-forward-affinity-v1`（设置 `openCodeSessionId` 或条目 `opencode_session` 可改）
- `x-opencode-client`: `unified-proxy-copilot`
- `User-Agent`: `unified-proxy-copilot/<version>`

无需改配置即可消除 `MissingSessionID`。若走自建反代再转发到 Go，可设 `openCodeSession=always`，或在反代侧透传/注入同名头。

**`supports_images` 三种模式**：

| 值 | 行为 | 适用场景 |
|----|------|---------|
| `0` | 丢弃图片（不发送） | 不支持视觉的模型 |
| `1` | **视觉代理**：自动调用 Gemini 等视觉模型分析图片，将描述文字注入请求后转发给目标模型 | 本身不支持视觉但需要图片理解能力的后端 |
| `2` | **原生传递**：将 OpenAI `image_url` 格式的图片直接发送给后端 | 后端本身支持视觉（如 Gemini、Qwen Vision 等） |

**`vision_proxy` 配置（仅 `supports_images=1` 时生效）：**

可在每个 proxy 条目中设置独立的视觉代理后端，覆盖全局设置。

| 字段 | 类型 | 必需 | 说明 |
|------|------|:----:|------|
| `type` | `"endpoint"` / `"vscode-lm"` | 否 | 默认为 `"vscode-lm"`（使用 VS Code LM API）；`"endpoint"` 时使用自定义 HTTP 端点 |
| `protocol` | 字符串 | 否 | 端点协议：`"openai-chat"`（默认）、`"openai-responses"`、`"anthropic-messages"` |
| `base_url` | 字符串 | `type=endpoint` 时必需 | 视觉 API 的根地址，如 `http://192.168.1.36:4150/v1` |
| `api_key` | 字符串 | 否 | 视觉 API 的 Bearer Token |
| `model_id` | 字符串 | 否 | 视觉模型 ID，如 `gemini-2.5-flash-lite` |
| `custom_headers` | 对象 | 否 | 自定义 HTTP 头，如 `{ "HTTP-Referer": "http://localhost" }` |
| `timeout_ms` | 数字 | 否 | 视觉端点超时（毫秒），默认 60000；对齐上游 0.8.1 |

示例：
```json
{
  "proxies": {
    "deepseek": {
      "supports_images": 1,
      "vision_proxy": {
        "type": "endpoint",
        "protocol": "openai-chat",
        "base_url": "http://192.168.1.36:4150/v1",
        "api_key": "YOUR_GEMINI_KEY",
        "model_id": "gemini-2.5-flash-lite"
      }
    }
  }
}
```

**`thinking_mode` 取值**（与菜单一致）：

| 配置值 | 菜单 | API |
|--------|------|-----|
| `停用` / `none` | 停用 | `thinking.type: disabled` |
| `轻量` / `low` | 轻量 | `reasoning_effort: low` |
| `标准` / `high` | 标准 | `reasoning_effort: high` |
| `深度` / `max` | 深度 | `reasoning_effort: max` |

用户在 Copilot 中切换思考档位后，**以 UI 选择为准**，覆盖配置文件默认值。

### 完整示例（占位符）

```json
{
  "proxies": {
    "gemini": {
      "name": "Gemini",
      "description": "Gemini Flash Lite (example)",
      "base_url": "http://proxy.example.com:4150/v1",
      "api_key": "YOUR_GEMINI_API_KEY",
      "model_id": "gemini-2.5-flash-lite",
      "supports_images": 1,
      "context_window_size": "128K",
      "max_output_tokens": 8192,
      "temperature": 0.5,
      "thinking_mode": "标准"
    },
    "local-claude": {
      "name": "Claude",
      "description": "Local OpenAI-compatible gateway (example)",
      "base_url": "http://proxy.example.com:8080/v1",
      "api_key": "YOUR_GATEWAY_KEY",
      "model_id": "claude-haiku-4.5",
      "supports_images": 0,
      "context_window_size": 128000,
      "thinking_mode": "停用"
    }
  }
}
```

修改配置后务必执行 **Unified Proxy: Reload Config**，必要时 **Reload Window**。

## 插件设置

| 设置 | 默认 | 说明 |
|------|------|------|
| `unified-proxy-copilot.proxyConfigPath` | 空 | 自定义 `proxy_configs.json` 路径 |
| `unified-proxy-copilot.openCodeSession` | `auto` | OpenCode Go 会话头开关：`auto` / `always` / `off` |
| `unified-proxy-copilot.openCodeSessionId` | `local-openai-forward-affinity-v1` | `x-opencode-session` 的不透明值（可改） |
| `unified-proxy-copilot.debugMode` | `minimal` | 诊断级别，行为同原版 |
| `unified-proxy-copilot.showUsageStatusBar` | `auto` | OpenCode Go 用量状态栏：`auto`（有 Go 端点才显示）/ `always` / `off` |
| `unified-proxy-copilot.usageRefreshEveryNRequests` | `3` | 累计多少次带 `usage` 的聊天 API 后立即刷配额 |
| `unified-proxy-copilot.usagePollMinutes` | `0` | 可选定时备份轮询（分钟）；**0=关闭**（推荐，主路径为请求驱动） |
| `unified-proxy-copilot.experimental.stabilizeToolList` | `false` | 实验性稳定工具列表，参见原版说明 |

更多设置项（视觉代理、调试 dump 等）请参阅 **DeepSeek V4 for Copilot Chat v0.8.2**。

## 故障排查

| 现象 | 处理 |
|------|------|
| 模型列表为空或只有 1 个默认项 | 检查 JSON 语法；执行 Reload Config |
| 仍显示旧模型名 | Copilot 缓存；新对话 + Reload Window |
| 连接超时 | 确认 `base_url` 可达；检查系统代理；`http.noProxy` 加入代理主机名 |
| 无工具调用 | 上游是否支持 `tools`；查看 Show Logs 是否 `retrying without tools` |

## 打包安装

```powershell
cd unified-proxy-copilot-extension
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension unified-proxy-copilot-1.2.0.vsix
```

## 致谢与许可

- 基于 [DeepSeek V4 for Copilot Chat](https://github.com/Vizards/deepseek-v4-for-copilot) v0.8.2
- 许可证：MIT（与原版相同）
