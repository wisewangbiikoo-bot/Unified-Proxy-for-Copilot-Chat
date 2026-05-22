## Unified Proxy for Copilot Chat v1.0.3

Route **multiple OpenAI-compatible backends** into the GitHub Copilot Chat model picker via `proxy_configs.json`. Built on [DeepSeek V4 for Copilot Chat v0.5.2](https://github.com/Vizards/deepseek-v4-for-copilot).

### Install

1. Download **`unified-proxy-copilot-1.0.3.vsix`** below.
2. In VS Code: Extensions → `...` → **Install from VSIX...**
3. Or: `code --install-extension unified-proxy-copilot-1.0.3.vsix`
4. Create/edit `%USERPROFILE%\.vscode\proxy_configs.json` (see `proxy_configs.json.example` in the repo).
5. Run **Unified Proxy: Reload Config**, then pick a model under **Unified Proxy** in Copilot Chat.

**Requirements:** VS Code 1.116+, GitHub Copilot Chat.

### Highlights (1.0.0 → 1.0.3)

- **Config-only models** — no built-in placeholder; each `proxies` entry = one Copilot model
- **Per-proxy options** — images, 128K context, max output, temperature, thinking default
- **LAN / corporate proxy** — SSE child-process bridge, `NO_PROXY` from config
- **Agent + tools** — inherited from DeepSeek V4; tool schema sanitization for gateways like Kiro-go
- **Docs** — [Why Unified Proxy?](https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/blob/main/docs/WHY_UNIFIED_PROXY.zh-cn.md) (中文) · [English](https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/blob/main/docs/WHY_UNIFIED_PROXY.md)

### v1.0.3 changes

- Removed built-in `unified-proxy` placeholder and hardcoded config template
- Backends load **only** from `proxy_configs.json`
- `proxyConfigPath` setting respected

Full changelog: [changelog.md](https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/blob/main/changelog.md)
