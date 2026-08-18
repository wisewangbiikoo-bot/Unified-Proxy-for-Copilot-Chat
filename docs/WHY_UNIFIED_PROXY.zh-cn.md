# 为什么选择 Unified Proxy for Copilot Chat

本文说明本插件的**定位、核心优势、与同类扩展的对比**，以及**适合 / 不适合**的使用场景。配置细节见 [README.zh-cn.md](../README.zh-cn.md)。

---

## 定位

**Unified Proxy** 不是又一个「只接一家云 API」的 Copilot 插件，而是：

> 用 **一份 `proxy_configs.json`**，把多台 **OpenAI 兼容代理**（内网网关、自建服务、统一入口）映射成 Copilot Chat 模型选择器里的多个模型，并保留 **DeepSeek V4 for Copilot Chat** 级别的 Agent、工具与思考能力。

技术基础：[DeepSeek V4 for Copilot Chat v0.7.1](https://github.com/Vizards/deepseek-v4-for-copilot)（MIT）。Provider ID 为 `unified-proxy`，可与官方 DeepSeek V4 扩展（`deepseek`）**同时安装、互不覆盖**。

---

## 核心优势

### 1. 一份 JSON，多个后端 → 模型列表自动对齐

| 能力 | 说明 |
|------|------|
| 配置驱动 | `proxies` 下每个键 = Copilot 里的一个模型（如 `claude`、`gemini`、`deepseek`） |
| 热更新 | 修改配置后执行 **Unified Proxy: Reload Config** 即可刷新列表 |
| 集中管理 | 地址、Key、`model_id`、温度、上下文等写在同一文件，适合多端口内网代理 |

适合已有 **AI 代理管理器 / 多端口 OpenAI 兼容服务**、希望在 Copilot 同一界面切换后端的用户。

### 2. 继承 DeepSeek V4 的 Copilot 深度集成（不只是「能聊天」）

基于上游 v0.7.1，保留并沿用其成熟能力：

- **Agent 模式**：文件编辑、终端、搜索、Git、测试、MCP、Skills 等
- **工具调用**：完整 Copilot 工具链；并对 schema 做**规范化**，适配 Kiro-go 等自建网关
- **思考模式**：停用 / 标准 / 深度，与 Copilot 模型菜单一致；可在配置里设每模型默认档
- **视觉代理**：文本模型不支持图片时，可经其它 Copilot 模型描述附件后再转发
- **推理 replay、Token 用量** 等与上游一致的行为（详见上游文档）

许多「OpenAI Compatible Copilot」类扩展主要解决**接入模型选择器**；本插件在 **Agent + 工具链** 上与 DeepSeek V4 同一代实现。

### 3. 为局域网与企业代理环境加固

针对 Extension Host 内 HTTP 流、系统代理导致 **空 SSE / ETIMEDOUT** 等问题，本插件包含：

- **子进程 `sse_bridge.js`**：在子进程中发起 SSE，减轻 EH 内 `fetch`/`http` 流异常
- **`NO_PROXY` 自动合并**：从 `proxy_configs.json` 的 `base_url` 提取主机并写入绕过列表
- **子进程清除 `HTTP_PROXY`**：便于直连内网 `base_url`

在 **公司 HTTP 代理 + 内网 API** 场景下，比仅面向公网 API 的扩展更贴近实际部署。

### 4. 按模型细调参数（非全局一套）

每个 proxy 条目可单独配置（见 `proxy_configs.json.example`）：

| 字段 | 作用 |
|------|------|
| `supports_images` | 是否启用视觉相关处理 |
| `context_window_size` | 上下文窗口（如 `128K` → 128000，Copilot 显示为 128K） |
| `max_output_tokens` | 最大输出；省略或无效值时不向 API 强行限制 |
| `temperature` | 采样温度 |
| `thinking_mode` | 默认思考档位（停用 / 标准 / 深度） |

同一环境中的 Claude 网关、Gemini、DeepSeek 可使用不同默认，无需反复改 VS Code 全局项。

### 5. 隐私与发布边界清晰

- **无内置真实 IP / API Key**（无占位「假模型」、无硬编码模板）
- 密钥与内网地址仅存在于用户本机 **`~/.vscode/proxy_configs.json`**
- 仓库仅跟踪 **`proxy_configs.json.example`**（占位符）；敏感文件已在 `.gitignore` 中排除

---

## 与同类扩展对比

市场上已有大量通过 [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) 接入 Copilot Chat 的扩展（可在 VS Code 中搜索 `@tag:language-models`）。下表为**典型对比**，非穷尽列表。

| 对比对象 | Unified Proxy 的优势 | 对方的常见优势 |
|----------|----------------------|----------------|
| [DeepSeek V4 for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot) | **JSON 多后端**、内网多代理、per-model 参数 | 专注 DeepSeek、安装量大、上游直接维护 |
| [OAI Compatible Provider for Copilot](https://marketplace.visualstudio.com/items?itemName=johnny-zhao.oai-compatible-copilot) 等 | **文件驱动多模型** + DeepSeek V4 级 Agent/工具 | 多协议、面向 Ollama/NIM 等生态 |
| [OAIProvider](https://marketplace.visualstudio.com/items?itemName=calgan.oai-provider) | 集中 JSON 配置，适合_homelab 多端口_ | 命令面板向导、多 Provider UI |
| [Unify Chat Provider](https://marketplace.visualstudio.com/items?itemName=SmallMain.vscode-unify-chat-provider) | 轻量、专精 OpenAI 兼容代理列表 | 多账号/多厂商配额整合 |
| [Copilot ++](https://marketplace.visualstudio.com/items?itemName=OEvortex.better-copilot-chat) 等「大而全」 | **配置简单、目标单一**（代理 JSON） | 预置 20+ 云厂商 |
| VS Code 内置 [BYOK / Custom Endpoint](https://code.visualstudio.com/docs/copilot/customization/language-models) | **一条 JSON 扫齐多个内网代理** | 无需装扩展、官方维护 |

**差异化小结**：市面已有「多 OpenAI 兼容后端进 Copilot」的插件，但较少见 **仅以 `proxy_configs.json` 驱动、专为多内网/自建代理设计**，并继承 **DeepSeek V4 完整 Agent 栈** 的组合。

---

## 适合谁 / 不适合谁

### 更适合

- 已部署 **多台 OpenAI 兼容代理**（不同端口 / 不同上游模型）
- 希望在 **GitHub Copilot Chat** 中切换模型，且需要 **Agent + 工具调用**
- 使用 **内网 `base_url`**，且常遇系统 HTTP 代理干扰
- 希望 API Key 写在本地 JSON，便于与现有「代理管理器」配置风格统一

### 优势不明显时

- 只使用 **一家公网 API** → 官方 [DeepSeek V4](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot) 或 VS Code 内置 BYOK 可能更简单
- 仅 **本机 Ollama 单地址** → [LM Studio for Copilot Chat](https://marketplace.visualstudio.com/search?term=lmstudio%20copilot) 等更贴场景
- 不想维护 JSON，偏好 **图形向导** → [OAIProvider](https://marketplace.visualstudio.com/items?itemName=calgan.oai-provider) 等更合适

---

## Marketplace 一句话卖点（可参考）

1. **One `proxy_configs.json` → many Copilot Chat models** for LAN / self-hosted OpenAI-compatible proxies.  
2. **Full Copilot agent stack**: tools, thinking modes, vision proxy — built on DeepSeek V4 v0.7.1.  
3. **LAN-friendly streaming**: SSE child-process bridge and proxy bypass for corporate networks.

---

## 相关文档

- [README.zh-cn.md](../README.zh-cn.md) — 安装、配置、`proxy_configs.json` 字段说明  
- [README_INSTALL.md](../README_INSTALL.md) — VSIX 安装与 Git 发布  
- [changelog.md](../changelog.md) — 版本变更  
- [DeepSeek V4 for Copilot Chat](https://github.com/Vizards/deepseek-v4-for-copilot) — 上游行为与 Agent 说明  
