# CodeBuddy History Sidebar

> 给 CodeBuddy IDE 增加一个**常驻侧边栏**，显示所有历史对话，点击即可切换——不再需要反复打开历史面板。

## 为什么要做这个？

CodeBuddy 自带的历史对话功能藏在右上角的时钟图标里，点击后会**全屏覆盖**当前对话界面。每次想切换到之前的对话，都需要：

1. 点击时钟图标
2. 在历史列表中找到目标对话
3. 点击进入
4. 完事后再点"返回"

这个流程在频繁切换对话时非常低效。**你无法边编码边浏览历史对话**，也无法快速在多个对话间跳转。

本插件用一个**常驻侧边栏**解决这个问题——历史对话列表始终可见，单击即切换。

## 功能

- **常驻侧边栏**：Activity Bar 新增 "CB History" 图标，历史对话列表始终可见
- **按日期分组**：今天 / 昨天 / 最近7天 / 更早
- **单击切换**：点击条目直接切换到对应对话，只刷新 CodeBuddy 面板，不重载窗口
- **工作区过滤**：默认只显示当前工作区的对话，可切换为显示全部
- **自动刷新**：每 30 秒刷新 + 手动刷新按钮
- **右键删除**：右键对话条目可删除

## 安装

下载 [Releases](https://github.com/zlvb/codebuddy-history-sidebar/releases) 页面的 `.vsix` 文件，然后：

```bash
# CodeBuddy CN
buddycn --install-extension codebuddy-history-sidebar-0.1.0.vsix

# 或在 IDE 中：Ctrl+Shift+P → "从 VSIX 安装..."
```

## 原理

1. 从 CodeBuddy 的 SQLite 数据库（`codebuddy-sessions.vscdb`）读取历史对话元数据，用 [sql.js](https://github.com/sql-js/sql.js)（纯 WASM）解析
2. 切换对话时，修改 CodeBuddy 的 `current.json` 指向目标对话，然后 reload webview 触发重新加载

## 兼容性

- **CodeBuddy CN**（基于 VS Code 的独立 IDE）
- Windows / macOS / Linux
- 需要系统已安装 CodeBuddy CN

## License

MIT
