# Changelog

**Unified Proxy for Copilot Chat** (publisher `biikoo`)

## [1.0.5] — 2026-06-02

### Fixed

* **Extension activation crash** — `no_proxy.js` was missing `const os = require("os")` and `const path = require("path")` imports in the `mergeVscodeNoProxyHosts()` function. Caused `ReferenceError: path is not defined` during startup on clean installs.

## [1.0.4] — 2026-05-23

### Fixed

* **Critical:** Extension failed to activate (`path is not defined` in `no_proxy.js`), so Copilot showed `[LM] No provider registered for vendor unified-proxy` and fell back to GitHub Copilot models. Restored missing `path` / `os` imports.

## [1.0.3] — 2026-05-20

### Removed

* Built-in placeholder model `unified-proxy` and hardcoded `DEFAULT_CONFIG_TEMPLATE` (no fallback when config is missing or empty).
* Legacy API Key / `proxyBaseUrl` / DeepSeek `baseUrl` routing path — backends come only from `proxy_configs.json`.

### Changed

* Empty or invalid config yields zero models in the picker (no built-in default).
* First-run template copies `proxy_configs.json.example` only, or writes `{ "proxies": {} }`.
* `proxyConfigPath` setting is honored when resolving the config file path.

## [1.0.2] — 2026-05-20

### Added

* Extension icon (`resources/icon.png`).
* `proxy_configs.json.example` template; auto-copy on first run when config is missing.
* Per-model optional fields: `supports_images`, `context_window_size`, `max_output_tokens`, `temperature`, `thinking_mode`.
* Child-process `sse_bridge.js` for SSE streaming outside the Extension Host (avoids empty bodies behind VS Code HTTP proxy).
* `NO_PROXY` / `http.noProxy` merge for LAN hosts from config.

### Changed

* Default context window **128K** (128000 tokens); Copilot shows **128K** instead of inflated 131K/164K when max output is unlimited.
* Model picker: thinking-effort line shows enum descriptions (Off / Standard / Deep); proxy `description` stays in the configuration schema header.
* Walkthrough, `package.nls` / `package.nls.zh-cn`, and marketplace copy rebranded to Unified Proxy.
* Provider ID `unified-proxy`.

### Fixed

* Tool schema sanitization when tools lack `parameters` (fixes 200 + empty SSE on some gateways).
* Retry path: sanitized tools, then strip tools on persistent failure.
* Clear `HTTP_PROXY` / `HTTPS_PROXY` in the SSE bridge child environment for direct LAN access.
* `ETIMEDOUT` when system proxy intercepted private `base_url` hosts.

### Documentation

* `README.zh-cn.md`, `readme.md`, `README_INSTALL.md` — setup and `proxy_configs.json` reference (placeholder hosts/keys only).
* Walkthrough: configure proxy config, show models, advanced settings.

## [1.0.1] — 2026-05-19

### Fixed

* SSE streaming via Node `http`/`https` instead of Extension Host `fetch` (`Content-Length: 0` could end the stream with zero chunks).
* Request pipeline logging: `convertMessages done`, HTTP status, first chunk, stream end.

## [1.0.0] — 2026-05-18

### Added

* Initial release of **Unified Proxy for Copilot Chat**.
* Multi-backend routing from `~/.vscode/proxy_configs.json` (override via `unified-proxy-copilot.proxyConfigPath`).
* One Copilot model per `proxies` entry; commands **Reload Config**, **Show Logs**, **Open Settings**.
* OpenAI-compatible chat completions per proxy `base_url`, `api_key`, and `model_id`.
* Agent mode, tool calling, thinking effort (`none` / `high` / `max`), vision proxy, reasoning replay, token usage reporting.
