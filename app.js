const STORAGE_KEY = "tarotJournal.records.v1";
const CONFIG_KEY = "tarotJournal.jsonbin.v1";
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";
// JsonBin 免费版整个库上限 100KB，照片和总数据都必须控制在这个范围内
const BIN_SIZE_LIMIT = 95000;
const PHOTO_BUDGET = 30000;
const TOMBSTONE_DAYS = 60;

const state = {
  records: [],
  selectedId: null,
  config: { apiKey: "", binId: "" },
  syncing: false,
  lastSyncAt: null
};

const $ = (selector) => document.querySelector(selector);

const els = {
  dailyBody: $("#dailyBody"),
  dailyProgress: $("#dailyProgress"),
  recordList: $("#recordList"),
  detailPanel: $("#detailPanel"),
  searchInput: $("#searchInput"),
  topicFilter: $("#topicFilter"),
  reviewFilter: $("#reviewFilter"),
  totalCount: $("#totalCount"),
  reviewedCount: $("#reviewedCount"),
  topCard: $("#topCard"),
  visibleCount: $("#visibleCount"),
  syncSetup: $("#syncSetup"),
  syncSummary: $("#syncSummary"),
  syncState: $("#syncState"),
  syncDialog: $("#syncDialog"),
  apiKeyInput: $("#apiKeyInput"),
  binIdInput: $("#binIdInput"),
  toast: $("#toast"),
  recordDialog: $("#recordDialog"),
  recordForm: $("#recordForm"),
  reviewDialog: $("#reviewDialog"),
  reviewForm: $("#reviewForm"),
  cardsContainer: $("#cardsContainer"),
  photoDataInput: $("#photoDataInput"),
  photoPreviewWrap: $("#photoPreviewWrap"),
  photoPreview: $("#photoPreview"),
  photoInput: $("#photoInput")
};

const MAJOR_ARCANA = ["愚者", "魔术师", "女祭司", "女皇", "皇帝", "教皇", "恋人", "战车", "力量", "隐士", "命运之轮", "正义", "倒吊人", "死神", "节制", "恶魔", "高塔", "星星", "月亮", "太阳", "审判", "世界"];
const MAJOR_ALIASES = { "愚人": "愚者", "魔法师": "魔术师", "吊人": "倒吊人", "死亡": "死神", "塔": "高塔", "星辰": "星星" };
const ROMAN_NUMERALS = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"];
const MINOR_RANKS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "侍从", "骑士", "王后", "国王"];
const SUITS = {
  "权杖": { symbol: "🔥", className: "suit-wands" },
  "圣杯": { symbol: "💧", className: "suit-cups" },
  "宝剑": { symbol: "⚔️", className: "suit-swords" },
  "星币": { symbol: "🪙", className: "suit-pents" }
};
const ALL_CARDS = [
  ...MAJOR_ARCANA,
  ...Object.keys(SUITS).flatMap((suit) => MINOR_RANKS.map((rank) => `${suit}${rank}`))
];

function cardMeta(name) {
  const clean = String(name || "").trim();
  for (const [suit, meta] of Object.entries(SUITS)) {
    if (clean.startsWith(suit)) {
      return { ...meta, corner: clean.slice(suit.length) };
    }
  }
  const majorName = MAJOR_ALIASES[clean] || clean;
  const majorIndex = MAJOR_ARCANA.indexOf(majorName);
  if (majorIndex >= 0) {
    return { symbol: "✨", className: "suit-major", corner: ROMAN_NUMERALS[majorIndex] };
  }
  return { symbol: "🔮", className: "suit-unknown", corner: "" };
}

function cardFaceHtml(card) {
  const meta = cardMeta(card.name);
  const reversed = card.orientation === "逆位";
  return `
    <div class="card-face ${meta.className}${reversed ? " reversed" : ""}">
      <span class="card-face-corner">${escapeHtml(meta.corner)}</span>
      <span class="card-face-symbol">${meta.symbol}</span>
      <span class="card-face-name">${escapeHtml(card.name || "？")}</span>
      ${reversed ? `<span class="card-face-reversed">逆</span>` : ""}
    </div>`;
}

function cardChipsHtml(record) {
  const cards = (record.cards || []).filter((card) => card.name);
  if (!cards.length) return "<p>未填写牌名</p>";
  return `<div class="card-chips">${cards.map((card) => {
    const meta = cardMeta(card.name);
    const reversed = card.orientation === "逆位";
    return `<span class="card-chip ${meta.className}${reversed ? " reversed" : ""}"><i>${meta.symbol}</i>${escapeHtml(card.name)}${reversed ? "<b>逆</b>" : ""}</span>`;
  }).join("")}</div>`;
}

function buildCardDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "tarotCardList";
  datalist.innerHTML = ALL_CARDS.map((name) => `<option value="${name}"></option>`).join("");
  document.body.appendChild(datalist);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function loadLocal() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const config = localStorage.getItem(CONFIG_KEY);
  state.records = saved ? JSON.parse(saved) : [];
  state.config = config ? JSON.parse(config) : { apiKey: "", binId: "" };
  els.apiKeyInput.value = state.config.apiKey || "";
  els.binIdInput.value = state.config.binId || "";
}

function saveLocal(message) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  render();
  if (message) showToast(message);
}

function hasCloudConfig() {
  return Boolean(state.config.apiKey && state.config.binId);
}

async function saveAndSync(localMessage = "已保存到本地") {
  saveLocal(localMessage);
  scheduleSync();
}

function saveConfig() {
  state.config.apiKey = els.apiKeyInput.value.trim();
  state.config.binId = els.binIdInput.value.trim();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  updateSyncState();
}

function appData() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    records: state.records
  };
}

function normalizeCloudData(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

function pickRecord(current, challenger) {
  const currentStamp = current.updatedAt || current.createdAt || "";
  const challengerStamp = challenger.updatedAt || challenger.createdAt || "";
  const winner = challengerStamp > currentStamp ? challenger : current;
  const loser = winner === challenger ? current : challenger;
  // 赢的那份如果因为云端容量丢了照片，从另一份里补回来
  if (!winner.photo && loser.photo && (winner.photoOmitted || challengerStamp === currentStamp)) {
    return { ...winner, photo: loser.photo, photoOmitted: false };
  }
  return winner;
}

function isLiveOrRecentTombstone(record) {
  if (!record.deleted) return true;
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 24 * 3600 * 1000).toISOString();
  return (record.updatedAt || record.createdAt || "") > cutoff;
}

function mergeRecords(localRecords, cloudRecords) {
  const map = new Map();
  [...cloudRecords, ...localRecords].forEach((record) => {
    if (!record || !record.id) return;
    const existing = map.get(record.id);
    map.set(record.id, existing ? pickRecord(existing, record) : record);
  });
  return [...map.values()].filter(isLiveOrRecentTombstone).sort(sortRecords);
}

function activeRecords() {
  return state.records.filter((record) => !record.deleted);
}

function sortRecords(a, b) {
  return `${b.date || ""} ${b.time || ""}`.localeCompare(`${a.date || ""} ${a.time || ""}`);
}

function filteredRecords() {
  const query = els.searchInput.value.trim().toLowerCase();
  const topic = els.topicFilter.value;
  const review = els.reviewFilter.value;

  return activeRecords()
    .filter((record) => {
      const text = JSON.stringify(record).toLowerCase();
      const matchesQuery = !query || text.includes(query);
      const matchesTopic = topic === "全部" || record.topic === topic;
      const hasReview = (record.reviews || []).length > 0;
      const matchesReview = review === "全部" || (review === "已回看" ? hasReview : !hasReview);
      return matchesQuery && matchesTopic && matchesReview;
    })
    .sort(sortRecords);
}

function updateSyncState() {
  if (state.syncing) {
    els.syncState.textContent = "同步中…";
  } else if (hasCloudConfig()) {
    const stamp = state.lastSyncAt
      ? ` ${String(state.lastSyncAt.getHours()).padStart(2, "0")}:${String(state.lastSyncAt.getMinutes()).padStart(2, "0")}`
      : "";
    els.syncState.textContent = `已同步${stamp}`;
  } else {
    els.syncState.textContent = "仅本地";
  }
  els.syncSetup.hidden = hasCloudConfig();
  els.syncSummary.hidden = !hasCloudConfig();
}

// 配对链接：#sync=Key:BinId 只存在于链接里，打开一次就写进本机并从地址栏抹掉
function parseSyncHash() {
  const match = location.hash.match(/^#sync=([^:]+):(.+)$/);
  if (!match) return;
  state.config.apiKey = decodeURIComponent(match[1]);
  state.config.binId = decodeURIComponent(match[2]);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  els.apiKeyInput.value = state.config.apiKey;
  els.binIdInput.value = state.config.binId;
  history.replaceState(null, "", location.pathname + location.search);
  showToast("已通过配对链接连接云端，开始自动同步");
}

async function copyPairLink() {
  const link = `${location.origin}${location.pathname}#sync=${encodeURIComponent(state.config.apiKey)}:${encodeURIComponent(state.config.binId)}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast("配对链接已复制，发给自己后用新设备打开一次即可");
  } catch {
    window.prompt("手动复制这个链接，用新设备打开一次：", link);
  }
}

function render() {
  updateSyncState();
  renderStats();
  renderDaily();
  renderList();
  renderDetail();
}

// 用日期决定今天学哪张牌：每台设备算出来都一样，不需要同步
const DAILY_EPOCH = Date.UTC(2026, 6, 12);
let dailyOffset = 0;

function dailyIndexToday() {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((todayUtc - DAILY_EPOCH) / 86400000);
  return ((days % ALL_CARDS.length) + ALL_CARDS.length) % ALL_CARDS.length;
}

function renderDaily() {
  if (!els.dailyBody) return;
  const total = ALL_CARDS.length;
  const index = (((dailyIndexToday() + dailyOffset) % total) + total) % total;
  const name = ALL_CARDS[index];
  const meaning = TAROT_MEANINGS[name] || { keywords: "", upright: "", reversed: "", question: "" };
  const drawnCount = activeRecords().filter((record) =>
    (record.cards || []).some((card) => (card.name || "").trim() === name)
  ).length;

  els.dailyProgress.textContent = `第 ${index + 1} / ${total} 张`;
  els.dailyBody.innerHTML = `
    ${cardFaceHtml({ name, orientation: "正位" })}
    <div class="daily-info">
      <h3>
        ${escapeHtml(name)}
        ${dailyOffset === 0 ? `<span class="tag">今日</span>` : ""}
        <span class="daily-count">${drawnCount ? `我抽到过 ${drawnCount} 次` : "还没抽到过"}</span>
      </h3>
      <p><strong>关键词：</strong>${escapeHtml(meaning.keywords)}</p>
      <p><strong>正位：</strong>${escapeHtml(meaning.upright)}</p>
      <p><strong>逆位：</strong>${escapeHtml(meaning.reversed)}</p>
      <p class="daily-question">✍️ ${escapeHtml(meaning.question)}</p>
      ${drawnCount ? `<button class="ghost" type="button" data-daily-search="${escapeHtml(name)}">查看我抽到这张牌的记录</button>` : ""}
    </div>
  `;
}

function renderStats() {
  const records = activeRecords();
  els.totalCount.textContent = records.length;
  els.reviewedCount.textContent = records.filter((item) => (item.reviews || []).length > 0).length;

  const counts = {};
  records.forEach((record) => {
    (record.cards || []).forEach((card) => {
      if (!card.name) return;
      counts[card.name] = (counts[card.name] || 0) + 1;
    });
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  els.topCard.textContent = top ? `${cardMeta(top[0]).symbol} ${top[0]} ${top[1]}次` : "-";
}

function renderList() {
  const records = filteredRecords();
  els.visibleCount.textContent = `${records.length} 条`;

  if (!records.length) {
    els.recordList.innerHTML = `<div class="empty-state"><h3>没有记录</h3><p>换个搜索条件，或新建一次抽牌。</p></div>`;
    return;
  }

  els.recordList.innerHTML = records.map((record) => {
    const reviewed = (record.reviews || []).length > 0 ? "已回看" : "未回看";
    const thumb = record.photo ? `<img class="record-thumb" src="${record.photo}" alt="牌面照片">` : "";
    return `
      <button class="record-card ${record.id === state.selectedId ? "active" : ""}" type="button" data-id="${record.id}">
        ${thumb}
        <div class="record-meta">
          <span class="tag">${escapeHtml(record.date || "未填日期")}</span>
          <span class="tag">${escapeHtml(record.topic || "其他")}</span>
          <span class="tag">${reviewed}</span>
        </div>
        <h3>${escapeHtml(record.question || "未命名记录")}</h3>
        ${cardChipsHtml(record)}
      </button>
    `;
  }).join("");
}

function renderDetail() {
  const record = activeRecords().find((item) => item.id === state.selectedId);
  if (!record) {
    els.detailPanel.innerHTML = `<div class="empty-state"><h3>还没有选中记录</h3><p>新建一条记录，或从左侧列表打开过去的牌面。</p></div>`;
    return;
  }

  const cardsHtml = (record.cards || []).map((card) => `
    <div class="tarot-card">
      ${cardFaceHtml(card)}
      <div class="tarot-card-body">
        <span class="tag">${escapeHtml(card.position || "位置")}</span>
        <h4>${escapeHtml(card.name || "未填牌名")} ${card.orientation ? `· ${escapeHtml(card.orientation)}` : ""}</h4>
        <p>${escapeHtml(card.firstFeeling || "")}</p>
        <p>${escapeHtml(card.personalMeaning || "")}</p>
        ${card.keywords ? `<p><strong>关键词：</strong>${escapeHtml(card.keywords)}</p>` : ""}
      </div>
    </div>
  `).join("");

  const reviewsHtml = (record.reviews || []).map((review) => `
    <div class="review-item">
      <p><strong>${escapeHtml(review.date)}</strong></p>
      <p>${escapeHtml(review.outcome || "")}</p>
      ${review.accurate ? `<p><strong>准确：</strong>${escapeHtml(review.accurate)}</p>` : ""}
      ${review.miss ? `<p><strong>偏差：</strong>${escapeHtml(review.miss)}</p>` : ""}
      ${review.reread ? `<p><strong>现在重新理解：</strong>${escapeHtml(review.reread)}</p>` : ""}
    </div>
  `).join("");

  els.detailPanel.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${escapeHtml(record.spread || "Tarot Reading")}</p>
        <h2>${escapeHtml(record.question || "未命名记录")}</h2>
        <div class="detail-meta">
          <span class="tag">${escapeHtml(record.date || "")} ${escapeHtml(record.time || "")}</span>
          <span class="tag">${escapeHtml(record.topic || "其他")}</span>
          <span class="tag">${escapeHtml(record.mood || "未记录情绪")}</span>
          <span class="tag">${escapeHtml(record.importance || "普通")}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="secondary" type="button" data-action="review">补充回看</button>
        <button class="primary" type="button" data-action="edit">编辑</button>
      </div>
    </div>

    ${record.photo ? `<div class="detail-photo"><img src="${record.photo}" alt="本次牌面照片"></div>` : ""}
    ${sectionHtml("问题背后的真实担心", record.hiddenConcern)}
    <div class="detail-section">
      <h3>抽到的牌</h3>
      <div class="card-grid">${cardsHtml || "<p>还没有填写牌面。</p>"}</div>
    </div>
    ${sectionHtml("整体解释", record.overallReading)}
    ${sectionHtml("这次牌给我的提醒", record.reminder)}
    ${sectionHtml("我准备怎么做", record.nextAction)}
    <div class="detail-section">
      <h3>回看</h3>
      ${reviewsHtml || "<p>还没有回看。过一阵子再来补充，会很有意思。</p>"}
    </div>
  `;
}

function sectionHtml(title, content) {
  if (!content) return "";
  return `
    <div class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(content)}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openRecordDialog(record = null) {
  $("#dialogTitle").textContent = record ? "编辑记录" : "新建记录";
  $("#deleteRecordBtn").style.display = record ? "inline-flex" : "none";
  $("#recordId").value = record?.id || "";
  $("#dateInput").value = record?.date || today();
  $("#timeInput").value = record?.time || nowTime();
  $("#topicInput").value = record?.topic || "自我成长";
  $("#moodInput").value = record?.mood || "";
  $("#questionInput").value = record?.question || "";
  $("#concernInput").value = record?.hiddenConcern || "";
  $("#spreadInput").value = record?.spread || "三张牌：情况 / 阻碍 / 建议";
  $("#importanceInput").value = record?.importance || "普通";
  $("#readingInput").value = record?.overallReading || "";
  $("#reminderInput").value = record?.reminder || "";
  $("#actionInput").value = record?.nextAction || "";
  setPhotoPreview(record?.photo || "");

  els.cardsContainer.innerHTML = "";
  const cards = record?.cards?.length ? record.cards : [
    { position: "情况" },
    { position: "阻碍" },
    { position: "建议" }
  ];
  cards.forEach(addCardEditor);
  els.recordDialog.showModal();
}

function setPhotoPreview(dataUrl) {
  els.photoDataInput.value = dataUrl || "";
  els.photoInput.value = "";
  if (dataUrl) {
    els.photoPreview.src = dataUrl;
    els.photoPreviewWrap.hidden = false;
  } else {
    els.photoPreview.removeAttribute("src");
    els.photoPreviewWrap.hidden = true;
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("照片读取失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("照片格式无法识别"));
      image.onload = () => {
        // 逐步压小，直到照片能装进 JsonBin 免费版的容量
        const attempts = [[720, 0.6], [640, 0.5], [560, 0.45], [480, 0.4], [400, 0.34], [340, 0.3]];
        let dataUrl = "";
        for (const [maxSide, quality] of attempts) {
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL("image/jpeg", quality);
          if (dataUrl.length <= PHOTO_BUDGET) break;
        }
        resolve(dataUrl);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function addCardEditor(card = {}) {
  const index = els.cardsContainer.children.length + 1;
  const wrapper = document.createElement("div");
  wrapper.className = "card-editor";
  wrapper.innerHTML = `
    <div class="card-editor-head">
      <strong>牌 ${index}</strong>
      <button class="ghost" type="button" data-remove-card>移除</button>
    </div>
    <div class="form-grid">
      <label>位置<input data-field="position" type="text" value="${escapeHtml(card.position || "")}" placeholder="情况 / 阻碍 / 建议"></label>
      <label>牌名<input data-field="name" type="text" list="tarotCardList" value="${escapeHtml(card.name || "")}" placeholder="比如：圣杯八"></label>
      <label>正位 / 逆位
        <select data-field="orientation">
          <option ${card.orientation === "正位" ? "selected" : ""}>正位</option>
          <option ${card.orientation === "逆位" ? "selected" : ""}>逆位</option>
        </select>
      </label>
      <label>关键词<input data-field="keywords" type="text" value="${escapeHtml(card.keywords || "")}" placeholder="离开、选择、关系"></label>
    </div>
    <label>第一眼感受<textarea data-field="firstFeeling">${escapeHtml(card.firstFeeling || "")}</textarea></label>
    <label>我的解释<textarea data-field="personalMeaning">${escapeHtml(card.personalMeaning || "")}</textarea></label>
  `;
  els.cardsContainer.appendChild(wrapper);
}

function collectCards() {
  return [...els.cardsContainer.querySelectorAll(".card-editor")].map((item) => {
    const get = (field) => item.querySelector(`[data-field="${field}"]`)?.value.trim() || "";
    return {
      position: get("position"),
      name: get("name"),
      orientation: get("orientation"),
      keywords: get("keywords"),
      firstFeeling: get("firstFeeling"),
      personalMeaning: get("personalMeaning")
    };
  }).filter((card) => card.position || card.name || card.personalMeaning || card.firstFeeling);
}

async function saveRecordFromForm() {
  const id = $("#recordId").value || uid();
  const existing = state.records.find((item) => item.id === id);
  const record = {
    id,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    date: $("#dateInput").value,
    time: $("#timeInput").value,
    topic: $("#topicInput").value,
    mood: $("#moodInput").value.trim(),
    question: $("#questionInput").value.trim(),
    hiddenConcern: $("#concernInput").value.trim(),
    spread: $("#spreadInput").value.trim(),
    importance: $("#importanceInput").value,
    cards: collectCards(),
    photo: els.photoDataInput.value,
    overallReading: $("#readingInput").value.trim(),
    reminder: $("#reminderInput").value.trim(),
    nextAction: $("#actionInput").value.trim(),
    reviews: existing?.reviews || []
  };

  state.records = state.records.filter((item) => item.id !== id);
  state.records.unshift(record);
  state.selectedId = id;
  els.recordDialog.close();
  await saveAndSync(hasCloudConfig() ? "已保存，正在同步" : "已保存到本地");
}

async function deleteSelectedRecord() {
  const id = $("#recordId").value;
  if (!id) return;
  const ok = window.confirm("确定删除这条记录吗？会同步删除到其他设备。");
  if (!ok) return;
  // 用删除标记代替直接移除，否则另一台设备合并时会把它加回来
  const record = state.records.find((item) => item.id === id);
  if (record) {
    record.deleted = true;
    record.photo = "";
    record.updatedAt = new Date().toISOString();
  }
  if (state.selectedId === id) state.selectedId = null;
  els.recordDialog.close();
  await saveAndSync(hasCloudConfig() ? "已删除，正在同步" : "已删除");
}

function openReviewDialog(id) {
  $("#reviewRecordId").value = id;
  $("#reviewDateInput").value = today();
  $("#reviewOutcomeInput").value = "";
  $("#reviewAccurateInput").value = "";
  $("#reviewMissInput").value = "";
  $("#reviewRereadInput").value = "";
  els.reviewDialog.showModal();
}

async function saveReviewFromForm() {
  const id = $("#reviewRecordId").value;
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  record.reviews = record.reviews || [];
  record.reviews.push({
    id: uid(),
    date: $("#reviewDateInput").value,
    outcome: $("#reviewOutcomeInput").value.trim(),
    accurate: $("#reviewAccurateInput").value.trim(),
    miss: $("#reviewMissInput").value.trim(),
    reread: $("#reviewRereadInput").value.trim()
  });
  record.updatedAt = new Date().toISOString();
  els.reviewDialog.close();
  await saveAndSync(hasCloudConfig() ? "已补充回看，正在同步" : "已补充回看");
}

async function createCloudBin() {
  saveConfig();
  if (!state.config.apiKey) {
    showToast("先填写 JsonBin API Key");
    return;
  }

  const response = await fetch(JSONBIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": state.config.apiKey,
      "X-Bin-Private": "true",
      "X-Bin-Name": "tarot-journal"
    },
    body: cloudPayload().json
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "创建失败");
  state.config.binId = data.metadata.id;
  els.binIdInput.value = state.config.binId;
  saveConfig();
  showToast("已创建云端库，之后会自动同步");
}

function cloudPayload() {
  const records = state.records.map((record) => ({ ...record }));
  const build = () => JSON.stringify({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    records
  });
  let json = build();
  let trimmed = 0;
  // 容量不够时从最旧的记录开始去掉照片（照片仍保留在本机），保证文字记录一定同步成功
  const oldestFirst = [...records].sort((a, b) => sortRecords(b, a));
  for (const record of oldestFirst) {
    if (json.length <= BIN_SIZE_LIMIT) break;
    if (!record.photo) continue;
    record.photo = "";
    record.photoOmitted = true;
    trimmed += 1;
    json = build();
  }
  return { json, trimmed, fits: json.length <= BIN_SIZE_LIMIT };
}

async function fetchCloud() {
  const response = await fetch(`${JSONBIN_URL}/${state.config.binId}/latest`, {
    headers: { "X-Master-Key": state.config.apiKey }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "下载失败");
  return mergeRecords(normalizeCloudData(data.record), []);
}

async function pushCloud() {
  const { json, trimmed, fits } = cloudPayload();
  if (!fits) throw new Error("云端容量已满（免费版上限 100KB），删除一些旧记录或照片后再试");
  const response = await fetch(`${JSONBIN_URL}/${state.config.binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": state.config.apiKey
    },
    body: json
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "上传失败");
  return trimmed;
}

async function syncNow(reason = "auto") {
  if (!hasCloudConfig() || state.syncing) return;
  state.syncing = true;
  updateSyncState();
  try {
    // 先拉取云端并合并，再上传合并结果，两台设备都不会覆盖对方
    const cloudRecords = await fetchCloud();
    const merged = mergeRecords(state.records, cloudRecords);
    state.records = merged;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
    let trimmed = 0;
    if (JSON.stringify(merged) !== JSON.stringify(cloudRecords)) {
      trimmed = await pushCloud();
    }
    state.lastSyncAt = new Date();
    if (reason === "manual") showToast("已完成同步");
    if (trimmed) showToast(`云端容量有限，${trimmed} 张旧照片只保留在本机`);
  } catch (error) {
    showToast(`同步失败：${error.message || "请稍后再试"}`);
  } finally {
    state.syncing = false;
    render();
  }
}

function scheduleSync(delay = 600) {
  if (!hasCloudConfig()) return;
  window.clearTimeout(scheduleSync.timer);
  scheduleSync.timer = window.setTimeout(() => {
    if (state.syncing) {
      scheduleSync(800);
      return;
    }
    syncNow("save");
  }, delay);
}

function syncOnReturn() {
  if (!hasCloudConfig() || state.syncing) return;
  const last = state.lastSyncAt ? state.lastSyncAt.getTime() : 0;
  if (Date.now() - last < 20000) return;
  syncNow("auto");
}

function exportData() {
  const blob = new Blob([JSON.stringify(appData(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tarot-journal-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const imported = normalizeCloudData(parsed);
      state.records = mergeRecords(state.records, imported);
      await saveAndSync(`已导入并合并 ${imported.length} 条记录`);
    } catch {
      showToast("导入失败：文件不是可识别的 JSON");
    }
  };
  reader.readAsText(file);
}

function bindEvents() {
  $("#newRecordBtn").addEventListener("click", () => openRecordDialog());
  $("#closeDialogBtn").addEventListener("click", () => els.recordDialog.close());
  $("#cancelBtn").addEventListener("click", () => els.recordDialog.close());
  $("#addCardBtn").addEventListener("click", () => addCardEditor());
  $("#deleteRecordBtn").addEventListener("click", deleteSelectedRecord);
  $("#removePhotoBtn").addEventListener("click", () => setPhotoPreview(""));
  $("#closeReviewBtn").addEventListener("click", () => els.reviewDialog.close());
  $("#cancelReviewBtn").addEventListener("click", () => els.reviewDialog.close());

  els.recordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveRecordFromForm();
  });

  els.photoInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      showToast("正在处理照片...");
      const dataUrl = await compressImage(file);
      setPhotoPreview(dataUrl);
      showToast("照片已加入记录");
    } catch (error) {
      showToast(error.message || "照片处理失败");
    }
  });

  els.reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveReviewFromForm();
  });

  els.cardsContainer.addEventListener("click", (event) => {
    if (event.target.matches("[data-remove-card]")) {
      event.target.closest(".card-editor").remove();
    }
  });

  els.recordList.addEventListener("click", (event) => {
    const card = event.target.closest(".record-card");
    if (!card) return;
    state.selectedId = card.dataset.id;
    render();
  });

  els.detailPanel.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (!action) return;
    const record = state.records.find((item) => item.id === state.selectedId);
    if (!record) return;
    if (action === "edit") openRecordDialog(record);
    if (action === "review") openReviewDialog(record.id);
  });

  [els.searchInput, els.topicFilter, els.reviewFilter].forEach((input) => input.addEventListener("input", render));
  [els.apiKeyInput, els.binIdInput].forEach((input) => input.addEventListener("change", () => {
    saveConfig();
    if (hasCloudConfig()) syncNow("manual");
  }));

  $("#syncChipBtn").addEventListener("click", () => els.syncDialog.showModal());
  $("#closeSyncBtn").addEventListener("click", () => els.syncDialog.close());
  $("#copyPairLinkBtn").addEventListener("click", copyPairLink);
  $("#createBinBtn").addEventListener("click", () => withCloud(createCloudBin));
  $("#saveCloudBtn").addEventListener("click", () => syncNow("manual"));
  $("#loadCloudBtn").addEventListener("click", () => syncNow("manual"));
  $("#quickSaveCloudBtn").addEventListener("click", () => syncNow("manual"));
  $("#quickLoadCloudBtn").addEventListener("click", () => syncNow("manual"));
  $("#editCloudConfigBtn").addEventListener("click", () => {
    els.syncSetup.hidden = false;
    els.syncSummary.hidden = true;
  });
  $("#clearCloudConfigBtn").addEventListener("click", () => {
    state.config = { apiKey: "", binId: "" };
    els.apiKeyInput.value = "";
    els.binIdInput.value = "";
    saveConfig();
    showToast("已清除同步设置");
  });
  $("#exportBtn").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", (event) => importData(event.target.files[0]));

  $("#prevCardBtn").addEventListener("click", () => { dailyOffset -= 1; renderDaily(); });
  $("#nextCardBtn").addEventListener("click", () => { dailyOffset += 1; renderDaily(); });
  $("#todayCardBtn").addEventListener("click", () => { dailyOffset = 0; renderDaily(); });
  els.dailyBody.addEventListener("click", (event) => {
    const name = event.target.dataset.dailySearch;
    if (!name) return;
    els.searchInput.value = name;
    render();
    els.recordList.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function withCloud(fn) {
  try {
    await fn();
  } catch (error) {
    showToast(error.message || "同步失败");
  }
}

function seedIfEmpty() {
  if (state.records.length) return;
  state.records = [{
    // 固定 id，避免每台新设备都生成一条重复的示例记录
    id: "sample-welcome-record",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    date: today(),
    time: nowTime(),
    topic: "自我成长",
    mood: "想理清楚",
    importance: "普通",
    question: "我现在最需要看见的问题是什么？",
    hiddenConcern: "我担心自己其实一直在逃避选择。",
    spread: "三张牌：情况 / 阻碍 / 建议",
    cards: [
      { position: "情况", name: "星币一", orientation: "正位", firstFeeling: "新的机会、落地、可以开始", personalMeaning: "眼前有一个可以慢慢养起来的机会，重点不是马上看到结果，而是愿意开始。", keywords: "机会、现实、开始" },
      { position: "阻碍", name: "宝剑一", orientation: "逆位", firstFeeling: "想法混乱、说不清", personalMeaning: "我可能还没有把问题切清楚，所以行动前需要先整理判断。", keywords: "混乱、判断、语言" },
      { position: "建议", name: "圣杯侍从", orientation: "逆位", firstFeeling: "敏感、情绪缩回去", personalMeaning: "不要让情绪只在心里打转，可以用温和但真实的方式表达出来。", keywords: "表达、敏感、照顾自己" }
    ],
    overallReading: "这组牌像是在说：机会已经出现，但我需要先把想法和情绪整理清楚，才能真的接住它。",
    reminder: "不要急着追求确定答案，先把自己真实的感受写下来。",
    nextAction: "今天先写一条完整记录，之后一周再回来回看。",
    reviews: []
  }];
  state.selectedId = state.records[0].id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

loadLocal();
parseSyncHash();
seedIfEmpty();
buildCardDatalist();
bindEvents();
render();
syncNow("auto");

// 切回这个页面 / 重新联网时自动再同步一次，手机长期开着页面也能拿到电脑上的新记录
window.addEventListener("hashchange", () => {
  parseSyncHash();
  if (hasCloudConfig()) syncNow("manual");
});
window.addEventListener("focus", syncOnReturn);
window.addEventListener("online", syncOnReturn);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncOnReturn();
});
