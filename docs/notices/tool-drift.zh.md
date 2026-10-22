# 工具列表漂移说明

VS Code Copilot Chat 在不同轮次可能向 Language Model Provider 传入不同的工具子集（例如用户开关工具、Agent/MCP 增减工具）。这会导致「工具列表漂移」。

## 与工具数量上限

较旧的 DeepSeek Chat Completions 文档曾写单次请求最多 **128** 个 tools。上游 **DeepSeek V4 for Copilot Chat 0.9.4**（#291）已移除扩展侧的硬上限；**Unified Proxy v1.3.2** 起同样不再因超过 128 个工具而拒绝请求。

实际能否接受大量 tools，取决于你配置的 **上游后端**（OpenCode Go、自建网关、官方 DeepSeek 等）。若上游仍报错，请在 VS Code **Configure Tools** 中关闭不常用的工具。

## 实验性稳定工具列表

开启实验性稳定工具列表后，请求中可能包含更多函数工具定义（名称、说明和 JSON Schema），因此 **input tokens** 可能增加。缓存命中的 input tokens 单价更低，但仍会计入用量。少于 **64 个已启用工具** 时通常无需开启；工具特别多时请自行权衡延迟与费用。
