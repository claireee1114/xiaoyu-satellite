import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";
const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = resolve(process.env.DATA_DIR || "data");
const UPLOAD_DIR = join(DATA_DIR, "uploads");
const DB_FILE = join(DATA_DIR, "footprints.json");
const PUBLIC_DIR = resolve(ROOT_DIR, "public");
const sessions = new Set();
const clients = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

await mkdir(UPLOAD_DIR, { recursive: true });
if (!existsSync(DB_FILE)) {
  await writeFile(DB_FILE, "[]", "utf8");
}

function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

const expectedPasswordHash = hashPassword(ADMIN_PASSWORD);

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

async function parseJson(req, limit = 12_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function isAuthed(req) {
  const token = getCookie(req, "footprint_session");
  return Boolean(token && sessions.has(token));
}

async function readFootprints() {
  const raw = await readFile(DB_FILE, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeFootprints(items) {
  await writeFile(DB_FILE, JSON.stringify(items, null, 2), "utf8");
}

function broadcast(payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(message);
  }
}

function clampText(value, max = 200_000) {
  return String(value || "").trim().slice(0, max);
}

function extractKeywords(text, max = 12) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "you", "your", "yours", "have", "has",
    "had", "will", "would", "could", "should", "about", "into", "onto", "than", "then", "there", "here", "know",
    "unknown", "once", "every", "each", "time", "again", "also", "because", "but", "not", "can", "cannot",
    "我", "你", "他", "她", "它", "俺", "咱", "您", "人家", "我们", "你们", "他们", "她们", "它们", "咱们",
    "我的", "你的", "他的", "她的", "它的", "我们的", "你们的", "他们的", "自己", "本人", "大家", "别人",
    "和", "与", "及", "或", "并", "且", "而", "同", "跟", "把", "被", "对", "给", "在", "从", "到", "向",
    "一个", "一种", "一些", "一点", "一下", "以及", "还有", "因为", "所以", "但是", "如果", "虽然", "只是",
    "这个", "那个", "这些", "那些", "这里", "那里", "这样", "那样", "什么", "怎么", "为什么", "可以",
    "进行", "通过", "关于", "没有", "不是", "还是", "或者", "然后", "并且", "而且", "就是", "只是",
    "知道", "不知", "不知道", "觉得", "感觉", "认为", "一次", "每次", "时候", "需要", "已经", "可能",
    "应该", "还是", "其实", "非常", "比较", "特别", "真的", "现在", "今天", "明天", "昨天", "很多",
    "东西", "事情", "问题", "内容", "文字"
  ]);
  const counts = new Map();
  const normalized = text.toLowerCase();
  const englishWords = normalized.match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  for (const word of englishWords) {
    if (!isStopWord(word, stopWords)) counts.set(word, (counts.get(word) || 0) + 1);
  }

  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of chineseRuns) {
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        const token = run.slice(index, index + size);
        if (!isStopWord(token, stopWords)) counts.set(token, (counts.get(token) || 0) + (size === 2 ? 1 : 1.4));
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([textValue, weight]) => ({ text: textValue, weight: Number(weight.toFixed(2)) }));
}

function isStopWord(token, stopWords) {
  if (stopWords.has(token)) return true;
  if (/^[\u4e00-\u9fff]{1,2}$/.test(token) && [...token].some((char) => stopWords.has(char))) return true;
  for (const word of stopWords) {
    if (word.length >= 2 && token.includes(word)) return true;
  }
  return false;
}

function aggregateWordCloud(items) {
  const totals = new Map();
  for (const item of items) {
    for (const keyword of item.keywords || []) {
      totals.set(keyword.text, (totals.get(keyword.text) || 0) + keyword.weight);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([text, weight]) => ({ text, weight: Number(weight.toFixed(2)) }));
}

async function saveImage(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const extension = match[1].split("/")[1].replace("jpeg", "jpg");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 8_000_000) throw new Error("Image must be smaller than 8MB");
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
  await writeFile(join(UPLOAD_DIR, filename), bytes);
  return `/uploads/${filename}`;
}

async function getState() {
  const footprints = (await readFootprints()).sort((a, b) => new Date(b.writtenAt) - new Date(a.writtenAt));
  return { footprints, wordCloud: aggregateWordCloud(footprints) };
}

async function serveStatic(req, res, pathname) {
  if (pathname.startsWith("/uploads/") && !isAuthed(req)) {
    return send(res, 401, "请先登录");
  }
  let filePath = pathname === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, pathname);
  if (pathname.startsWith("/uploads/")) {
    filePath = join(UPLOAD_DIR, pathname.replace("/uploads/", ""));
  }
  const safePath = normalize(filePath);
  if (!safePath.startsWith(PUBLIC_DIR) && !safePath.startsWith(UPLOAD_DIR)) {
    return send(res, 403, "Forbidden");
  }
  if (!existsSync(safePath)) {
    if (pathname === "/") {
      return send(res, 500, "public/index.html is missing. Upload the public folder to the repository root and redeploy.");
    }
    return send(res, 404, "Not found");
  }
  const extension = extname(safePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[extension] || "application/octet-stream" });
  createReadStream(safePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/healthz") {
      return send(res, 200, {
        ok: true,
        app: "word-cloud-footprints",
        rootDir: ROOT_DIR,
        publicDir: PUBLIC_DIR,
        hasIndex: existsSync(join(PUBLIC_DIR, "index.html"))
      });
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const { password } = await parseJson(req, 20_000);
      if (hashPassword(String(password || "")) !== expectedPasswordHash) {
        return send(res, 401, { error: "密码不正确" });
      }
      const token = randomBytes(24).toString("hex");
      sessions.add(token);
      return send(res, 200, { ok: true }, {
        "Set-Cookie": `footprint_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
      });
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const token = getCookie(req, "footprint_session");
      if (token) sessions.delete(token);
      return send(res, 200, { ok: true }, {
        "Set-Cookie": "footprint_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
      });
    }

    if (pathname.startsWith("/api/") && !isAuthed(req)) {
      return send(res, 401, { error: "请先登录" });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      return send(res, 200, await getState());
    }

    if (req.method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      clients.add(res);
      res.write(`data: ${JSON.stringify(await getState())}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && pathname === "/api/footprints") {
      const body = await parseJson(req);
      const writtenAt = new Date(body.writtenAt);
      if (Number.isNaN(writtenAt.getTime())) {
        return send(res, 400, { error: "请填写有效的撰写时间" });
      }
      const content = clampText(body.content);
      if (!content) return send(res, 400, { error: "请填写或识别出文字内容" });
      const imageUrl = await saveImage(body.imageDataUrl);
      const item = {
        id: randomBytes(10).toString("hex"),
        writtenAt: writtenAt.toISOString(),
        createdAt: new Date().toISOString(),
        content,
        imageUrl,
        keywords: extractKeywords(content)
      };
      const items = await readFootprints();
      items.push(item);
      await writeFootprints(items);
      const state = await getState();
      broadcast(state);
      return send(res, 201, item);
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/footprints/")) {
      const id = pathname.split("/").pop();
      const items = await readFootprints();
      const nextItems = items.filter((item) => item.id !== id);
      await writeFootprints(nextItems);
      const state = await getState();
      broadcast(state);
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET") return serveStatic(req, res, pathname);
    return send(res, 405, "Method not allowed");
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Footprints app running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Public directory: ${PUBLIC_DIR}`);
  console.log(`Index exists: ${existsSync(join(PUBLIC_DIR, "index.html"))}`);
  if (ADMIN_PASSWORD === "change-me-now") {
    console.log("Set ADMIN_PASSWORD before going live. Current local password is change-me-now");
  }
});
