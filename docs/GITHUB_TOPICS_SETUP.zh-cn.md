# GitHub 仓库 Topics（标签）怎么加

自动同步依赖 Actions 的 `GITHUB_TOKEN` 写权限。若找不到 **Workflow permissions**，**直接用下面的「手动添加」即可**（推荐，1 分钟完成）。

---

## 方法一：手动添加（推荐）

1. 打开仓库首页：  
   https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat

2. 右侧 **About**（关于）区域，点击 **⚙**（齿轮）。

3. 找到 **Topics**（主题），在输入框里**逐个输入**下面标签（输入一个回车确认一个，最多 20 个）：

```
vscode-extension
vscode
visual-studio-code
github-copilot
copilot-chat
copilot
language-model
byok
openai-compatible
proxy
unified-proxy
deepseek
deepseek-v4
ai
chat
agent-mode
tool-calling
lan
self-hosted
json-config
typescript
```

4. 点击 **Save changes**（保存更改）。

保存后，别人在 GitHub 搜索 `copilot-chat`、`vscode-extension`、`openai-compatible` 等更容易找到本仓库。

---

## 方法二：用 Actions 自动同步（需权限）

### 若仓库里找不到 Workflow permissions

该选项在 **英文界面** 下名称是 **Workflow permissions**，中文可能是 **工作流权限**。请按顺序尝试：

#### A. 仓库设置（有 **Settings** 标签时）

1. 打开仓库 → 顶部 **Settings**（设置）  
   - 若看不到：点 **⋯** 下拉 → **Settings**
2. 左侧 **Actions** → **General**（常规）
3. **拉到页面最底部**
4. 找到 **Workflow permissions** / **工作流权限**
5. 选 **Read and write permissions**（读取和写入权限）  
   - 不要选 “Read repository contents and packages permissions only”（只读）
6. 点 **Save**

直达链接（需已登录且有管理权限）：  
https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/settings/actions

#### B. 个人账号默认权限（仓库里没有上述区块时）

个人新建仓库常继承**账号级**默认（只读），需在账号设置里改：

1. 打开：https://github.com/settings/actions  
2. **Workflow permissions** → 选 **Read and write permissions**
3. **Save**

然后回到仓库，再运行一次同步工作流。

#### C. 运行同步工作流

1. https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/actions/workflows/sync-topics.yml  
2. 右侧 **Run workflow** → 分支选 **main** → **Run workflow**
3. 约 30 秒后刷新仓库首页，About 旁应出现 Topics

标签列表以 [`.github/repository-topics.txt`](../.github/repository-topics.txt) 为准；改文件并 push 到 `main` 后会再次触发同步（需方法二权限成功）。

---

## Actions 报错 `Resource not accessible by integration` / workflow 失败

说明 **`GITHUB_TOKEN` 没有写 Topics 的权限**（仓库默认常为只读）。任选其一：

1. **账号级**（推荐先试）：https://github.com/settings/actions → **Workflow permissions** → **Read and write permissions** → Save  
2. **仓库级**：https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/settings/actions → 拉到最底 → 同上  
3. **改用手动 Topics**（不依赖 Actions，见上文方法一）

修好权限后，打开 [Sync repository topics](https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/actions/workflows/sync-topics.yml) → **Run workflow**。

当前工作流已改为使用 `gh api` 设置 Topics；仅当修改 `.github/repository-topics.txt` 时会自动运行（改 `sync-topics.yml` 本身不会触发）。

---

## 仍然只有 “Actions permissions” 没有 Workflow permissions？

部分界面把两项合在一起：

- **Allow all actions**（允许所有操作）要先打开，下面才会出现 **Workflow permissions**。
- 或仓库 **Settings** 左侧根本没有 **Actions**：说明当前账号对该仓库无管理员权限，只能用**方法一**手动加 Topics。

---

## 验证

仓库首页 About 下方出现一串灰色标签，或访问：  
https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat/topics  

应能看到 `vscode-extension`、`github-copilot` 等。
