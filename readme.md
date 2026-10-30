# Unified Proxy for Copilot Chat

**Use multiple OpenAI-compatible AI backends from the GitHub Copilot Chat model picker — driven by a single JSON config file.**

This extension is based on **[DeepSeek V4 for Copilot Chat v0.8.2](https://github.com/Vizards/deepseek-v4-for-copilot)** by Vizards (plus selected **0.9.x** fixes: no 128-tool cap, safer deactivate). It keeps Copilot’s agent mode, tool calling, thinking-effort menu, and vision proxy patterns, and adds **config-file multi-backend routing** plus **OpenCode Go `x-opencode-session` support**.

> For agent mode, vision proxy, tool-list stabilization, debug modes, and other shared behavior, refer to the **DeepSeek V4 for Copilot Chat v0.8.2** documentation (and 0.9.x notes for tool limits).

简体中文完整说明见 [README.zh-cn.md](./README.zh-cn.md)（含 `proxy_configs.json` 配置章节，示例均使用占位符）。

**Why this extension?** See [docs/WHY_UNIFIED_PROXY.md](./docs/WHY_UNIFIED_PROXY.md) (English) · [docs/WHY_UNIFIED_PROXY.zh-cn.md](./docs/WHY_UNIFIED_PROXY.zh-cn.md) (简体中文) — advantages, comparisons, and who it’s for.

**Find this repo:** In **About → Topics**, paste space-separated tags (see [docs/GITHUB_TOPICS_SETUP.zh-cn.md](./docs/GITHUB_TOPICS_SETUP.zh-cn.md)). List file [`.github/repository-topics.txt`](./.github/repository-topics.txt) is for Actions sync.

## What we added

- One Copilot model entry per proxy in `proxy_configs.json`
- Per-model: images on/off (0/1/2), context window, max output, temperature, default thinking level
- **Auto limits from `/v1/models`** (v1.3.3) — omit `context_window_size` / `max_output_tokens` to use upstream `limit.context` / `limit.output`
- **Auto vision / tools / thinking** (v1.3.4) — omit `supports_images` / `supports_tools` / `supports_thinking` to use OpenCode `modalities` / `capabilities`
- **Configurable vision proxy** (v1.1.0): each backend can specify its own vision source — VS Code LM, or an API endpoint (OpenAI Chat, Anthropic Messages, OpenAI Responses)
- **Per-backend vision proxy** (v1.1.0): `vision_proxy` field in `proxy_configs.json` for per-model vision configuration
- Tool-schema sanitization for OpenAI-compatible gateways
- SSE child-process bridge with LAN / `NO_PROXY` handling
- Thinking menu: **Off / Low / Standard / Deep** (same as DeepSeek V4)
- Deduplicated streaming usage reports (v1.2.0) — prevents inflated token counts
- **OpenCode Go session affinity** (v1.3.0) — auto `x-opencode-session` / `x-opencode-client` / `User-Agent` for `opencode.ai` backends
- **Vision tool-result images** (v1.3.1) — align DeepSeek V4 0.8.2: describe tool screenshots via vision proxy; native mode passes `image_url`
- **No 128-tool hard cap** (v1.3.2) — cherry-pick DeepSeek 0.9.4 #291; safer deactivate (0.9.1 #271)

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
