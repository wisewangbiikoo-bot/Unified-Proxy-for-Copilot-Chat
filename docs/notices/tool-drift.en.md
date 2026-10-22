# Tool-list drift notice

VS Code Copilot Chat may pass different tool subsets to a Language Model Provider across turns (user toggles, Agent/MCP tools). That is “tool-list drift”.

## Tool count limits

Older DeepSeek Chat Completions docs mentioned a max of **128** tools per request. Upstream **DeepSeek V4 for Copilot Chat 0.9.4** (#291) removed the extension-side hard cap; **Unified Proxy v1.3.2** likewise no longer rejects requests with more than 128 tools.

Whether a large tool list works still depends on your **upstream backend** (OpenCode Go, self-hosted gateway, official DeepSeek, etc.). If the backend errors, disable unused tools via VS Code **Configure Tools**.

## Experimental tool-list stabilization

With the experimental stabilize-tool-list setting enabled, each request may include more function definitions (names, descriptions, and JSON schemas), so **input tokens** can increase. Cache-hit input tokens are billed at a lower price but still count toward usage. Usually unnecessary with fewer than **64 enabled tools**; with very large tool sets, weigh latency and cost yourself.
