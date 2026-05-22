# GitHub 仓库 Topics（标签）怎么加

GitHub **About → Topics** 输入框规则：

| 规则 | 说明 |
|------|------|
| **空格分隔** | 提示 *Topics (separate with spaces)*，用空格分开多个词，**不要用逗号** |
| **整行 ≤ 约 200 字符** | 所有标签加空格算在一起，**不能超过约 200 字**（否则保存失败） |
| **每个词 ≤ 50 字符** | 单个标签名长度上限 |
| **最多 20 个词** | 标签个数上限 |
| **字符** | 仅小写字母、数字、连字符 `-` |

> API / Actions 可设置最多 20 个标签（见 `repository-topics.txt`）；**网页里手动填写**受「一行 200 字符」限制，请用下面短行。

---

## 手动填写：复制这一行（169 字符，≤200）

1. https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat  
2. **About** → **⚙** → **Topics**  
3. 粘贴（**仅空格**，无逗号）：

```
vscode-extension github-copilot copilot-chat openai-compatible unified-proxy deepseek-v4 self-hosted agent-mode tool-calling json-config deepseek copilot vscode proxy ai
```

4. **Save changes**

共 **16 个** 核心标签，已控制在 200 字符以内。

---

## 更短（约 124 字符，5 个核心词）

```
vscode-extension github-copilot copilot-chat openai-compatible unified-proxy
```

---

## 为什么会报错？

| 情况 | 原因 |
|------|------|
| 一长串带 **逗号** | 应用空格，不是逗号 |
| **整行超过 ~200 字符** | 此前 20 词长行约 **231 字符**，会失败 |
| 标签名含 **空格/下划线/大写** | 只允许 `a-z` `0-9` `-` |

报错 *must start with a lowercase letter…* 常为**整行不合法**（含逗号、超长等），不一定是第一个词不对。

---

## Actions 同步（可选，可设满 20 个）

网页输入框有 200 字限制；[`.github/repository-topics.txt`](../.github/repository-topics.txt) 每行一个词，**Run workflow** 后可通过 API 写入最多 20 个（需 Workflow **Read and write** 权限）。

https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/actions/workflows/sync-topics.yml

---

## 验证

https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/topics
