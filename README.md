# Codex 德州扑克桌

本地网页实现：1 名人类玩家和 N 个 AI 玩家同桌打德州扑克。AI 默认通过本机 `codex exec` 做决策；如果 Codex 不可用或超时，会自动回退到内置策略，牌局不会卡死。

## 启动

```bash
node server.js
```

打开：

```text
http://localhost:4173
```

## 功能

- 支持 1-8 个 AI 玩家。
- 支持小盲/大盲、翻牌/转牌/河牌、摊牌、弃牌直接赢池。
- 支持过牌、跟注、加注、全下。
- 支持边池结算。
- AI 决策日志会显示动作、理由、token 消耗，并可展开查看输入 Prompt 与输出信息。
- AI 分析详情默认隐藏，可在日志区域点击“显示分析”展开。
- `AI 模式` 可在 `Codex CLI` 和 `内置策略` 间切换。
- TexasSolver 翻前策略支持选择不同 range profile；默认使用 TexasSolver 自带 `6max_range`。
- 音频使用本地 `assets/audio/` 资源，支持背景音乐、动作音效开关和音量配置。
- 每个牌桌目录会按手保存 `ai-analysis/hand-*.json`，用于复盘每次 Codex AI 决策的可见局面、Prompt、输出和 token。

## 音频配置

默认音频配置在：

```text
assets/audio/audio-config.json
```

本地音频文件放在：

```text
assets/audio/
```

默认包含 `background.wav`、`check.wav`、`call.wav`、`raise.wav`、`fold.wav`、`all-in.wav`。如需替换音效，可以直接替换同名 wav，或修改 `audio-config.json` 中的 `background.src` 和 `actions.*.src`。

## Codex 决策链路

前端每次轮到 AI 时，会把该 AI 可见的局面、手牌、公共牌、底池、跟注额、合法动作发给：

```text
POST /api/ai-decision
```

服务端调用：

```bash
codex exec --skip-git-repo-check --ephemeral --sandbox read-only --json --output-schema codex-decision.schema.json -o <tmp-file> -
```

Codex 必须返回严格 JSON：

```json
{
  "action": "call",
  "amount": 0,
  "reasoning": "跟注额较小，手牌有继续看牌价值。"
}
```

每次保存牌桌时，服务端会写入：

```text
data/<牌桌ID>/table.json
data/<牌桌ID>/hands/hand-000001.json
data/<牌桌ID>/hands/hand-000002.json
data/<牌桌ID>/ai-analysis/hand-000001.json
data/<牌桌ID>/ai-analysis/hand-000002.json
```

`table.json` 只保存牌桌元信息、每手牌索引和每手 AI 分析索引；每一手牌的完整状态、动作事件会单独保存在 `hands/hand-*.json`，每一手的 AI 决策分析会单独保存在 `ai-analysis/hand-*.json`。导入归档时，服务端会按 `table.json` 里的索引读取这些文件并重组给前端。

`ai-analysis/hand-*.json` 的 `records` 中，每条记录对应一次 Codex 决策，包含：

- `visibleState`：当时该 AI 可见的牌局信息。
- `prompt`：实际发给 Codex 的完整 Prompt。
- `rawOutput` / `parsedOutput`：Codex 原始输出和解析后的 JSON。
- `tokenUsage`：本次输入/输出/总 token。
- `sanitizedDecision` / `appliedAction`：模型建议和牌桌校验后实际执行的动作。

前端仍会二次校验动作合法性，避免 AI 输出异常金额破坏牌局状态。

## TexasSolver 翻前 Range

TexasSolver 模式下，翻前不会启动 `console_solver`，而是读取 `config/texassolver.json` 里的 range profile。默认配置等价于原来的 TexasSolver 自带 6-max range：

```json
{
  "defaultPreflopRangeProfile": "texassolver-6max",
  "preflopRangeProfiles": [
    {
      "id": "texassolver-6max",
      "label": "TexasSolver 6-max",
      "type": "texassolver-tree",
      "seatCount": 6,
      "root": "vendor/texassolver/TexasSolver-v0.2.0-MacOs/ranges/6max_range",
      "defaultOpenSizesBb": {
        "UTG": 2.5,
        "MP": 2.5,
        "CO": 2.5,
        "BTN": 2.5,
        "SB": 3.0
      }
    }
  ]
}
```

接入其他 range 有两种方式。

第一种是 TexasSolver tree 目录格式：

```json
{
  "id": "my-6max-100bb",
  "label": "My 6-max 100bb",
  "type": "texassolver-tree",
  "seatCount": 6,
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

第二种是轻量手牌列表格式，适合接入网上公开的起手牌分组、EV 排名或公式派生 range：

```json
{
  "id": "my-open-chart",
  "label": "My Open Chart",
  "type": "simple-hand-list",
  "seatCount": 6,
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

当前内置的额外 profile：

- `sklansky-tight-6max`：根据 Sklansky 起手牌分组整理出的偏紧 6-max 策略。
- `pokerroom-ev-balanced-6max`：根据 PokerRoom 真实线上牌局 EV tiers 整理出的中等松紧策略。
- `chen-loose-6max`：根据 Chen Formula 思路整理出的偏松 6-max 策略。

这些公开资料来自 Wikipedia 的 Texas hold 'em starting hands 条目：`https://en.wikipedia.org/wiki/Texas_hold_%27em_starting_hands`。它们不是 GTO 方案，主要用于提供可切换的 baseline 策略和对照测试。

前端的“翻前 Range”下拉框会自动列出这些 profile；牌桌归档也会保存当时选中的 `preflopRangeProfileId`，方便复盘。
