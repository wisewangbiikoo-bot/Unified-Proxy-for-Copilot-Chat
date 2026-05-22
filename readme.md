# Unified Proxy for Copilot Chat

**Use multiple OpenAI-compatible AI backends from the GitHub Copilot Chat model picker — driven by a single JSON config file.**

This extension is based on **[DeepSeek V4 for Copilot Chat v0.5.2](https://github.com/Vizards/deepseek-v4-for-copilot)** by Vizards. It keeps Copilot’s agent mode, tool calling, thinking-effort menu, and vision proxy patterns, and adds **config-file multi-backend routing**.

> For agent mode, vision proxy, tool-list stabilization, debug modes, and other shared behavior, refer to the **DeepSeek V4 for Copilot Chat v0.5.2** documentation.

简体中文完整说明见 [README.zh-cn.md](./README.zh-cn.md)（含 `proxy_configs.json` 配置章节，示例均使用占位符）。

**Why this extension?** See [docs/WHY_UNIFIED_PROXY.md](./docs/WHY_UNIFIED_PROXY.md) (English) · [docs/WHY_UNIFIED_PROXY.zh-cn.md](./docs/WHY_UNIFIED_PROXY.zh-cn.md) (简体中文) — advantages, comparisons, and who it’s for.

## What we added

- One Copilot model entry per proxy in `proxy_configs.json`
- Per-model: images on/off, context window, max output, temperature, default thinking level
- Tool-schema sanitization for OpenAI-compatible gateways
- SSE child-process bridge with LAN / `NO_PROXY` handling
- Thinking menu: **Off / Standard / Deep** (same as DeepSeek V4)

## Quick start

1. Install the extension.
2. Edit `~/.vscode/proxy_configs.json` (see [README.zh-cn.md](./README.zh-cn.md) — use placeholders only in docs).
3. Run **Unified Proxy: Reload Config**.
4. Pick a model under the **Unified Proxy** vendor in Copilot Chat.

## Commands

- **Unified Proxy: Reload Config** — reload `proxy_configs.json`
- **Unified Proxy: Show Logs** — output channel
- **Unified Proxy: Open Settings**

## License

MIT — derived from DeepSeek V4 for Copilot Chat (Vizards).
