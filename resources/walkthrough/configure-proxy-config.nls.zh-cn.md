# 配置 proxy_configs.json

Unified Proxy 从 JSON 文件加载后端。**默认路径：** `~/.vscode/proxy_configs.json`

创建该文件（或从扩展目录中的 `proxy_configs.json.example` 复制）。**示例中请仅使用占位符**，不要写入真实内网 IP 或 API Key：

```json
{
  "proxies": {
    "my-model": {
      "name": "我的模型",
      "description": "示例 OpenAI 兼容后端",
      "base_url": "http://proxy.example.com:8080/v1",
      "api_key": "YOUR_API_KEY",
      "model_id": "upstream-model-id"
    }
  }
}
```

然后执行 **[Unified Proxy: Reload Config](command:unified-proxy-copilot.reloadConfig)**，在 Copilot Chat 的 **Unified Proxy** 提供商下选择 **my-model**。

完整字段说明见扩展目录 **README.zh-cn.md**。Agent、工具、视觉代理等通用能力请参阅 **DeepSeek V4 for Copilot Chat v0.6.2** 官方文档。
