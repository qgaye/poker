const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataRoot = path.join(root, "data");
const texasSolverDir = path.join(root, "vendor", "texassolver", "TexasSolver-v0.2.0-MacOs");
const texasSolverBin = path.join(texasSolverDir, "console_solver");
const texasSolverConfigPath = path.join(root, "config", "texassolver.json");
const rangeCache = new Map();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 5_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function tableArchivePath(tableId) {
  if (!/^\d{8}-[a-z0-9]{6,16}$/i.test(tableId)) {
    throw new Error("Invalid table archive id");
  }
  return path.join(dataRoot, tableId);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function handNumberFromState(state) {
  return Math.max(0, Number(state?.handNumber) || 0);
}

function handFileName(handNumber) {
  return `hand-${String(handNumber).padStart(6, "0")}.json`;
}

function handRelativeFile(tableId, handNumber) {
  return `data/${tableId}/hands/${handFileName(handNumber)}`;
}

function aiAnalysisRelativeFile(tableId, handNumber) {
  return `data/${tableId}/ai-analysis/${handFileName(handNumber)}`;
}

function writeJsonAtomic(filePath, body, tmpPrefix) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `${tmpPrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(body, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function summarizePlayers(players) {
  return Array.isArray(players)
    ? players.map(player => {
        const { hand, ...summary } = player || {};
        return summary;
      })
    : [];
}

function collectHandNumbers(archive) {
  const numbers = new Set();
  const add = value => {
    const handNumber = Math.max(0, Number(value) || 0);
    if (handNumber > 0) numbers.add(handNumber);
  };
  add(archive?.currentState?.handNumber);
  for (const event of archive?.logs?.events || []) add(event?.state?.handNumber);
  for (const record of archive?.aiAnalysis?.records || []) add(record?.handNumber);
  return [...numbers].sort((a, b) => a - b);
}

function latestStateForHand(archive, handNumber) {
  const states = (archive?.logs?.events || [])
    .filter(event => handNumberFromState(event?.state) === handNumber && event.state)
    .map(event => event.state);
  if (handNumberFromState(archive?.currentState) === handNumber) states.push(archive.currentState);
  return states.length ? cloneJson(states[states.length - 1]) : null;
}

function logsForHand(archive, handNumber) {
  const events = (archive?.logs?.events || [])
    .filter(event => handNumberFromState(event?.state) === handNumber);
  const keys = new Set(events.map(event => `${event.type}:${event.sequence}`));
  const filterLogs = type => (archive?.logs?.[type] || [])
    .filter(entry => keys.has(`${type}:${entry.sequence}`));
  return {
    game: filterLogs("game"),
    ai: filterLogs("ai"),
    events
  };
}

function aiAnalysisRecordsForHand(archive, handNumber) {
  return (archive?.aiAnalysis?.records || [])
    .filter(record => Math.max(0, Number(record?.handNumber) || 0) === handNumber);
}

function buildHandArchive(tableId, archive, handNumber) {
  const logs = logsForHand(archive, handNumber);
  const aiRecords = aiAnalysisRecordsForHand(archive, handNumber);
  const state = latestStateForHand(archive, handNumber);
  const times = [
    ...logs.events.map(event => event?.at),
    ...aiRecords.map(record => record?.at)
  ].filter(Boolean).sort();
  const currentHandNumber = handNumberFromState(archive?.currentState);
  return {
    version: 1,
    tableId,
    handNumber,
    file: handRelativeFile(tableId, handNumber),
    createdAt: times[0] || archive?.tableInfo?.createdAt || new Date().toISOString(),
    updatedAt: times[times.length - 1] || archive?.tableInfo?.updatedAt || new Date().toISOString(),
    status: handNumber === currentHandNumber ? archive?.tableInfo?.status || "running" : "completed",
    state,
    logs,
    aiAnalysis: {
      version: 1,
      file: aiAnalysisRelativeFile(tableId, handNumber),
      recordCount: aiRecords.length
    }
  };
}

function writeHandArchives(tableId, archive) {
  const tableDir = tableArchivePath(tableId);
  const handsDir = path.join(tableDir, "hands");
  fs.mkdirSync(handsDir, { recursive: true });
  return collectHandNumbers(archive).map(handNumber => {
    const handArchive = buildHandArchive(tableId, archive, handNumber);
    const filePath = path.join(handsDir, handFileName(handNumber));
    writeJsonAtomic(filePath, handArchive, `hand-${handNumber}`);
    return {
      handNumber,
      file: handArchive.file,
      createdAt: handArchive.createdAt,
      updatedAt: handArchive.updatedAt,
      status: handArchive.status,
      eventCount: handArchive.logs.events.length,
      aiDecisionCount: handArchive.aiAnalysis.recordCount
    };
  });
}

function buildAiAnalysisHandArchive(tableId, archive, handNumber) {
  const records = aiAnalysisRecordsForHand(archive, handNumber);
  const times = records.map(record => record?.at).filter(Boolean).sort();
  return {
    version: archive?.aiAnalysis?.version || 1,
    tableId,
    handNumber,
    file: aiAnalysisRelativeFile(tableId, handNumber),
    createdAt: times[0] || archive?.tableInfo?.createdAt || archive?.aiAnalysis?.createdAt || new Date().toISOString(),
    updatedAt: times[times.length - 1] || archive?.tableInfo?.updatedAt || archive?.aiAnalysis?.updatedAt || new Date().toISOString(),
    records
  };
}

function writeAiAnalysisArchives(tableId, archive, hands) {
  const tableDir = tableArchivePath(tableId);
  const aiAnalysisDir = path.join(tableDir, "ai-analysis");
  fs.mkdirSync(aiAnalysisDir, { recursive: true });
  return hands.map(hand => {
    const handNumber = hand.handNumber;
    const handAnalysis = buildAiAnalysisHandArchive(tableId, archive, handNumber);
    const filePath = path.join(aiAnalysisDir, handFileName(handNumber));
    writeJsonAtomic(filePath, handAnalysis, `ai-analysis-${handNumber}`);
    return {
      handNumber,
      file: handAnalysis.file,
      createdAt: handAnalysis.createdAt,
      updatedAt: handAnalysis.updatedAt,
      recordCount: handAnalysis.records.length
    };
  });
}

function buildTableIndexArchive(tableId, archive, hands, aiAnalysisHands) {
  const currentHandNumber = handNumberFromState(archive?.currentState);
  const currentHand = hands.find(hand => hand.handNumber === currentHandNumber) || hands[hands.length - 1] || null;
  const aiRecordCount = Array.isArray(archive?.aiAnalysis?.records) ? archive.aiAnalysis.records.length : 0;
  return {
    version: archive?.version || 1,
    storageVersion: 2,
    tableInfo: {
      ...(archive?.tableInfo || {}),
      archiveId: tableId,
      directory: `data/${tableId}`,
      updatedAt: archive?.tableInfo?.updatedAt || new Date().toISOString()
    },
    settings: archive?.settings || {},
    players: summarizePlayers(archive?.players),
    currentHand: currentHand
      ? {
          handNumber: currentHand.handNumber,
          file: currentHand.file
        }
      : null,
    setupState: currentHandNumber === 0 ? archive?.currentState || null : undefined,
    hands,
    logs: {
      gameCount: Array.isArray(archive?.logs?.game) ? archive.logs.game.length : 0,
      aiCount: Array.isArray(archive?.logs?.ai) ? archive.logs.ai.length : 0,
      eventCount: Array.isArray(archive?.logs?.events) ? archive.logs.events.length : 0
    },
    aiAnalysis: archive?.aiAnalysis
      ? {
          version: archive.aiAnalysis.version || 1,
          hands: aiAnalysisHands,
          recordCount: aiRecordCount,
          updatedAt: archive.aiAnalysis.updatedAt || archive?.tableInfo?.updatedAt || new Date().toISOString()
        }
      : undefined
  };
}

function writeTableArchive(tableId, archive) {
  const tableDir = tableArchivePath(tableId);
  fs.mkdirSync(tableDir, { recursive: true });
  const filePath = path.join(tableDir, "table.json");
  const hands = writeHandArchives(tableId, archive);
  const aiAnalysisHands = archive?.aiAnalysis ? writeAiAnalysisArchives(tableId, archive, hands) : [];
  const tableArchive = buildTableIndexArchive(tableId, archive, hands, aiAnalysisHands);
  writeJsonAtomic(filePath, tableArchive, "table");
  return filePath;
}

function readHandArchive(tableId, hand) {
  const file = typeof hand === "string" ? hand : hand?.file;
  if (!file) return null;
  const relativeFile = file.startsWith(`data/${tableId}/`)
    ? file.slice(`data/${tableId}/`.length)
    : file;
  const filePath = path.join(tableArchivePath(tableId), relativeFile);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readAiAnalysisHandArchive(tableId, hand) {
  const file = typeof hand === "string" ? hand : hand?.file;
  if (!file) return null;
  const relativeFile = file.startsWith(`data/${tableId}/`)
    ? file.slice(`data/${tableId}/`.length)
    : file;
  const filePath = path.join(tableArchivePath(tableId), relativeFile);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readAiAnalysisArchive(tableId) {
  const tablePath = path.join(tableArchivePath(tableId), "table.json");
  const tableArchive = JSON.parse(fs.readFileSync(tablePath, "utf8"));
  if (Array.isArray(tableArchive?.aiAnalysis?.hands)) {
    const handAnalyses = tableArchive.aiAnalysis.hands
      .map(hand => {
        try {
          return readAiAnalysisHandArchive(tableId, hand);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (Number(a.handNumber) || 0) - (Number(b.handNumber) || 0));
    const records = handAnalyses
      .flatMap(hand => hand.records || [])
      .sort((a, b) => String(a?.at || "").localeCompare(String(b?.at || "")));
    return {
      version: tableArchive.aiAnalysis.version || 1,
      tableId,
      createdAt: handAnalyses[0]?.createdAt || tableArchive?.tableInfo?.createdAt || null,
      updatedAt: tableArchive.aiAnalysis.updatedAt || handAnalyses.at(-1)?.updatedAt || tableArchive?.tableInfo?.updatedAt || null,
      records
    };
  }
  const legacyPath = path.join(tableArchivePath(tableId), "ai-analysis.json");
  return JSON.parse(fs.readFileSync(legacyPath, "utf8"));
}

function rehydrateTableArchive(tableId, tableArchive) {
  if (!Array.isArray(tableArchive?.hands)) return tableArchive;
  const handArchives = tableArchive.hands
    .map(hand => {
      try {
        return readHandArchive(tableId, hand);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (Number(a.handNumber) || 0) - (Number(b.handNumber) || 0));
  const currentHandNumber = Number(tableArchive?.currentHand?.handNumber) || Number(handArchives.at(-1)?.handNumber) || 0;
  const currentHand = handArchives.find(hand => Number(hand.handNumber) === currentHandNumber) || handArchives.at(-1) || null;
  const logsForType = type => handArchives
    .flatMap(hand => (hand?.logs?.[type] || []).map(entry => ({
      handNumber: Number(hand.handNumber) || 0,
      ...entry
    })))
    .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));
  return {
    ...tableArchive,
    currentState: currentHand?.state || tableArchive.setupState || null,
    logs: {
      game: logsForType("game"),
      ai: logsForType("ai"),
      events: logsForType("events")
    }
  };
}

function listTableArchives() {
  if (!fs.existsSync(dataRoot)) return [];
  return fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{8}-[a-z0-9]{6,16}$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(dataRoot, entry.name, "table.json");
      try {
        const stat = fs.statSync(filePath);
        const archive = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
          id: entry.name,
          directory: `data/${entry.name}`,
          createdAt: archive?.tableInfo?.createdAt || stat.birthtime.toISOString(),
          updatedAt: archive?.tableInfo?.updatedAt || stat.mtime.toISOString(),
          status: archive?.tableInfo?.status || "unknown",
          handNumber: archive?.currentHand?.handNumber || archive?.currentState?.handNumber || 0,
          playerCount: Array.isArray(archive?.players) ? archive.players.length : 0
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function codexAvailable() {
  return new Promise(resolve => {
    const child = spawn("codex", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    child.on("close", code => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function texasSolverAvailable() {
  try {
    fs.accessSync(texasSolverBin, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function loadTexasSolverConfig() {
  const defaults = {
    preflopRangeRoot: path.join("vendor", "texassolver", "TexasSolver-v0.2.0-MacOs", "ranges", "6max_range"),
    postflopTimeoutMs: 600_000,
    defaultOpenSizesBb: { UTG: 2.5, MP: 2.5, CO: 2.5, BTN: 2.5, SB: 3.0 }
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(texasSolverConfigPath, "utf8")) };
  } catch {
    return defaults;
  }
}

function configuredPreflopRangeRoot() {
  const config = loadTexasSolverConfig();
  return path.isAbsolute(config.preflopRangeRoot)
    ? config.preflopRangeRoot
    : path.join(root, config.preflopRangeRoot);
}

function configuredPostflopTimeoutMs() {
  const config = loadTexasSolverConfig();
  const timeout = Number(config.postflopTimeoutMs);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 600_000;
}

function formatBb(value) {
  return `${Number(value).toFixed(1)}bb`;
}

function parseBbSegment(value) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)bb$/);
  return match ? Number(match[1]) : null;
}

function parseRangeFile(filePath) {
  if (rangeCache.has(filePath)) return rangeCache.get(filePath);
  const parsed = new Map();
  const raw = fs.readFileSync(filePath, "utf8").trim();
  for (const part of raw.split(",")) {
    const [hand, frequency] = part.split(":");
    if (hand) parsed.set(hand.trim(), Number(frequency) || 0);
  }
  rangeCache.set(filePath, parsed);
  return parsed;
}

function listDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

function closestBbDirectory(parentDir, wantedSegment) {
  const wanted = parseBbSegment(wantedSegment);
  if (!Number.isFinite(wanted)) return null;
  const candidates = listDirs(parentDir)
    .map(name => ({ name, value: parseBbSegment(name) }))
    .filter(candidate => Number.isFinite(candidate.value));
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.value - wanted) - Math.abs(b.value - wanted));
  return candidates[0];
}

function resolveRangePath(rangeRoot, parts) {
  const resolved = [];
  const mappings = [];
  let current = rangeRoot;

  for (let index = 0; index < (parts || []).length; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];

    if (nextPart === "Fold") {
      const foldPath = path.join(current, part, "Fold");
      if (!fs.existsSync(foldPath)) {
        mappings.push({
          type: "skippedFold",
          from: `${part}/Fold`,
          at: path.relative(rangeRoot, current) || "."
        });
        index += 1;
        continue;
      }
    }

    const exactPath = path.join(current, part);
    if (fs.existsSync(exactPath)) {
      resolved.push(part);
      current = exactPath;
      continue;
    }

    const closest = closestBbDirectory(current, part);
    if (closest) {
      resolved.push(closest.name);
      mappings.push({ from: part, to: closest.name, at: path.relative(rangeRoot, current) || "." });
      current = path.join(current, closest.name);
      continue;
    }

    return { ok: false, path: current, parts: resolved, mappings };
  }

  return { ok: true, path: current, parts: resolved, mappings };
}

function findFiles(dirPath, predicate, limit = 40) {
  const found = [];
  function walk(current) {
    if (found.length >= limit) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(next);
      } else if (predicate(next, entry.name)) {
        found.push(next);
        if (found.length >= limit) return;
      }
    }
  }
  walk(dirPath);
  return found;
}

function maxHandFrequency(files, handClass) {
  let best = 0;
  let sourceFile = "";
  for (const file of files) {
    const frequency = parseRangeFile(file).get(handClass) || 0;
    if (frequency > best) {
      best = frequency;
      sourceFile = file;
    }
  }
  return { frequency: best, sourceFile };
}

function preflopPathFromHistory(actions) {
  const parts = [];
  for (const item of actions || []) {
    if (!item?.position) continue;
    if (item.action === "fold") {
      parts.push(item.position, "Fold");
    } else if (item.action === "call") {
      parts.push(item.position, "Call");
    } else if (item.action === "all-in") {
      parts.push(item.position, "AllIn");
    } else if (item.action === "raise") {
      parts.push(item.position, formatBb(item.amountBb || 0));
    }
  }
  return parts;
}

function preflopPathVariants(actions) {
  const normalized = (actions || []).filter(item => item?.position);
  const firstAggressiveIndex = normalized.findIndex(item => item.action === "raise" || item.action === "all-in");
  const relevant = firstAggressiveIndex >= 0 ? normalized.slice(firstAggressiveIndex) : normalized;
  const variants = [];

  function pushVariant(items) {
    const parts = preflopPathFromHistory(items);
    const key = parts.join("/");
    if (!variants.some(variant => variant.key === key)) variants.push({ key, parts });
  }

  pushVariant(relevant);
  pushVariant(relevant.filter(item => item.action !== "fold"));

  const lastAggressiveIndex = relevant.findLastIndex(item => item.action === "raise" || item.action === "all-in");
  if (lastAggressiveIndex >= 0) pushVariant(relevant.slice(0, lastAggressiveIndex + 1));

  return variants;
}

function mapPreflopRangeAction(payload, actionName) {
  const legal = payload?.legalActions || {};
  if (actionName === "Fold") return { action: legal.canFold ? "fold" : (legal.canCheck ? "check" : "fold"), amount: 0 };
  if (actionName === "Call") return { action: legal.canCall ? "call" : (legal.canCheck ? "check" : "call"), amount: 0 };
  if (actionName === "AllIn") return { action: "all-in", amount: 0 };
  const raiseMatch = String(actionName).match(/^(\d+(?:\.\d+)?)bb$/);
  if (raiseMatch) {
    return {
      action: "raise",
      amount: Math.round(Number(raiseMatch[1]) * (Number(payload?.table?.bigBlind) || 1))
    };
  }
  return null;
}

function choosePreflopOpen(payload, rangeRoot, handClass) {
  const config = loadTexasSolverConfig();
  const position = payload?.player?.position || "";
  const openSize = config.defaultOpenSizesBb?.[position];
  if (!openSize) return null;
  const openDir = path.join(rangeRoot, position, formatBb(openSize));
  const files = findFiles(openDir, (_file, name) => name === `${position}_range.txt`, 80);
  const result = maxHandFrequency(files, handClass);
  const raiseAmount = Math.round(openSize * (Number(payload?.table?.bigBlind) || 1));
  return {
    decision: result.frequency > 0
      ? { action: "raise", amount: raiseAmount, reasoning: `TexasSolver Preflop Range: ${position} ${formatBb(openSize)} open，${handClass} 频率 ${(result.frequency * 100).toFixed(1)}%。` }
      : { action: "fold", amount: 0, reasoning: `TexasSolver Preflop Range: ${position} open range 未包含 ${handClass}。` },
    debug: {
      rangeRoot,
      rangePath: openDir,
      sourceFile: result.sourceFile,
      handClass,
      frequency: result.frequency,
      selectedAction: result.frequency > 0 ? `${formatBb(openSize)} open` : "Fold"
    }
  };
}

function choosePreflopResponse(payload, rangeRoot, handClass) {
  const position = payload?.player?.position || "";
  const historyVariants = preflopPathVariants(payload?.table?.preflopActions || []);
  const resolvedVariants = historyVariants.map(variant => ({
    ...variant,
    resolved: resolveRangePath(rangeRoot, variant.parts)
  }));
  const selectedVariant = resolvedVariants.find(variant => variant.resolved.ok && fs.existsSync(path.join(variant.resolved.path, position)))
    || resolvedVariants.find(variant => variant.resolved.ok)
    || resolvedVariants[0]
    || { parts: [], resolved: { ok: false, path: rangeRoot, parts: [], mappings: [] } };
  const historyPath = selectedVariant.resolved.parts;
  const basePath = selectedVariant.resolved.ok ? selectedVariant.resolved.path : path.join(rangeRoot, ...historyPath);
  const positionPath = path.join(basePath, position);
  const candidateActions = listDirs(positionPath);
  const candidates = [];
  for (const actionName of candidateActions) {
    const actionPath = path.join(positionPath, actionName);
    const files = findFiles(actionPath, (_file, name) => name === `${position}_range.txt`, 80);
    const result = maxHandFrequency(files, handClass);
    const mapped = mapPreflopRangeAction(payload, actionName);
    if (mapped) candidates.push({ actionName, actionPath, ...result, mapped });
  }
  candidates.sort((a, b) => b.frequency - a.frequency);
  const best = candidates[0];
  if (!best) return null;
  if (best.frequency <= 0) {
    return {
      decision: {
        action: payload?.legalActions?.canFold ? "fold" : "check",
        amount: 0,
        reasoning: `TexasSolver Preflop Range: ${position} 当前路径下 ${handClass} 不在任何继续行动 range，选择弃牌。`
      },
      debug: {
        rangeRoot,
        rangePath: positionPath,
        historyPath,
        amountMappings: selectedVariant.resolved.mappings || [],
        historyVariants: historyVariants.map(variant => variant.parts),
        candidates: candidates.map(candidate => ({
          action: candidate.actionName,
          frequency: candidate.frequency,
          sourceFile: candidate.sourceFile
        })),
        handClass,
        selectedAction: "Fold"
      }
    };
  }
  return {
    decision: {
      ...best.mapped,
      reasoning: `TexasSolver Preflop Range: ${position} 选择 ${best.actionName}，${handClass} 频率 ${(best.frequency * 100).toFixed(1)}%。`
    },
    debug: {
      rangeRoot,
      rangePath: positionPath,
      historyPath,
      amountMappings: selectedVariant.resolved.mappings || [],
      historyVariants: historyVariants.map(variant => variant.parts),
      candidates: candidates.map(candidate => ({
        action: candidate.actionName,
        frequency: candidate.frequency,
        sourceFile: candidate.sourceFile
      })),
      handClass,
      selectedAction: best.actionName
    }
  };
}

function runPreflopRangeDecision(payload) {
  const rangeRoot = configuredPreflopRangeRoot();
  const handClass = handClassFromCards(payload?.player?.holeCards || []);
  const reasons = [];
  if (!fs.existsSync(rangeRoot)) reasons.push(`preflop range root 不存在：${rangeRoot}`);
  if ((Number(payload?.table?.seatCount) || 0) !== 6) reasons.push("当前只支持 6-max TexasSolver 自带翻前 range");
  if (!payload?.player?.position) reasons.push("缺少玩家位置，无法查找翻前 range");
  if (!handClass) reasons.push("无法从手牌构造 hand class");
  if (reasons.length) {
    return {
      error: `TexasSolver Preflop Range 未运行：${reasons.join("；")}`,
      debug: { provider: "texassolver-preflop", rangeRoot, handClass, unsupportedReasons: reasons }
    };
  }

  const history = payload?.table?.preflopActions || [];
  const result = history.length
    ? choosePreflopResponse(payload, rangeRoot, handClass)
    : choosePreflopOpen(payload, rangeRoot, handClass);
  if (!result) {
    return {
      error: "TexasSolver Preflop Range 未找到当前行动路径或当前手牌策略。",
      debug: {
        provider: "texassolver-preflop",
        rangeRoot,
        handClass,
        historyPath: preflopPathFromHistory(history),
        selectedAction: null
      }
    };
  }
  return {
    decision: result.decision,
    debug: {
      provider: "texassolver-preflop",
      solverInput: JSON.stringify({
        rangeRoot,
        handClass,
        position: payload.player.position,
        preflopActions: history
      }, null, 2),
      rawOutput: JSON.stringify(result.debug, null, 2),
      parsedOutput: result.debug,
      solverOutput: result.debug,
      selectedAction: result.debug.selectedAction
    }
  };
}

function makePrompt(payload) {
  return [
    "你是一个德州扑克 AI 玩家。只根据给定 JSON 局面做一个合法决策。",
    "必须返回严格 JSON，字段为 action、amount、reasoning。",
    "action 只能是 fold/check/call/raise/all-in。",
    "amount 表示 raise 到的总下注额；check/call/fold 可为 0；all-in 可为当前玩家剩余可形成的总下注额。",
    "不要输出 Markdown，不要输出额外解释。",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function collectTokenUsage(value, usage = {}) {
  if (!value || typeof value !== "object") return usage;
  for (const [key, raw] of Object.entries(value)) {
    if (raw && typeof raw === "object") {
      collectTokenUsage(raw, usage);
      continue;
    }
    if (typeof raw !== "number") continue;
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (["input_tokens", "prompt_tokens", "cached_input_tokens"].includes(normalized)) {
      usage.inputTokens = Math.max(usage.inputTokens || 0, raw);
    } else if (["output_tokens", "completion_tokens", "reasoning_tokens"].includes(normalized)) {
      usage.outputTokens = Math.max(usage.outputTokens || 0, raw);
    } else if (["total_tokens", "total_token_count", "tokens_total"].includes(normalized)) {
      usage.totalTokens = Math.max(usage.totalTokens || 0, raw);
    }
  }
  return usage;
}

function runCodexDecision(payload) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `poker-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const prompt = makePrompt(payload);
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--json",
      "--output-schema",
      path.join(root, "codex-decision.schema.json"),
      "-o",
      outFile,
      "-"
    ];
    const child = spawn("codex", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex decision timed out"));
    }, 25_000);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Codex exited with ${code}`));
        return;
      }
      try {
        const raw = fs.readFileSync(outFile, "utf8").trim();
        fs.rmSync(outFile, { force: true });
        const events = parseJsonLines(stdout);
        const usage = events.reduce((result, event) => collectTokenUsage(event, result), {});
        resolve({
          decision: JSON.parse(raw),
          debug: {
            prompt,
            rawOutput: raw,
            usage: Object.keys(usage).length ? usage : null
          }
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(prompt);
  });
}

function parseVisibleCard(value) {
  const match = String(value || "").trim().match(/^([2-9TJQKA])([♠♥♦♣SHDC])$/i);
  if (!match) return null;
  const suitMap = { "♠": "s", "♥": "h", "♦": "d", "♣": "c", S: "s", H: "h", D: "d", C: "c" };
  return `${match[1].toUpperCase()}${suitMap[match[2].toUpperCase()] || suitMap[match[2]]}`;
}

function handClassFromCards(cards) {
  const parsed = cards.map(parseVisibleCard);
  if (parsed.some(card => !card)) return "";
  const rankOrder = "23456789TJQKA";
  const [a, b] = parsed.sort((left, right) => rankOrder.indexOf(right[0]) - rankOrder.indexOf(left[0]));
  if (a[0] === b[0]) return `${a[0]}${b[0]}`;
  return `${a[0]}${b[0]}${a[1] === b[1] ? "s" : "o"}`;
}

function exactHandKey(cards) {
  return cards.map(parseVisibleCard).filter(Boolean)
    .sort((left, right) => "23456789TJQKA".indexOf(right[0]) - "23456789TJQKA".indexOf(left[0]))
    .join("");
}

function allHoldemRangeClasses() {
  const ranks = "AKQJT98765432".split("");
  const ranges = [];
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i; j < ranks.length; j++) {
      if (i === j) {
        ranges.push(`${ranks[i]}${ranks[j]}`);
      } else {
        ranges.push(`${ranks[i]}${ranks[j]}s`, `${ranks[i]}${ranks[j]}o`);
      }
    }
  }
  return ranges.join(",");
}

const DEFAULT_TEXAS_SOLVER_RANGE = allHoldemRangeClasses();

function makeTexasSolverInput(payload, outputFile) {
  const legal = payload?.legalActions || {};
  const street = payload?.table?.street || "";
  const board = Array.isArray(payload?.table?.community)
    ? payload.table.community.map(parseVisibleCard).filter(Boolean)
    : [];
  const heroRange = handClassFromCards(payload?.player?.holeCards || []);
  const pot = Math.max(1, Math.round(Number(payload?.table?.pot) || 1));
  const effectiveStack = Math.max(
    1,
    Math.round(Math.min(
      Number(payload?.player?.stack) || pot,
      ...(payload?.table?.activePlayers || [])
        .filter(player => player.name !== payload?.player?.name)
        .map(player => Number(player.stack) || pot)
    ))
  );
  const unsupportedReasons = [];
  if (!texasSolverAvailable()) unsupportedReasons.push("TexasSolver console_solver 不可执行");
  if (street === "preflop" || board.length < 3) unsupportedReasons.push("TexasSolver 仅用于翻后局面");
  if (!heroRange) unsupportedReasons.push("无法从手牌构造 TexasSolver range");

  const input = [
    `set_pot ${pot}`,
    `set_effective_stack ${effectiveStack}`,
    `set_board ${board.join(",")}`,
    `set_range_oop ${heroRange || "AA"}`,
    `set_range_ip ${DEFAULT_TEXAS_SOLVER_RANGE}`,
    "set_bet_sizes oop,flop,bet,50",
    "set_bet_sizes oop,flop,raise,60",
    "set_bet_sizes ip,flop,bet,50",
    "set_bet_sizes ip,flop,raise,60",
    "set_bet_sizes oop,turn,bet,50",
    "set_bet_sizes oop,turn,raise,60",
    "set_bet_sizes ip,turn,bet,50",
    "set_bet_sizes ip,turn,raise,60",
    "set_bet_sizes oop,river,bet,50",
    "set_bet_sizes oop,river,donk,50",
    "set_bet_sizes oop,river,raise,60",
    "set_bet_sizes ip,river,bet,50",
    "set_bet_sizes ip,river,raise,60",
    "set_allin_threshold 1.0",
    "build_tree",
    "set_thread_num 4",
    "set_accuracy 2.0",
    "set_max_iteration 40",
    "set_print_interval 20",
    "set_use_isomorphism 1",
    "start_solve",
    "set_dump_rounds 2",
    `dump_result ${outputFile}`
  ].join("\n");

  return {
    input,
    supported: unsupportedReasons.length === 0,
    unsupportedReasons,
    heroRange,
    exactHand: exactHandKey(payload?.player?.holeCards || []),
    outputFile,
    pot,
    effectiveStack
  };
}

function texasSolverFallbackDecision(payload, reason) {
  const legal = payload?.legalActions || {};
  if (Number(legal.toCall) > 0) {
    return {
      action: legal.canCall ? "call" : "fold",
      amount: 0,
      reasoning: reason || "TexasSolver 当前局面不可用，按可继续动作兜底。"
    };
  }
  if (legal.canCheck) return { action: "check", amount: 0, reasoning: reason || "TexasSolver 当前局面不可用，过牌兜底。" };
  return { action: "fold", amount: 0, reasoning: reason || "TexasSolver 当前局面不可用，弃牌兜底。" };
}

function parseSolverActionAmount(action) {
  const match = String(action || "").match(/(?:BET|RAISE)\s+(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function selectTexasSolverDecisionNode(payload, outputJson) {
  const legal = payload?.legalActions || {};
  const toCall = Number(legal.toCall) || 0;
  if (toCall <= 0) return { node: outputJson, nodePath: [], matchedAction: "" };

  const children = outputJson?.childrens || {};
  const betActions = Object.keys(children)
    .map(action => ({ action, amount: parseSolverActionAmount(action), node: children[action] }))
    .filter(candidate => /^BET\b/i.test(candidate.action) && Number.isFinite(candidate.amount));
  if (!betActions.length) return { node: outputJson, nodePath: [], matchedAction: "" };

  betActions.sort((a, b) => Math.abs(a.amount - toCall) - Math.abs(b.amount - toCall));
  const best = betActions[0];
  return { node: best.node, nodePath: [best.action], matchedAction: best.action };
}

function findTexasSolverStrategy(outputJson, exactHand, heroRange) {
  const strategyBody = outputJson?.strategy?.strategy || {};
  const actions = outputJson?.strategy?.actions || outputJson?.actions || [];
  const exact = strategyBody[exactHand];
  if (Array.isArray(exact)) return { actions, probabilities: exact, source: exactHand };

  const matched = Object.entries(strategyBody).filter(([hand]) => {
    const match = hand.match(/^([2-9TJQKA])([shdc])([2-9TJQKA])([shdc])$/i);
    if (!match) return false;
    const derived = handClassFromCards([`${match[1].toUpperCase()}${match[2].toUpperCase()}`, `${match[3].toUpperCase()}${match[4].toUpperCase()}`]);
    return derived === heroRange;
  });
  if (!matched.length) return { actions, probabilities: [], source: "" };

  const sums = Array.from({ length: actions.length }, () => 0);
  for (const [, values] of matched) {
    values.forEach((value, index) => {
      sums[index] += Number(value) || 0;
    });
  }
  return {
    actions,
    probabilities: sums.map(value => value / matched.length),
    source: `${heroRange} aggregate`
  };
}

function mapTexasSolverAction(payload, solverAction) {
  const legal = payload?.legalActions || {};
  const action = String(solverAction || "").toUpperCase();
  if (action === "FOLD") return { action: legal.canFold ? "fold" : (legal.canCheck ? "check" : "fold"), amount: 0 };
  if (action === "CALL") return { action: legal.canCall ? "call" : (legal.canCheck ? "check" : "call"), amount: 0 };
  if (action === "CHECK") return { action: legal.canCheck ? "check" : "call", amount: 0 };
  if (action.startsWith("BET")) {
    const betAmount = Math.round(parseSolverActionAmount(action) || 0);
    return {
      action: legal.canRaise ? "raise" : (legal.canCheck ? "check" : "call"),
      amount: Math.max(Number(legal.minRaiseTo) || 0, betAmount)
    };
  }
  if (action.startsWith("RAISE")) {
    const raiseAmount = Math.round(parseSolverActionAmount(action) || 0);
    return {
      action: legal.canRaise ? "raise" : (legal.canCall ? "call" : "fold"),
      amount: Math.max(Number(legal.minRaiseTo) || 0, raiseAmount)
    };
  }
  if (action.startsWith("ALLIN") || action.includes("ALL-IN")) return { action: "all-in", amount: 0 };
  return texasSolverFallbackDecision(payload, `TexasSolver 动作 ${solverAction || "未知"} 暂未映射。`);
}

function cleanTexasSolverStdout(stdout) {
  return String(stdout || "")
    .replace(/\u0008/g, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.includes("] 0%") && !line.includes("] 2%") && !line.includes("] 4%"))
    .slice(-24)
    .join("\n");
}

function summarizeTexasSolverOutput(outputJson, strategy, selectedAction, outputFile, stdout, selectedNode = null) {
  return {
    outputFile,
    nodeType: selectedNode?.node?.node_type || outputJson?.node_type || "",
    player: selectedNode?.node?.player ?? outputJson?.player ?? null,
    nodePath: selectedNode?.nodePath || [],
    matchedAction: selectedNode?.matchedAction || "",
    actions: strategy.actions || selectedNode?.node?.actions || outputJson?.actions || [],
    strategySource: strategy.source || "",
    probabilities: strategy.probabilities || [],
    selectedAction,
    stdoutSummary: cleanTexasSolverStdout(stdout)
  };
}

function runTexasSolverDecision(payload) {
  return new Promise(resolve => {
    if (payload?.table?.street === "preflop") {
      resolve(runPreflopRangeDecision(payload));
      return;
    }
    const outputFile = path.join("resources", "outputs", `texassolver-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const solverRequest = makeTexasSolverInput(payload, outputFile);
    const postflopTimeoutMs = configuredPostflopTimeoutMs();
    const debugBase = {
      provider: "texassolver",
      prompt: solverRequest.input,
      solverInput: solverRequest.input,
      outputFile,
      postflopTimeoutMs,
      unsupportedReasons: solverRequest.unsupportedReasons,
      heroRange: solverRequest.heroRange,
      exactHand: solverRequest.exactHand
    };

    if (!solverRequest.supported) {
      const reason = `TexasSolver 未运行：${solverRequest.unsupportedReasons.join("；")}`;
      resolve({
        error: reason,
        debug: { ...debugBase, rawOutput: "", parsedOutput: null, selectedAction: null, fallbackReason: reason }
      });
      return;
    }

    const child = spawn(texasSolverBin, { cwd: texasSolverDir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, postflopTimeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      clearTimeout(timer);
      const reason = `TexasSolver 启动失败：${error.message}`;
      resolve({
        error: reason,
        debug: { ...debugBase, rawOutput: stdout || stderr, parsedOutput: null, selectedAction: null, fallbackReason: reason }
      });
    });
    child.on("close", code => {
      clearTimeout(timer);
      const outputPath = path.join(texasSolverDir, outputFile);
      let outputJson = null;
      try {
        if (fs.existsSync(outputPath)) outputJson = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      } catch {
        outputJson = null;
      }

      if (timedOut || code !== 0 || !outputJson) {
        const reason = timedOut
          ? "TexasSolver 决策超时"
          : `TexasSolver 退出异常${code == null ? "" : ` (${code})`}`;
        resolve({
          error: reason,
          debug: {
            ...debugBase,
            rawOutput: cleanTexasSolverStdout(stdout || stderr),
            parsedOutput: outputJson,
            solverOutput: outputJson,
            selectedAction: null,
            fallbackReason: reason
          }
        });
        return;
      }

      const selectedNode = selectTexasSolverDecisionNode(payload, outputJson);
      const strategy = findTexasSolverStrategy(selectedNode.node, solverRequest.exactHand, solverRequest.heroRange);
      let bestIndex = 0;
      for (let index = 1; index < strategy.probabilities.length; index++) {
        if ((strategy.probabilities[index] || 0) > (strategy.probabilities[bestIndex] || 0)) bestIndex = index;
      }
      const solverAction = strategy.actions[bestIndex] || "";
      if (!strategy.probabilities.length) {
        const reason = "TexasSolver 输出中未找到当前手牌策略。";
        resolve({
          error: reason,
          debug: {
            ...debugBase,
            rawOutput: JSON.stringify(summarizeTexasSolverOutput(outputJson, strategy, null, outputFile, stdout, selectedNode), null, 2),
            parsedOutput: summarizeTexasSolverOutput(outputJson, strategy, null, outputFile, stdout, selectedNode),
            solverOutput: summarizeTexasSolverOutput(outputJson, strategy, null, outputFile, stdout, selectedNode),
            selectedAction: null,
            fallbackReason: reason,
            stdout: cleanTexasSolverStdout(stdout),
            stderr
          }
        });
        return;
      }
      const mapped = mapTexasSolverAction(payload, solverAction);
      const selectedAction = {
        solverAction,
        probability: strategy.probabilities[bestIndex] || 0,
        strategySource: strategy.source,
        nodePath: selectedNode.nodePath,
        matchedAction: selectedNode.matchedAction,
        mappedAction: mapped
      };
      const solverOutput = summarizeTexasSolverOutput(outputJson, strategy, selectedAction, outputFile, stdout, selectedNode);
      resolve({
        decision: {
          ...mapped,
          reasoning: strategy.probabilities.length
            ? `TexasSolver 选择 ${solverAction}，频率 ${(selectedAction.probability * 100).toFixed(1)}%。`
            : mapped.reasoning
        },
        debug: {
          ...debugBase,
          rawOutput: JSON.stringify(solverOutput, null, 2),
          parsedOutput: solverOutput,
          solverOutput,
          selectedAction,
          stdout: cleanTexasSolverStdout(stdout),
          stderr
        }
      });
    });
    child.stdin.end(`${solverRequest.input}\n`);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/status") {
    sendJson(res, 200, { ok: true, codex: await codexAvailable(), texasSolver: texasSolverAvailable() });
    return;
  }

  if (url.pathname === "/api/table-archive" && req.method === "POST") {
    try {
      const archive = JSON.parse(await readBody(req));
      const tableId = archive?.tableInfo?.archiveId;
      if (!tableId) {
        sendJson(res, 400, { error: "Missing tableInfo.archiveId" });
        return;
      }
      const filePath = writeTableArchive(tableId, archive);
      sendJson(res, 200, { ok: true, tableId, file: path.relative(root, filePath) });
    } catch (error) {
      sendJson(res, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (url.pathname === "/api/table-archives" && req.method === "GET") {
    sendJson(res, 200, { archives: listTableArchives() });
    return;
  }

  if (url.pathname.startsWith("/api/table-archive/") && req.method === "GET") {
    try {
      const tableId = decodeURIComponent(url.pathname.slice("/api/table-archive/".length));
      const filePath = path.join(tableArchivePath(tableId), "table.json");
      const archive = rehydrateTableArchive(tableId, JSON.parse(fs.readFileSync(filePath, "utf8")));
      sendJson(res, 200, archive);
    } catch (error) {
      sendJson(res, 404, { error: error.message || String(error) });
    }
    return;
  }

  if (url.pathname.startsWith("/api/table-ai-analysis/") && req.method === "GET") {
    try {
      const tableId = decodeURIComponent(url.pathname.slice("/api/table-ai-analysis/".length));
      sendJson(res, 200, readAiAnalysisArchive(tableId));
    } catch (error) {
      sendJson(res, 404, { error: error.message || String(error) });
    }
    return;
  }

  if (url.pathname === "/api/ai-decision" && req.method === "POST") {
    try {
      const payload = JSON.parse(await readBody(req));
      if (payload.provider === "texassolver") {
        const result = await runTexasSolverDecision(payload.state);
        if (result.error) {
          sendJson(res, 422, { error: result.error, debug: result.debug, provider: "texassolver" });
          return;
        }
        sendJson(res, 200, { decision: result.decision, debug: result.debug, provider: "texassolver" });
        return;
      }
      if (payload.provider !== "codex") {
        sendJson(res, 400, { error: "Only codex and texassolver providers are handled by the server" });
        return;
      }
      const result = await runCodexDecision(payload.state);
      sendJson(res, 200, { decision: result.decision, debug: result.debug, provider: "codex" });
    } catch (error) {
      sendJson(res, 502, { error: error.message || String(error) });
    }
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Poker table: http://localhost:${port}`);
});
