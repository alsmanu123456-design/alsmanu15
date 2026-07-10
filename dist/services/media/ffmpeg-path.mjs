// dist/services/media/ffmpeg-path.mjs
// ────────────────────────────────────────────────────────────────
// يحلّ مسار ثنائي ffmpeg بشكل يعمل على أي استضافة، مع تفضيل النسخة
// المثبتة في النظام لتوفير مساحة القرص (بعض الاستضافات تعطي 1GB فقط):
//   1. متغير البيئة FFMPEG_PATH (إن ضبطه المشغّل)
//   2. ffmpeg الموجود في PATH بالنظام (لا يستهلك مساحة إضافية)
//   3. حزمة ffmpeg-static المرفقة (احتياط لمنصة واحدة، ~80MB)
//
// ملاحظة: أُزيلت ffprobe-static تماماً (كانت 351MB وتملأ القرص) —
// نستخرج مدة الصوت من ffmpeg نفسه في audio-chunker.mjs.
//
// النتيجة تُخزَّن (cache) بعد أول حساب لتفادي إعادة الفحص لكل استدعاء.

import { existsSync } from "fs";
import { execFileSync } from "child_process";

let _ffmpegCached = null;

function _systemHasFfmpeg() {
  try {
    // "command -v" لا يحمّل الثنائي كاملاً، مجرد فحص وجوده في PATH
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function _tryImportDefault(mod) {
  try {
    const m = await import(mod);
    const p = m?.default || m;
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

  // 2. ffmpeg مثبّت في النظام — الأفضل لأنه لا يستهلك مساحة إضافية
  if (_systemHasFfmpeg()) {
    _ffmpegCached = "ffmpeg";
    return _ffmpegCached;
  }

  // 3. حزمة ffmpeg-static المرفقة (احتياط)
  const staticPath = await _tryImportDefault("ffmpeg-static");
  if (staticPath && existsSync(staticPath)) {
    _ffmpegCached = staticPath;
    return _ffmpegCached;
  }

  // 4. احتياط أخير: الاسم المجرّد من PATH
  _ffmpegCached = "ffmpeg";
  return _ffmpegCached;
}
