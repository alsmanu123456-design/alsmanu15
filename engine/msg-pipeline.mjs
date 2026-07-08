/**
 * engine/msg-pipeline.mjs — v2
 * ─────────────────────────────────────────────────────────────────
 * خط معالجة الرسائل ذو الأولوية — يمنع تسونامي newsletter من إيقاف "رسالي".
 *
 * التطويرات v2:
 *  • timeout لكل lane: COMMAND=60s، NOTIFY=30s، NEWSLETTER=10s
 *  • teardown(userId) — إلغاء كل المهام المعلّقة لمستخدم عند قطع اتصاله
 *  • إحصائيات per-user منفصلة
 *  • تسجيل عيّنة من الرسائل المتجاهلة (كل 10 رسائل) بدل الصمت
 *  • حراسة مزدوجة: isNewsletter تُكتشف أيضاً من remoteJid
 *
 * الـ Lanes (مشتركة بين جميع المستخدمين — الأولوية تكفل العزل):
 *   LANE_COMMAND    priority=10 — concurrency=3 — timeout=60s — لا سقف
 *   LANE_NOTIFY     priority=5  — concurrency=5 — timeout=30s — سقف=200
 *   LANE_NEWSLETTER priority=1  — concurrency=2 — timeout=10s — سقف=50
 *
 * Exports:
 *   setupMsgPipeline(sock, userId, applyForward, mainHandler, hooks)
 *   teardown(userId)
 *   getPipelineStats()
 *   getUserStats(userId)
 */

import { Queue } from "./queue.mjs";

// ── Lanes ────────────────────────────────────────────────────────
const LANE_COMMAND    = new Queue({ maxConcurrent: 3, maxRetries: 1, retryDelay: 200, timeout: 60_000 });
const LANE_NOTIFY     = new Queue({ maxConcurrent: 5, maxRetries: 0,                  timeout: 30_000 });
const LANE_NEWSLETTER = new Queue({ maxConcurrent: 2, maxRetries: 0,                  timeout: 10_000 });

const CAP_NOTIFY     = 200;
const CAP_NEWSLETTER = 50;

// ── إحصائيات عامة ────────────────────────────────────────────────
const _stats = { received: 0, commands: 0, notify: 0, newsletter: 0, dropped: 0 };

// ── إحصائيات per-user ────────────────────────────────────────────
/** @type {Map<string, {commands:number, notify:number, newsletter:number, dropped:number}>} */
const _userStats = new Map();

function _uStat(userId) {
  if (!_userStats.has(userId))
    _userStats.set(userId, { commands: 0, notify: 0, newsletter: 0, dropped: 0 });
  return _userStats.get(userId);
}

// ── عيّنة سجلات الحذف (لا نُسجّل كل رسالة محذوفة) ───────────────
let _dropCounter = 0;
const DROP_LOG_SAMPLE = 10; // سجّل واحدة من كل 10

// ── الـ API العام ─────────────────────────────────────────────────

/**
 * يُسجّل messages.upsert على السوكت ويوجّه الرسائل عبر الـ lanes.
 */
export function setupMsgPipeline(sock, userId, applyForward, mainHandler, hooks = {}) {
  const { heartbeat = () => {}, resetRetries = () => {} } = hooks;

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    _stats.received++;

    if (type === "notify") { heartbeat(); resetRetries(); }

    // newsletter = append مع jid ينتهي بـ @newsletter
    const isNewsletter = (type === "append") &&
      messages.some(m =>
        (m.key?.remoteJid || "").endsWith("@newsletter")
      );

    if (type !== "notify" && !isNewsletter) return;

    for (const msg of messages) {
      _routeMessage(sock, userId, msg, type, isNewsletter, applyForward, mainHandler);
    }
  });
}

/**
 * يُلغي كل المهام المعلّقة لمستخدم محدد (استدعِه عند قطع اتصال المستخدم).
 * @param {string} userId
 * @returns {number} عدد المهام الملغاة
 */
export function teardown(userId) {
  let n = 0;
  n += LANE_COMMAND.clearByLabel(`cmd:${userId}:`);
  n += LANE_NOTIFY.clearByLabel(`ntf:${userId}:`);
  n += LANE_NEWSLETTER.clearByLabel(`nl:${userId}:`);
  _userStats.delete(userId);
  return n;
}

// ── التوجيه الداخلي ──────────────────────────────────────────────

function _routeMessage(sock, userId, msg, type, isNewsletter, applyForward, mainHandler) {
  const jid = msg.key?.remoteJid || "";
  if (!jid) return;

  const us = _uStat(userId);

  // أوامر المستخدم — أعلى أولوية
  if (type === "notify" && msg.key?.fromMe) {
    _stats.commands++; us.commands++;
    LANE_COMMAND.push(
      `cmd:${userId}:${jid}`,
      () => _processMsg(sock, userId, msg, applyForward, mainHandler),
      10
    ).catch(() => {});
    return;
  }

  // رسائل newsletter
  if (isNewsletter) {
    const { pending } = LANE_NEWSLETTER.getStats();
    if (pending >= CAP_NEWSLETTER) {
      _stats.dropped++; us.dropped++;
      if ((++_dropCounter % DROP_LOG_SAMPLE) === 0) {
        process.stderr.write(`[PIPELINE] تجاوز newsletter cap (${pending}/${CAP_NEWSLETTER}) — تم تجاهل ${_stats.dropped} رسالة\n`);
      }
      return;
    }
    _stats.newsletter++; us.newsletter++;
    LANE_NEWSLETTER.push(
      `nl:${userId}:${jid}`,
      () => _processMsg(sock, userId, msg, applyForward, mainHandler),
      1
    ).catch(() => {});
    return;
  }

  // رسائل notify عادية
  const { pending: ntPending } = LANE_NOTIFY.getStats();
  if (ntPending >= CAP_NOTIFY) {
    _stats.dropped++; us.dropped++;
    return;
  }
  _stats.notify++; us.notify++;
  LANE_NOTIFY.push(
    `ntf:${userId}:${jid}`,
    () => _processMsg(sock, userId, msg, applyForward, mainHandler),
    5
  ).catch(() => {});
}

// ── معالجة رسالة واحدة ───────────────────────────────────────────

async function _processMsg(sock, userId, msg, applyForward, mainHandler) {
  try { await applyForward(sock, msg); }
  catch { /* خطأ forward لا يُعطّل الأوامر */ }
  try { await mainHandler(msg, userId, sock); }
  catch { /* حماية الـ lane */ }
}

// ── إحصائيات ─────────────────────────────────────────────────────

/** إحصائيات عامة للـ pipeline */
export function getPipelineStats() {
  return {
    ..._stats,
    lanes: {
      command:    LANE_COMMAND.getStats(),
      notify:     LANE_NOTIFY.getStats(),
      newsletter: LANE_NEWSLETTER.getStats(),
    },
  };
}

/**
 * إحصائيات مستخدم محدد.
 * @param {string} userId
 */
export function getUserStats(userId) {
  return _userStats.get(userId) ?? { commands: 0, notify: 0, newsletter: 0, dropped: 0 };
}

/** للاختبار: إعادة تعيين */
export function _resetStatsForTest() {
  Object.keys(_stats).forEach(k => { _stats[k] = 0; });
  _userStats.clear();
  LANE_COMMAND.clear();
  LANE_NOTIFY.clear();
  LANE_NEWSLETTER.clear();
}
