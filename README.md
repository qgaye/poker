# Codex 德州扑克桌

一个本地运行的德州扑克 Web 牌桌：1 名人类玩家和 N 个 AI 玩家同桌。项目重点不是联网对战，而是把牌桌流程、AI 决策、TexasSolver 建议、手牌归档和复盘分析串在一起，方便观察不同策略在同一套牌局规则下的表现。

默认 AI 模式是 `TexasSolver`。如果外部服务不可用，前端会校验并兜底处理决策，避免牌局卡死。

## 快速启动

项目没有前端构建步骤，也没有 npm 依赖；使用 Node.js 启动静态文件和本地 API 服务即可。

```bash
node server.js
```

默认地址：

```text
http://localhost:4173
```

可用 `PORT` 覆盖端口：

```bash
PORT=5173 node server.js
```

## 依赖安装指南

这个项目本身只依赖 Node.js 运行 `server.js`，但要启用完整 AI 能力，还需要安装并配置 Codex CLI、TexasSolver 和翻前 range。推荐按下面顺序安装：先让牌桌能打开，再接 Codex，最后接 TexasSolver。

### 1. 安装基础运行环境

需要：

- Node.js 18+。
- Git，方便其他 AI 助手识别仓库状态和协助安装。
- macOS 优先；当前默认 TexasSolver 路径指向 Mac build。

验证：

```bash
node --version
git --version
```

启动项目：

```bash
node server.js
```

打开 `http://localhost:4173`。如果页面能显示牌桌，但顶部 Codex 或 TexasSolver 是未连接，说明基础 Web 项目已经跑通，只是外部 AI/Solver 依赖还没接上。

### 2. 安装 Codex CLI

Codex 模式依赖本机可执行的 `codex` 命令，并使用 `codex exec` 非交互模式生成结构化 JSON 决策。Codex 官方文档说明 Codex CLI 支持本地终端运行，支持 `codex exec`、`--json`、`--output-schema` 和登录缓存。

推荐安装方式：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

无人值守安装可用：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh
```

Windows PowerShell 可参考：

```powershell
$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex
```

也可以安装 Codex Desktop。macOS 上本项目会优先尝试：

```text
/Applications/Codex.app/Contents/Resources/codex
```

如果该文件不存在，则使用 PATH 中的 `codex`。需要强制指定路径时：

```bash
CODEX_BIN=/absolute/path/to/codex node server.js
```

登录 Codex：

```bash
codex login
```

无浏览器或远程环境可尝试设备码登录：

```bash
codex login --device-auth
```

验证 `codex exec` 可用：

```bash
printf 'Return exactly {"action":"check","amount":0,"reasoning":"ok"} as JSON.' \
  | codex exec --skip-git-repo-check --ephemeral --sandbox read-only --json \
      --output-schema codex-decision.schema.json -o /tmp/poker-codex-check.json -
cat /tmp/poker-codex-check.json
```

期望输出文件是符合 schema 的 JSON。然后重新启动项目，打开页面顶部状态区，Codex 应显示已连接。也可直接检查：

```bash
curl http://localhost:4173/api/status
```

### 3. 安装 TexasSolver

TexasSolver 模式依赖本地 `console_solver`。当前默认目录是：

```text
vendor/texassolver/TexasSolver-v0.2.0-MacOs/
```

该目录至少需要包含：

```text
console_solver
ranges/6max_range/
resources/
parameters/
```

如果仓库中已经带有压缩包：

```text
vendor/texassolver/TexasSolver-v0.2.0-MacOs.zip
```

可解压到默认目录：

```bash
cd vendor/texassolver
unzip TexasSolver-v0.2.0-MacOs.zip
chmod +x TexasSolver-v0.2.0-MacOs/console_solver
```

如果仓库没有携带 TexasSolver，请从 TexasSolver 的官方或授权发布渠道获取与你系统匹配的版本。不要从不可信镜像下载二进制。下载后把解压目录改名或移动到：

```text
vendor/texassolver/TexasSolver-v0.2.0-MacOs
```

验证：

```bash
test -x vendor/texassolver/TexasSolver-v0.2.0-MacOs/console_solver
test -d vendor/texassolver/TexasSolver-v0.2.0-MacOs/ranges/6max_range
```

重新启动项目后，页面顶部 TexasSolver 应显示已连接。也可通过 API 检查：

```bash
curl http://localhost:4173/api/status
```

如果 macOS 拦截二进制执行，可在系统安全设置里允许该程序，或在确认来源可信后移除隔离属性：

```bash
xattr -dr com.apple.quarantine vendor/texassolver/TexasSolver-v0.2.0-MacOs
```

### 4. 配置翻前 Range

默认配置文件：

```text
config/texassolver.json
```

默认 profile `texassolver-6max` 依赖：

```text
vendor/texassolver/TexasSolver-v0.2.0-MacOs/ranges/6max_range
```

另外几个 `simple-hand-list` profile 已经直接写在 `config/texassolver.json` 中，不依赖 TexasSolver range 文件，但仍适合作为翻前 baseline。若只想先跑起来，可以先使用 `内置策略` 或 simple profile；若要完整 TexasSolver 默认体验，需要 `console_solver` 和 `ranges/6max_range` 都存在。

新增 range profile 时，保持这几个字段完整：

```json
{
  "id": "my-profile",
  "label": "My Profile",
  "type": "simple-hand-list",
  "seatCount": 6,
  "seatCounts": [2, 3, 4, 5, 6],
  "defaultOpenSizesBb": {
    "UTG": 2.5,
    "MP": 2.5,
    "CO": 2.5,
    "BTN": 2.5,
    "SB": 3.0
  },
  "ranges": {
    "open": {
      "UTG": "AA,KK,QQ,AKs"
    }
  }
}
```

### 5. 一键健康检查

启动服务后运行：

```bash
curl http://localhost:4173/api/status
```

重点看：

```json
{
  "codex": true,
  "texasSolver": true
}
```

如果 `codex` 为 `false`，检查 `codex login`、`CODEX_BIN`、PATH 和 `codex exec` 验证命令。如果 `texasSolver` 为 `false`，检查 `console_solver` 是否存在且可执行，以及目录是否和 `server.js` 的默认路径一致。

### 6. 给 AI 助手的安装任务模板

可以把下面这段直接发给本机 AI 助手，让它协助安装依赖：

```text
请在这个仓库中安装并验证 poker 项目的运行依赖：

1. 不要修改业务代码，除非为了修正文档或本地路径配置。
2. 先确认 Node.js 可用，并用 node server.js 启动项目。
3. 安装或定位 Codex CLI，使 codex exec 可用；如已安装 Codex Desktop，优先检查 /Applications/Codex.app/Contents/Resources/codex。
4. 运行 codex login 或提示我完成登录；不要读取、打印或提交 ~/.codex/auth.json。
5. 安装或定位 TexasSolver，把 console_solver 放到 vendor/texassolver/TexasSolver-v0.2.0-MacOs/console_solver，并确保 ranges/6max_range 存在。
6. 如需下载 TexasSolver，只能使用官方或我明确提供的授权来源；不要使用随机镜像。
7. 检查 config/texassolver.json 中的 preflopRangeProfiles，确保默认 profile 指向存在的 range 目录。
8. 启动 node server.js 后调用 /api/status，确认 codex 和 texasSolver 都为 true。
9. 最后告诉我做了哪些安装、哪些路径被使用、还有哪些需要我手动授权。
```

## 项目能力

- 单人本地牌桌：1 名人类玩家，加 1-8 个 AI 玩家。
- 完整手牌流程：小盲/大盲、翻牌前、翻牌圈、转牌圈、河牌圈、摊牌。
- 玩家动作：弃牌、过牌、跟注、加注、全下。
- 结算能力：无人跟注直接赢池、摊牌比牌、全下边池结算。
- 牌桌控制：新牌桌、下一手、暂停/开始，暂停时 AI 不会继续自动行动。
- 下注辅助：加注金额输入、滑杆、1x/2x/3x 倍数、10%/30%/50%/80% 点位。
- 行动可视化：座位、庄位、小盲/大盲、行动顺序、当前思考时间、最新动作高亮。
- 服务状态探针：页面顶部展示 Codex 与 TexasSolver 是否可用，以及连接判定标准。
- 音频系统：本地背景音乐与动作音效，支持开关和音量持久化。
- 牌局日志：保存牌局事件、AI 决策详情、Prompt、原始输出、解析结果和 token 使用量。
- 牌桌归档：每张牌桌和每一手牌都会落盘到 `data/`，可从页面导入继续查看。
- GTO 复盘：选择历史牌桌和手牌，用 TexasSolver 对人类玩家的行动点做对比分析。

## AI 模式

页面的 `AI 模式` 下拉框支持三种模式：

- `TexasSolver`：默认模式。翻前读取配置中的 range profile；翻后调用本地 TexasSolver `console_solver`。
- `Codex CLI`：把 AI 可见局面发给本机 `codex exec`，要求返回严格 JSON 决策。
- `内置策略`：浏览器端启发式策略，适合作为外部服务不可用时的兜底。

AI 决策都会经过前端合法性校验。即使模型或 Solver 返回了不合法动作，牌桌也会把动作修正到当前局面允许的范围内。

## Codex 决策链路

当 AI 模式为 `Codex CLI` 时，前端调用：

```text
POST /api/ai-decision
```

服务端执行：

```bash
codex exec --skip-git-repo-check --ephemeral --sandbox read-only --json --output-schema codex-decision.schema.json -o <tmp-file> -
```

默认优先使用 Codex.app 内置 CLI：

```text
/Applications/Codex.app/Contents/Resources/codex
```

如果不存在，则回退到 PATH 中的 `codex`。也可以用环境变量指定：

```bash
CODEX_BIN=/path/to/codex node server.js
```

Codex 必须返回符合 `codex-decision.schema.json` 的 JSON：

```json
{
  "action": "call",
  "amount": 0,
  "reasoning": "跟注额较小，手牌有继续看牌价值。"
}
```

其中 `action` 只能是 `fold`、`check`、`call`、`raise`、`all-in`；`amount` 表示加注到的总下注额，非加注动作可以为 `0`。

## TexasSolver 能力

TexasSolver 相关配置在：

```text
config/texassolver.json
```

默认二进制路径：

```text
vendor/texassolver/TexasSolver-v0.2.0-MacOs/console_solver
```

当前实现把 TexasSolver 拆成两条链路：

- 翻前：不启动 `console_solver`，而是读取配置的 range profile，按位置、手牌类型和翻前行动历史选择动作。
- 翻后：启动 `console_solver`，构造 pot、effective stack、board、range、bet sizes 等输入，求解后选择当前手牌最高频动作。

翻后求解参数可在 `config/texassolver.json` 中调整：

```json
{
  "postflopTimeoutMs": 600000,
  "postflopThreadNum": 8
}
```

页面里有两个 TexasSolver 入口：

- AI 模式选择 `TexasSolver` 后，AI 自动使用 Solver/Range 决策。
- 轮到人类玩家行动时，可点击 `TexasSolver 建议` 查看当前行动点推荐。

## 翻前 Range Profile

`config/texassolver.json` 中的 `defaultPreflopRangeProfile` 决定默认翻前策略。页面的 `翻前 Range` 下拉框会自动列出所有 profile，并在牌桌归档中保存当时选择。

`seatCount` 表示 profile 的原始来源人数；`seatCounts` 表示牌桌实际剩余 2-6 人时都允许继续使用该 profile。少人局会按剩余玩家重新分配位置，例如 5 人局使用 `BTN/SB/BB/UTG/CO`，再落到对应位置的 range。没有真实 N-max solver tree 时，这是明确的近似 fallback，用来避免淘汰后策略直接失效。

内置 profile：

- `texassolver-6max`：TexasSolver 自带 `6max_range` tree。
- `sklansky-tight-6max`：基于 Sklansky 起手牌分组整理的偏紧 6-max 策略。
- `pokerroom-ev-balanced-6max`：基于 PokerRoom EV tiers 整理的中等松紧策略。
- `chen-loose-6max`：基于 Chen Formula 思路整理的偏松策略。

支持两种 profile 类型。

TexasSolver tree 目录格式：

```json
{
  "id": "my-6max-100bb",
  "label": "My 6-max 100bb",
  "type": "texassolver-tree",
  "seatCount": 6,
  "seatCounts": [2, 3, 4, 5, 6],
  "root": "ranges/my-6max-100bb",
  "defaultOpenSizesBb": {
    "UTG": 2.3,
    "MP": 2.3,
    "CO": 2.3,
    "BTN": 2.3,
    "SB": 3.0
  }
}
```

轻量手牌列表格式：

```json
{
  "id": "my-open-chart",
  "label": "My Open Chart",
  "type": "simple-hand-list",
  "seatCount": 6,
  "seatCounts": [2, 3, 4, 5, 6],
  "defaultOpenSizesBb": {
    "UTG": 2.5,
    "MP": 2.5,
    "CO": 2.5,
    "BTN": 2.5,
    "SB": 3.0
  },
  "ranges": {
    "open": {
      "UTG": "AA,KK,QQ,AKs",
      "BTN": "AA,KK,QQ,JJ,TT,99,88,AKs,AKo,AQs,AQo,KQs"
    },
    "call": {
      "_default": "AA,KK,QQ,JJ,TT,AKs,AKo,AQs,KQs"
    },
    "raise": {
      "_default": "AA,KK,QQ,AKs,AKo"
    },
    "allIn": {
      "_default": "AA,KK,AKs"
    }
  }
}
```

`simple-hand-list` 使用标准手牌类：对子如 `AA`，同花如 `AKs`，非同花如 `AKo`。

## 归档与复盘

每张牌桌会生成一个形如 `YYYYMMDD-xxxxxx` 的归档 ID。服务端按手牌拆分保存，避免单个 JSON 越打越大。

```text
data/<牌桌ID>/table.json
data/<牌桌ID>/hands/hand-000001.json
data/<牌桌ID>/hands/hand-000002.json
data/<牌桌ID>/ai-analysis/hand-000001.json
data/<牌桌ID>/ai-analysis/hand-000002.json
```

`table.json` 保存牌桌元信息、设置、玩家摘要、当前手牌索引、日志计数和 AI 分析索引。每一手的完整状态与事件保存在 `hands/hand-*.json`，AI 决策详情保存在 `ai-analysis/hand-*.json`。

AI 分析记录包含：

- `visibleState`：当时该 AI 可见的局面。
- `prompt` 或 `solverInput`：发给 Codex 或 TexasSolver 的输入。
- `rawOutput` / `parsedOutput`：原始输出和解析结果。
- `tokenUsage`：Codex 模式下的 token 信息。
- `sanitizedDecision` / `appliedAction`：建议动作和牌桌实际执行动作。

页面底部的 `你的 GTO 复盘` 可以选择历史牌桌和手牌。服务端会从归档中提取人类玩家行动点，再用 TexasSolver 给出推荐，并按 `合理`、`尺度可疑`、`偏离`、`无法分析` 汇总。

## 音频配置

默认音频配置：

```text
assets/audio/audio-config.json
```

默认音频文件：

```text
assets/audio/background.wav
assets/audio/check.wav
assets/audio/call.wav
assets/audio/raise.wav
assets/audio/fold.wav
assets/audio/all-in.wav
```

替换同名 wav 即可更换音效；也可以修改 `audio-config.json` 中的 `background.src` 和 `actions.*.src`。浏览器音频策略要求用户先与页面交互，背景音乐才会真正开始播放。

## 本地 API

服务端同时提供静态文件和本地 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/status` | 检查 Codex、TexasSolver、翻前 range profile 状态 |
| `POST` | `/api/ai-decision` | 获取 Codex 或 TexasSolver 决策 |
| `POST` | `/api/table-archive` | 保存当前牌桌归档 |
| `GET` | `/api/table-archives` | 列出本地归档 |
| `GET` | `/api/table-archive/<tableId>` | 读取并重组牌桌归档 |
| `GET` | `/api/table-ai-analysis/<tableId>` | 读取某张牌桌的 AI 分析记录 |
| `POST` | `/api/human-gto-analysis/<tableId>` | 对指定手牌做人类行动复盘 |

## 项目结构

```text
.
├── app.js                         # 前端牌桌、规则、UI、AI 调用和归档交互
├── index.html                     # 页面结构
├── styles.css                     # 牌桌样式
├── server.js                      # 静态服务、本地 API、Codex/TexasSolver 调用
├── codex-decision.schema.json     # Codex 决策输出 JSON Schema
├── config/
│   └── texassolver.json           # TexasSolver 与翻前 range 配置
├── assets/audio/                  # 背景音乐和动作音效
├── scripts/
│   └── texassolver-console        # TexasSolver 控制台辅助脚本
├── vendor/                        # 本地 TexasSolver 依赖目录
└── data/                          # 运行时生成的牌桌归档
```

## 开发提示

- 修改前端后刷新页面即可，无需构建。
- `server.js` 和 `app.js` 都是原生 JavaScript，适合直接用浏览器 DevTools 调试。
- `data/` 是运行时数据；排查复盘问题时优先看对应牌桌的 `hands/` 和 `ai-analysis/`。
- `/api/status` 是判断外部依赖是否接通的第一入口。
- TexasSolver 翻后可能耗时较长，优先调整 `postflopTimeoutMs`、`postflopThreadNum` 和 bet sizes。
- Codex 模式依赖本机 CLI 可执行，并且服务端会用 `codex-decision.schema.json` 约束输出。
