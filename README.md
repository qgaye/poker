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
