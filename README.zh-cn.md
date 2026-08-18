# Unified Proxy for Copilot Chat

**在 GitHub Copilot Chat 的模型选择器中，通过配置文件切换多个 OpenAI 兼容后端。**

本插件基于 **[DeepSeek V4 for Copilot Chat v0.7.1](https://github.com/Vizards/deepseek-v4-for-copilot)**（作者 Vizards）二次开发，并已移植 v0.5.3 ~ v0.7.1 全部上游修复（含 0.7.0/0.7.1 的 `low` 轻量推理档位）。保留 Copilot 原生的 Agent、工具调用、思考模式菜单等能力，并增加 **多后端配置驱动** 能力。

> 除下文「配置文件」章节外，Agent 模式、视觉代理、工具列表稳定、调试模式等通用行为请参阅 **DeepSeek V4 for Copilot Chat v0.7.1** 官方文档与源码说明。

**本插件有什么优势？** 见 [docs/WHY_UNIFIED_PROXY.zh-cn.md](./docs/WHY_UNIFIED_PROXY.zh-cn.md)（定位、与同类扩展对比、适用场景）；英文版 [docs/WHY_UNIFIED_PROXY.md](./docs/WHY_UNIFIED_PROXY.md)。

**如何搜到本仓库？** 在 **About → Topics** 粘贴空格分隔的一行（常见 **整行仅约 50 字符**，见 [docs/GITHUB_TOPICS_SETUP.zh-cn.md](./docs/GITHUB_TOPICS_SETUP.zh-cn.md)）。

## 与原版的关系

| 项目 | DeepSeek V4 v0.7.1（原版） | Unified Proxy（本插件） |
|------|---------------------------|-------------------------|
| 模型来源 | 固定 DeepSeek V4 Flash / Pro | `proxy_configs.json` 中每个键 = 一个模型 |
| API 地址 | 设置项 `deepseek-copilot.baseUrl` | 每个代理的 `base_url` |
| API Key | SecretStorage 或设置 | 写在配置文件的 `api_key` |
| 上下文 | 约 1M | 默认 128K，可 per-model 配置 |
| 视觉代理 | 固定 VS Code LM | 可配置：VS Code LM / HTTP 端点（三种协议）|
| 提供商 ID | `deepseek` | `unified-proxy`（可与原版并存） |

## 本插件新增 / 强化的功能

1. **多模型条目**：配置里有几个代理，Copilot 模型列表里就出现几个模型。
2. **`proxy_configs.json` 驱动**：默认路径 `%USERPROFILE%\.vscode\proxy_configs.json`（可通过设置 `unified-proxy-copilot.proxyConfigPath` 覆盖）。
3. **按模型可选参数**：图片支持（0/1/2 三档）、上下文窗口、最大输出、温度、思考模式默认值。
4. **可配置视觉代理**（v1.1.0）：每个后端可独立指定视觉来源——VS Code LM 或 HTTP 端点（OpenAI Chat / Anthropic Messages / OpenAI Responses）。
5. **Streaming usage 去重**（v1.2.0）：累计 per-chunk usage，流结束时仅上报一次，防止 token 数虚高。
6. **OpenAI 兼容工具调用**：对 Copilot 工具 schema 做规范化，适配多数自建代理。
7. **局域网直连**：子进程 SSE 桥接，自动绕过系统 HTTP 代理访问内网 `base_url`。
8. **思考模式菜单**：与原版一致（停用 / 轻量 / 标准 / 深度），配置文件可设默认档。

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
| `supports_images` | `0` / `1` / `2` | `0` | 图片处理模式，见下方说明 |
| `context_window_size` | 数字或 `"128K"` | `128K`（128000） | Copilot 显示的上下文上限 |
| `max_output_tokens` | 数字 | 不限制 | 省略或 `0` 时不向 API 传 `max_tokens` |
| `temperature` | 数字 | `0.5` | 采样温度 |
| `thinking_mode` | 字符串 | `停用` | 思考模式菜单默认值，见下表 |

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
| `unified-proxy-copilot.debugMode` | `minimal` | 诊断级别，行为同原版 |
| `unified-proxy-copilot.experimental.stabilizeToolList` | `false` | 实验性稳定工具列表，参见原版说明 |

更多设置项（视觉代理、调试 dump 等）请参阅 **DeepSeek V4 for Copilot Chat v0.7.1**。

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

- 基于 [DeepSeek V4 for Copilot Chat](https://github.com/Vizards/deepseek-v4-for-copilot) v0.7.1
- 许可证：MIT（与原版相同）
