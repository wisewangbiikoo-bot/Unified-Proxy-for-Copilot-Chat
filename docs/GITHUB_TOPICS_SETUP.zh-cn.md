# GitHub 仓库 Topics（标签）怎么加

---

## 报错：must start with a lowercase letter or number…

GitHub 在保存失败时**总是同一句英文**，常见真实原因如下（不一定是“没以小写字母开头”）：

| 原因 | 处理 |
|------|------|
| 一次粘贴了带 **逗号/空格** 的一整行 | 删掉该标签，**一个词 + Enter** 单独添加 |
| 标签里混入了 **大写、下划线 `_`、中文、反引号 `` ` ``** | 只保留 `a-z` `0-9` `-` |
| 已有 **超过 20 个** 或某个 **空标签** | 先 **清空全部 Topics** 保存，再重新加 |
| 标签以 **`-` 开头/结尾**（如 `-proxy`） | 去掉首尾 `-` |

### 推荐：先清空再逐个添加（最稳）

1. About → ⚙ → Topics  
2. **删掉已有全部标签**（每个标签上的 ×）  
3. **Save changes**（允许 0 个标签）  
4. 只先加 **1 个** 测试：`vscode-extension` → Enter → Save  
   - 若成功，再继续加下面的词  
   - 若仍失败，检查是否登录的是仓库所有者账号  

5. 每次只输入 **一个** 词（全小写），按 **Enter**，**不要**粘贴逗号分隔的一行  

### 建议添加的 20 个（与仓库 `repository-topics.txt` 一致）

```
vscode-extension
github-copilot
copilot-chat
openai-compatible
unified-proxy
deepseek-v4
self-hosted
agent-mode
tool-calling
json-config
language-model
bring-your-own-key
local-proxy
typescript
copilot
deepseek
vscode
proxy
chat
ai
```

**不要输入：** `proxy_configs`、`Unified-Proxy`、`openai compatible`、`vscode-extension, copilot`

---

## 方法一：手动添加（推荐）

1. https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat  
2. 右侧 **About** → **⚙** → **Topics**  
3. 按上一节「先清空再逐个添加」操作  
4. **Save changes**

---

## 方法二：Actions 自动同步

需账号或仓库 **Workflow permissions = Read and write**。  
失败时请用方法一。

- 账号：https://github.com/settings/actions  
- 仓库：https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/settings/actions（页面**最底部**）  
- 手动运行：https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/actions/workflows/sync-topics.yml → **Run workflow**

---

## 验证

About 下方出现灰色标签，或打开：  
https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/topics
