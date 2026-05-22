# GitHub 仓库 Topics（标签）怎么加

## 重要：网页输入框很短

About 里提示 **Topics (separate with spaces)**（用**空格**分开）。

很多账号里这一栏 **整行一共只能约 50 个字符**（所有词 + 空格加起来），**不是**每个标签 50 字，也**不是** 200 字。  
所以一长串 20 个词（一百多字）会报：

> Repository topics must start with a lowercase letter…

---

## 请先试这一行（39 字符，≤50）

复制到 **About → ⚙ → Topics**，不要逗号，不要换行：

```
vscode-extension github-copilot copilot
```

点 **Save changes**。  
若成功，说明上限是 **整行约 50 字**；不必再塞更多词。

---

## 若可以稍长（约 76～97 字符）

有的界面放宽到约 **100 字**，可试：

**76 字符（5 个词）：**

```
vscode-extension github-copilot copilot-chat openai-compatible unified-proxy
```

**97 字符（6 个词）：**

```
vscode-extension github-copilot copilot-chat openai-compatible unified-proxy deepseek-v4
```

保存前在记事本里看一下**总长度**；超过你界面允许的长度就会失败。

---

## 规则

| 项目 | 说明 |
|------|------|
| 分隔 | **空格**，不要逗号 |
| 整行长度 | 以你界面为准，常见 **≤50** 或 **≤100** |
| 每个词 | 小写 `a-z` `0-9` `-`，单个词 ≤50 字符 |
| 个数 | 最多 20 个词（但受整行长度限制，网页里往往只能 2～6 个） |

---

## 想要更多标签？

网页输入框放不下时，可依赖 **Actions** 写入最多 20 个（不受「一行 50 字」限制）：

1. 账号 https://github.com/settings/actions → **Read and write permissions**
2. 运行 https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/actions/workflows/sync-topics.yml → **Run workflow**

列表见 [`.github/repository-topics.txt`](../.github/repository-topics.txt)。

---

## 验证

https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/topics
