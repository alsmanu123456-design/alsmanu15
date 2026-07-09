// dist/services/media/ffmpeg-path.mjs
// ────────────────────────────────────────────────────────────────
// يحلّ مسار ثنائيات ffmpeg / ffprobe بشكل يعمل على أي استضافة دون
// الاعتماد على تثبيتها يدوياً في النظام:
//   1. الحزم المرفقة ffmpeg-static / ffprobe-static (ثنائيات جاهزة لكل منصة)
//   2. متغيرات البيئة FFMPEG_PATH / FFPROBE_PATH (إن ضبطها المشغّل)
//   3. الاسم المجرّد "ffmpeg"/"ffprobe" من PATH (احتياط أخير)
//
// النتيجة تُخزَّن (cache) بعد أول حساب لتفادي إعادة الاستيراد لكل استدعاء.

import { existsSync } from "fs";

let _ffmpegCached = null;
let _ffprobeCached = null;

async function _tryImportDefault(mod) {
  try {
    const m = await import(mod);
    const p = m?.default || m;
    return typeof p === "string" ? p : null;
  } catch {
    return null;
  }
}

async function _tryImportProp(mod, prop) {
  try {
    const m = await import(mod);
    const p = m?.[prop] || m?.default?.[prop];
    return typeof p === "string" ? p : null;
  } catch {
    return null;
  }
}

/**
 * يُعيد مسار ffmpeg القابل للتنفيذ.
 * @returns {Promise<string>}
 */
export async function getFfmpegPath() {
  if (_ffmpegCached) return _ffmpegCached;

  // 1. متغير بيئة صريح
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    _ffmpegCached = process.env.FFMPEG_PATH;
    return _ffmpegCached;
  }

  // 2. حزمة ffmpeg-static المرفقة
  const staticPath = await _tryImportDefault("ffmpeg-static");
  if (staticPath && existsSync(staticPath)) {
    _ffmpegCached = staticPath;
    return _ffmpegCached;
  }

  // 3. احتياط: الاسم المجرّد من PATH
  _ffmpegCached = "ffmpeg";
  return _ffmpegCached;
}

/**
 * يُعيد مسار ffprobe القابل للتنفيذ.
 * @returns {Promise<string>}
 */
export async function getFfprobePath() {
  if (_ffprobeCached) return _ffprobeCached;

  // 1. متغير بيئة صريح
  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) {
    _ffprobeCached = process.env.FFPROBE_PATH;
    return _ffprobeCached;
  }

  // 2. حزمة ffprobe-static المرفقة (تصدّر { path })
  const staticPath = await _tryImportProp("ffprobe-static", "path");
  if (staticPath && existsSync(staticPath)) {
    _ffprobeCached = staticPath;
    return _ffprobeCached;
  }

  // 3. احتياط: الاسم المجرّد من PATH
  _ffprobeCached = "ffprobe";
  return _ffprobeCached;
}
