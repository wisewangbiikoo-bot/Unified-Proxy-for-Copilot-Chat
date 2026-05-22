# Install & Git

## VSIX install

```powershell
cd d:\Work\unified-proxy-copilot
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension unified-proxy-copilot-*.vsix --force
```

## Git push (this directory)

This folder is the **standalone repository** for the extension ([Unified-Proxy-for-Copilot-Chat](https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat)).

- Put real backends in **`%USERPROFILE%\.vscode\proxy_configs.json`** on your machine — **not** in this repo.
- Only `proxy_configs.json.example` (placeholders) is tracked.
- Files matching secrets, local configs, VSIX, and debug dumps are listed in `.gitignore`.

```powershell
git init   # first time only
git add .
git status # verify no proxy_configs.json / *.vsix
git commit -m "..."
git remote add origin https://github.com/wisewangbiikoo-bot/Unified-Proxy-for-Copilot-Chat.git
git push -u origin main
```
