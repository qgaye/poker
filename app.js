const RANKS = "23456789TJQKA".split("");
const SUITS = ["S", "H", "D", "C"];
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
const STREETS = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABEL = {
  preflop: "翻牌前",
  flop: "翻牌圈",
  turn: "转牌圈",
  river: "河牌圈",
  showdown: "摊牌"
};
const AI_NAMES = [
  "Ethan",
  "Olivia",
  "Liam",
  "Emma",
  "Noah",
  "Ava",
  "Mason",
  "Sophia",
  "Lucas",
  "Mia",
  "Logan",
  "Grace",
  "Owen",
  "Chloe",
  "Henry",
  "Nora"
];
const DEFAULT_AUDIO_CONFIG = {
  defaults: {
    soundEnabled: true,
    musicEnabled: true,
    effectsVolume: 0.75,
    musicVolume: 0.28
  },
  background: {
    src: "./assets/audio/background.wav",
    loop: true
  },
  actions: {
    check: { src: "./assets/audio/check.wav" },
    call: { src: "./assets/audio/call.wav" },
    raise: { src: "./assets/audio/raise.wav" },
    fold: { src: "./assets/audio/fold.wav" },
    "all-in": { src: "./assets/audio/all-in.wav" }
  }
};

const els = {
  serverStatus: document.getElementById("serverStatus"),
  aiCount: document.getElementById("aiCount"),
  startingStack: document.getElementById("startingStack"),
  bigBlind: document.getElementById("bigBlind"),
  aiMode: document.getElementById("aiMode"),
  soundToggleBtn: document.getElementById("soundToggleBtn"),
  musicToggleBtn: document.getElementById("musicToggleBtn"),
  effectsVolume: document.getElementById("effectsVolume"),
  musicVolume: document.getElementById("musicVolume"),
  newTableBtn: document.getElementById("newTableBtn"),
  newHandBtn: document.getElementById("newHandBtn"),
  currentArchiveId: document.getElementById("currentArchiveId"),
  archiveSelect: document.getElementById("archiveSelect"),
  importTableBtn: document.getElementById("importTableBtn"),
  archiveNotice: document.getElementById("archiveNotice"),
  flowControl: document.getElementById("flowControl"),
  flowStatusText: document.getElementById("flowStatusText"),
  tableFlowBtn: document.getElementById("tableFlowBtn"),
  potTotal: document.getElementById("potTotal"),
  currentBet: document.getElementById("currentBet"),
  blindSummary: document.getElementById("blindSummary"),
  actionOrder: document.getElementById("actionOrder"),
  board: document.getElementById("board"),
  seats: document.getElementById("seats"),
  turnTitle: document.getElementById("turnTitle"),
  turnHint: document.getElementById("turnHint"),
  foldBtn: document.getElementById("foldBtn"),
  checkCallBtn: document.getElementById("checkCallBtn"),
  raiseAmount: document.getElementById("raiseAmount"),
  raiseAmountInput: document.getElementById("raiseAmountInput"),
  raiseTicks: document.getElementById("raiseTicks"),
  raiseAmountLabel: document.getElementById("raiseAmountLabel"),
  raiseMultipleBtns: document.querySelectorAll(".raise-multiple"),
  raisePointBtns: document.querySelectorAll(".raise-point"),
  raiseBtn: document.getElementById("raiseBtn"),
  allInBtn: document.getElementById("allInBtn"),
  actionPulse: document.getElementById("actionPulse"),
  logPanel: document.querySelector(".log-panel"),
  toggleReasonBtn: document.getElementById("toggleReasonBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  gameLog: document.getElementById("gameLog"),
  aiLog: document.getElementById("aiLog")
};

let state = null;
let serverHasCodex = false;
let serverHasTexasSolver = false;
let actionToken = 0;
let showAnalysis = false;
let tablePaused = true;
let tableArchiveId = "";
let tableCreatedAt = "";
let tableSettings = null;
let logSequence = 0;
let persistTimer = null;
let persistQueue = Promise.resolve();
let recentAction = null;
let recentHumanAction = null;
let thinkingPlayerId = "";
let thinkingStartedAt = 0;
let thinkingElapsedMs = 0;
let thinkingTimer = null;
let audioConfig = DEFAULT_AUDIO_CONFIG;
let soundEnabled = storedAudioPreference("pokerSoundEnabled", audioConfig.defaults.soundEnabled) !== false;
let musicEnabled = storedAudioPreference("pokerMusicEnabled", audioConfig.defaults.musicEnabled) !== false;
let effectsVolume = Number(storedAudioPreference("pokerEffectsVolume", audioConfig.defaults.effectsVolume));
let musicVolume = Number(storedAudioPreference("pokerMusicVolume", audioConfig.defaults.musicVolume));
let audioUnlocked = false;
let backgroundAudio = null;
let actionAudio = {};
let runLogs = {
  game: [],
  ai: [],
  events: []
};
let aiAnalysisRecords = [];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let i = 0; i < RANKS.length; i++) {
      deck.push({ rank: RANKS[i], value: i + 2, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function shuffledAiNames(count) {
  const names = [...AI_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return Array.from({ length: count }, (_, index) => {
    const baseName = names[index % names.length];
    const suffix = index >= names.length ? ` ${Math.floor(index / names.length) + 1}` : "";
    return `${baseName}${suffix} (AI)`;
  });
}

function cardText(card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function createLogItem(message, reason = "", details = null, number = null) {
  const item = document.createElement("li");
  const displayNumber = Number(number);
  if (Number.isFinite(displayNumber) && displayNumber > 0) item.value = displayNumber;
  const normalizedDetails = normalizeAiDetails(details);
  const detailHtml = normalizedDetails ? renderAiLogDetails(normalizedDetails) : "";
  const tokenHtml = shouldShowTokenUsage(normalizedDetails)
    ? ` <span class="token-summary">${escapeHtml(formatTokenUsage(normalizedDetails.usage))}</span>`
    : "";
  item.innerHTML = [
    escapeHtml(message),
    tokenHtml,
    reason ? `<div class="reason">${escapeHtml(reason)}${detailHtml}</div>` : detailHtml ? `<div class="reason">${detailHtml}</div>` : ""
  ].join("");
  return item;
}

function appendLog(target, message, reason = "", details = null) {
  const item = createLogItem(message, reason, details);
  target.prepend(item);
  while (target.children.length > 80) target.lastElementChild.remove();
}

function gameLog(message) {
  if (!tableArchiveId) {
    appendLog(els.gameLog, message);
    return;
  }
  recordRunLog("game", { message });
  renderStoredLogs();
}

function aiDecisionLog(message, reason = "", details = null) {
  if (!tableArchiveId) {
    appendLog(els.aiLog, message, reason, details);
    return;
  }
  recordRunLog("ai", { message, reason, details });
  renderStoredLogs();
}

function formatTokenUsage(usage) {
  if (!usage) return "Token: 未返回";
  const totalTokens = Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : (Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens) ? usage.inputTokens + usage.outputTokens : null);
  const parts = [];
  if (Number.isFinite(usage.inputTokens)) parts.push(`输入 ${usage.inputTokens}`);
  if (Number.isFinite(usage.outputTokens)) parts.push(`输出 ${usage.outputTokens}`);
  if (Number.isFinite(totalTokens)) parts.push(`总计 ${totalTokens}`);
  return parts.length ? `Token: ${parts.join(" / ")}` : "Token: 未返回";
}

function normalizeAiDetails(details) {
  if (!details) return null;
  const rawOutput = details.rawOutput || (details.parsedOutput ? JSON.stringify(details.parsedOutput, null, 2) : "");
  return {
    ...details,
    usage: details.usage || details.tokenUsage || null,
    rawOutput,
    visibleState: details.visibleState || null
  };
}

function shouldShowTokenUsage(details) {
  return String(details?.provider || "").toLowerCase() === "codex";
}

function renderAiLogDetails(details) {
  const prompt = details?.prompt || details?.solverInput ? escapeHtml(details.prompt || details.solverInput) : "未返回";
  const rawOutput = details?.rawOutput ? escapeHtml(details.rawOutput) : "未返回";
  const usageHtml = shouldShowTokenUsage(details)
    ? `<div class="debug-meta">${escapeHtml(formatTokenUsage(details?.usage))}</div>`
    : "";
  const visibleState = details?.visibleState ? escapeHtml(JSON.stringify(details.visibleState, null, 2)) : "未返回";
  const selectedAction = details?.selectedAction ? escapeHtml(JSON.stringify(details.selectedAction, null, 2)) : "未返回";
  return `
    <details class="ai-debug">
      <summary>Prompt / 输出</summary>
      ${usageHtml}
      <label>AI 可见牌局信息</label>
      <pre>${visibleState}</pre>
      <label>输入 Prompt</label>
      <pre>${prompt}</pre>
      <label>具体行动</label>
      <pre>${selectedAction}</pre>
      <label>输出信息</label>
      <pre>${rawOutput}</pre>
    </details>
  `;
}

function recordRunLog(type, payload) {
  if (!tableArchiveId) return;
  const handNumber = Number(payload.handNumber) || Number(state?.handNumber) || 0;
  const entry = {
    sequence: ++logSequence,
    at: new Date().toISOString(),
    handNumber,
    ...payload
  };
  runLogs[type].push(entry);
  runLogs.events.push({
    ...entry,
    type,
    state: snapshotState()
  });
  queuePersistTable();
  return entry;
}

function createArchiveId() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), value => value.toString(16).padStart(2, "0")).join("");
  return `${date}-${random}`;
}

function resetRunArchive(settings) {
  tableArchiveId = createArchiveId();
  tableCreatedAt = new Date().toISOString();
  tableSettings = settings;
  logSequence = 0;
  recentAction = null;
  recentHumanAction = null;
  thinkingPlayerId = "";
  thinkingStartedAt = 0;
  thinkingElapsedMs = 0;
  runLogs = {
    game: [],
    ai: [],
    events: []
  };
  aiAnalysisRecords = [];
}

function snapshotState() {
  if (!state) return null;
  return {
    ...JSON.parse(JSON.stringify(state)),
    paused: tablePaused,
    activePlayerId: activePlayer()?.id || null,
    pot: totalPot()
  };
}

function archiveStatus() {
  if (!state) return "empty";
  const livePlayers = state.players.filter(player => player.stack > 0);
  if (livePlayers.length < 2) return "completed";
  if (tablePaused) return "paused";
  return "running";
}

function buildTableArchive() {
  const updatedAt = new Date().toISOString();
  return {
    version: 1,
    tableInfo: {
      archiveId: tableArchiveId,
      directory: `data/${tableArchiveId}`,
      createdAt: tableCreatedAt,
      updatedAt,
      status: archiveStatus(),
      aiMode: els.aiMode.value
    },
    settings: {
      ...(tableSettings || {}),
      aiMode: els.aiMode.value
    },
    players: state ? JSON.parse(JSON.stringify(state.players)) : [],
    currentState: snapshotState(),
    logs: {
      game: runLogs.game,
      ai: runLogs.ai,
      events: runLogs.events
    },
    aiAnalysis: {
      version: 1,
      createdAt: tableCreatedAt,
      updatedAt,
      records: aiAnalysisRecords
    }
  };
}

function queuePersistTable() {
  if (!state || !tableArchiveId) return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistTableArchive, 120);
}

function persistTableArchive() {
  if (!state || !tableArchiveId) return Promise.resolve();
  return persistTableArchiveSnapshot(buildTableArchive());
}

function persistTableArchiveNow() {
  if (!state || !tableArchiveId) return Promise.resolve();
  window.clearTimeout(persistTimer);
  persistTimer = null;
  return persistTableArchiveSnapshot(buildTableArchive());
}

function persistTableArchiveSnapshot(archive) {
  const archiveSnapshot = JSON.parse(JSON.stringify(archive));
  persistQueue = persistQueue
    .catch(() => {})
    .then(() => sendTableArchiveSnapshot(archiveSnapshot));
  return persistQueue;
}

async function sendTableArchiveSnapshot(archive) {
  try {
    const response = await fetch("/api/table-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(archive)
    });
    if (response.ok) loadArchiveList();
  } catch (error) {
    console.warn("Failed to persist table archive", error);
  }
}

function updateArchiveDisplay() {
  els.currentArchiveId.textContent = tableArchiveId || "--";
}

function requestedTableId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("tableId") || params.get("table") || params.get("id") || "";
}

function setArchiveNotice(message = "", tone = "") {
  if (!els.archiveNotice) return;
  els.archiveNotice.textContent = message;
  els.archiveNotice.className = ["archive-notice", tone].filter(Boolean).join(" ");
}

function updateTableUrl(tableId) {
  if (!tableId) return;
  const url = new URL(window.location.href);
  url.searchParams.set("tableId", tableId);
  url.searchParams.delete("table");
  url.searchParams.delete("id");
  window.history.replaceState(null, "", url);
}

async function loadArchiveList() {
  try {
    const response = await fetch("/api/table-archives");
    if (!response.ok) throw new Error("无法读取牌桌归档列表");
    const { archives } = await response.json();
    const currentValue = tableArchiveId || els.archiveSelect.value;
    els.archiveSelect.innerHTML = "";
    if (!archives.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "暂无可导入牌桌";
      els.archiveSelect.append(option);
      els.importTableBtn.disabled = true;
      return;
    }
    for (const archive of archives) {
      const option = document.createElement("option");
      option.value = archive.id;
      option.textContent = `${archive.id} · ${archive.status} · 第 ${archive.handNumber} 手 · ${archive.playerCount} 人`;
      els.archiveSelect.append(option);
    }
    els.archiveSelect.value = archives.some(archive => archive.id === currentValue) ? currentValue : archives[0].id;
    els.importTableBtn.disabled = false;
  } catch (error) {
    els.archiveSelect.innerHTML = '<option value="">读取归档失败</option>';
    els.importTableBtn.disabled = true;
    console.warn("Failed to load table archives", error);
  }
}

function renderStoredLogs() {
  const handRanges = buildHandRanges(runLogs.game || []);
  renderGroupedLog(els.gameLog, runLogs.game || [], (entry, number) => createLogItem(entry.message || "", "", null, number), handRanges);
  renderGroupedLog(els.aiLog, buildAiLogEntries(handRanges), (entry, number) => createLogItem(entry.message || "", entry.reason || "", entry.details, number), handRanges);
  const latest = [...(runLogs.game || [])].sort((a, b) => (Number(b.sequence) || 0) - (Number(a.sequence) || 0))[0];
  recentAction = latest
    ? {
        playerId: "",
        playerName: "牌桌",
        action: latest.message || "",
        isHuman: String(latest.message || "").startsWith("你:"),
        pot: totalPot(),
        at: latest.at
      }
    : null;
  recentHumanAction = recentAction?.isHuman ? { ...recentAction, visibleUntil: Date.now() + 3500 } : null;
}

function buildAiLogEntries(handRanges = []) {
  const analysisRecords = Array.isArray(aiAnalysisRecords) ? aiAnalysisRecords : [];
  const recordsByHand = new Map();
  for (const record of [...analysisRecords].sort(compareLogEntriesAsc)) {
    const handNumber = entryHandNumber(record, handRanges);
    if (!recordsByHand.has(handNumber)) recordsByHand.set(handNumber, []);
    recordsByHand.get(handNumber).push(record);
  }

  const entries = [];
  for (const entry of [...(runLogs.ai || [])].sort(compareLogEntriesAsc)) {
    const handNumber = entryHandNumber(entry, handRanges);
    const record = (recordsByHand.get(handNumber) || []).shift() || null;
    entries.push({
      ...entry,
      handNumber,
      details: record || normalizeAiDetails(entry.details)
    });
  }

  for (const records of recordsByHand.values()) {
    for (const record of records) {
      entries.push({
        ...aiAnalysisRecordToLog(record),
        handNumber: entryHandNumber(record, handRanges),
        at: record?.at || "",
        sequence: Number.MAX_SAFE_INTEGER
      });
    }
  }
  return entries;
}

function renderGroupedLog(target, entries, renderEntry, handRanges = []) {
  target.innerHTML = "";
  const grouped = groupLogEntries(entries, handRanges);
  for (const group of grouped) {
    const item = document.createElement("li");
    item.className = "log-hand-group";
    const title = group.handNumber > 0 ? `第 ${group.handNumber} 手` : "牌桌记录";
    item.innerHTML = `
      <div class="log-hand-title">
        <span>${escapeHtml(title)}</span>
        <small>${group.entries.length} 条</small>
      </div>
    `;
    const list = document.createElement("ol");
    list.className = "log-hand-list";
    list.reversed = true;
    for (let index = 0; index < group.entries.length; index++) {
      const entry = group.entries[index];
      list.append(renderEntry(entry, group.entries.length - index));
    }
    item.append(list);
    target.append(item);
  }
}

function groupLogEntries(entries, handRanges = []) {
  const groups = new Map();
  for (const entry of entries || []) {
    const handNumber = entryHandNumber(entry, handRanges);
    if (!groups.has(handNumber)) groups.set(handNumber, []);
    groups.get(handNumber).push(entry);
  }
  return [...groups.entries()]
    .map(([handNumber, groupEntries]) => ({
      handNumber,
      entries: groupEntries.sort(compareLogEntriesDesc)
    }))
    .sort((a, b) => b.handNumber - a.handNumber);
}

function buildHandRanges(entries) {
  const starts = [...(entries || [])]
    .map(entry => ({
      handNumber: handNumberFromMessage(entry?.message),
      sequence: Number(entry?.sequence) || 0,
      at: entry?.at || ""
    }))
    .filter(start => start.handNumber > 0)
    .sort(compareLogEntriesAsc);
  return starts.map((start, index) => ({
    handNumber: start.handNumber,
    startSequence: start.sequence,
    endSequence: starts[index + 1]?.sequence || Number.POSITIVE_INFINITY,
    startAt: start.at,
    endAt: starts[index + 1]?.at || ""
  }));
}

function entryHandNumber(entry, handRanges = []) {
  const direct = Number(entry?.handNumber);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const stateNumber = Number(entry?.state?.handNumber);
  if (Number.isFinite(stateNumber) && stateNumber > 0) return stateNumber;
  const messageHandNumber = handNumberFromMessage(entry?.message);
  if (messageHandNumber > 0) return messageHandNumber;
  const sequence = Number(entry?.sequence);
  if (Number.isFinite(sequence)) {
    const range = handRanges.find(candidate => sequence >= candidate.startSequence && sequence < candidate.endSequence);
    if (range) return range.handNumber;
  }
  const at = String(entry?.at || "");
  if (at) {
    const range = handRanges.find(candidate => at >= candidate.startAt && (!candidate.endAt || at < candidate.endAt));
    if (range) return range.handNumber;
  }
  return 0;
}

function handNumberFromMessage(message) {
  const messageMatch = String(message || "").match(/^第\s*(\d+)\s*手/);
  return messageMatch ? Number(messageMatch[1]) : 0;
}

function compareLogEntriesDesc(a, b) {
  return compareLogEntriesAsc(b, a);
}

function compareLogEntriesAsc(a, b) {
  const aSequence = Number(a?.sequence);
  const bSequence = Number(b?.sequence);
  if (Number.isFinite(aSequence) || Number.isFinite(bSequence)) {
    return (Number.isFinite(aSequence) ? aSequence : 0) - (Number.isFinite(bSequence) ? bSequence : 0);
  }
  return String(a?.at || "").localeCompare(String(b?.at || ""));
}

function aiAnalysisRecordToLog(record) {
  const playerName = record?.player?.name || "AI";
  const actionLabel = record?.appliedAction?.label || record?.sanitizedDecision?.action || "AI 决策";
  return {
    message: `${playerName}: ${actionLabel}`,
    reason: record?.sanitizedDecision?.reasoning ? `(${record.sanitizedDecision.reasoning})` : "",
    details: record
  };
}

function normalizeRestoredState(restoredState) {
  const nextState = JSON.parse(JSON.stringify(restoredState));
  tablePaused = Boolean(nextState.paused);
  delete nextState.paused;
  delete nextState.activePlayerId;
  delete nextState.pot;
  nextState.waiting = false;
  nextState.actionToken = ++actionToken;
  return nextState;
}

function restoreSettings(settings) {
  if (!settings) return;
  if (settings.aiCount != null) els.aiCount.value = settings.aiCount;
  if (settings.startingStack != null) els.startingStack.value = settings.startingStack;
  if (settings.bigBlind != null) els.bigBlind.value = settings.bigBlind;
  if (settings.aiMode) els.aiMode.value = settings.aiMode;
}

async function importTableArchive(tableId) {
  if (!tableId) return false;
  try {
    window.clearTimeout(persistTimer);
    const response = await fetch(`/api/table-archive/${encodeURIComponent(tableId)}`);
    if (!response.ok) throw new Error(`找不到牌桌 ${tableId}`);
    const archive = await response.json();
    const aiAnalysis = await loadAiAnalysisArchive(tableId, archive.aiAnalysis);
    if (!archive.currentState) throw new Error("归档缺少 currentState，无法恢复");

    tableArchiveId = archive.tableInfo?.archiveId || tableId;
    tableCreatedAt = archive.tableInfo?.createdAt || new Date().toISOString();
    tableSettings = archive.settings || null;
    thinkingPlayerId = "";
    thinkingStartedAt = 0;
    thinkingElapsedMs = 0;
    state = normalizeRestoredState(archive.currentState);
    state.archiveId = tableArchiveId;
    els.tableFlowBtn.disabled = false;
    runLogs = {
      game: Array.isArray(archive.logs?.game) ? archive.logs.game : [],
      ai: Array.isArray(archive.logs?.ai) ? archive.logs.ai : [],
      events: Array.isArray(archive.logs?.events) ? archive.logs.events : []
    };
    aiAnalysisRecords = Array.isArray(aiAnalysis?.records) ? aiAnalysis.records : [];
    logSequence = Math.max(0, ...Object.values(runLogs).flat().map(entry => Number(entry.sequence) || 0));

    restoreSettings(tableSettings);
    renderStoredLogs();
    updateArchiveDisplay();
    updateTableUrl(tableArchiveId);
    setArchiveNotice(`已加载牌桌 ${tableArchiveId}`, "ok");
    render();
    loadArchiveList();
    return true;
  } catch (error) {
    setArchiveNotice(`${error.message}。请从下拉框选择已有牌桌，或点击“新牌桌”创建。`, "error");
    if (state) gameLog(`导入牌桌失败：${error.message}`);
    return false;
  }
}

async function loadAiAnalysisArchive(tableId, fallback = null) {
  if (Array.isArray(fallback?.records)) return fallback;
  try {
    const response = await fetch(`/api/table-ai-analysis/${encodeURIComponent(tableId)}`);
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function updateSoundToggle() {
  els.soundToggleBtn.textContent = soundEnabled ? "音效开" : "音效关";
  els.soundToggleBtn.classList.toggle("muted", !soundEnabled);
  els.musicToggleBtn.textContent = musicEnabled ? "背景音乐开" : "背景音乐关";
  els.musicToggleBtn.classList.toggle("muted", !musicEnabled);
  els.effectsVolume.value = Math.round(clampVolume(effectsVolume) * 100);
  els.musicVolume.value = Math.round(clampVolume(musicVolume) * 100);
}

function storedAudioPreference(key, fallback) {
  try {
    const value = window.localStorage?.getItem(key);
    if (value == null) return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  } catch {
    return fallback;
  }
}

function storeAudioPreference(key, value) {
  try {
    window.localStorage?.setItem(key, String(value));
  } catch {
    // Some embedded browser contexts disable localStorage.
  }
}

function clampVolume(value) {
  return clamp(Number(value), 0, 1);
}

async function loadAudioConfig() {
  try {
    const response = await fetch("./assets/audio/audio-config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("audio config unavailable");
    const config = await response.json();
    audioConfig = mergeAudioConfig(DEFAULT_AUDIO_CONFIG, config);
  } catch {
    audioConfig = DEFAULT_AUDIO_CONFIG;
  }
  soundEnabled = storedAudioPreference("pokerSoundEnabled", audioConfig.defaults.soundEnabled) !== false;
  musicEnabled = storedAudioPreference("pokerMusicEnabled", audioConfig.defaults.musicEnabled) !== false;
  effectsVolume = clampVolume(storedAudioPreference("pokerEffectsVolume", audioConfig.defaults.effectsVolume));
  musicVolume = clampVolume(storedAudioPreference("pokerMusicVolume", audioConfig.defaults.musicVolume));
  setupAudioPlayers();
  updateSoundToggle();
  startBackgroundMusic();
}

function mergeAudioConfig(base, override) {
  return {
    ...base,
    ...override,
    defaults: { ...base.defaults, ...(override.defaults || {}) },
    background: { ...base.background, ...(override.background || {}) },
    actions: { ...base.actions, ...(override.actions || {}) }
  };
}

function setupAudioPlayers() {
  actionAudio = {};
  for (const [action, config] of Object.entries(audioConfig.actions || {})) {
    if (config?.src) actionAudio[action] = makeAudio(config.src, false);
  }
  backgroundAudio = audioConfig.background?.src ? makeAudio(audioConfig.background.src, audioConfig.background.loop !== false) : null;
  syncAudioVolumes();
}

function makeAudio(src, loop) {
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.loop = Boolean(loop);
  return audio;
}

function syncAudioVolumes() {
  for (const audio of Object.values(actionAudio)) {
    audio.volume = soundEnabled ? clampVolume(effectsVolume) : 0;
  }
  if (backgroundAudio) {
    backgroundAudio.volume = musicEnabled ? clampVolume(musicVolume) : 0;
  }
}

function primeAudio() {
  audioUnlocked = true;
  startBackgroundMusic();
}

function startBackgroundMusic() {
  if (!backgroundAudio || !musicEnabled) return;
  syncAudioVolumes();
  const playPromise = backgroundAudio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      // Browsers require a user gesture before audio can start.
    });
  }
}

function stopBackgroundMusic() {
  if (!backgroundAudio) return;
  backgroundAudio.pause();
}

function playActionSound(action, label = "") {
  if (!soundEnabled) return;
  const resolvedAction = action === "all-in" || label.includes("全下") ? "all-in" : action;
  const source = actionAudio[resolvedAction] || actionAudio.call;
  if (!source) return;
  const audio = source.cloneNode(true);
  audio.volume = clampVolume(effectsVolume);
  const playPromise = audio.play();
  if (playPromise?.catch) playPromise.catch(() => {});
}

function setupTable() {
  const aiCount = clamp(Number(els.aiCount.value) || 5, 1, 8);
  const startingStack = clamp(Number(els.startingStack.value) || 2000, 200, 100000);
  const bigBlind = clamp(Number(els.bigBlind.value) || 40, 10, Math.floor(startingStack / 2));
  const smallBlind = Math.floor(bigBlind / 2);
  const aiNames = shuffledAiNames(aiCount);
  resetRunArchive({
    aiCount,
    startingStack,
    smallBlind,
    bigBlind,
    aiMode: els.aiMode.value
  });
  const players = [
    makePlayer("human-1", "你", "human", startingStack),
    ...Array.from({ length: aiCount }, (_, i) => makePlayer(`ai-${i + 1}`, aiNames[i], "ai", startingStack))
  ];
  tablePaused = true;
  state = {
    players,
    archiveId: tableArchiveId,
    handNumber: 0,
    dealerIndex: -1,
    smallBlind,
    bigBlind,
    deck: [],
    community: [],
    preflopActions: [],
    street: "showdown",
    currentBet: 0,
    minRaise: bigBlind,
    activeIndex: 0,
    waiting: false,
    winners: [],
    actionToken: 0
  };
  els.tableFlowBtn.disabled = false;
  gameLog(`新牌桌：1 名人类，${aiCount} 个 AI，盲注 ${state.smallBlind}/${state.bigBlind}`);
  updateTableUrl(tableArchiveId);
  setArchiveNotice(`已创建新牌桌 ${tableArchiveId}`, "ok");
  startHand();
}

function makePlayer(id, name, type, stack) {
  return {
    id,
    name,
    type,
    stack,
    hand: [],
    folded: false,
    allIn: false,
    bet: 0,
    invested: 0,
    acted: false,
    out: false,
    lastAction: ""
  };
}

function startHand() {
  if (!state) {
    setupTable();
    return;
  }
  state.winners = [];
  state.actionToken = ++actionToken;
  const livePlayers = state.players.filter(player => player.stack > 0);
  if (livePlayers.length < 2) {
    gameLog("牌局结束：只剩一名玩家有筹码");
    render();
    return;
  }

  state.handNumber += 1;
  state.deck = createDeck();
  state.community = [];
  state.preflopActions = [];
  state.street = "preflop";
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.dealerIndex = nextSeat(state.dealerIndex, true);

  for (const player of state.players) {
    player.hand = player.stack > 0 ? [state.deck.pop(), state.deck.pop()] : [];
    player.folded = false;
    player.allIn = false;
    player.bet = 0;
    player.invested = 0;
    player.acted = false;
    player.out = player.stack <= 0;
    player.lastAction = player.out ? "淘汰" : "";
  }

  const sbIndex = nextSeat(state.dealerIndex);
  const bbIndex = nextSeat(sbIndex);
  postBlind(sbIndex, state.smallBlind, "小盲");
  postBlind(bbIndex, state.bigBlind, "大盲");
  state.currentBet = Math.max(...state.players.map(player => player.bet));
  state.activeIndex = nextSeat(bbIndex);
  gameLog(`第 ${state.handNumber} 手开始，庄位 ${state.players[state.dealerIndex].name}`);
  render();
  maybeRunAi();
}

function nextSeat(fromIndex, includeCurrent = false) {
  const len = state.players.length;
  for (let step = includeCurrent ? 0 : 1; step <= len; step++) {
    const index = (fromIndex + step + len) % len;
    if (!state.players[index].out) return index;
  }
  return 0;
}

function postBlind(index, amount, label) {
  const player = state.players[index];
  const paid = commitChips(player, amount);
  player.lastAction = `${label} ${paid}`;
  player.acted = false;
}

function tablePosition(index) {
  if (!state || state.players.length !== 6) return "";
  const offset = (index - state.dealerIndex + state.players.length) % state.players.length;
  return ["BTN", "SB", "BB", "UTG", "MP", "CO"][offset] || "";
}

function commitChips(player, amount) {
  const paid = Math.min(Math.max(0, amount), player.stack);
  player.stack -= paid;
  player.bet += paid;
  player.invested += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}

function activePlayer() {
  return state?.players[state.activeIndex] || null;
}

function legalActions(player) {
  const toCall = Math.max(0, state.currentBet - player.bet);
  const maxTotal = player.bet + player.stack;
  const minRaiseTo = state.currentBet + state.minRaise;
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0 && player.stack > 0,
    canRaise: player.stack > toCall && maxTotal > state.currentBet,
    canAllIn: player.stack > 0,
    toCall,
    minRaiseTo: Math.min(minRaiseTo, maxTotal),
    maxTotal,
    currentBet: state.currentBet
  };
}

function applyAction(player, decision) {
  const legal = legalActions(player);
  let action = decision.action;
  let amount = Number(decision.amount) || 0;
  const beforeBet = player.bet;

  if (action === "check" && !legal.canCheck) action = legal.canCall ? "call" : "fold";
  if (action === "call" && !legal.canCall) action = legal.canCheck ? "check" : "fold";
  if (action === "raise" && !legal.canRaise) action = legal.canCall ? "call" : "check";
  if (action === "all-in" && !legal.canAllIn) action = legal.canCheck ? "check" : "fold";
  if (action === "fold" && !legal.canFold) action = legal.canCheck ? "check" : "fold";

  if (action === "fold") {
    player.folded = true;
    player.lastAction = "弃牌";
  } else if (action === "check") {
    player.lastAction = "过牌";
  } else if (action === "call") {
    const paid = commitChips(player, legal.toCall);
    player.lastAction = paid === 0 ? "过牌" : `跟注 ${paid}`;
  } else if (action === "all-in") {
    commitChips(player, player.stack);
    amount = player.bet;
    player.lastAction = `全下到 ${player.bet}`;
  } else if (action === "raise") {
    const target = clamp(Math.floor(amount), legal.minRaiseTo, legal.maxTotal);
    commitChips(player, target - player.bet);
    amount = player.bet;
    player.lastAction = player.allIn ? `全下到 ${player.bet}` : `加注到 ${player.bet}`;
  }

  player.acted = true;
  if (state.street === "preflop") {
    state.preflopActions.push({
      sequence: state.preflopActions.length + 1,
      playerId: player.id,
      playerName: player.name,
      position: tablePosition(state.players.indexOf(player)),
      action,
      amount,
      totalBet: player.bet,
      amountBb: Number((player.bet / state.bigBlind).toFixed(1)),
      label: player.lastAction
    });
  }
  if (player.bet > state.currentBet) {
    const raiseSize = player.bet - state.currentBet;
    state.currentBet = player.bet;
    state.minRaise = Math.max(state.bigBlind, raiseSize);
    for (const other of state.players) {
      if (other.id !== player.id && canAct(other)) other.acted = false;
    }
  }

  gameLog(`${player.name}: ${player.lastAction}`);
  recentAction = {
    playerId: player.id,
    playerName: player.name,
    action: player.lastAction,
    isHuman: player.type === "human",
    pot: totalPot(),
    at: new Date().toISOString()
  };
  if (player.type === "human") {
    recentHumanAction = { ...recentAction, visibleUntil: Date.now() + 3500 };
    window.setTimeout(render, 3600);
  }
  playActionSound(action, player.lastAction);
  if (player.type === "ai") {
    recordAiAnalysis(player, decision, {
      action,
      amount,
      label: player.lastAction,
      betAfter: player.bet,
      stackAfter: player.stack,
      potAfter: totalPot()
    });
    aiDecisionLog(`${player.name}: ${player.lastAction}`, decision.reasoning ? `(${decision.reasoning})` : "", decision.details || null);
  }

  if (remainingContenders().length === 1) {
    awardUncontested();
    return;
  }

  if (beforeBet !== player.bet || action === "fold" || action === "check") {
    advanceAfterAction();
  }
}

function canAct(player) {
  return !player.out && !player.folded && !player.allIn;
}

function remainingContenders() {
  return state.players.filter(player => !player.out && !player.folded);
}

function activePlayersWhoCanAct() {
  return state.players.filter(canAct);
}

function bettingComplete() {
  const actors = activePlayersWhoCanAct();
  if (actors.length === 0) return true;
  return actors.every(player => player.acted && player.bet === state.currentBet);
}

function advanceAfterAction() {
  if (bettingComplete()) {
    advanceStreet();
  } else {
    state.activeIndex = nextActor(state.activeIndex);
  }
  render(false);
  persistTableArchiveNow();
  maybeRunAi();
}

function nextActor(fromIndex) {
  for (let step = 1; step <= state.players.length; step++) {
    const index = (fromIndex + step) % state.players.length;
    if (canAct(state.players[index])) return index;
  }
  return state.activeIndex;
}

function advanceStreet() {
  for (const player of state.players) {
    player.bet = 0;
    player.acted = false;
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;

  if (state.street === "preflop") {
    state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    state.street = "flop";
  } else if (state.street === "flop") {
    state.community.push(state.deck.pop());
    state.street = "turn";
  } else if (state.street === "turn") {
    state.community.push(state.deck.pop());
    state.street = "river";
  } else {
    showdown();
    return;
  }

  gameLog(`进入${STREET_LABEL[state.street]}：${state.community.map(cardText).join(" ")}`);
  state.activeIndex = nextActor(state.dealerIndex);
  if (activePlayersWhoCanAct().length === 0) showdown();
}

function awardUncontested() {
  const winner = remainingContenders()[0];
  const pot = totalPot();
  winner.stack += pot;
  state.winners = [{ playerId: winner.id, amount: pot, label: "未摊牌胜出" }];
  state.street = "showdown";
  gameLog(`${winner.name} 赢得底池 ${pot}`);
  render(false);
  persistTableArchiveNow();
}

function showdown() {
  while (state.community.length < 5) state.community.push(state.deck.pop());
  state.street = "showdown";
  const awards = settlePots();
  state.winners = awards;
  for (const award of awards) {
    const player = state.players.find(candidate => candidate.id === award.playerId);
    gameLog(`${player.name} 赢得 ${award.amount} (${award.label})`);
  }
  render();
}

function totalPot() {
  return state.players.reduce((sum, player) => sum + player.invested, 0);
}

function settlePots() {
  const awards = [];
  let remaining = state.players.map(player => ({ player, amount: player.invested })).filter(item => item.amount > 0);

  while (remaining.length) {
    const level = Math.min(...remaining.map(item => item.amount));
    const contributors = remaining.filter(item => item.amount > 0);
    const pot = contributors.length * level;
    const eligible = contributors.map(item => item.player).filter(player => !player.folded);
    const winners = bestPlayers(eligible);
    const share = Math.floor(pot / winners.length);
    let odd = pot % winners.length;
    for (const winner of winners) {
      const paid = share + (odd > 0 ? 1 : 0);
      odd -= 1;
      winner.stack += paid;
      awards.push({ playerId: winner.id, amount: paid, label: evaluateSeven([...winner.hand, ...state.community]).name });
    }
    remaining = remaining
      .map(item => ({ player: item.player, amount: item.amount - level }))
      .filter(item => item.amount > 0);
  }

  return awards;
}

function bestPlayers(players) {
  let best = null;
  let winners = [];
  for (const player of players) {
    const score = evaluateSeven([...player.hand, ...state.community]);
    if (!best || compareScore(score.values, best.values) > 0) {
      best = score;
      winners = [player];
    } else if (compareScore(score.values, best.values) === 0) {
      winners.push(player);
    }
  }
  return winners;
}

function evaluateSeven(cards) {
  const combos = combinations(cards, 5);
  let best = null;
  for (const combo of combos) {
    const score = evaluateFive(combo);
    if (!best || compareScore(score.values, best.values) > 0) best = score;
  }
  return best;
}

function evaluateFive(cards) {
  const values = cards.map(card => card.value).sort((a, b) => b - a);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(card => card.suit === cards[0].suit);
  const straightHigh = getStraightHigh(values);

  if (flush && straightHigh) return named("同花顺", 8, [straightHigh]);
  if (groups[0][1] === 4) return named("四条", 7, [groups[0][0], ...values.filter(value => value !== groups[0][0])]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return named("葫芦", 6, [groups[0][0], groups[1][0]]);
  if (flush) return named("同花", 5, values);
  if (straightHigh) return named("顺子", 4, [straightHigh]);
  if (groups[0][1] === 3) return named("三条", 3, [groups[0][0], ...values.filter(value => value !== groups[0][0])]);
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter(group => group[1] === 2).map(group => group[0]).sort((a, b) => b - a);
    return named("两对", 2, [...pairs, ...values.filter(value => !pairs.includes(value))]);
  }
  if (groups[0][1] === 2) return named("一对", 1, [groups[0][0], ...values.filter(value => value !== groups[0][0])]);
  return named("高牌", 0, values);
}

function named(name, rank, kickers) {
  return { name, values: [rank, ...kickers] };
}

function getStraightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i++) {
    const run = unique.slice(i, i + 5);
    if (run.every((value, index) => index === 0 || value === run[index - 1] - 1)) return run[0] === 1 ? 5 : run[0];
  }
  return 0;
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

function combinations(items, size) {
  const result = [];
  function walk(start, combo) {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let i = start; i < items.length; i++) walk(i + 1, [...combo, items[i]]);
  }
  walk(0, []);
  return result;
}

function updateThinkingClock() {
  const player = activePlayer();
  const canThink = Boolean(state && player && state.street !== "showdown" && canAct(player));
  if (!canThink) {
    thinkingPlayerId = "";
    thinkingStartedAt = 0;
    thinkingElapsedMs = 0;
    return;
  }
  if (thinkingPlayerId !== player.id) {
    thinkingPlayerId = player.id;
    thinkingStartedAt = Date.now();
    thinkingElapsedMs = 0;
  } else if (!tablePaused && thinkingStartedAt) {
    thinkingElapsedMs = Date.now() - thinkingStartedAt;
  }
}

function thinkingSecondsFor(player) {
  if (!player || player.id !== thinkingPlayerId) return null;
  return Math.max(0, Math.floor(thinkingElapsedMs / 1000));
}

function formatThinkingTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
}

function render(shouldPersist = true) {
  if (!state) return;
  updateThinkingClock();
  els.potTotal.textContent = totalPot();
  els.currentBet.textContent = state.currentBet;
  renderTableFlow();
  renderBlindSummary();
  renderActionOrder();
  renderBoard();
  renderSeats();
  renderActions();
  if (shouldPersist) queuePersistTable();
}

function renderEmptyTable(message) {
  state = null;
  tableArchiveId = "";
  updateArchiveDisplay();
  els.potTotal.textContent = "0";
  els.currentBet.textContent = "0";
  els.blindSummary.innerHTML = "<span>盲注 -- / --</span>";
  els.actionOrder.innerHTML = '<span class="order-title">行动顺序</span><span class="order-empty">等待牌桌</span>';
  els.board.innerHTML = "";
  for (let i = 0; i < 5; i++) els.board.append(emptyCardNode());
  els.seats.innerHTML = "";
  els.turnTitle.textContent = "未加载牌桌";
  els.turnHint.textContent = message;
  els.actionPulse.className = "action-pulse log-action-highlight empty";
  els.actionPulse.textContent = "点击“新牌桌”创建一张新牌桌。";
  els.foldBtn.disabled = true;
  els.checkCallBtn.disabled = true;
  els.raiseBtn.disabled = true;
  els.allInBtn.disabled = true;
  els.raiseAmount.disabled = true;
  els.raiseAmountInput.disabled = true;
  els.raiseMultipleBtns.forEach(button => { button.disabled = true; });
  els.raisePointBtns.forEach(button => { button.disabled = true; });
  els.tableFlowBtn.disabled = true;
}

function renderTableFlow() {
  updateArchiveDisplay();
  els.tableFlowBtn.textContent = tablePaused ? "开始牌桌" : "暂停牌桌";
  els.tableFlowBtn.classList.toggle("paused", tablePaused);
  els.flowControl.classList.toggle("paused", tablePaused);
  els.flowStatusText.textContent = tablePaused ? "已暂停" : "运行中";
}

function blindIndexes() {
  const smallBlindIndex = nextSeat(state.dealerIndex);
  const bigBlindIndex = nextSeat(smallBlindIndex);
  return { smallBlindIndex, bigBlindIndex };
}

function renderBlindSummary() {
  const { smallBlindIndex, bigBlindIndex } = blindIndexes();
  const dealer = state.players[state.dealerIndex];
  const smallBlind = state.players[smallBlindIndex];
  const bigBlind = state.players[bigBlindIndex];
  els.blindSummary.innerHTML = `
    <span class="blind-main">盲注 ${state.smallBlind} / ${state.bigBlind}</span>
    <span>庄位 ${escapeHtml(dealer?.name || "--")}</span>
    <span>小盲 ${escapeHtml(smallBlind?.name || "--")} · ${state.smallBlind}</span>
    <span>大盲 ${escapeHtml(bigBlind?.name || "--")} · ${state.bigBlind}</span>
  `;
}

function actingOrder() {
  if (!state || state.street === "showdown") return [];
  const order = [];
  for (let step = 0; step < state.players.length; step++) {
    const index = (state.activeIndex + step) % state.players.length;
    const player = state.players[index];
    if (!player.out) order.push({ index, player });
  }
  return order;
}

function renderActionOrder() {
  if (!els.actionOrder) return;
  const order = actingOrder();
  if (!order.length) {
    els.actionOrder.innerHTML = '<span class="order-title">行动顺序</span><span class="order-empty">本手已结束</span>';
    return;
  }
  els.actionOrder.innerHTML = `
    <span class="order-title">行动顺序</span>
    <div class="order-track">
      ${order.map(({ index, player }, orderIndex) => {
        const flags = [
          orderIndex === 0 ? "current" : "",
          player.type === "human" ? "human" : "",
          player.folded ? "folded" : "",
          player.allIn ? "all-in" : ""
        ].filter(Boolean).join(" ");
        const status = player.folded ? "弃牌" : player.allIn ? "全下" : index === state.activeIndex ? "当前" : player.acted ? "已行动" : "等待";
        const thinkingSeconds = thinkingSecondsFor(player);
        return `
          <span class="order-chip ${flags}">
            <b>${orderIndex + 1}</b>
            ${escapeHtml(player.type === "human" ? "你" : player.name.replace(" (AI)", ""))}
            <small>${status}</small>
            ${thinkingSeconds == null ? "" : `<small class="thinking-time">思考 ${formatThinkingTime(thinkingSeconds)}</small>`}
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function renderBoard() {
  els.board.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const card = state.community[i];
    els.board.append(card ? cardNode(card) : emptyCardNode());
  }
}

function renderSeats() {
  els.seats.innerHTML = "";
  const { smallBlindIndex, bigBlindIndex } = blindIndexes();
  const totalSeats = state.players.length;
  for (const [index, player] of state.players.entries()) {
    const seat = document.createElement("article");
    const position = seatPosition(index, totalSeats);
    seat.style.setProperty("--seat-x", `${position.x}%`);
    seat.style.setProperty("--seat-y", `${position.y}%`);
    seat.className = [
      "seat",
      player.type === "human" ? "human-seat" : "",
      recentAction?.playerId === player.id ? "recent-action" : "",
      index === state.activeIndex && state.street !== "showdown" ? "active" : "",
      index === smallBlindIndex ? "small-blind" : "",
      index === bigBlindIndex ? "big-blind" : "",
      player.folded ? "folded" : "",
      state.winners.some(winner => winner.playerId === player.id) ? "winner" : ""
    ].filter(Boolean).join(" ");
    const badges = [];
    if (player.type === "human") badges.push({ label: "你", className: "human" });
    if (index === state.dealerIndex) badges.push({ label: "D", className: "dealer" });
    if (index === smallBlindIndex) badges.push({ label: `小盲 ${state.smallBlind}`, className: "blind" });
    if (index === bigBlindIndex) badges.push({ label: `大盲 ${state.bigBlind}`, className: "blind" });
    if (player.allIn) badges.push({ label: "全下", className: "" });
    if (player.out) badges.push({ label: "出局", className: "" });
    const thinkingSeconds = thinkingSecondsFor(player);
    const showCards = state.street === "showdown" || (player.type === "human" && !player.folded);
    seat.innerHTML = `
      <div class="seat-head">
        <span class="seat-name">${escapeHtml(player.name)}</span>
        <span>${badges.map(badge => `<span class="badge ${badge.className}">${escapeHtml(badge.label)}</span>`).join(" ")}</span>
      </div>
      ${thinkingSeconds == null ? "" : `<div class="thinking-badge">思考中 ${formatThinkingTime(thinkingSeconds)}</div>`}
      <div class="cards"></div>
      <div class="seat-stats">
        <span class="stack">筹码 ${player.stack}</span>
        <span class="bet">本轮 ${player.bet} / 已投 ${player.invested}</span>
      </div>
      <div class="last-action">${escapeHtml(player.lastAction)}</div>
    `;
    const cards = seat.querySelector(".cards");
    for (const card of player.hand) cards.append(showCards ? cardNode(card) : backCardNode());
    els.seats.append(seat);
  }
}

function seatPosition(index, total) {
  if (total <= 1 || index < 0) return { x: 50, y: 92 };
  const angle = (90 - (index * 360) / total) * Math.PI / 180;
  const radiusX = total <= 3 ? 34 : 43;
  const radiusY = total <= 3 ? 36 : 42;
  return {
    x: 50 + radiusX * Math.cos(angle),
    y: 50 + radiusY * Math.sin(angle)
  };
}

function cardNode(card) {
  const node = document.createElement("div");
  node.className = `card ${card.suit === "H" || card.suit === "D" ? "red" : ""}`;
  node.textContent = cardText(card);
  return node;
}

function backCardNode() {
  const node = document.createElement("div");
  node.className = "card back";
  node.textContent = "牌";
  return node;
}

function emptyCardNode() {
  const node = document.createElement("div");
  node.className = "empty-card";
  return node;
}

function renderActions() {
  const player = activePlayer();
  const humanTurn = player && player.type === "human" && state.street !== "showdown" && !state.waiting && !tablePaused;
  const legal = player ? legalActions(player) : null;
  renderActionPulse();
  els.turnTitle.textContent = state.street === "showdown"
    ? "本手结束"
    : tablePaused
      ? `已暂停：${STREET_LABEL[state.street]}，轮到 ${player.name}`
      : `${STREET_LABEL[state.street]}：轮到 ${player.name}`;
  els.turnHint.textContent = state.street === "showdown"
    ? "点击“下一手”继续。"
    : tablePaused
      ? "点击“开始牌桌”后继续，AI 将恢复自动决策投注。"
    : `跟注额 ${legal.toCall}，底池 ${totalPot()}。`;

  els.foldBtn.disabled = !humanTurn || !legal.canFold;
  els.checkCallBtn.disabled = !humanTurn || (!legal.canCheck && !legal.canCall);
  els.raiseBtn.disabled = !humanTurn || !legal.canRaise;
  els.allInBtn.disabled = !humanTurn || !legal.canAllIn;
  els.checkCallBtn.textContent = legal?.canCheck ? "过牌" : `跟注 ${legal?.toCall || 0}`;

  const min = legal?.canRaise ? legal.minRaiseTo : 0;
  const max = legal?.canRaise ? legal.maxTotal : 0;
  els.raiseAmount.min = min;
  els.raiseAmount.max = max;
  els.raiseAmountInput.min = min;
  els.raiseAmountInput.max = max;
  renderRaiseTicks(legal);
  setRaiseAmount(clampRaiseAmount(Number(els.raiseAmountInput.value) || Number(els.raiseAmount.value) || min, legal));
  els.raiseAmount.disabled = !humanTurn || !legal.canRaise;
  els.raiseAmountInput.disabled = !humanTurn || !legal.canRaise;
  els.raiseMultipleBtns.forEach(button => { button.disabled = !humanTurn || !legal.canRaise; });
  els.raisePointBtns.forEach(button => { button.disabled = !humanTurn || !legal.canRaise; });
  syncRaisePointState(legal);
}

function renderRaiseTicks(legal) {
  if (!els.raiseTicks) return;
  els.raiseTicks.innerHTML = "";
  for (const percent of [10, 30, 50, 80]) {
    const option = document.createElement("option");
    option.value = legal?.canRaise ? raiseAmountByPercent(percent) : 0;
    option.label = `${percent}%`;
    els.raiseTicks.append(option);
  }
}

function clampRaiseAmount(value, legal = activePlayer() ? legalActions(activePlayer()) : null) {
  if (!legal?.canRaise) return 0;
  return clamp(Math.floor(Number(value) || legal.minRaiseTo), legal.minRaiseTo, legal.maxTotal);
}

function setRaiseAmount(value) {
  const amount = clampRaiseAmount(value);
  els.raiseAmount.value = amount;
  els.raiseAmountInput.value = amount;
  els.raiseAmountLabel.textContent = `准备下注 ${amount}`;
}

function raiseAmountByPercent(percent) {
  const player = activePlayer();
  if (!player) return 0;
  const legal = legalActions(player);
  if (!legal.canRaise) return 0;
  const span = legal.maxTotal - legal.minRaiseTo;
  return legal.minRaiseTo + Math.round(span * (percent / 100));
}

function raiseAmountByMultiple(multiple) {
  const player = activePlayer();
  if (!player) return 0;
  const legal = legalActions(player);
  if (!legal.canRaise) return 0;
  return state.currentBet + state.minRaise * multiple;
}

function syncRaisePointState(legal) {
  const amount = Number(els.raiseAmountInput.value) || 0;
  els.raisePointBtns.forEach(button => {
    const target = raiseAmountByPercent(Number(button.dataset.percent));
    button.classList.toggle("selected", legal?.canRaise && target === amount);
  });
  els.raiseMultipleBtns.forEach(button => {
    const target = clampRaiseAmount(raiseAmountByMultiple(Number(button.dataset.multiple)), legal);
    button.classList.toggle("selected", legal?.canRaise && target === amount);
  });
}

function renderActionPulse() {
  if (!els.actionPulse) return;
  const pinnedHumanAction = recentHumanAction && Date.now() < recentHumanAction.visibleUntil ? recentHumanAction : null;
  const displayedAction = pinnedHumanAction || recentAction;
  if (!displayedAction) {
    els.actionPulse.className = "action-pulse log-action-highlight empty";
    els.actionPulse.textContent = "等待行动";
    return;
  }
  els.actionPulse.className = `action-pulse log-action-highlight ${displayedAction.isHuman ? "human" : ""}`;
  els.actionPulse.innerHTML = `
    <span>${displayedAction.isHuman ? "你的动作" : "最新动作"}</span>
    <strong>${escapeHtml(displayedAction.playerName)}：${escapeHtml(displayedAction.action)}</strong>
    <em>底池 ${displayedAction.pot}</em>
  `;
}

function maybeRunAi() {
  const player = activePlayer();
  if (!player || player.type !== "ai" || state.street === "showdown" || state.waiting || tablePaused) return;
  const requestContext = currentAiRequestContext(player);
  state.waiting = true;
  render();
  window.setTimeout(async () => {
    const decision = await getAiDecision(player, requestContext);
    if (!isCurrentAiTurn(requestContext)) return;
    if (!decision) {
      state.waiting = false;
      render();
      return;
    }
    state.waiting = false;
    applyAction(player, decision);
  }, 350);
}

function currentAiRequestContext(player) {
  return {
    archiveId: tableArchiveId,
    handNumber: state.handNumber,
    token: state.actionToken,
    playerId: player.id
  };
}

function isCurrentAiTurn(context) {
  const player = activePlayer();
  return Boolean(
    state
    && !tablePaused
    && tableArchiveId === context?.archiveId
    && state.handNumber === context?.handNumber
    && state.actionToken === context?.token
    && player
    && player.id === context?.playerId
    && player.type === "ai"
    && state.street !== "showdown"
  );
}

async function getAiDecision(player, requestContext) {
  const mode = els.aiMode.value;
  if (mode === "texassolver" && serverHasTexasSolver) {
    const visibleState = publicAiState(player);
    try {
      const response = await fetch("/api/ai-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "texassolver", state: visibleState })
      });
      if (!response.ok) {
        const body = await response.json();
        if (!isCurrentAiTurn(requestContext)) return null;
        recordAiFailureAnalysis(player, "texassolver", visibleState, body.debug || null, body.error || "TexasSolver 请求失败");
        throw new Error(body.error || "TexasSolver 请求失败");
      }
      const body = await response.json();
      if (!isCurrentAiTurn(requestContext)) return null;
      return sanitizeDecision(player, body.decision, "TexasSolver", {
        ...(body.debug || {}),
        provider: "texassolver",
        visibleState,
        parsedOutput: body.debug?.parsedOutput || body.decision || null
      });
    } catch (error) {
      if (isCurrentAiTurn(requestContext)) {
        tablePaused = true;
        state.waiting = false;
        state.actionToken = ++actionToken;
        gameLog(`${player.name}: TexasSolver 决策失败，牌桌已暂停`);
        aiDecisionLog(`${player.name}: TexasSolver 决策失败`, `(${error.message})`);
      }
      return null;
    }
  } else if (mode === "texassolver") {
    tablePaused = true;
    state.waiting = false;
    state.actionToken = ++actionToken;
    const visibleState = publicAiState(player);
    const message = "TexasSolver 不可用，牌桌已暂停";
    recordAiFailureAnalysis(player, "texassolver", visibleState, null, message);
    gameLog(`${player.name}: ${message}`);
    aiDecisionLog(`${player.name}: TexasSolver 不可用`, `(${message})`);
    return null;
  }
  if (mode === "codex" && serverHasCodex) {
    try {
      const visibleState = publicAiState(player);
      const response = await fetch("/api/ai-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", state: visibleState })
      });
      if (!response.ok) throw new Error((await response.json()).error || "Codex 请求失败");
      const body = await response.json();
      if (!isCurrentAiTurn(requestContext)) return null;
      return sanitizeDecision(player, body.decision, "Codex", {
        ...(body.debug || {}),
        visibleState,
        parsedOutput: body.decision || null
      });
    } catch (error) {
      if (isCurrentAiTurn(requestContext)) {
        gameLog(`${player.name}: Codex 决策失败，改用内置策略`);
        aiDecisionLog(`${player.name}: Codex 决策失败，改用内置策略`, `(${error.message})`);
      }
    }
  }
  return localDecision(player);
}

function recordAiFailureAnalysis(player, provider, visibleState, debug, message) {
  aiAnalysisRecords.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${aiAnalysisRecords.length + 1}`,
    at: new Date().toISOString(),
    handNumber: state.handNumber,
    street: visibleState?.table?.street || state.street,
    streetLabel: visibleState?.table?.streetLabel || STREET_LABEL[state.street],
    player: {
      id: player.id,
      name: player.name
    },
    visibleState: JSON.parse(JSON.stringify(visibleState || null)),
    provider,
    prompt: debug?.prompt || "",
    solverInput: debug?.solverInput || "",
    solverOutput: debug?.solverOutput || null,
    selectedAction: debug?.selectedAction || null,
    fallbackReason: debug?.fallbackReason || message,
    rawOutput: debug?.rawOutput || "",
    parsedOutput: debug?.parsedOutput || null,
    postflopTimeoutMs: debug?.postflopTimeoutMs || null,
    outputFile: debug?.outputFile || "",
    heroRange: debug?.heroRange || "",
    exactHand: debug?.exactHand || "",
    tokenUsage: debug?.usage || null,
    sanitizedDecision: null,
    appliedAction: {
      action: "paused",
      amount: 0,
      label: "TexasSolver 决策失败，牌桌暂停"
    }
  });
  queuePersistTable();
}

function recordAiAnalysis(player, decision, appliedAction) {
  const details = decision.details || null;
  if (!details?.prompt && !details?.solverInput && !details?.rawOutput && !details?.visibleState) return;
  aiAnalysisRecords.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${aiAnalysisRecords.length + 1}`,
    at: new Date().toISOString(),
    handNumber: state.handNumber,
    street: details.visibleState?.table?.street || state.street,
    streetLabel: details.visibleState?.table?.streetLabel || STREET_LABEL[state.street],
    player: {
      id: player.id,
      name: player.name
    },
    visibleState: JSON.parse(JSON.stringify(details.visibleState || null)),
    provider: details.provider || null,
    prompt: details.prompt || "",
    solverInput: details.solverInput || "",
    solverOutput: details.solverOutput || null,
    selectedAction: details.selectedAction || null,
    fallbackReason: details.fallbackReason || "",
    rawOutput: details.rawOutput || "",
    parsedOutput: details.parsedOutput || null,
    postflopTimeoutMs: details.postflopTimeoutMs || null,
    outputFile: details.outputFile || "",
    heroRange: details.heroRange || "",
    exactHand: details.exactHand || "",
    tokenUsage: details.usage || null,
    sanitizedDecision: {
      action: decision.action,
      amount: Number(decision.amount) || 0,
      reasoning: decision.reasoning || ""
    },
    appliedAction
  });
}

function publicAiState(player) {
  const legal = legalActions(player);
  return {
    player: {
      name: player.name,
      position: tablePosition(state.players.indexOf(player)),
      stack: player.stack,
      bet: player.bet,
      invested: player.invested,
      holeCards: player.hand.map(cardText)
    },
    table: {
      street: state.street,
      streetLabel: STREET_LABEL[state.street],
      community: state.community.map(cardText),
      pot: totalPot(),
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      currentBet: state.currentBet,
      toCall: legal.toCall,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxTotal,
      seatCount: state.players.filter(candidate => !candidate.out).length,
      preflopActions: state.preflopActions || [],
      activePlayers: remainingContenders().map(candidate => ({
        name: candidate.name,
        position: tablePosition(state.players.indexOf(candidate)),
        stack: candidate.stack,
        bet: candidate.bet,
        invested: candidate.invested,
        folded: candidate.folded,
        allIn: candidate.allIn,
        lastAction: candidate.lastAction
      }))
    },
    legalActions: legal
  };
}

function sanitizeDecision(player, decision, source, details = null) {
  const legal = legalActions(player);
  const allowed = ["fold", "check", "call", "raise", "all-in"];
  const action = allowed.includes(decision?.action) ? decision.action : (legal.canCheck ? "check" : "call");
  return {
    action,
    amount: Math.floor(Number(decision?.amount) || 0),
    reasoning: `${source}: ${decision?.reasoning || "无说明"}`,
    details
  };
}

function localDecision(player) {
  const legal = legalActions(player);
  const strength = estimateStrength(player);
  const pressure = legal.toCall / Math.max(1, totalPot() + legal.toCall);
  let action = "check";
  let amount = 0;

  if (legal.toCall > 0) {
    if (strength < 0.34 && pressure > 0.22) action = "fold";
    else if (strength > 0.76 && legal.canRaise) {
      action = "raise";
      amount = Math.min(legal.maxTotal, legal.minRaiseTo + Math.round(state.bigBlind * (2 + Math.random() * 3)));
    } else action = "call";
  } else if (strength > 0.68 && legal.canRaise) {
    action = "raise";
    amount = Math.min(legal.maxTotal, Math.max(legal.minRaiseTo, state.bigBlind * (2 + Math.ceil(Math.random() * 3))));
  }

  if (legal.canAllIn && player.stack < state.bigBlind * 3 && strength > 0.55) action = "all-in";
  return { action, amount, reasoning: `内置策略：强度 ${strength.toFixed(2)}，压力 ${pressure.toFixed(2)}` };
}

function estimateStrength(player) {
  const cards = [...player.hand, ...state.community];
  if (state.community.length >= 3) {
    const score = evaluateSeven(cards.concat(drawKnownPadding(cards)));
    return Math.min(0.98, (score.values[0] + 1) / 9 + highCardBoost(player.hand));
  }
  const [a, b] = player.hand.map(card => card.value).sort((x, y) => y - x);
  const pair = a === b ? 0.34 : 0;
  const suited = player.hand[0].suit === player.hand[1].suit ? 0.06 : 0;
  const connected = Math.abs(a - b) <= 2 ? 0.06 : 0;
  return clamp((a + b) / 30 + pair + suited + connected, 0.12, 0.95);
}

function drawKnownPadding(cards) {
  const needed = Math.max(0, 7 - cards.length);
  return state.deck.slice(0, needed);
}

function highCardBoost(cards) {
  return Math.max(...cards.map(card => card.value)) / 100;
}

function humanAction(action) {
  const player = activePlayer();
  if (!player || player.type !== "human" || state.street === "showdown" || tablePaused) return;
  applyAction(player, {
    action,
    amount: action === "raise" ? Number(els.raiseAmountInput.value) : 0,
    reasoning: "人类玩家"
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function checkServer() {
  try {
    const response = await fetch("/api/status");
    const body = await response.json();
    serverHasCodex = Boolean(body.codex);
    serverHasTexasSolver = Boolean(body.texasSolver);
    els.serverStatus.textContent = serverHasTexasSolver
      ? "TexasSolver 已连接"
      : serverHasCodex
        ? "Codex 已连接"
        : "服务在线，无外部 AI";
    els.serverStatus.className = `status-pill ${serverHasTexasSolver || serverHasCodex ? "ok" : "warn"}`;
    if (els.aiMode.value === "texassolver" && !serverHasTexasSolver) {
      els.serverStatus.textContent = "TexasSolver 未连接";
    } else if (els.aiMode.value === "codex" && !serverHasCodex) {
      els.aiMode.value = serverHasTexasSolver ? "texassolver" : "local";
    }
  } catch {
    serverHasCodex = false;
    serverHasTexasSolver = false;
    els.serverStatus.textContent = "静态模式";
    els.serverStatus.className = "status-pill warn";
  }
}

els.newTableBtn.addEventListener("click", setupTable);
els.newHandBtn.addEventListener("click", startHand);
els.importTableBtn.addEventListener("click", () => importTableArchive(els.archiveSelect.value));
els.aiMode.addEventListener("change", () => {
  if (tableSettings) tableSettings.aiMode = els.aiMode.value;
  queuePersistTable();
});
els.soundToggleBtn.addEventListener("click", () => {
  primeAudio();
  soundEnabled = !soundEnabled;
  storeAudioPreference("pokerSoundEnabled", soundEnabled);
  syncAudioVolumes();
  updateSoundToggle();
  if (soundEnabled) playActionSound("check");
});
els.musicToggleBtn.addEventListener("click", () => {
  primeAudio();
  musicEnabled = !musicEnabled;
  storeAudioPreference("pokerMusicEnabled", musicEnabled);
  syncAudioVolumes();
  if (musicEnabled) startBackgroundMusic();
  else stopBackgroundMusic();
  updateSoundToggle();
});
els.effectsVolume.addEventListener("input", () => {
  effectsVolume = clampVolume(Number(els.effectsVolume.value) / 100);
  storeAudioPreference("pokerEffectsVolume", effectsVolume);
  syncAudioVolumes();
});
els.musicVolume.addEventListener("input", () => {
  musicVolume = clampVolume(Number(els.musicVolume.value) / 100);
  storeAudioPreference("pokerMusicVolume", musicVolume);
  syncAudioVolumes();
});
els.tableFlowBtn.addEventListener("click", () => {
  primeAudio();
  tablePaused = !tablePaused;
  if (tablePaused && state) {
    state.waiting = false;
    state.actionToken = ++actionToken;
  }
  gameLog(tablePaused ? "牌桌已暂停" : "牌桌已开始");
  render();
  if (!tablePaused) maybeRunAi();
});
els.foldBtn.addEventListener("click", () => {
  primeAudio();
  humanAction("fold");
});
els.checkCallBtn.addEventListener("click", () => {
  primeAudio();
  humanAction(legalActions(activePlayer()).canCheck ? "check" : "call");
});
els.raiseBtn.addEventListener("click", () => {
  primeAudio();
  humanAction("raise");
});
els.allInBtn.addEventListener("click", () => {
  primeAudio();
  humanAction("all-in");
});
els.raiseAmount.addEventListener("input", () => {
  setRaiseAmount(Number(els.raiseAmount.value));
  syncRaisePointState(activePlayer() ? legalActions(activePlayer()) : null);
});
els.raiseAmountInput.addEventListener("input", () => {
  setRaiseAmount(Number(els.raiseAmountInput.value));
  syncRaisePointState(activePlayer() ? legalActions(activePlayer()) : null);
});
els.raiseMultipleBtns.forEach(button => {
  button.addEventListener("click", () => {
    setRaiseAmount(raiseAmountByMultiple(Number(button.dataset.multiple)));
    syncRaisePointState(activePlayer() ? legalActions(activePlayer()) : null);
  });
});
els.raisePointBtns.forEach(button => {
  button.addEventListener("click", () => {
    setRaiseAmount(raiseAmountByPercent(Number(button.dataset.percent)));
    syncRaisePointState(activePlayer() ? legalActions(activePlayer()) : null);
  });
});
els.clearLogBtn.addEventListener("click", () => {
  els.aiLog.innerHTML = "";
});
els.toggleReasonBtn.addEventListener("click", () => {
  showAnalysis = !showAnalysis;
  els.logPanel.classList.toggle("show-analysis", showAnalysis);
  els.toggleReasonBtn.textContent = showAnalysis ? "隐藏分析" : "显示分析";
});

thinkingTimer = window.setInterval(() => {
  if (state && state.street !== "showdown" && thinkingPlayerId && !tablePaused) {
    render(false);
  }
}, 1000);

updateSoundToggle();

checkServer().then(async () => {
  await loadAudioConfig();
  await loadArchiveList();
  const tableId = requestedTableId();
  if (tableId) {
    const imported = await importTableArchive(tableId);
    if (!imported) {
      renderEmptyTable(`URL 中的牌桌 ID “${tableId}” 不存在或无法读取。`);
    }
    return;
  }
  setupTable();
  loadArchiveList();
});
