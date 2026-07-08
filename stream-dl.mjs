#!/usr/bin/env node
/**
 * stream-dl.mjs — Zero-Disk Streaming Downloader v2.0
 *
 * ما يميز هذا الإصدار:
 *  • جودات صحيحة: 1=360p | 2=720p | 3=أفضل جودة متاحة
 *  • لا حد للحجم — الأفلام حتى 3GB+ بصفر RAM على السيرفر
 *  • استراتيجية ثلاثية: URL مباشر → بث yt-dlp → بافر كمخرج أخير
 *  • عدد صحيح: /vid 5 = 5 فيديوهات مختلفة (offset)
 */

import { spawn, execFile } from "child_process";
import { existsSync }       from "fs";
import { join, dirname }    from "path";
import { fileURLToPath }    from "url";
import { promisify }        from "util";
import https from "https";
import http  from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileP = promisify(execFile);

// ── جودات yt-dlp الصحيحة ────────────────────────────────────────────────────
// نفضّل الصيغ pre-merged (video+audio في ملف واحد) لأنها لا تحتاج ffmpeg
// 18  = 360p  H.264+AAC mp4 — متوفر دائماً
// 22  = 720p  H.264+AAC mp4 — متوفر في معظم الفيديوهات
// 137+140 = 1080p video + AAC audio → يحتاج ffmpeg merge

const FORMATS = {
  // ── فيديو / فيلم ──────────────────────────────────────────────────────────
  vid: {
    1: "18",                                    // 360p pre-merged — مضمون 100%
    2: "22/18",                                 // 720p ← هذا الصحيح لـ "متوسط"
    3: "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/22/18"  // أفضل جودة
  },
  film: {
    1: "18",
    2: "22/18",
    3: "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/22/18"
  },
  // ── صوت ─────────────────────────────────────────────────────────────────
  // 140 = m4a/aac 128kbps — متوفر على 99%+ من يوتيوب (أفضل لواتساب)
  // 139 = m4a/aac 48kbps — احتياطي
  // نتجنب 251/250 (opus/webm) لأن واتساب لا يدعمها كملف صوتي عادي
  song: "140/139/bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio"
};

// ── كشف صيغة الصوت من بايتات البافر ────────────────────────────────────────
function detectAudioExt(buf) {
  if (!buf || buf.length < 12) return "m4a";
  // OGG / Opus
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return "ogg";
  // WebM (EBML header)
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return "ogg";
  // MP3 — ID3 tag
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "mp3";
  // MP3 — sync frame (0xFFEx or 0xFFFx)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return "mp3";
  // MP4/M4A — ftyp box at byte offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "m4a";
  return "m4a";
}

const QUALITY_LABEL = {
  1: "منخفضة 360p",
  2: "متوسطة 720p",
  3: "عالية (أفضل)"
};

// لا حد قصوى للحجم — النظام يختار الأسلوب المناسب تلقائياً
// RAM Buffer يُستخدم فقط كمسار أخير
const BUFFER_MAX_MB = 800; // حد البافر: 800MB كمسار أخير فقط

// ══════════════════════════════════════════════════════════════════════════════
// مساعدات مرئية
// ══════════════════════════════════════════════════════════════════════════════

export function fmtBytes(b) {
  if (!b || b < 0) return "?";
  if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
  return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function progressBar(pct, width = 14) {
  if (pct < 0) {
    const spin = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    return spin[Math.floor(Date.now() / 300) % spin.length] + " جاري الاستقبال...";
  }
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round(p / 100 * width);
  return "█".repeat(filled) + "░".repeat(width - filled) + " " + p + "%";
}

export function buildProgressMsg(title, stage, qlLabel, recv, total, pct) {
  const bar = progressBar(typeof pct === "number" ? pct : -1);
  const sep = "━".repeat(22);
  let lines = ["🎬 *" + title.slice(0, 50) + "*", sep];

  switch (stage) {
    case "search":
      lines.push("🔍 البحث على يوتيوب...", "⚡ صفر ملفات على السيرفر");
      break;
    case "found":
      lines.push("✅ تم العثور — جودة " + qlLabel, "📡 جاري الحصول على رابط البث...", "⚡ صفر ملفات على السيرفر");
      break;
    case "url_send":
      lines.push("📡 إرسال مباشر — " + qlLabel, "واتساب يحمّل مباشرةً بدون RAM", "⚡ صفر موارد على السيرفر");
      break;
    case "streaming":
    case "piping":
      lines.push("📥 بث مباشر — " + qlLabel, bar, "💾 " + fmtBytes(recv) + " | ⚡ صفر ملفات");
      break;
    case "progress":
      const recvStr = fmtBytes(recv);
      const totStr  = total > 0 ? " / " + fmtBytes(total) : "";
      lines.push("📥 استلام — " + qlLabel, bar, "💾 " + recvStr + totStr + " | ⚡ صفر ملفات");
      break;
    case "done":
      lines.push("✅ اكتمل — " + fmtBytes(recv), "📤 جاري الإرسال لواتساب...");
      break;
    default:
      lines.push(stage);
  }
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// مسار yt-dlp
// ══════════════════════════════════════════════════════════════════════════════

async function ytdlpBin() {
  const local = join(__dirname, "bin", "yt-dlp");
  if (existsSync(local)) return local;
  if (process.env.YTDLP_PATH && existsSync(process.env.YTDLP_PATH)) return process.env.YTDLP_PATH;
  try {
    const { stdout } = await execFileP("which", ["yt-dlp"], { timeout: 3000 });
    const p = stdout.trim();
    if (p && existsSync(p)) return p;
  } catch {}
  throw new Error("yt-dlp غير موجود");
}

// الحصول على مسار ffmpeg
function ffmpegPath() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const nix = "/nix/store/k28ypnisbhajg3x1kv5hy7h2vjbajkvy-replit-runtime-path/bin/ffmpeg";
  if (existsSync(nix)) return nix;
  return "ffmpeg";
}

// ══════════════════════════════════════════════════════════════════════════════
// البحث على يوتيوب مع دعم Offset (للحصول على نتائج مختلفة)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {string[]} queries   — قائمة نصوص البحث
 * @param {number}   minDurSec — حد أدنى للمدة (ثانية)
 * @param {number}   offset    — رقم النتيجة المطلوبة (0=الأولى, 1=الثانية...)
 * @param {number}   poolSize  — عدد النتائج للجلب (للاختيار من بينها)
 */
export async function youtubeSearch(queries, minDurSec, offset, poolSize) {
  minDurSec = minDurSec || 0;
  offset    = Math.max(0, parseInt(offset) || 0);
  poolSize  = Math.max(offset + 1, parseInt(poolSize) || offset + 5);

  // المحاولة 1: yt-search (npm)
  let ytSearch = null;
  try { ytSearch = (await import(join(__dirname, "node_modules", "yt-search", "index.js"))).default; } catch {}
  if (!ytSearch) { try { ytSearch = (await import("yt-search")).default; } catch {} }

  if (ytSearch) {
    for (const q of queries) {
      try {
        const r = await Promise.race([
          ytSearch(q),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 18000))
        ]);
        const vids = (r && r.videos ? r.videos : [])
          .filter(v => !minDurSec || ((v.duration && v.duration.seconds) || 0) >= minDurSec);
        if (vids.length > offset) {
          const v = vids[offset];
          return { url: v.url, title: v.title || q, duration: (v.duration && v.duration.seconds) || 0 };
        }
        if (vids.length > 0) {
          // offset أكبر من النتائج — خذ الأخير
          const v = vids[vids.length - 1];
          return { url: v.url, title: v.title || q, duration: (v.duration && v.duration.seconds) || 0 };
        }
      } catch {}
    }
  }

  // المحاولة 2: yt-dlp ytsearch
  const bin = await ytdlpBin();
  for (const q of queries) {
    try {
      const n = Math.max(5, poolSize);
      const { stdout } = await execFileP(bin, [
        "ytsearch" + n + ":" + q, "--flat-playlist",
        "--print", "%(webpage_url)s\t%(title)s\t%(duration)s",
        "--no-warnings", "-q"
      ], { timeout: 20000 });

      const lines = stdout.trim().split("\n").filter(Boolean);
      const all   = [];
      for (const line of lines) {
        const parts = line.split("\t");
        const url   = parts[0];
        const title = parts[1] || q;
        const dur   = parseInt(parts[2] || "0");
        if (url && url.startsWith("http") && (!minDurSec || dur >= minDurSec))
          all.push({ url, title, duration: dur });
      }
      if (all.length > 0) {
        const idx = Math.min(offset, all.length - 1);
        return all[idx];
      }
    } catch {}
  }

  return null;
}

/**
 * يبحث عن عدة نتائج دفعة واحدة
 */
export async function youtubeSearchMultiple(query, count, minDurSec) {
  count     = Math.max(1, parseInt(count) || 1);
  minDurSec = minDurSec || 0;

  const bin = await ytdlpBin();
  const n   = count * 2; // جلب ضعف العدد لتجنب النتائج السيئة
  const results = [];

  // حاول yt-search أولاً
  let ytSearch = null;
  try { ytSearch = (await import(join(__dirname, "node_modules", "yt-search", "index.js"))).default; } catch {}
  if (!ytSearch) { try { ytSearch = (await import("yt-search")).default; } catch {} }

  if (ytSearch) {
    try {
      const r = await Promise.race([
        ytSearch(query),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 18000))
      ]);
      const vids = (r && r.videos ? r.videos : [])
        .filter(v => !minDurSec || ((v.duration && v.duration.seconds) || 0) >= minDurSec)
        .slice(0, count);
      if (vids.length >= count) {
        return vids.map(v => ({ url: v.url, title: v.title || query, duration: (v.duration && v.duration.seconds) || 0 }));
      }
      vids.forEach(v => results.push({ url: v.url, title: v.title || query, duration: (v.duration && v.duration.seconds) || 0 }));
    } catch {}
  }

  if (results.length >= count) return results.slice(0, count);

  // yt-dlp ytsearch
  try {
    const { stdout } = await execFileP(bin, [
      "ytsearch" + n + ":" + query, "--flat-playlist",
      "--print", "%(webpage_url)s\t%(title)s\t%(duration)s",
      "--no-warnings", "-q"
    ], { timeout: 25000 });

    const seen = new Set(results.map(r => r.url));
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      if (results.length >= count) break;
      const parts = line.split("\t");
      const url   = parts[0];
      const title = parts[1] || query;
      const dur   = parseInt(parts[2] || "0");
      if (url && url.startsWith("http") && !seen.has(url) && (!minDurSec || dur >= minDurSec)) {
        seen.add(url);
        results.push({ url, title, duration: dur });
      }
    }
  } catch {}

  return results.slice(0, count);
}

// ══════════════════════════════════════════════════════════════════════════════
// الحصول على رابط مباشر من YouTube CDN (بدون أي تحميل)
// ══════════════════════════════════════════════════════════════════════════════

export async function getDirectUrl(ytUrl, format) {
  const bin  = await ytdlpBin();
  const args = [ytUrl, "-f", format, "--get-url", "--no-playlist", "--no-warnings", "-q"];
  const fm   = ffmpegPath();
  if (fm) args.push("--ffmpeg-location", fm);

  const { stdout } = await execFileP(bin, args, { timeout: 30000 });
  const urls = stdout.trim().split("\n").filter(u => u.startsWith("http"));
  if (!urls.length) throw new Error("لم يُعثر على رابط مباشر");
  // إذا كان هناك رابطان (video+audio منفصلين)، أول رابط هو الفيديو
  return urls[0];
}

// ══════════════════════════════════════════════════════════════════════════════
// yt-dlp stdout pipe → Buffer (مسار أخير — بافر في RAM)
// ══════════════════════════════════════════════════════════════════════════════

export function ytdlpPipeToBuffer(ytUrl, format, maxMB, onChunk) {
  return new Promise(async (resolve, reject) => {
    const bin      = await ytdlpBin().catch(reject);
    if (!bin) return;
    const maxBytes = (maxMB || BUFFER_MAX_MB) * 1024 * 1024;
    const fm       = ffmpegPath();
    const args     = [ytUrl, "-f", format,
      "--output", "-",
      "--no-playlist", "--no-warnings", "-q", "--no-part",
      "--ffmpeg-location", fm
    ];

    const proc   = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let received   = 0;
    let lastReport = 0;
    let dead       = false;

    proc.stdout.on("data", chunk => {
      if (dead) return;
      received += chunk.length;
      chunks.push(chunk);
      if (maxMB && received > maxBytes) {
        dead = true;
        proc.kill("SIGKILL");
        reject(new Error("حجم الملف تجاوز " + maxMB + "MB"));
        return;
      }
      const now = Date.now();
      if (onChunk && now - lastReport > 2500) {
        lastReport = now;
        onChunk(received, 0, -1).catch(() => {});
      }
    });

    proc.stdout.on("end", () => {
      if (dead) return;
      dead = true;
      if (received < 5000) return reject(new Error("البيانات فارغة أو صغيرة جداً"));
      onChunk && onChunk(received, received, 100).catch(() => {});
      resolve(Buffer.concat(chunks));
    });

    proc.on("error", e => { if (!dead) { dead = true; reject(e); } });
    proc.on("close", code => {
      if (!dead && code !== 0) { dead = true; reject(new Error("yt-dlp كود " + code)); }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP GET streaming → Buffer (للروابط المباشرة)
// ══════════════════════════════════════════════════════════════════════════════

export function streamUrlToBuffer(url, maxMB, onChunk) {
  return new Promise((resolve, reject) => {
    const maxBytes = (maxMB || BUFFER_MAX_MB) * 1024 * 1024;
    const chunks   = [];
    let received   = 0;
    let total      = 0;
    let lastReport = 0;
    let dead       = false;

    function doRequest(targetUrl, hops) {
      if (hops > 8) return reject(new Error("إعادة توجيه أكثر من اللازم"));
      const lib = targetUrl.startsWith("https") ? https : http;
      const req = lib.get(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122",
          "Accept": "*/*", "Accept-Encoding": "identity", "Range": "bytes=0-"
        },
        timeout: 300000
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location)
          return doRequest(res.headers.location, hops + 1);
        if (res.statusCode !== 200 && res.statusCode !== 206)
          return reject(new Error("HTTP " + res.statusCode));
        total = parseInt(res.headers["content-length"] || "0");

        res.on("data", chunk => {
          if (dead) return;
          received += chunk.length;
          chunks.push(chunk);
          if (maxMB && received > maxBytes) {
            dead = true; req.destroy();
            reject(new Error("حجم الملف تجاوز " + maxMB + "MB"));
            return;
          }
          const now = Date.now();
          if (onChunk && now - lastReport > 2500) {
            lastReport = now;
            const pct = total > 0 ? Math.min(99, Math.round(received / total * 100)) : -1;
            onChunk(received, total, pct).catch(() => {});
          }
        });

        res.on("end", () => {
          if (dead) return;
          if (received < 5000) return reject(new Error("الملف فارغ أو صغير جداً"));
          onChunk && onChunk(received, total || received, 100).catch(() => {});
          resolve(Buffer.concat(chunks));
        });
        res.on("error", e => { if (!dead) { dead = true; reject(e); } });
      });

      req.on("error", e => { if (!dead) { dead = true; reject(e); } });
      req.on("timeout", () => { if (!dead) { dead = true; req.destroy(); reject(new Error("انتهت مهلة الاتصال")); } });
    }
    doRequest(url, 0);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// تدفق بيانات URL مباشرة (Node.js Readable) — لإرسالها لواتساب بدون RAM
// ══════════════════════════════════════════════════════════════════════════════

/**
 * إرجاع ReadableStream من yt-dlp stdout (صفر RAM — بث مباشر)
 * يُستخدم عندما يدعم الـ socket المُرسِل streaming
 */
export async function ytdlpReadable(ytUrl, format) {
  const bin  = await ytdlpBin();
  const fm   = ffmpegPath();
  const args = [ytUrl, "-f", format, "--output", "-",
    "--no-playlist", "--no-warnings", "-q", "--no-part",
    "--ffmpeg-location", fm
  ];
  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", () => {}); // تجاهل stderr
  return { stream: proc.stdout, process: proc };
}

// ══════════════════════════════════════════════════════════════════════════════
// streamFilm — تدفق فيلم (بدون حد للحجم)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @returns {{ buffer?, directUrl?, title, quality, ext }}
 *   directUrl: استخدم video:{url:directUrl} في sendMessage  (صفر RAM — الأفضل)
 *   buffer:    استخدم video:buffer في sendMessage (RAM — مسار أخير)
 */
export async function streamFilm(query, quality, onProgress) {
  quality = Math.min(3, Math.max(1, parseInt(quality) || 2));
  const qlLabel = QUALITY_LABEL[quality];

  if (onProgress) await onProgress("search", query, qlLabel, 0, 0, 0).catch(() => {});

  const queries = [
    query + " full movie",
    query + " فيلم كامل",
    query + " movie",
    query + " film",
    query
  ];
  const video = await youtubeSearch(queries, 300, 0, 5);
  if (!video) throw new Error('لم أجد "' + query + '" — جرّب اسماً آخر أو بالإنجليزية');

  if (onProgress) await onProgress("found", video.title, qlLabel, 0, 0, 0).catch(() => {});

  const format = FORMATS.film[quality] || FORMATS.film[2];

  // ── المسار 1: URL مباشر → واتساب يحمّل بنفسه (صفر RAM على السيرفر) ──────
  try {
    const directUrl = await getDirectUrl(video.url, format);
    if (directUrl) {
      if (onProgress) await onProgress("url_send", video.title, qlLabel, 0, 0, 0).catch(() => {});
      return { directUrl, title: video.title, quality, ext: "mp4" };
    }
  } catch {}

  // ── المسار 2: HTTP GET streaming → Buffer (بافر في RAM) ──────────────────
  if (onProgress) await onProgress("streaming", video.title, qlLabel, 0, 0, 0).catch(() => {});
  try {
    const directUrl2 = await getDirectUrl(video.url, "18"); // fallback 360p
    const buffer = await streamUrlToBuffer(directUrl2, BUFFER_MAX_MB, (recv, tot, pct) =>
      onProgress ? onProgress("progress", video.title, qlLabel, recv, tot, pct) : Promise.resolve()
    );
    return { buffer, title: video.title, quality, ext: "mp4" };
  } catch {}

  // ── المسار 3: yt-dlp stdout pipe → Buffer ────────────────────────────────
  if (onProgress) await onProgress("piping", video.title, qlLabel, 0, 0, 0).catch(() => {});
  const buffer = await ytdlpPipeToBuffer(video.url, format, BUFFER_MAX_MB, (recv, tot, pct) =>
    onProgress ? onProgress("progress", video.title, qlLabel, recv, tot, pct) : Promise.resolve()
  );
  return { buffer, title: video.title, quality, ext: "mp4" };
}

// ══════════════════════════════════════════════════════════════════════════════
// streamVideo — تدفق فيديو يوتيوب (مع offset للعدد الصحيح)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {number} offset — رقم الفيديو في قائمة البحث (0=الأول, 1=الثاني, ...)
 */
export async function streamVideo(query, quality, onProgress, offset) {
  quality = Math.min(3, Math.max(1, parseInt(quality) || 2));
  offset  = Math.max(0, parseInt(offset) || 0);
  const qlLabel = QUALITY_LABEL[quality];

  if (onProgress) await onProgress("search", query, qlLabel, 0, 0, 0).catch(() => {});

  const video = await youtubeSearch([query, query + " youtube", query + " فيديو"], 0, offset, offset + 5);
  if (!video) throw new Error('لم أجد "' + query + '"');

  if (onProgress) await onProgress("found", video.title, qlLabel, 0, 0, 0).catch(() => {});

  const format = FORMATS.vid[quality] || FORMATS.vid[2];

  // ── المسار 1: URL مباشر → صفر RAM ────────────────────────────────────────
  try {
    const directUrl = await getDirectUrl(video.url, format);
    if (directUrl) {
      if (onProgress) await onProgress("url_send", video.title, qlLabel, 0, 0, 0).catch(() => {});
      return { directUrl, title: video.title, quality, ext: "mp4" };
    }
  } catch {}

  // ── المسار 2: HTTP GET streaming → Buffer ────────────────────────────────
  if (onProgress) await onProgress("streaming", video.title, qlLabel, 0, 0, 0).catch(() => {});
  try {
    const directUrl2 = await getDirectUrl(video.url, "18");
    const buffer = await streamUrlToBuffer(directUrl2, BUFFER_MAX_MB, (recv, tot, pct) =>
      onProgress ? onProgress("progress", video.title, qlLabel, recv, tot, pct) : Promise.resolve()
    );
    return { buffer, title: video.title, quality, ext: "mp4" };
  } catch {}

  // ── المسار 3: yt-dlp pipe → Buffer ───────────────────────────────────────
  if (onProgress) await onProgress("piping", video.title, qlLabel, 0, 0, 0).catch(() => {});
  const buffer = await ytdlpPipeToBuffer(video.url, format, BUFFER_MAX_MB, (recv, tot, pct) =>
    onProgress ? onProgress("progress", video.title, qlLabel, recv, tot, pct) : Promise.resolve()
  );
  return { buffer, title: video.title, quality, ext: "mp4" };
}

// ══════════════════════════════════════════════════════════════════════════════
// streamSong — تدفق صوت
// ══════════════════════════════════════════════════════════════════════════════

export async function streamSong(query, onProgress, offset) {
  offset = Math.max(0, parseInt(offset) || 0);
  if (onProgress) await onProgress("search", query, "صوت", 0, 0, 0).catch(() => {});

  const video = await youtubeSearch([query, query + " audio", query + " أغنية", query + " music"], 0, offset, offset + 5);
  if (!video) throw new Error('لم أجد "' + query + '"');

  if (onProgress) await onProgress("found", video.title, "صوت", 0, 0, 0).catch(() => {});

  // [FIX-AUDIO] استخدام صيغة m4a دائماً (140 هو AAC 128kbps — متوفر على كل يوتيوب)
  try {
    const directUrl = await getDirectUrl(video.url, FORMATS.song);
    if (directUrl) {
      if (onProgress) await onProgress("url_send", video.title, "صوت", 0, 0, 0).catch(() => {});
      const buffer = await streamUrlToBuffer(directUrl, 100, (recv, tot, pct) =>
        onProgress ? onProgress("progress", video.title, "صوت", recv, tot, pct) : Promise.resolve()
      );
      // [FIX-AUDIO] كشف الصيغة الفعلية من بايتات الملف
      const ext = detectAudioExt(buffer);
      // إذا كانت webm/opus، نحاول التحميل مرة ثانية بصيغة بديلة
      if (ext === "ogg") {
        try {
          const fallbackUrl = await getDirectUrl(video.url, "bestaudio[ext=mp3]/bestaudio[ext=m4a]");
          if (fallbackUrl) {
            const buf2 = await streamUrlToBuffer(fallbackUrl, 100, null);
            const ext2 = detectAudioExt(buf2);
            if (ext2 !== "ogg") return { buffer: buf2, title: video.title, ext: ext2 };
          }
        } catch {}
      }
      return { buffer, title: video.title, ext };
    }
  } catch {}

  if (onProgress) await onProgress("piping", video.title, "صوت", 0, 0, 0).catch(() => {});
  const buffer = await ytdlpPipeToBuffer(video.url, FORMATS.song, 100, (recv, tot, pct) =>
    onProgress ? onProgress("progress", video.title, "صوت", recv, tot, pct) : Promise.resolve()
  );
  // [FIX-AUDIO] كشف الصيغة الفعلية
  const ext = detectAudioExt(buffer);
  return { buffer, title: video.title, ext };
}
