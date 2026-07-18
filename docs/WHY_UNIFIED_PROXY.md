# Why Unified Proxy for Copilot Chat

This document explains **positioning, key advantages, comparison with similar extensions**, and **who should (or should not) use** this extension. For setup and `proxy_configs.json`, see [README.zh-cn.md](../README.zh-cn.md) (Chinese, full config reference) or the quick start in [readme.md](../readme.md).

---

## Positioning

**Unified Proxy** is not just another single-vendor Copilot bridge. It is:

> **One `proxy_configs.json` file** maps multiple **OpenAI-compatible proxies** (LAN gateways, self-hosted stacks, unified entrypoints) into separate models in the **GitHub Copilot Chat** picker, while keeping **DeepSeek V4 for Copilot Chat**-level agent, tool, and thinking support.

Built on [DeepSeek V4 for Copilot Chat v0.6.2](https://github.com/Vizards/deepseek-v4-for-copilot) (MIT). Provider ID: `unified-proxy` — can be installed **alongside** the official DeepSeek V4 extension (`deepseek`) without conflicting model vendors.

---

## Key advantages

### 1. One JSON file, many backends → picker stays in sync

| Capability | Description |
|------------|-------------|
| Config-driven | Each key under `proxies` = one model in Copilot (e.g. `claude`, `gemini`, `deepseek`) |
| Hot reload | Run **Unified Proxy: Reload Config** after editing the file |
| Centralized | `base_url`, `api_key`, `model_id`, temperature, context — one place for multi-port LAN setups |

Ideal if you already run an **AI proxy manager** or several OpenAI-compatible services and want one Copilot UI for all of them.

### 2. Deep Copilot integration (not chat-only)

Inherited from upstream v0.6.2:

- **Agent mode** — edits, terminal, search, Git, tests, MCP, skills
- **Tool calling** — full Copilot tool chain; **schema sanitization** for gateways like Kiro-go
- **Thinking modes** — Off / Standard / Deep (Copilot-native menu); per-model defaults in JSON
- **Vision proxy** — describe images via another Copilot model when the backend is text-only
- **Reasoning replay, token usage** — same family of behavior as upstream (see upstream docs)

Many “OpenAI Compatible Copilot” extensions focus on **listing models**; this extension keeps the **agent + tools** stack from DeepSeek V4.

### 3. Hardened for LAN and corporate HTTP proxies

- **Child-process `sse_bridge.js`** — SSE outside the Extension Host when streams break behind proxies
- **`NO_PROXY` merge** — hostnames from `base_url` in your config
- **Clear proxy env in child** — direct access to private `base_url` hosts

Useful when **system HTTP_PROXY** breaks localhost/LAN OpenAI-compatible endpoints.

### 4. Per-model tuning (not one global preset)

Each proxy entry supports (see `proxy_configs.json.example`):

| Field | Purpose |
|-------|---------|
| `supports_images` | Vision-related handling on/off |
| `context_window_size` | Context window (e.g. `128K` → 128000 in UI) |
| `max_output_tokens` | Cap output; omit when unlimited |
| `temperature` | Sampling temperature |
| `thinking_mode` | Default thinking level |

### 5. Clear privacy boundary

- **No baked-in IPs or API keys** in the extension package
- Secrets live only in **`~/.vscode/proxy_configs.json`** on the user machine
- Repo tracks **`proxy_configs.json.example`** (placeholders only); see `.gitignore`

---

## Comparison with similar extensions

Many extensions use the [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider). Search `@tag:language-models` in VS Code Marketplace. Typical comparisons:

| Alternative | Unified Proxy strengths | Their typical strengths |
|-------------|-------------------------|-------------------------|
| [DeepSeek V4 for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot) | **Multi-backend JSON**, LAN proxies, per-model options | DeepSeek-focused, large install base, upstream maintenance |
| [OAI Compatible Provider for Copilot](https://marketplace.visualstudio.com/items?itemName=johnny-zhao.oai-compatible-copilot) | **File-driven models** + DeepSeek V4 agent stack | Broad protocol / Ollama / NIM ecosystem |
| [OAIProvider](https://marketplace.visualstudio.com/items?itemName=calgan.oai-provider) | Single JSON for homelab multi-port setups | UI wizards, multiple provider entries |
| [Unify Chat Provider](https://marketplace.visualstudio.com/items?itemName=SmallMain.vscode-unify-chat-provider) | Lightweight, proxy-list focused | Multi-account / quota aggregation |
| [Copilot ++](https://marketplace.visualstudio.com/items?itemName=OEvortex.better-copilot-chat) | Simple JSON, narrow scope | 20+ preset cloud vendors |
| VS Code [BYOK / Custom Endpoint](https://code.visualstudio.com/docs/copilot/customization/language-models) | **One JSON for many LAN proxies** | No extra extension; Microsoft-maintained |

**Takeaway:** “Multiple OpenAI backends in Copilot” already exists; fewer extensions combine **`proxy_configs.json`-only workflow**, **LAN/self-hosted focus**, and **DeepSeek V4’s full agent path**.

---

## Who it’s for / not for

### Good fit

- Multiple **OpenAI-compatible proxies** (ports / upstream models)
- Need **Copilot Chat + Agent + tools**, not plain chat
- **Private `base_url`** behind corporate HTTP proxy
- Prefer API keys in a **local JSON** file aligned with proxy-manager workflows

### Less ideal

- **Single public API only** → official DeepSeek V4 or built-in BYOK may be simpler
- **One local Ollama URL only** → LM Studio–style extensions may fit better
- Prefer **GUI wizards** over JSON → e.g. OAIProvider-style extensions

---

## Marketplace one-liners (optional copy)

1. **One `proxy_configs.json` → many Copilot Chat models** for LAN / self-hosted OpenAI-compatible proxies.  
2. **Full Copilot agent stack**: tools, thinking modes, vision proxy — built on DeepSeek V4 v0.6.2.  
3. **LAN-friendly streaming**: SSE child-process bridge and proxy bypass for corporate networks.

---

## See also

- [README.zh-cn.md](../README.zh-cn.md) — full Chinese guide and config reference  
- [readme.md](../readme.md) — English quick start  
- [README_INSTALL.md](../README_INSTALL.md) — VSIX install and Git  
- [changelog.md](../changelog.md) — release notes  
- [DeepSeek V4 for Copilot Chat](https://github.com/Vizards/deepseek-v4-for-copilot) — upstream agent behavior  
