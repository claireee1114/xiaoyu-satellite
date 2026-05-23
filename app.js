import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { ADMIN_EMAIL, STORAGE_FOLDER, firebaseConfig } from "./firebase-config.js";

const stopWords = new Set([
  "一个", "一些", "一种", "这个", "那个", "我们", "你们", "他们", "它们", "自己", "今天", "昨天",
  "明天", "时候", "还是", "可以", "已经", "因为", "所以", "但是", "然后", "没有", "不是", "只是",
  "非常", "开始", "继续", "感觉", "关于", "里面", "一次", "一起", "可能", "需要", "the", "and",
  "for", "with", "that", "this", "from", "into", "have", "were", "was", "are", "you", "your"
]);

const palette = ["#344a41", "#c65f4a", "#3f6f8f", "#b4872d", "#627b6d", "#684a7a"];

const state = {
  appReady: !firebaseConfig.apiKey.includes("PASTE_"),
  entries: [],
  sort: "desc",
  pendingFile: null,
  unsubscribeEntries: null
};

const $ = (selector) => document.querySelector(selector);

const loginView = $("#loginView");
const homeView = $("#homeView");
const loginForm = $("#loginForm");
const loginError = $("#loginError");
const entryForm = $("#entryForm");
const entryType = $("#entryType");
const imageUploadWrap = $("#imageUploadWrap");
const imageInput = $("#imageInput");
const fileName = $("#fileName");
const entryHint = $("#entryHint");
const timeline = $("#timeline");
const emptyState = $("#emptyState");
const entryCount = $("#entryCount");
const cloudSection = $("#cloudSection");
const cloudCanvas = $("#cloudCanvas");
const cloudCount = $("#cloudCount");

let auth;
let db;
let storage;

if (state.appReady) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
} else {
  loginError.textContent = "请先填写 firebase-config.js 里的 Firebase 配置";
}

function setDefaultDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $("#entryDate").value = now.toISOString().slice(0, 16);
}

function toDate(value) {
  if (value instanceof Timestamp) return value.toDate();
  if (value?.toDate) return value.toDate();
  return new Date(value);
}

function toDatetimeLocal(value) {
  const date = toDate(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function fromFirestore(doc) {
  const data = doc.data();
  const writtenAt = data.writtenAt || data.written_at || new Date();
  return {
    id: doc.id,
    title: data.title || "",
    content: data.content || "",
    date: toDatetimeLocal(writtenAt),
    type: data.type || "text",
    image: data.imageUrl || data.image_url || "",
    createdAt: data.createdAt || data.created_at || null
  };
}

function tokenize(text) {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const tokens = [];

  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(["zh-CN", "en"], { granularity: "word" });
    for (const item of segmenter.segment(normalized)) {
      if (item.isWordLike) tokens.push(item.segment.trim());
    }
  } else {
    tokens.push(...normalized.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) || []);
  }

  return tokens.filter((word) => word.length > 1 && !stopWords.has(word));
}

function keywordCounts(entries) {
  const counts = new Map();
  entries.forEach((entry) => {
    tokenize(`${entry.title} ${entry.content}`).forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 28)
    .map(([word, count]) => ({ word, count }));
}

function entryKeywords(entry) {
  return keywordCounts([entry]).slice(0, 6);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function makeCloud(words) {
  if (!words.length) {
    return `<div class="cloud-empty"><p>关键词不足</p></div>`;
  }

  const max = Math.max(...words.map((item) => item.count));
  const min = Math.min(...words.map((item) => item.count));
  const points = words.map((item, index) => {
    const ring = Math.floor(index / 6) + 1;
    const angle = index * 2.28;
    const radius = 10 + ring * 16 + (index % 3) * 8;
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius * 0.62;
    const scale = max === min ? 0.65 : (item.count - min) / (max - min);
    const size = 14 + scale * 28;
    return `<text x="${x.toFixed(1)}%" y="${y.toFixed(1)}%" text-anchor="middle" dominant-baseline="middle" fill="${palette[index % palette.length]}" font-size="${size.toFixed(0)}" font-weight="${scale > 0.52 ? 900 : 750}">${escapeHtml(item.word)}</text>`;
  });

  return `<svg viewBox="0 0 100 100" role="img" aria-label="全部文字词云">${points.join("")}</svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEntry(entry) {
  const template = $("#entryTemplate").content.cloneNode(true);
  const article = template.querySelector("article");
  const time = template.querySelector("time");
  const type = template.querySelector(".entry-type");
  const title = template.querySelector("h2");
  const image = template.querySelector(".entry-image");
  const text = template.querySelector(".entry-text");
  const keywords = template.querySelector(".keyword-list");

  time.dateTime = entry.date;
  time.textContent = formatDate(entry.date);
  type.textContent = entry.type === "image" ? "图片文字" : "文字";
  title.textContent = entry.title;
  text.textContent = entry.content;
  article.dataset.id = entry.id;

  if (entry.image) {
    image.src = entry.image;
    image.alt = entry.title;
  } else {
    image.removeAttribute("src");
  }

  entryKeywords(entry).forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = item.word;
    keywords.appendChild(chip);
  });

  return template;
}

function renderTimeline() {
  const sorted = [...state.entries].sort((a, b) => {
    return state.sort === "desc"
      ? new Date(b.date) - new Date(a.date)
      : new Date(a.date) - new Date(b.date);
  });

  timeline.innerHTML = "";
  entryCount.textContent = sorted.length;
  emptyState.classList.toggle("is-hidden", sorted.length > 0);
  cloudSection.classList.toggle("is-hidden", sorted.length === 0);

  sorted.forEach((entry) => timeline.appendChild(renderEntry(entry)));

  const words = keywordCounts(sorted);
  cloudCount.textContent = `${words.length} 个关键词`;
  cloudCanvas.innerHTML = makeCloud(words);
}

function renderShell(user) {
  const loggedIn = Boolean(user);
  loginView.classList.toggle("is-hidden", loggedIn);
  homeView.classList.toggle("is-hidden", !loggedIn);
  if (!loggedIn) {
    if (state.unsubscribeEntries) state.unsubscribeEntries();
    state.unsubscribeEntries = null;
    state.entries = [];
    renderTimeline();
  }
}

function listenForEntries() {
  if (state.unsubscribeEntries) state.unsubscribeEntries();
  const entriesQuery = query(collection(db, "footprints"), orderBy("writtenAt", "desc"));
  state.unsubscribeEntries = onSnapshot(
    entriesQuery,
    (snapshot) => {
      state.entries = snapshot.docs.map(fromFirestore);
      renderTimeline();
    },
    (error) => {
      entryHint.textContent = `读取失败：${error.message}`;
    }
  );
}

function setSubmitting(isSubmitting) {
  const button = entryForm.querySelector('button[type="submit"]');
  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? "保存中..." : "保存足迹";
}

function getSafeFileName(file) {
  const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "jpg";
  return `${crypto.randomUUID()}.${extension.replace(/[^a-z0-9]/g, "") || "jpg"}`;
}

async function uploadImage(file) {
  const imageRef = ref(storage, `${STORAGE_FOLDER}/${getSafeFileName(file)}`);
  await uploadBytes(imageRef, file);
  return getDownloadURL(imageRef);
}

async function addSampleEntries() {
  const samples = [
    {
      title: "清晨读书",
      content: "清晨读完一章关于城市记忆的文章，里面提到步行、旧街区、树影和人的节奏。记录这些细小的移动，像是在给生活留下一串温柔坐标。",
      writtenAt: Timestamp.fromDate(new Date("2026-05-21T08:30:00")),
      type: "text",
      imageUrl: ""
    },
    {
      title: "展览手写牌",
      content: "展览入口的手写牌写着时间、材料、光线和空间。最打动我的是纸张边缘留下的褶皱，像一段没有被抹平的现场。",
      writtenAt: Timestamp.fromDate(new Date("2026-05-19T15:10:00")),
      type: "image",
      imageUrl: ""
    },
    {
      title: "项目复盘",
      content: "下午复盘产品流程，关键词集中在上传、识别、隐私、检索、时间线和可视化。下一步要让记录更轻，也让回看更有方向。",
      writtenAt: Timestamp.fromDate(new Date("2026-05-15T18:20:00")),
      type: "text",
      imageUrl: ""
    }
  ];

  await Promise.all(samples.map((sample) => addDoc(collection(db, "footprints"), {
    ...sample,
    createdAt: serverTimestamp()
  })));
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.appReady) {
    loginError.textContent = "请先填写 firebase-config.js 里的 Firebase 配置";
    return;
  }

  const email = $("#emailInput").value.trim();
  const password = $("#passwordInput").value;
  loginError.textContent = "";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch {
    loginError.textContent = "账号或密码不正确";
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await signOut(auth);
});

$("#seedButton").addEventListener("click", async () => {
  try {
    entryHint.textContent = "正在加入示例...";
    await addSampleEntries();
    entryHint.textContent = "";
  } catch (error) {
    entryHint.textContent = `示例写入失败：${error.message}`;
  }
});

entryType.addEventListener("change", () => {
  const isImage = entryType.value === "image";
  imageUploadWrap.classList.toggle("is-hidden", !isImage);
  imageInput.required = isImage;
  entryHint.textContent = isImage ? "请填写图片中的文字，系统会用这段文字提取关键词。" : "";
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  state.pendingFile = file || null;
  fileName.textContent = file ? file.name : "选择图片";
});

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = $("#entryTitle").value.trim();
  const content = $("#entryContent").value.trim();
  const date = $("#entryDate").value;
  const type = entryType.value;

  if (!title || !content || !date) {
    entryHint.textContent = "请补全标题、撰写时间和内容";
    return;
  }

  if (type === "image" && !state.pendingFile) {
    entryHint.textContent = "请先选择图片";
    return;
  }

  setSubmitting(true);
  entryHint.textContent = "";

  try {
    const imageUrl = type === "image" ? await uploadImage(state.pendingFile) : "";
    await addDoc(collection(db, "footprints"), {
      title,
      content,
      type,
      imageUrl,
      writtenAt: Timestamp.fromDate(new Date(date)),
      createdAt: serverTimestamp()
    });

    entryForm.reset();
    state.pendingFile = null;
    fileName.textContent = "选择图片";
    imageUploadWrap.classList.add("is-hidden");
    imageInput.required = false;
    setDefaultDate();
  } catch (error) {
    entryHint.textContent = `保存失败：${error.message}`;
  } finally {
    setSubmitting(false);
  }
});

$("#sortDesc").addEventListener("click", () => {
  state.sort = "desc";
  $("#sortDesc").classList.add("is-active");
  $("#sortAsc").classList.remove("is-active");
  renderTimeline();
});

$("#sortAsc").addEventListener("click", () => {
  state.sort = "asc";
  $("#sortAsc").classList.add("is-active");
  $("#sortDesc").classList.remove("is-active");
  renderTimeline();
});

setDefaultDate();
renderTimeline();

if (state.appReady) {
  onAuthStateChanged(auth, async (user) => {
    if (user && user.email !== ADMIN_EMAIL) {
      loginError.textContent = "当前账号不是管理者账号";
      await signOut(auth);
      return;
    }

    renderShell(user);
    if (user) listenForEntries();
  });
}
