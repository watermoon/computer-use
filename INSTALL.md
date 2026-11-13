# INSTALL.md — `computer_use` MCP 安装契约

> **读者**：能执行命令的 harness（Agent / CLI）。
> **目标**：读完即可无人解释地装好服务、编译原生 helper、注册进 MCP 客户端，并**自证成功**。
> **平台**：Windows x64 / macOS（Apple Silicon 或 Intel）。其它平台不支持（`server/computer-use-stdio.cjs` 会直接抛错）。
> **写法**：命令按 `Windows (PowerShell)` / `macOS (sh)` 分列；`node` 段两边通用。

---

## 0. 执行契约（先读，再动手）

### 0.1 你可以自动做的事

- 检查前置条件、clone 或定位仓库
- `npm ci`、编译原生 helper
- 跑只读冒烟（`npm run smoke`）、跑只读原生枚举
- 合并写入 MCP 配置、跑注册验证

### 0.2 你绝对不能代做的事

| 禁止项 | 原因 |
|---|---|
| 安装过程中调用 `open_session` / `observe` / 任何输入类 action | 安装验证只需要 `tools/list`；注入真实输入会让用户屏幕被抢 |
| 代替人类点原生窗口选择器的 Allow | 该点击是**授权行为本身**，属于使用者本人 |
| 代替人类在 macOS「系统设置 → 隐私与安全性」里勾选授权 | TCC 授权只能由人类完成 |
| 用覆盖写的方式改 `settings.json` | 客户端配置里通常已有其它 `mcpServers`（例如 `TJGenerators`），覆盖会静默删掉它们。**必须合并**，见 §6 |
| 提权（UAC / `sudo`）、关闭系统安全设置、改用 Win32 API / AppleScript 代替原生输入 | 绕过安全边界；`docs/computer-use-policy.md` 明确禁止 |
| 把"冒烟通过"当成"安装成功" | `npm run smoke` **不触碰原生 helper**，它能过但 helper 可能根本不存在。必须走完 §4 的断言 |

### 0.3 通用规则

1. **每一步都有断言**。断言失败 → 立刻停止，报告「命令 + 退出码 + 原始 stderr」，不要跳到后续步骤，不要"顺手修一下"。
2. **全部步骤幂等**，可重复执行。
3. **占位符必须替换**：命令里的 `<REPO_URL>`、`<仓库绝对路径>`、`/path/to/settings.json` 等都只是占位，一律换成实际值。
4. 只有 §8 的步骤需要人类参与；其余全部由你完成。

### 0.4 最短路径（六步）

| # | 步骤 | 断言 |
|---|---|---|
| 1 | 前置检查 | Node ≥ 20.9.0；Windows 有 `csc.exe`；macOS 有 `swiftc` |
| 2 | `npm ci` | `require('sharp')` 成功 |
| 3 | 构建 helper | 根目录出现 `ComputerUse.exe` / `ComputerUse.Mac` |
| 4 | `npm run smoke` | 输出含 `tool: computer_use actions=23 required=["action"]` |
| 5 | 合并配置 | 客户端配置文件里新增 `mcpServers.computer-use` 且**原有键全在** |
| 6 | `node scripts/verify-mcp-config.cjs` | 输出含 `tool: computer_use` 与 `actions: 23` |

---

## 1. 前置条件

### 1.1 Node.js ≥ 20.9.0（硬门槛）

`@modelcontextprotocol/sdk@1.32.1` 只要求 Node ≥ 18，但 `sharp@0.35.5` 的 `engines` 是 `>=20.9.0`——在 Node 18 上 `npm ci` 会告警、运行期截图处理会失败。**按 20.9.0 判定。**

```sh
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<20||(a===20&&b<9)){console.error('NODE_TOO_OLD',process.versions.node);process.exit(1)} console.log('node ok',process.versions.node)"
```

断言：退出码 0，打印 `node ok <version>`。失败 → 让人类升级 Node，不要用 `--force` 硬装。

### 1.2 Windows：需要 .NET Framework 4 编译器

`scripts/build-helper.cjs` 调用的是**系统自带**编译器，路径写死为：

```
%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

```powershell
$csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { Write-Output "CSC_MISSING $csc"; exit 1 }
Write-Output "csc ok $csc"
```

断言：退出码 0。失败 → 这通常意味着系统缺 .NET Framework 4.x 运行时（Windows 10/11 一般自带）。请人类开启 Windows 功能 `.NET Framework 4.x`，**不要**改用 VS 的 `csc`（脚本不接受参数化路径）。

### 1.3 macOS：需要 Swift 编译器

```sh
command -v swiftc >/dev/null || { echo "SWIFTC_MISSING"; exit 1; }
swiftc --version
```

还需要 Xcode Command Line Tools（`xcode-select --install`）。目标系统 **macOS 14.0+**（原生侧 import 了 `ScreenCaptureKit`）。

### 1.4 网络

`npm ci` 需要访问 npm registry，并且 `sharp` 会下载对应平台的预编译二进制（`@img/sharp-win32-x64` / `@img/sharp-darwin-arm64` 等）。离线环境请人类预先准备好 npm 缓存，不要改用 `npm install --ignore-scripts`（sharp 会坏）。

---

## 2. 获取仓库

若已在一个含 `package.json` 的目录内，**先用内容判定是不是本仓库**：

```sh
node -e "const p=require('./package.json'); if(p.name!=='computer-use-mcp'){console.error('WRONG_DIR',p.name);process.exit(1)} console.log('repo ok',p.version)"
```

断言：输出 `repo ok 0.8.2`（版本号随仓库变动，判定只看 `name`）。

未 clone 时：

```powershell
git clone <REPO_URL> <仓库绝对路径>
Set-Location <仓库绝对路径>
```

```sh
git clone <REPO_URL> <仓库绝对路径>
cd <仓库绝对路径>
```

---

## 3. 安装依赖

**必须用 `npm ci`**（仓库只有 `package-lock.json`，`npm install` 会重算依赖树导致版本漂移）：

```sh
npm ci --no-audit --no-fund
```

断言（关键：确认 sharp 的原生二进制真的装上了）：

```sh
node -e "require('sharp'); console.log('sharp ok')"
```

失败常见原因：Node 版本 < 20.9.0（见 §1.1）、内网 registry 没有 `@img/*` 预编译包、公司代理拦截。**不要**用 `SHARP_IGNORE_GLOBAL_LIBVIPS` 之类的开关糊过去。

---

## 4. 构建原生 helper（最容易漏的一步）

服务本身是 Node，但真实鼠标键盘动作由根目录的原生 helper 执行。**没有它，`npm run smoke` 依然会通过**——因为冒烟只做 `initialize` + `tools/list`，不会 spawn helper。所以本节断言不能省。

### 4.1 Windows

```powershell
npm run build:helper
if (-not (Test-Path .\ComputerUse.exe)) { Write-Output "HELPER_MISSING"; exit 1 }
$len = (Get-Item .\ComputerUse.exe).Length
if ($len -lt 20000) { Write-Output "HELPER_TOO_SMALL $len"; exit 1 }
Write-Output "helper ok bytes=$len"
```

断言：退出码 0，输出 `helper ok bytes=<N>`。本仓库实测为 **87040 字节（约 85 KB）**；低于 20000 字节基本说明编译产物不完整。

产物位置是**仓库根目录**（不是 `scripts/`、不是 `dist/`）——因为 `server/windows-computer-use.cjs` 按 `path.join(__dirname,'../ComputerUse.exe')` 解析。

### 4.2 macOS

仓库没有 macOS 构建脚本，需要直接调用 `swiftc`（`@main` 在 `MacComputerUse.swift`，故必须 `-parse-as-library`）：

```sh
swiftc -target arm64-apple-macosx14.0 -parse-as-library -O \
  native/MacComputerUse.swift \
  native/MacCursorGlow.swift \
  native/MacCursorTrajectory.swift \
  native/MacHUDSurface.swift \
  -o ComputerUse.Mac
chmod +x ComputerUse.Mac
test -x ComputerUse.Mac && echo "helper ok $(wc -c < ComputerUse.Mac) bytes"
```

Intel Mac 把 `-target arm64-apple-macosx14.0` 换成 `-target x86_64-apple-macosx14.0`。

断言：退出码 0，`ComputerUse.Mac` 可执行。产物同样必须在**仓库根目录**（`server/macos-computer-use.cjs` 按 `../ComputerUse.Mac` 解析）。

> macOS TCC 提示：二进制未签名时，屏幕录制 / 辅助功能授权可能反复要求重授权。可尝试 `codesign --force --sign - ComputerUse.Mac`（ad-hoc 签名）后重新授权——**此步未在仓库文档中验证**，失败就交回人类处理，不要伪装成已授权。

---

## 5. 只读验证

### 5.1 MCP 工具面冒烟（不开会话、不注入输入）

```sh
npm run smoke
```

期望输出**逐字**为：

```
modules loaded: 13
tool: computer_use actions=23 required=["action"]
```

断言：退出码 0；恰好 1 个工具、名称为 `computer_use`、23 个 action。数量不对说明代码树被改过，停止并报告。

### 5.2 原生链路只读枚举（Windows）

```powershell
$owner = (Get-Process -Id $PID).Id
$out = & .\ComputerUse.exe $owner list_windows 0 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Output "NATIVE_FAILED $LASTEXITCODE $out"; exit 1 }
if ($out -notmatch '"windows"') { Write-Output "NATIVE_BAD_OUTPUT $out"; exit 1 }
Write-Output "native ok"
```

期望 stdout 形如 `{"windows":[{"window_id":"263894","title":"...","pid":43336}, ...]}`。

> 注意：这条直连原生 helper 的路径**绕过 MCP 层的授权判定**（`per_window` 下 MCP 的 `list_windows` 会被 `CU_WINDOW_LIST_NOT_AUTHORIZED` 拒绝，但原生枚举本身允许）。仅用于安装体检，不要用它在任务中替代 MCP 调用。

### 5.3 macOS 权限自检

```sh
./ComputerUse.Mac permission_status
```

返回 JSON，含 `screen_recording` 与 `accessibility` 两个布尔值。任一为 `false` → **停在这里交给人类**去系统设置里勾选（§8.2），然后重跑。

---

## 6. 注册到 MCP 客户端（必须合并，不许覆盖）

### 6.1 配置位置

本契约**不预设任何客户端的配置文件路径**，也不假定工具名前缀：`computer_use` 就是一个标准 stdio MCP 服务，任何支持 `command` / `args` / `env` 的客户端都能接入，underscore 命名、目录布局与顶层键名都以上层客户端为准。

配置文件位置由使用者决定，下文统一用环境变量 `MCP_SETTINGS_PATH` 指代。写入前先读该文件确认已有的 `mcpServers` 结构（顶层键名可能不叫 `mcpServers`，以客户端文档为准）。

### 6.2 要写入的条目

```json
"computer-use": {
  "command": "node",
  "args": ["<仓库绝对路径>/server/computer-use-stdio.cjs"],
  "env": { "CU_AUTHORIZATION_MODE": "per_window" }
}
```

- `command` 用 `"node"`（走 PATH）；若客户端进程的 PATH 不可靠，改成 `node` 的绝对路径（`where node` / `which node`），**不要**指向 `.exe` 之外的包装器。
- 路径里的 `\` 由 JSON 序列化自动转义；手写时注意是 `\\`。
- 入口必须是 `server/computer-use-stdio.cjs`（平台分发入口），不要指向 `windows-computer-use-stdio.cjs` / `macos-*`。

### 6.3 幂等合并脚本

把下面内容存成临时文件（PowerShell 用 `@'...'@ | Set-Content -Path "$env:TEMP\cu-register.cjs" -Encoding utf8`；sh 用 `cat > /tmp/cu-register.cjs <<'EOF' ... EOF`），**不要存进仓库**：

```js
// cu-register.cjs <repo-abs-path> [per_window|all_windows]
const fs = require('node:fs');
const path = require('node:path');

const repo = process.argv[2];
const mode = process.argv[3] || 'per_window';
if (!repo) throw new Error('usage: node cu-register.cjs <repo-abs-path> [mode]');
if (!['per_window', 'all_windows'].includes(mode)) throw new Error('BAD_MODE ' + mode);

const entry = path.join(repo, 'server', 'computer-use-stdio.cjs');
if (!fs.existsSync(entry)) throw new Error('MISSING_ENTRY ' + entry);

const settingsPath = process.env.MCP_SETTINGS_PATH;
if (!settingsPath) throw new Error('MCP_SETTINGS_PATH is required: point it at your MCP client settings.json');
let settings = {};
if (fs.existsSync(settingsPath)) {
  // 剥离 BOM：PowerShell 的 Set-Content -Encoding utf8 / 某些编辑器会写 UTF-8 BOM，
  // 而 JSON.parse 见到 BOM 会直接抛 SyntaxError。
  const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
  if (raw.trim()) settings = JSON.parse(raw);          // 解析失败必须抛出，不要静默重置
  fs.copyFileSync(settingsPath, settingsPath + '.bak-' + Date.now());
}
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
settings.mcpServers = settings.mcpServers || {};
settings.mcpServers['computer-use'] = {
  command: 'node',
  args: [entry],
  env: { CU_AUTHORIZATION_MODE: mode }
};
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('registered', entry, mode);
console.log('mcpServers:', Object.keys(settings.mcpServers).join(','));
```

执行：

```powershell
$env:MCP_SETTINGS_PATH = "C:\path\to\settings.json"
node "$env:TEMP\cu-register.cjs" "<仓库绝对路径>" per_window
```

```sh
MCP_SETTINGS_PATH="/path/to/settings.json" node /tmp/cu-register.cjs "<仓库绝对路径>" per_window
```

断言：

1. 退出码 0；
2. 输出 `registered <正确路径> per_window`；
3. 输出里的 `mcpServers:` 列表**同时包含** `computer-use` 和安装前已存在的每一个键（例如 `TJGenerators`）。少一个 = 覆盖事故，立刻用 `.bak-<ts>` 恢复并报告。

> 该脚本会用 2 空格重排整个 JSON（键不丢，注释会丢——标准 JSON 本来就不支持注释）。若目标配置文件按 JSONC 编写且含注释，改用客户端自带的导入命令，不要用本脚本。

---

## 7. 验证注册

```sh
MCP_SETTINGS_PATH=/path/to/settings.json node scripts/verify-mcp-config.cjs
```

它按 `settings.json` 里真实的 `command` / `args` / `env` 拉起服务，做 `initialize` + `tools/list`（**不开 GUI 会话**）。期望输出：

```
command: node
args: ["<...>\\server\\computer-use-stdio.cjs"]
env: {"CU_AUTHORIZATION_MODE":"per_window"}
tool: computer_use (Computer Use · <主机名> (Windows))
actions: 23
authorization_mode env: per_window
```

断言：退出码 0；`tool:` 行存在；`actions: 23`；`<主机名>` 是**本机**主机名（不是别的机器）。
`args:` 行是 `JSON.stringify` 结果，Windows 路径里的 `\` 会显示成 `\\`，属正常，不要当成路径写错。

最后告诉人类：**重启客户端或新开会话**，配置不会热加载。重启后工具名可能带客户端自己的命名空间前缀（如 `computer-use__computer_use`），以客户端显示为准。

---

## 8. 只有人类能做的步骤

### 8.1 `per_window` 模式的首次授权

首次 `open_session` 会弹**原生窗口选择器**，必须由人类亲手点 Allow。在此之前任何输入类 action 都会返回：

- `CU_WINDOW_LIST_NOT_AUTHORIZED`（`per_window` 下禁止枚举窗口清单，这是设计，不是 bug）
- `CU_CONSENT_PENDING`（选择器还开着）

**你的正确动作**：告诉人类"请在桌面上弹出的选择器里选择目标窗口并点 Allow"，然后等待，不要重试轰炸。

### 8.2 macOS 系统授权

`CU_SCREEN_RECORDING_REQUIRED` / `CU_ACCESSIBILITY_REQUIRED` 出现时，让人类去「系统设置 → 隐私与安全性 → 屏幕录制 / 辅助功能」勾选**运行 helper 的那个进程**（通常是终端或客户端本身），并重启该进程。

### 8.3 真实 GUI 验收

点击、输入、拖动、HUD/STOP 浮层的实际表现，只能由人类在桌面上确认。`npm run smoke` 不覆盖这些。

---

## 9. 授权模式选择

| 模式 | 行为 | 适用 | 风险 |
|---|---|---|---|
| `per_window`（本文默认注册值） | 每次开会话弹原生选择器，人类点 Allow；`list_windows` 被禁 | 日常使用 | 低：模型拿不到窗口清单，授权动作可见 |
| `all_windows`（**代码默认值**，见 `server/windows-computer-use.cjs`） | 不弹窗，可先 `list_windows` 拿 `window_id` 再开会话 | 无人值守/固定流程 | 高：任何拿到 MCP 调用权的一方都能指定任意窗口 |

改模式 = 重跑 §6.3 脚本并把第二个参数换成 `all_windows`，然后重启客户端。改动前请人类明确同意。

---

## 10. 故障排查

| 现象 / 错误码 | 原因 | 处置 |
|---|---|---|
| `CSC_MISSING` / `csc.exe not found: ...` | 系统缺 .NET Framework 4.x | 请人类启用该 Windows 功能，不要改用 VS 的 csc |
| `npm ci` 报 `EBADENGINE` 或 sharp 装不上 | Node < 20.9.0 | 升级 Node（§1.1） |
| `require('sharp')` 抛 `Could not load ... .node` | 预编译二进制没下全 | 删 `node_modules` 重跑 `npm ci`；检查内网 registry 是否有 `@img/*` |
| `CU_HELPER_UNAVAILABLE` | 原生 helper 不存在（常见：忘了 §4，而 smoke 却能过） | 回到 §4 构建，确认产物在**仓库根目录** |
| `CU_HELPER_NOT_EXECUTABLE` | macOS 没 `chmod +x` | `chmod +x ComputerUse.Mac` |
| `CU_HELPER_ARCH_INCOMPATIBLE` | 架构不匹配（Intel Mac 用了 arm64 target） | 按 §4.2 换 `-target` 重编 |
| `CU_HELPER_OS_INCOMPATIBLE` | 系统版本低于 macOS 14 | 让人类升级系统 |
| `CU_HELPER_START_FAILED` / `CU_HELPER_TIMEOUT` | 原生进程起不来或超时 | 直连跑一次 §5.2 / §5.3 看原始输出 |
| `CU_WINDOW_LIST_NOT_AUTHORIZED` | `per_window` 模式的**预期行为** | 不要重试；让人类点选择器（§8.1） |
| `CU_OWNER_REQUIRED` | 手工直连 helper 时参数缺失/过多（接受 1~4 个） | 用 `ComputerUse.exe <ownerPid> list_windows 0` |
| `CU_DEVICE_ID_INVALID` / `CU_DEVICE_ID_UNAVAILABLE` | `%APPDATA%\ComputerUse\computer-use-device-id`（macOS：`~/Library/Application Support/ComputerUse/`）内容损坏或目录不可写 | 确认目录可写；文件损坏时**请人类确认后**删除，下次启动会重新生成 |
| `CU_INVALID_ARGUMENT`（明明传了合法参数） | **已知问题**：客户端把未填的可选字段序列化成 `null`（如 `{"action":"list_windows","session_id":null}`），而校验要求"要么不出现、要么类型正确" | 客户端侧去掉 `null` 字段；或手写干净参数验证服务本身没问题 |
| `CU_BUSY` | 同一进程内有操作正在执行 | 串行调用，等上一个返回 |
| `CU_SESSION_EXPIRED` | 会话 10 分钟到期 | 重新 `open_session` |
| `CU_TARGET_DEVICE_MISMATCH` | 传入的 `target_device_id` 与本机设备 ID 不符 | 正常调用请**省略** `target_device_id` |
| 工具面里看不到 `computer_use` | 配置没被热加载 / JSON 写坏 | 重启客户端；重跑 §7 |

---

## 11. 并发与多 harness 约束

安装完成后请注意（细节见 `README.md` 与代码）：

- **单进程内严格串行**：一个 `computer_use` 服务进程同时只有 **1 个会话**、**1 个操作**；并发调用被 `CU_BUSY` 拒绝，换窗口的 `open_session` 被 `CU_SESSION_TARGET_MISMATCH` 拒绝。
- **跨 harness 没有互斥**：仓库不含任何单实例锁。N 个客户端 → N 个 Node 进程 → N 个原生 helper → N 个独立会话和 N 个 HUD 浮层。它们共享同一套真实鼠标键盘和前台窗口，会互相触发 `CU_USER_INPUT_ACTIVE` / `CU_WINDOW_NOT_FOREGROUND`，属于"能跑但会打架"。
- 跨进程真正共享的只有两样：指针诊断日志的写互斥（`Local\ComputerUse.PointerLog.<hash>`）和设备 ID 文件（`flag:'wx'`，并发启动共享同一 ID）。**都不是会话锁。**

**安装时的推荐动作**：同一台机器只给**一个**客户端注册 `computer-use`。若发现已有多处注册，报告给人类，不要自行删除别人的配置。

---

## 12. 回滚

```powershell
# Windows
node -e "const fs=require('node:fs');const f=process.env.MCP_SETTINGS_PATH;if(!f)throw new Error('MCP_SETTINGS_PATH required');const s=JSON.parse(fs.readFileSync(f,'utf8'));delete s.mcpServers['computer-use'];fs.writeFileSync(f,JSON.stringify(s,null,2)+'\n');console.log('unregistered')"
Remove-Item .\ComputerUse.exe -ErrorAction SilentlyContinue
```

```sh
# macOS
node -e "const fs=require('node:fs');const f=process.env.MCP_SETTINGS_PATH;if(!f)throw new Error('MCP_SETTINGS_PATH required');const s=JSON.parse(fs.readFileSync(f,'utf8'));delete s.mcpServers['computer-use'];fs.writeFileSync(f,JSON.stringify(s,null,2)+'\n');console.log('unregistered')"
rm -f ComputerUse.Mac
```

`node_modules/` 可保留（回滚不必删）。数据目录（设备 ID、指针日志、任务检查点）默认保留，删除前请人类确认。

---

## 13. 完成清单（逐条核对，全绿才算装好）

- [ ] `node ok <≥20.9.0>`
- [ ] Windows：`csc ok ...` ／ macOS：`swiftc --version` 正常
- [ ] `repo ok 0.8.2`（`name === "computer-use-mcp"`）
- [ ] `sharp ok`
- [ ] `helper ok bytes=<N>`，产物在**仓库根目录**
- [ ] `npm run smoke` → `modules loaded: 13` + `tool: computer_use actions=23 required=["action"]`
- [ ] 原生只读枚举通过（Windows §5.2 / macOS §5.3 权限为 true）
- [ ] `settings.json` 已合并，`mcpServers` 原有键**一个不少**
- [ ] `node scripts/verify-mcp-config.cjs` → `tool: computer_use` + `actions: 23` + 本机主机名
- [ ] 已告知人类：重启客户端 / 新开会话
- [ ] 已告知人类：首次 `open_session` 需要亲手点 Allow（`per_window`）
- [ ] 已告知人类：同一台机器只保留一个 `computer-use` 注册

**报告格式**：向人类汇报时给出——安装路径、helper 字节数、smoke 原始两行、当前授权模式、以及仍需人类完成的项（若有）。任何一项未验证，明说"未验证"，不要笼统写"安装成功"。
