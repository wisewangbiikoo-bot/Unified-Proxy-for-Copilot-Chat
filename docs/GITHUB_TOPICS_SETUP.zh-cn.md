# GitHub 仓库 Topics（标签）怎么加

GitHub 在 **About → ⚙ → Topics** 里的提示是：

> **Topics (separate with spaces)** — 用**空格**分隔，每个标签 ≤ 50 个字符。

也就是说：**一个输入框、空格分开多个词**，不是逗号，也不是一行一个回车。

---

## 正确填写方式（复制下面整行）

1. 打开：https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat  
2. 右侧 **About** → **⚙**  
3. 在 **Topics** 输入框里 **整段粘贴下面这一行**（词与词之间是**空格**，没有逗号）：

```
vscode-extension github-copilot copilot-chat openai-compatible unified-proxy deepseek-v4 self-hosted agent-mode tool-calling json-config language-model bring-your-own-key local-proxy typescript copilot deepseek vscode proxy chat ai
```

4. 点击 **Save changes**

共 **20 个** 标签（GitHub 上限），每个词 ≤ 50 字符。

---

## 为什么会报错？

| 错误写法 | 原因 |
|----------|------|
| `vscode-extension, github-copilot` | 用了**逗号**，应改为**空格** |
| `openai compatible` | 标签名里不能有**空格**（应用 `openai-compatible`） |
| `proxy_configs` | 不能有**下划线** `_` |
| `Unified-Proxy` | 必须**全小写** |
| 超过 20 个词 | GitHub 最多 20 个 Topics |

报错 *must start with a lowercase letter…* 时，多半是某个「词」里带了逗号、空格或非法字符，不是整句提示的字面意思。

---

## 想少加几个（最短示例）

只加核心 5 个时，可粘贴：

```
vscode-extension github-copilot copilot-chat openai-compatible unified-proxy
```

---

## 方法二：Actions 自动同步（可选）

列表文件：[`.github/repository-topics.txt`](../.github/repository-topics.txt)（每行一个词，供 Actions 用；**手动填写请用上面空格那一行**）。

需 **Workflow permissions = Read and write**，否则用手动方式即可。

- 账号设置：https://github.com/settings/actions  
- 运行工作流：https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/actions/workflows/sync-topics.yml → **Run workflow**

---

## 验证

保存后 About 下方出现灰色标签，或访问：  
https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/topics
