const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const logoutButton = document.querySelector("#logoutButton");
const footprintForm = document.querySelector("#footprintForm");
const writtenAt = document.querySelector("#writtenAt");
const imageInput = document.querySelector("#imageInput");
const contentInput = document.querySelector("#contentInput");
const ocrButton = document.querySelector("#ocrButton");
const ocrStatus = document.querySelector("#ocrStatus");
const imagePreview = document.querySelector("#imagePreview");
const wordCloud = document.querySelector("#wordCloud");
const timeline = document.querySelector("#timeline");
const countLabel = document.querySelector("#countLabel");
const syncState = document.querySelector("#syncState");
const template = document.querySelector("#footprintTemplate");

let selectedImageDataUrl = "";
let events;

const palette = ["#2f6f5e", "#9a3150", "#477a9d", "#b57917", "#204e43", "#4d6385"];

function iconRefresh() {
  if (window.lucide) window.lucide.createIcons();
}

function setDefaultDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  writtenAt.value = now.toISOString().slice(0, 16);
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  setDefaultDate();
  connectEvents();
  iconRefresh();
}

function showLogin(message = "") {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  loginError.textContent = message;
  if (events) events.close();
  iconRefresh();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    showLogin("请先登录");
    throw new Error("Unauthorized");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function renderWordCloud(words) {
  wordCloud.innerHTML = "";
  wordCloud.classList.toggle("empty", !words.length);
  if (!words.length) {
    wordCloud.textContent = "还没有足迹";
    return;
  }
  const max = Math.max(...words.map((word) => word.weight));
  const min = Math.min(...words.map((word) => word.weight));
  for (const [index, word] of words.entries()) {
    const span = document.createElement("span");
    const ratio = max === min ? 0.5 : (word.weight - min) / (max - min);
    span.className = "cloud-word";
    span.textContent = word.text;
    span.style.fontSize = `${0.95 + ratio * 2.25}rem`;
    span.style.color = palette[index % palette.length];
    span.style.opacity = `${0.72 + ratio * 0.28}`;
    wordCloud.append(span);
  }
}

function renderTimeline(items) {
  timeline.innerHTML = "";
  countLabel.textContent = `${items.length} 条`;
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "添加第一条文字后，这里会按撰写时间倒序展示。";
    timeline.append(empty);
    return;
  }

  for (const item of items) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("time").textContent = formatDate(item.writtenAt);
    const image = node.querySelector(".footprint-image");
    if (item.imageUrl) image.src = item.imageUrl;
    node.querySelector(".footprint-content").textContent = item.content;
    const keywordRow = node.querySelector(".keyword-row");
    for (const keyword of item.keywords || []) {
      const chip = document.createElement("span");
      chip.className = "keyword";
      chip.textContent = keyword.text;
      keywordRow.append(chip);
    }
    node.querySelector(".delete-button").addEventListener("click", async () => {
      if (!confirm("删除这条足迹？")) return;
      await api(`/api/footprints/${item.id}`, { method: "DELETE" });
    });
    timeline.append(node);
  }
  iconRefresh();
}

function renderState(state) {
  renderWordCloud(state.wordCloud || []);
  renderTimeline(state.footprints || []);
}

function connectEvents() {
  if (events) events.close();
  events = new EventSource("/api/events");
  events.onopen = () => {
    syncState.textContent = "实时同步中";
  };
  events.onmessage = (event) => {
    renderState(JSON.parse(event.data));
  };
  events.onerror = () => {
    syncState.textContent = "正在重连";
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function recognizeImage() {
  if (!selectedImageDataUrl) {
    ocrStatus.textContent = "请先选择一张图片。";
    return;
  }
  if (!window.Tesseract) {
    ocrStatus.textContent = "OCR 库加载失败，请手动粘贴文字。";
    return;
  }
  ocrButton.disabled = true;
  ocrStatus.textContent = "正在识别图片文字...";
  try {
    const result = await window.Tesseract.recognize(selectedImageDataUrl, "chi_sim+eng", {
      logger: (message) => {
        if (message.status === "recognizing text") {
          ocrStatus.textContent = `正在识别图片文字 ${Math.round(message.progress * 100)}%`;
        }
      }
    });
    const text = result.data.text.trim();
    contentInput.value = [contentInput.value.trim(), text].filter(Boolean).join("\n\n");
    ocrStatus.textContent = text ? "识别完成，可以继续编辑后保存。" : "没有识别到文字，可以手动补充。";
  } catch (error) {
    ocrStatus.textContent = "识别失败，请手动粘贴文字。";
  } finally {
    ocrButton.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const password = new FormData(loginForm).get("password");
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    showApp();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  showLogin();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  selectedImageDataUrl = "";
  imagePreview.classList.add("hidden");
  imagePreview.innerHTML = "";
  ocrStatus.textContent = "";
  if (!file) return;
  if (file.size > 8_000_000) {
    ocrStatus.textContent = "图片需要小于 8MB。";
    imageInput.value = "";
    return;
  }
  selectedImageDataUrl = await readFileAsDataUrl(file);
  const img = document.createElement("img");
  img.alt = "待上传图片";
  img.src = selectedImageDataUrl;
  imagePreview.append(img);
  imagePreview.classList.remove("hidden");
});

ocrButton.addEventListener("click", recognizeImage);

footprintForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    writtenAt: writtenAt.value,
    content: contentInput.value,
    imageDataUrl: selectedImageDataUrl
  };
  try {
    await api("/api/footprints", { method: "POST", body: JSON.stringify(payload) });
    contentInput.value = "";
    imageInput.value = "";
    selectedImageDataUrl = "";
    imagePreview.innerHTML = "";
    imagePreview.classList.add("hidden");
    ocrStatus.textContent = "已添加并同步。";
    setDefaultDate();
  } catch (error) {
    ocrStatus.textContent = error.message;
  }
});

api("/api/state")
  .then(() => showApp())
  .catch(() => showLogin());

iconRefresh();
