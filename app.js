const STORAGE_KEY = "tarotJournal.records.v1";
const CONFIG_KEY = "tarotJournal.jsonbin.v1";
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

const state = {
  records: [],
  selectedId: null,
  config: { apiKey: "", binId: "" }
};

const $ = (selector) => document.querySelector(selector);

const els = {
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

function mergeRecords(localRecords, cloudRecords) {
  const map = new Map();
  [...cloudRecords, ...localRecords].forEach((record) => {
    const existing = map.get(record.id);
    if (!existing || (record.updatedAt || record.createdAt || "") > (existing.updatedAt || existing.createdAt || "")) {
      map.set(record.id, record);
    }
  });
  return [...map.values()].sort(sortRecords);
}

function sortRecords(a, b) {
  return `${b.date || ""} ${b.time || ""}`.localeCompare(`${a.date || ""} ${a.time || ""}`);
}

function filteredRecords() {
  const query = els.searchInput.value.trim().toLowerCase();
  const topic = els.topicFilter.value;
  const review = els.reviewFilter.value;

  return state.records
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
  if (state.config.apiKey && state.config.binId) {
    els.syncState.textContent = "已配置";
    els.syncSetup.hidden = true;
    els.syncSummary.hidden = false;
  } else if (state.config.apiKey) {
    els.syncState.textContent = "可创建";
    els.syncSetup.hidden = false;
    els.syncSummary.hidden = true;
  } else {
    els.syncState.textContent = "仅本地";
    els.syncSetup.hidden = false;
    els.syncSummary.hidden = true;
  }
}

function render() {
  updateSyncState();
  renderStats();
  renderList();
  renderDetail();
}

function renderStats() {
  els.totalCount.textContent = state.records.length;
  els.reviewedCount.textContent = state.records.filter((item) => (item.reviews || []).length > 0).length;

  const counts = {};
  state.records.forEach((record) => {
    (record.cards || []).forEach((card) => {
      if (!card.name) return;
      counts[card.name] = (counts[card.name] || 0) + 1;
    });
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  els.topCard.textContent = top ? `${top[0]} ${top[1]}次` : "-";
}

function renderList() {
  const records = filteredRecords();
  els.visibleCount.textContent = `${records.length} 条`;

  if (!records.length) {
    els.recordList.innerHTML = `<div class="empty-state"><h3>没有记录</h3><p>换个搜索条件，或新建一次抽牌。</p></div>`;
    return;
  }

  els.recordList.innerHTML = records.map((record) => {
    const cards = (record.cards || []).map((card) => card.name).filter(Boolean).join(" / ") || "未填写牌名";
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
        <p>${escapeHtml(cards)}</p>
      </button>
    `;
  }).join("");
}

function renderDetail() {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (!record) {
    els.detailPanel.innerHTML = `<div class="empty-state"><h3>还没有选中记录</h3><p>新建一条记录，或从左侧列表打开过去的牌面。</p></div>`;
    return;
  }

  const cardsHtml = (record.cards || []).map((card) => `
    <div class="tarot-card">
      <span class="tag">${escapeHtml(card.position || "位置")}</span>
      <h4>${escapeHtml(card.name || "未填牌名")} ${card.orientation ? `· ${escapeHtml(card.orientation)}` : ""}</h4>
      <p>${escapeHtml(card.firstFeeling || "")}</p>
      <p>${escapeHtml(card.personalMeaning || "")}</p>
      ${card.keywords ? `<p><strong>关键词：</strong>${escapeHtml(card.keywords)}</p>` : ""}
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
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
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
      <label>牌名<input data-field="name" type="text" value="${escapeHtml(card.name || "")}" placeholder="比如：圣杯八"></label>
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
  saveLocal("已保存到本地");
}

function deleteSelectedRecord() {
  const id = $("#recordId").value;
  if (!id) return;
  const ok = window.confirm("确定删除这条记录吗？这个操作只会删除本地数据，上传后才会覆盖云端。");
  if (!ok) return;
  state.records = state.records.filter((item) => item.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  els.recordDialog.close();
  saveLocal("已删除");
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

function saveReviewFromForm() {
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
  saveLocal("已补充回看");
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
    body: JSON.stringify(appData())
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "创建失败");
  state.config.binId = data.metadata.id;
  els.binIdInput.value = state.config.binId;
  saveConfig();
  showToast("已创建云端库，并保存 Bin ID");
}

async function saveCloud() {
  saveConfig();
  if (!state.config.apiKey || !state.config.binId) {
    showToast("先填写 API Key 和 Bin ID");
    return;
  }

  const response = await fetch(`${JSONBIN_URL}/${state.config.binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": state.config.apiKey
    },
    body: JSON.stringify(appData())
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "上传失败");
  showToast("已上传到 JsonBin");
}

async function loadCloud() {
  saveConfig();
  if (!state.config.apiKey || !state.config.binId) {
    showToast("先填写 API Key 和 Bin ID");
    return;
  }

  const response = await fetch(`${JSONBIN_URL}/${state.config.binId}/latest`, {
    headers: { "X-Master-Key": state.config.apiKey }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "下载失败");
  const cloudRecords = normalizeCloudData(data.record);
  state.records = mergeRecords(state.records, cloudRecords);
  saveLocal(`已下载并合并 ${cloudRecords.length} 条云端记录`);
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
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const imported = normalizeCloudData(parsed);
      state.records = mergeRecords(state.records, imported);
      saveLocal(`已导入并合并 ${imported.length} 条记录`);
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

  els.reviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveReviewFromForm();
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
  [els.apiKeyInput, els.binIdInput].forEach((input) => input.addEventListener("change", saveConfig));

  $("#createBinBtn").addEventListener("click", () => withCloud(createCloudBin));
  $("#saveCloudBtn").addEventListener("click", () => withCloud(saveCloud));
  $("#loadCloudBtn").addEventListener("click", () => withCloud(loadCloud));
  $("#quickSaveCloudBtn").addEventListener("click", () => withCloud(saveCloud));
  $("#quickLoadCloudBtn").addEventListener("click", () => withCloud(loadCloud));
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
    id: uid(),
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
seedIfEmpty();
bindEvents();
render();
