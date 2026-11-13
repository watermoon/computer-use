# computer-use

独立的 `computer_use` MCP 服务：把 Computer Use 能力做成一个 stdio MCP 服务器，注册进任意 MCP 客户端，让 Agent 获得 `computer_use` 工具，可以用**真实鼠标/键盘**操作本机已授权的窗口。

## 命名与运行时约定

| 项 | 值 |
|---|---|
| Windows 原生 helper | `ComputerUse.exe`（仓库根目录，构建产物，不入库） |
| macOS 原生 helper | `ComputerUse.Mac`（需自行用 Xcode 编译） |
| 授权模式环境变量 | `CU_AUTHORIZATION_MODE`（`per_window` / `all_windows`） |
| Windows 数据目录 | `%APPDATA%\ComputerUse` |
| Unix 数据目录 | `~/.ComputerUse` |
| 指针诊断日志 | `%APPDATA%\ComputerUse\logs\computer-use-pointer`（回滚到 4MB） |
| MCP `_meta` 命名空间 | `com.computeruse/device`、`com.computeruse/computer-use-policy`、`com.computeruse/conversationTitle` |
| HUD 标题 | `Computer Use` / `● Computer Use` |
| 授权的原生互斥体 | `Local\ComputerUse.PointerLog.*` |

## 目录结构

```
computer-use/
├─ package.json                    # @modelcontextprotocol/sdk 1.32.1 + sharp 0.35.5
├─ server/                         # MCP 服务与编排逻辑（16 个文件）
│  ├─ computer-use-stdio.cjs        # 平台分发入口（win32 → windows-computer-use-stdio）
│  ├─ windows-computer-use-stdio.cjs# 暴露 computer_use 工具、绑定设备 ID、可选 Sampling Planner
│  ├─ base-computer-use.cjs         # 参数校验/会话状态机/观察时效/错误码/恢复建议
│  ├─ windows-computer-use.cjs      # 仅选本机 helper + 授权模式
│  ├─ macos-computer-use*.cjs       # macOS 适配
│  ├─ computer-use-agent-runner.cjs # observe → decide → act 循环、awaiting_decision 决策桥
│  ├─ computer-use-task-runner.cjs  # 窗口移动兼容任务（start_move_task）
│  ├─ computer-use-task-ids.cjs     # 任务 ID 分配与幂等索引
│  ├─ durable-files.cjs             # 原子 JSON 检查点（0600、防符号链接）
│  ├─ computer-use-images.cjs       # PNG/无损 WebP 取小、>1MiB 分块 + SHA-256（sharp）
│  ├─ computer-use-planner-images.cjs
│  ├─ computer-use-sampling-planner.cjs
│  ├─ computer-use-devices.cjs      # 本机设备 ID（%APPDATA%\ComputerUse\computer-use-device-id）
│  ├─ computer-use-permissions.cjs  # macOS TCC 检查（Windows 恒 granted）
│  └─ native-helper-error.cjs
├─ native/                         # 原生源码：ComputerUse.cs（Windows）+ 4 个 Swift（macOS）
├─ scripts/
│  ├─ build-helper.cjs              # csc 编译 Windows helper
│  ├─ smoke.cjs                     # 模块加载 + tools/list 冒烟（不开会话、不注入输入）
│  └─ verify-mcp-config.cjs      # 按真实 settings.json 拉起服务验证
└─ docs/computer-use-policy.md      # 操作规范（行为准则的规范源）
```

`server/windows-computer-use.cjs` 按 `path.join(__dirname, '../ComputerUse.exe')` 查找 helper，因此 `npm run build:helper` 必须在仓库根目录产出该文件。

## 安装

```powershell
npm ci
npm run build:helper   # 生成 ComputerUse.exe（.NET Framework 4.8 的 csc）
npm run smoke          # 期望输出 tool: computer_use actions=23
```

## 在 MCP 客户端里注册

把下面这段写进客户端的 MCP 配置（客户端的 `settings.json` 里的 `mcpServers`）：

```json
"computer-use": {
  "command": "node",
  "args": ["<仓库路径>\\server\\computer-use-stdio.cjs"],
  "env": { "CU_AUTHORIZATION_MODE": "per_window" }
}
```

重启客户端（或新开会话）后生效，Agent 侧工具名可能带客户端自己的命名空间前缀（如 `computer-use__computer_use`），标题形如 `Computer Use · <主机名> (Windows)`。

**`per_window` 模式**：`open_session` 由**本地原生窗口选择器**完成授权，模型不能枚举窗口清单（`list_windows` 返回 `CU_WINDOW_LIST_NOT_AUTHORIZED`）；窗口选择器由使用者亲手点 Allow。

**`all_windows` 模式**：不弹窗，可先 `list_windows` 拿 `window_id`，再 `open_session(window_id=...)`。

设备 ID 首次启动时生成并持久化在 `%APPDATA%\ComputerUse\computer-use-device-id`（`all_windows` 模式下可用来做跨机校验）；更换该目录会让设备 ID 重新生成。

## 典型调用顺序（真实输入，不允许静默替换成 Win32/脚本）

1. `open_session(session_title=...)` → 轮询 `get_session` 到 `ready`（先 `activate` 再 `observe`）
2. `observe` → 拿 `observation_id` + 截图（>1MiB 分块，用 `read_screenshot` 拼接并校验 sha256）
3. `click` / `type_text` / `key_press` / `scroll` / `mouse_move`（每次输入消耗当前 observation，30 秒时效）
4. 窗口移动用 `drag_window`；它的 `screen_x`/`screen_y` 是**光标终点**而不是期望的窗口位置，落位需按抓取点偏移做「测误差→重拖」校正，并避开屏幕顶边的「拖到顶=最大化」吸附
5. 通用自主任务：`start_task` / `get_task` / `submit_task_decision` / `cancel_task`
6. 收尾：**必须 `close_session` 并确认 `closed: true`**，才能向使用者报告"已完成"

## 安全边界（见 `docs/computer-use-policy.md`）

- 原生 `Esc` / HUD 的 STOP 按钮立即终止控制；STOP 之后禁止重放。
- 输入前必须有**新鲜观察**（30 秒内、session 内有效），不得盲重放结果未知的点击/输入/拖动。
- 可恢复错误（`CU_WINDOW_NOT_FOREGROUND`、`CU_USER_INPUT_ACTIVE`、遮挡、截图过期）不等于任务失败，重新激活/观察后继续。
- 会话 10 分钟到期；helper 父进程退出即自杀；只控制被授权的目标窗口，不改变 shell/目录权限。
- 截图、输入文字、目标原文不进检查点文件；指针诊断日志只记指针事件并回滚到 4MB。

## 运维

```powershell
node scripts/build-helper.cjs          # 重新编译原生 helper
node scripts/smoke.cjs                 # 模块 + tools/list 冒烟（不碰鼠标）
node scripts/verify-mcp-config.cjs  # 按 settings.json 实际拉起验证
.\ComputerUse.exe $PID list_windows 0  # 只读枚举窗口，验证原生链路
```

## 已知问题

- **严格的入参校验会拒绝 `null` 字段**：`validate()`（`server/base-computer-use.cjs`）要求每个可选字段"要么不出现、要么是正确类型"。客户端若把未填字段序列化成 `null`（例如 `{"action":"list_windows","session_id":null}`），会一律得到 `CU_INVALID_ARGUMENT`，错误包形态为 `code + task_state:session_terminated + next_action:get_session`。在真实 MCP 客户端上实测可复现；直连同一份服务传干净参数则一切正常（`per_window` 下 `list_windows` 返回的是 `CU_WINDOW_LIST_NOT_AUTHORIZED`，说明已通过校验、走到授权判断）。修复方向：校验前把取值为 `null` 的可选字段当缺省丢弃（尚未实施）。
- 本仓库只保证 Windows helper 的构建链路；macOS 侧需要 macOS + Xcode（`swiftc -target arm64-apple-macosx14.0 -parse-as-library -O`）自行编译 `ComputerUse.Mac`。
- 真实 GUI 交互（点击、输入、拖动、HUD/STOP 面板）必须由使用者在桌面上验收；`scripts/smoke.cjs` 只覆盖启动握手与工具面。
- `PrintWindow` 对部分应用截图不可靠；`SendInput` 走全局路由，前台检查不能消除所有竞态——这**不是沙箱**。
