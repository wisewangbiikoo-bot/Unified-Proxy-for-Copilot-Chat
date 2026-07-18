# Configure proxy_configs.json

Unified Proxy loads backends from a JSON file. **Default path:** `~/.vscode/proxy_configs.json`

Create the file (or copy from `proxy_configs.json.example` in the extension folder). Use **placeholder hosts and keys only** in samples:

```json
{
  "proxies": {
    "my-model": {
      "name": "My Model",
      "description": "Example OpenAI-compatible backend",
      "base_url": "http://proxy.example.com:8080/v1",
      "api_key": "YOUR_API_KEY",
      "model_id": "model-name-on-upstream"
    }
  }
}
```

Then run **[Unified Proxy: Reload Config](command:unified-proxy-copilot.reloadConfig)** and pick **my-model** under the **Unified Proxy** vendor in Copilot Chat.

Full field reference: see **README.zh-cn.md** in the extension folder. General Copilot/agent behavior: **DeepSeek V4 for Copilot Chat v0.6.2** docs.
