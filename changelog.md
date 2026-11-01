# Changelog

**Unified Proxy for Copilot Chat** (publisher `biikoo`)

## [2.0.36] — 2026-11-01

### Fixed

* **Large context 400** — clamp `max_tokens` so prompt + max_tokens ≤ context window
  (was sending catalog output 384000 with ~664k prompt → OpenCode 400 empty stream).

## [2.0.35] — 2026-11-01

### Fixed

* **Session affinity** — only bind `x-opencode-session` to segment when replay marker exists;
  never use per-request random UUID (that busted large-context cache).

## [2.0.34] — 2026-11-01

### Fixed

* **Large-context Agent empty replies** — accumulate OpenCode `tool_calls` by index even when
  later chunks send `id:""` (was dropped → Copilot “no response”).
* **Cache stats** — read OpenCode `cached_tokens` / `opencode.tokens.cache_read` (was always 0).
* **Session affinity** — use conversation segment id for `x-opencode-session` when unset.

## [2.0.33] — 2026-11-01

### Fixed

* **Empty `[DONE]` path** — `data: [DONE]` now goes through the same empty-stream rejection
  (previously `resolve()` bypassed the check).

## [2.0.32] — 2026-11-01

### Fixed

* **Empty upstream stream** — treat zero content/thinking/tools as an error (with finish_reason log)
  instead of silent success that becomes Copilot “no response”. Hint: huge Agent context.

## [2.0.31] — 2026-11-01

### Fixed

* **Cancelled stream ≠ empty success** — SSE bridge cancel now rejects with `CancellationError`
  instead of `resolve()` (which made Copilot show “Sorry, no response was returned”).
* **Stream diagnostics** — log cancel / reject / zero-part finishes for easier Agent retry diagnosis.

## [2.0.30] — 2026-10-31

### Fixed

* **标签下空白** — 全局 `#status` 为空时隐藏，收紧 tabs 与内容间距（目录信息已迁到「模型」页）。

## [2.0.29] — 2026-10-31

### Changed

* **模型目录状态** —「已加载上次列表 / 已刷新」只显示在「模型」标签页，不再出现在「当前模型」等页。

## [2.0.28] — 2026-10-31

### Fixed

* **思考模式默认值** — 配置未写 `thinking_mode` 时解析为「标准」(high)，不再误显示「停用」。
  显式写「停用」/none 仍生效。

## [2.0.27] — 2026-10-31

### Changed

* **Quota counters per account** — OC forward count is keyed by `providerId::accountId`;
  5m window / open-settings only refresh when the *current* account's counter &gt; 0,
  and only that account's counter is cleared after refresh.

## [2.0.26] — 2026-10-31

### Fixed

* **当前模型 tip CSS** — 补齐字号对齐与进度条 `max-width: 220px`（2.0.25 漏打样式）。

## [2.0.25] — 2026-10-31

### Changed

* **当前模型 tip** — 上游 limit 改中文（上下文/输出/视觉/工具/思考）。

## [2.0.24] — 2026-10-31

### Changed

* **Quota on open settings** — if OC Go forward counter &gt; 0, silent refresh once and
  reset counter (then load settings tip with fresh %).

## [2.0.23] — 2026-10-31

### Changed

* **「当前模型」UI** — help text on tab hover; remove name/URL lines; usage block
  uses progress bars like the status-bar hover dialog.

## [2.0.22] — 2026-10-31

### Fixed

* **Settings「当前模型」用量账号** — show provider name + fetch that provider’s key
  usage (not global snapshot / `acc_…` id).

## [2.0.21] — 2026-10-31

### Fixed

* **Hover「账号」** — show provider name (e.g. `OpenCode Go · gmail`) instead of
  OpenCode `user_…` subscriber id.

## [2.0.20] — 2026-10-31

### Fixed

* **Quota account vs 自动分配** — status bar usage follows auto-assign「当前选用」
  provider (e.g. gmail), not the first OpenCode provider (163). Switching current
  silently refreshes that account’s monthly %.

## [2.0.19] — 2026-10-31

### Changed

* **Status bar after silent quota fetch** — update monthly `%` text only when it
  actually changes (no spinner; no flicker when unchanged).

## [2.0.18] — 2026-10-31

### Changed

* **Quota refresh** — only: (1) silent fetch on reload/activate; (2) every 5 minutes,
  refresh once if any OpenCode Go API forwards in that window, then reset counter.
  Removed focus/idle/every-N/statusbar-click refreshes and status-bar spinner/flash.

## [2.0.17] — 2026-10-31

### Changed

* **Model discovery switches** — smaller toggle knobs on catalog rows.

## [2.0.16] — 2026-10-31

### Changed

* **辅助模型** — configure OpenAI-compatible `base_url` + `model_id` + `api_key` per
  vision / web-extract (not pick from enabled list). Legacy `aux.*.ref` still works.

## [2.0.15] — 2026-10-31

### Fixed

* **「当前模型」默认跟自动分配** — when the pool is set, settings show the auto-assign
  「当前选用」(e.g. flash-gmail) instead of the previous chat’s flash-163.

## [2.0.14] — 2026-10-31

### Fixed

* **「当前模型」vs「自动分配」混淆** — 当前模型页标明自动分配实际指向；改「当前选用」
  立即写入并刷新，不再被上次聊天的 163 条目误导。

## [2.0.13] — 2026-10-31

### Fixed

* **Auto-assign checkbox → 当前选用** — wire `change` listener so newly checked models
  (e.g. GLM-5.3) appear in the dropdown before Save; status reminds to save.

## [2.0.12] — 2026-10-31

### Fixed

* **Auto-assign「当前选用」 helpers** — `fillAutoCurrentSelect` from live checkboxes;
  help text notes Save is required.

## [2.0.11] — 2026-10-31

### Fixed

* **Auto-assign pool blank rows** — webview flex+`overflow:hidden` clipped all pool
  text; switched to CSS grid so names/meta show beside checkboxes.

## [2.0.10] — 2026-10-31

### Fixed

* **Auto-assign pool layout** — model names wrapped one character per line (`word-break:
  break-all` inside flex); now ellipsis row with stable checkbox alignment.

## [2.0.9] — 2026-10-31

### Added

* **Remember model catalog** — last Refresh result per provider is kept in globalState;
  reopening settings restores the list (enabled flags re-synced); Refresh still updates.

## [2.0.8] — 2026-10-31

### Added

* **Model discovery cost** — show upstream `$input/$output` (USD per 1M tokens) next to
  ctx/out in each catalog row.

## [2.0.7] — 2026-10-31

### Fixed

* **Model switch double-fire** — native `<button>:active` theme flash + `click` looked
  like press+release both toggled; now `div[role=switch]` with a single `pointerup`,
  pending lock, and non-blocking enable (write first, fill limits in background).

## [2.0.6] — 2026-10-31

### Changed

* **Model discovery list** — each row shows upstream limits (`ctx` / `out` / 视觉 /
  工具 / 思考); row padding and font size reduced for denser list.

## [2.0.5] — 2026-10-31

### Fixed

* **Model toggle UI stale** — enabling/disabling wrote config but list stayed wrong;
  optimistic update + re-sync after save.

## [2.0.4] — 2026-10-31

### Added

* **Provider「修改」** — edit name / base_url / api_key without delete+re-add.

## [2.0.3] — 2026-10-31

### Fixed

* **Settings「当前模型」错成自动分配** — fallback used `models[0]` which is the virtual
  auto-assign entry; now prefers last chat model, resolves auto-assign → target, and
  adds a model dropdown to pick what you edit.

## [2.0.2] — 2026-10-31

### Fixed

* **Status bar hidden on schema v2** — `configHasOpenCodeGo()` only looked at legacy
  `proxies`; with `providers` it returned false and hid the bar after every refresh.

## [2.0.1] — 2026-10-31

### Changed

* **Provider = one URL + one API key** — only `name` / `base_url` / `api_key` (same
  vendor with different keys = multiple provider rows). Removed nested `accounts` /
  `account_switch` on providers.
* **`auto_assign`** — top-level pool of enabled model ids + rotate mode; Copilot shows
  virtual model **自动分配**. Migrate expands legacy multi-key proxies into providers
  and fills `auto_assign.model_ids`.

## [2.0.0] — 2026-10-31

### Added

* **Config schema v2** — `schema_version: 2` with `providers` + `models` + `aux`.
  Legacy v1 `{ "proxies": … }` still loads read-only; **Upgrade to 2.0** in settings
  backs up then migrates.
* **Provider UI** — add / delete OpenAI-compatible backends (URL + API key) in settings.
* **Model discovery** — Refresh `GET /models`, toggle enable; auto-fill params from
  upstream limits (`param_source: auto`). User edits mark `param_source: user` and are
  not overwritten on refresh.
* **Auxiliary models** — global `aux.vision` (image describe) and `aux.web_extract`
  (long page tool-result summarize). Default = use main model (`ref: null`).

### Changed

* Copilot picker lists only **enabled** v2 models (`providerId__modelId`).
* Settings webview tabs: 当前模型 / 供应商 / 模型 / 辅助模型.

## [1.5.0] — 2026-10-31

### Added

* **Multi-account per proxy** — optional `accounts: [{ id, name, api_key }, …]` plus
  `account_switch: { mode: "manual"|"rotate", rotate_minutes, rotate_every_n_requests }`.
  * **manual (default)**: command **Switch Account**, or settings panel account picker
  * **rotate**: timed and/or every-N-request advance; manual pick still works
  * Active account stored in `globalState` only (not written to `proxy_configs.json`)
  * Legacy single `api_key` still works (one implicit account)
* **Settings webview** — **Unified Proxy: 设置** / status-bar click opens a compact panel
  (account switch, rotate mode, thinking default, context / max output / temperature).
  Hints sit behind `!` tooltips; account switch applies immediately.
* **Custom status-bar icon** (`$(unified-proxy)`) on the right, near Copilot Chat.
* **Copilot-like usage hover** — month / week / 5h meters + account + update time.

### Changed

* **Status bar label** shows monthly usage % (e.g. `21%`) so you see quota without relying
  on hover refresh (VS Code Stable has no status-bar hover-fetch API).
* **Quota % matches OpenCode console** — prefer `go/status` `access.meters` + round;
  fall back to floored `/zen/go/v1/usage` when meters are missing.
* **Refresh triggers** — window focus / idle→active, chat request bursts, status-bar click,
  and **Refresh Usage**. Hover is detail-only (does not re-fetch).

### Fixed

* **Usage account label is OpenCode Go identity**, not proxy/model name.
  From `GET https://opencode.ai/console/api/go/status` → `subscriberUserId`
  (e.g. `user_…35E4PN`). Optional local `accounts[].name` is alias-only.

## [1.4.2] — 2026-10-30

### Changed

* **Request-driven usage refresh** (replaces short interval polling as primary):
  * After a chat/API burst goes idle (~1.2s) → refresh once (end of a turn / “大对话”)
  * Every `usageRefreshEveryNRequests` usage events (default **3**) → refresh immediately
  * `usagePollMinutes` default **0 = off** (optional backup only)
  * Window focus only refreshes if there were pending API events

## [1.4.1] — 2026-10-30

### Changed

* **Usage auto-refresh** — default `usagePollMinutes` **10 → 5**; also refresh when
  the VS Code window regains focus. Status bar tooltip states auto-refresh rules;
  Show Usage document notes it is a snapshot (not live).

## [1.4.0] — 2026-10-30

### Added

* **OpenCode Go usage status bar** — polls `GET {base_url}/usage` for rolling (5h) /
  weekly / monthly `percent`; tooltip shows `resetsAt`. Setting
  `showUsageStatusBar`: `auto` | `always` | `off`; `usagePollMinutes` (default 5 as of 1.4.1).
* **Commands** — `Unified Proxy: Show Usage` (quota + today's local token totals),
  `Unified Proxy: Refresh Usage`.
* **Local token totals** — accumulate prompt/completion from chat stream `usage`
  into `globalState` (per day / per model; not written to `proxy_configs.json`).
  Debounced quota refresh after chats that report usage.

## [1.3.6] — 2026-10-30

### Docs

* Synced **readme.md**, **README.zh-cn.md**, **WHY_UNIFIED_PROXY.md**,
  **WHY_UNIFIED_PROXY.zh-cn.md** on auto-detect from `/v1/models`, omit-or-`0`,
  memory-only behavior, and force-off via `false`/`off`.

## [1.3.5] — 2026-10-30

### Changed

* **Numeric `0` means auto-detect** (same as omitting the field) for
  `context_window_size`, `max_output_tokens`, `supports_images`, `supports_tools`,
  `supports_thinking`. To force images/tools/thinking off, use `false` / `off` /
  `none` (not bare `0`). Still memory-only; never writes `proxy_configs.json`.

## [1.3.4] — 2026-10-30

### Added

* **Auto vision / tools / thinking from upstream `/v1/models`** — when omitted:
  * `supports_images` ← `modalities.input` contains `image/*` → native `2`, else `0`
    (mode `1` describe-proxy is never auto; config-only)
  * `supports_tools` ← `capabilities.tools.supported`
  * `supports_thinking` (new optional field) ← `capabilities.reasoning.supported`
  Explicit config always wins. Plain OpenAI catalogs without these fields keep
  previous defaults (images off, tools/thinking on).
  **Memory-only** — never writes back to `proxy_configs.json`; re-probes on each
  startup / Reload Config.

## [1.3.3] — 2026-10-30

### Added

* **Auto context / output limits from upstream `/v1/models`** — if a proxy entry
  omits `context_window_size` and/or `max_output_tokens`, the extension GETs
  `{base_url}/models` after load/reload and fills from OpenCode-style
  `limit.context` / `limit.output` (also accepts common aliases such as
  `context_window`, `max_model_len`, `max_output_tokens`). Explicit config values
  always win. Failure falls back to previous defaults (128K context; unlimited
  output). Results cached ~10 minutes per base URL.

## [1.3.2] — 2026-10-22

### Fixed

* **Remove stale 128-tool limit** — aligned with DeepSeek V4 **0.9.4** [#291](https://github.com/Vizards/deepseek-v4-for-copilot/issues/291).
  `toolCalling` is now a boolean capability; requests no longer throw when Copilot
  enables more than 128 tools (common with Agent + MCP).
* **Deactivate without `selectChatModels`** — aligned with DeepSeek V4 **0.9.1** [#271](https://github.com/Vizards/deepseek-v4-for-copilot/issues/271).
  Avoids potential Copilot BYOK teardown deadlock; still fires the model-info change event.

### Notes

* Upstream baseline remains **DeepSeek V4 for Copilot Chat v0.8.2**, with these two
  cherry-picks from 0.9.x. Skipped DeepSeek-only items (V4.1 catalog, pricing UI, settings UX).

## [1.3.1] — 2026-09-08

### Added

* **Align with DeepSeek V4 for Copilot Chat v0.8.2 vision stack**
  * Tool-result images described via vision proxy (`supports_images=1`) — upstream #260
  * Shared lazy vision description session for user-tail + tool images — upstream #261
  * Replay marker `toolVision` so follow-up turns reuse descriptions
  * Native multimodal path (`supports_images=2`) forwards tool-result images as `image_url`
  * `vision_proxy.timeout_ms` configurable endpoint timeout — upstream 0.8.1 #203

### Changed

* Upstream baseline reference: **DeepSeek V4 for Copilot Chat v0.7.1 → v0.8.2**
* Skipped DeepSeek-only pieces (fixed Flash Vision Exp catalog, picker pricing UI)

## [1.3.0] — 2026-09-08

### Added

* **OpenCode Go `x-opencode-session`** — auto-injects affinity headers required by
  Console Go (fixes `MissingSessionID` / HTTP 400). Same approach as
  `local_openai_forward.py`.
  * Default session value: `local-openai-forward-affinity-v1` (setting
    `unified-proxy-copilot.openCodeSessionId`, or per-proxy `opencode_session` /
    `custom_headers`)
  * Also sends `x-opencode-client` + `User-Agent: unified-proxy-copilot/<version>`
  * Mode setting `unified-proxy-copilot.openCodeSession`: `auto` / `always` / `off`
  * Vision endpoint proxies to OpenCode Go get the same headers
* **`custom_headers` on main proxy entries** — optional extra HTTP headers for
  chat completions (previously only on `vision_proxy`)
* **SSE bridge `SSE_BRIDGE_HEADERS`** — child process forwards JSON extra headers

### Notes

* Upstream baseline remains **DeepSeek V4 for Copilot Chat v0.7.1**. OpenCode Go
  session support is additive (not present in upstream 0.7.1 / 0.8.2 yet).

## [1.2.3] — 2026-08-18

### Added

* **Low reasoning effort (轻量推理)** — sync upstream DeepSeek V4 0.7.0/0.7.1:
  model picker thinking menu now offers `none / low / high / max`; `proxy_configs.json`
  `thinking_mode` accepts `low` / `light` / `轻量` / `轻度` etc. and maps to
  `reasoning_effort: low`.

### Fixed

* **Mark models as BYOK** — sync upstream 0.6.2 (#162): `toChatInfo` now sets
  `isBYOK: true` so Copilot Chat renders the BYOK badge correctly.
* **Vision model selection disambiguation** — sync upstream 0.6.2 (#161): the
  vision proxy model picker now saves `vendor/id` instead of a bare model id;
  legacy bare ids are still read for compatibility.
* **Explicit thinking-off payload** — when thinking is disabled, the request now
  sends `chat_template_kwargs: { enable_thinking: false }` for backends that need
  the explicit flag instead of relying on `thinking.type: disabled` alone.

## [1.2.2] — 2026-08-18

### Fixed

* **Model picker refresh race on startup** — after loading models, force the host to
  re-pull `provideLanguageModelChatInformation` synchronously via
  `selectChatModels({ vendor: 'unified-proxy' })`, and re-fire the change event at
  2s / 5s delays so the picker still shows models if Copilot Chat missed the first
  event during startup.

## [1.2.1] — 2026-07-18

### Fixed

* **Retry on upstream provider errors** — `client.js` now retries once with 1s delay
  when the upstream returns "Upstream request failed" or HTTP 5xx errors, reducing
  transient failures from providers like Console Go (Kimi, MiniMax).

## [1.2.0] — 2026-07-14

### Changed

* **Dedupe streaming usage reports** (#145 upstream) — `client.js` accumulates usage
  from SSE chunks and emits only once at stream end, preventing inflated token counts
  in Copilot UI when backends send per-chunk usage.
* **Wrap usage reporting in try/catch** (#145) — `stream.js` guards
  `reportCopilotContextUsage` so a rejected data part doesn't block replay marker
  or cache diagnostics.
* **Improved error diagnostics** (#104/#109) — `client.js` now logs detailed error
  context (target URL, specific failure hints for timeout/DNS/auth/reset) and
  `stream.js` logs error with model name before re-throwing.

## [1.1.0] — 2026-07-14

### Added

* **Configurable vision proxy per backend** — `vision_proxy` field in `proxy_configs.json`. Each proxy entry with `supports_images: 1` can now specify its own vision backend via endpoint (OpenAI Chat, OpenAI Responses, Anthropic Messages) instead of relying solely on VS Code LM API. See README.zh-cn.md for details.
* **New files**: `out/provider/vision/endpoint.js` — endpoint-based vision describer client supporting three protocols.

## [1.0.9] — 2026-07-14

### Fixed

* **SSE streaming UTF-8 split‑character corruption** — `client.js` used `chunk.toString("utf8")` which produces `�` (U+FFFD) when a multi‑byte character (e.g. Chinese) is split across two TCP/HTTP chunks. Replaced with `TextDecoder(stream: true)` that preserves partial byte state across decode calls.

## [1.0.8] — 2026-07-11

### Changed

* **`supports_images` 三档模式**
  * `0` — 不支持图片，丢弃图片附件
  * `1` — 旧路径：经 VS Code 识图代理转成文字描述后再发给后端
  * `2` — 原生多模态：将图片转为 OpenAI `image_url`（`data:image/...;base64,...`）发给后端（如 LM Studio + mmproj）
* 布尔值兼容：`true` → `1`，`false` → `0`
* Copilot UI `imageInput` 在模式 `1`/`2` 时开启，允许贴图

### Fixed

* 模式 `2` 下不再误走「识图转文字」导致出现 `[Image Description unavailable]`
* `dump` 写入首条 message 时兼容 `content` 为数组（多模态）

## [1.0.6] — 2026-06-07

### Added

* **Gemma 4 channel-token cleanup** — strip `<|channel>thought` / `<|channel|>` leaks from streamed `content` and `reasoning_content` when the upstream LM Studio reasoning parser is unset or incomplete.
* **Auto-reload on config change** — watch `proxy_configs.json` and refresh the model picker when the file is saved (debounced).

### Fixed

* **Markdown layout collapsed to plain text** — removed the cross-chunk Gemma filter buffer that discarded newline-only SSE deltas; filtering is now per-chunk so lists, headings, and code blocks render correctly in Copilot Chat.
* **`no_proxy.js` import corruption** — remove duplicated `os` / `path` requires introduced in the v1.0.5 build.
* **`supports_tools` honored** — respect `supports_tools: 0` in `proxy_configs.json` when advertising tool-calling capability to Copilot.

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
