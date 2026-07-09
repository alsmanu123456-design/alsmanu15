// ═══════════════════════════════════════════════════════════════════
// forward.mjs — قسم التحويل الشامل
// تحويل الرسائل بين القنوات والمجموعات والأشخاص تلقائياً
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

// [PIPELINE-FIX] كاش في الذاكرة — يقضي على readFileSync لكل رسالة
import {
  getRules      as _cacheGetRules,
  getChats      as _cacheGetChats,
  invalidate    as _cacheInvalidate,
  initRulesCache,
} from "../engine/rules-cache.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const RULES_FILE = join(DATA_DIR, "forward-rules.json");
const CHATS_FILE = join(DATA_DIR, "forward-chats.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// تهيئة الكاش فوراً عند تحميل الوحدة
initRulesCache(RULES_FILE, CHATS_FILE);

// ─── مرجع البوت والسوكت ────────────────────────────────────────────
let _bot = null;
let _sock = null;
const DEV_ID = "7428421245";

// [FIX-MULTINUM-FORWARD] سوكتات كل رقم واتساب مربوط، مفهرسة برقم الهاتف (مع +)
// حتى يمكن اختيار "من أي رقم" تُجلب المجموعات/تُشترك القنوات عند إنشاء قاعدة تحويل
const _socksByNumber = new Map();

export function initForward(bot) { _bot = bot; }
export function setForwardSock(sock) { _sock = sock; }
// يُستدعى من index.mjs عند كل اتصال ناجح لرقم — يسجّل سوكته الخاص باسمه
export function registerForwardSock(phoneNumber, sock) {
  if (!phoneNumber || !sock) return;
  _socksByNumber.set(phoneNumber, sock);
}
export function getConnectedForwardNumbers() {
  return Array.from(_socksByNumber.keys());
}
function _sockForNumber(phoneNumber) {
  return (phoneNumber && _socksByNumber.get(phoneNumber)) || _sock;
}
function _ownNumberOfSock(sock) {
  try {
    return "+" + (sock?.user?.id || "").split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
  } catch { return null; }
}

// [LOG] إشعارات تيليجرام معطّلة بطلب المستخدم
function _fwLog(_text) { /* disabled */ }

// ─── إدارة البيانات ────────────────────────────────────────────────
function loadRules() {
  try { return JSON.parse(readFileSync(RULES_FILE, "utf8")); }
  catch { return []; }
}
function saveRules(rules) {
  writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf8");
  _cacheInvalidate(); // [PIPELINE-FIX v2] تحديث الكاش فوراً بعد الحفظ
}
function loadChats() {
  try { return JSON.parse(readFileSync(CHATS_FILE, "utf8")); }
  catch { return { groups: [], channels: [] }; }
}
function saveChats(chats) {
  writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), "utf8");
  _cacheInvalidate(); // [PIPELINE-FIX v2] تحديث الكاش فوراً بعد الحفظ
}

// ─── حالة الجلسة (في الذاكرة) ──────────────────────────────────────
const SESSION = new Map();
function gs(uid) { return SESSION.get(uid) || {}; }
function ss(uid, data) { SESSION.set(uid, { ...gs(uid), ...data }); }
function cs(uid) { SESSION.delete(uid); }

// ─── جلب المجموعات من واتساب ──────────────────────────────────────
async function fetchGroups(sockOverride) {
  const sock = sockOverride || _sock;
  if (!sock) return [];
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups).map((g) => ({
      id: g.id,
      name: g.subject || g.id.split("@")[0],
    }));
  } catch { return []; }
}

// ─── مساعد: جلب اسم القناة من صفحتها على الويب (fallback بدون sock) ─
// [FIX-HTML-ENTITIES] فك تشفير HTML entities (مثل &#x62d; → 'ح')
function _decodeHtmlEntities(str) {
  if (!str) return str;
  const _safeCP = (cp) => {
    try {
      return (cp > 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF))
        ? String.fromCodePoint(cp) : "";
    } catch { return ""; }
  };
  return str
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => _safeCP(parseInt(h, 16)))
    .replace(/&#([0-9]{1,7});/g,         (_, d) => _safeCP(parseInt(d, 10)))
    .replace(/&amp;/g,  '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[‎‏‪-‮﻿]/g, '').trim();
}

async function _fetchChannelNameFromWeb(inviteCode) {
  try {
    const url = `https://www.whatsapp.com/channel/${inviteCode}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // جرب og:title أولاً (يحتوي HTML entities)
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch) {
      const raw = _decodeHtmlEntities(ogMatch[1])
        .replace(/ [\|\-] WhatsApp.*/i, "").replace(/ - \u0642\u0646\u0627\u0629 \u0639\u0644\u0649 \u0648\u0627\u062A\u0633\u0627\u0628.*/i, "").trim();
      if (raw && raw.length > 0 && raw !== "WhatsApp") return raw;
    }
    // fallback: <title>
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const raw = _decodeHtmlEntities(titleMatch[1])
        .replace(/ [\|\-] WhatsApp.*/i, "").replace(/ - \u0642\u0646\u0627\u0629 \u0639\u0644\u0649 \u0648\u0627\u062A\u0633\u0627\u0628.*/i, "").trim();
      if (raw && raw.length > 0 && raw !== "WhatsApp") return raw;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── مساعد: جلب وعرض معلومات قناة واتساب (newsletter) ─────────────
async function _fetchAndShowNewsletter(uid, type, key, displayFn) {
  if (!_sock) {
    await displayFn("⚠️ *واتساب غير متصل*\n\nاربط رقم واتساب أولاً ثم حاول مجدداً.", {
      inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "fw_chm" }]],
    });
    return;
  }
  try {
    const meta = await _sock.newsletterMetadata(type, key);
    if (!meta || !meta.id) throw new Error("no result");
    // [FIX-CHANNEL-NAME] تحقق من الاسم — إذا كان رقماً خلص أو فارغاً → جلب من الويب
    let _metaRawName = (typeof meta.name === "string" ? meta.name.trim() : "") || "";
    if (!_metaRawName || /^\d+$/.test(_metaRawName)) {
      // حاول من الويب إذا كان type=invite (عندنا invite code)
      if (type === "invite") {
        const _webN = await _fetchChannelNameFromWeb(key);
        if (_webN) _metaRawName = _webN;
      }
    }
    const name = _metaRawName || meta.id;
    const desc = typeof meta.description === "string" && meta.description ? meta.description.slice(0, 200) : "";
    const subs = meta.subscribers ? Number(meta.subscribers).toLocaleString("ar-SA") : "—";
    const verified = meta.verification === "VERIFIED" ? " ✅" : "";
    ss(uid, { chSearchResult: { id: meta.id, name, type, key } });
    await displayFn(
      `📺 *${name}${verified}*\n\n���� المشتركون: ${subs}${desc ? "\n\n📝 " + desc : ""}`,
      {
        inline_keyboard: [
          [{ text: "📥 اشتراك في القناة", callback_data: "fw_chfollow" }],
          [{ text: "💾 حفظ في قائمة القنوات", callback_data: "fw_chsave" }],
          [{ text: "🖼️ تنزيل بروفايل القناة", callback_data: "fw_chpic" }],
          [{ text: "🔄 تحديث المعلومات", callback_data: "fw_chref" }],
          [{ text: "🔍 بحث عن قناة أخرى", callback_data: "fw_ch_search" }],
          backHome("fw_chm"),
        ],
      }
    );
  } catch {
    await displayFn(
      `❌ *لم يتم العثور على القناة*\n\nتأكد من:\n• صحة الرابط أو JID\n• أن القناة عامة وموجودة\n• أن واتساب متصل`,
      {
        inline_keyboard: [
          [{ text: "🔍 حاول مرة أخرى", callback_data: "fw_ch_search" }],
          backHome("fw_chm"),
        ],
      }
    );
  }
}

// ─── حذف الروابط ──────────────────────────────────────────────────
function removeLinks(text) {
  if (!text) return "";
  return text
    .replace(/https?:\/\/[^\s<>]*/gi, "")
    .replace(/www\.[^\s<>]*/gi, "")
    .replace(/bit\.ly\/[^\s]*/gi, "")
    .replace(/t\.me\/[^\s]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function hasLinks(text) {
  return /https?:\/\/|www\.|bit\.ly\/|t\.me\//i.test(text || "");
}

// ─── استخراج نص الرسالة ────────────────────────────────────────────
function extractMsgText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  );
}

// ═══════════════════════════════════════════════════════════════════
// معالجة رسائل واتساب — تطبيق قواعد التحويل
// ═══════════════════════════════════════════════════════════════════
export async function applyForwardRules(sock, msg) {
  try {
    // [PIPELINE-FIX] O(1) من الكاش — لا disk read لكل رسالة
    const rules = _cacheGetRules().filter((r) => r.enabled);
    const fromJid = msg.key?.remoteJid;
    const isNewsletter = fromJid?.endsWith("@newsletter");

    if (!rules.length || !fromJid) return;

    if (isNewsletter) {
      const matched = rules.some((r) => r.sources.includes(fromJid));
      if (!matched) return; // [PIPELINE-FIX] لا log spam لقنوات بلا قواعد
    }

    // [FIX-MULTINUM-FORWARD] رقم الحساب الذي استقبل هذه الرسالة فعلياً — يُستخدم
    // للتأكد أن القاعدة تخص هذا الرقم تحديداً (قواعد أُنشئت قبل هذا الإصلاح لن
    // تملك sourceNumber وتبقى تعمل كالسابق دون تمييز، حفاظاً على التوافق العكسي)
    const receivingNumber = _ownNumberOfSock(sock);

    for (const rule of rules) {
      if (!rule.sources.includes(fromJid)) continue;
      if (rule.sourceNumber && receivingNumber && rule.sourceNumber !== receivingNumber) continue;
      const destJid = rule.destination;
      if (!destJid) continue;

      try {
        let text = extractMsgText(msg);
        const m = msg.message;
        if (!m) {
          _fwLog(`⚠️ رسالة بدون محتوى واردة من:\n\`${fromJid}\`\n\nربما تحتاج واتساب لإعادة الاشتراك في القناة.`);
          continue;
        }

        // [FIX-REPLY-FILTER] تجاهل ردود صاحب القناة على تعليقات المستخدمين
        if (isNewsletter) {
          const _replyCtxId =
            m.extendedTextMessage?.contextInfo?.stanzaId ||
            m.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.stanzaId ||
            m.imageMessage?.contextInfo?.stanzaId ||
            m.videoMessage?.contextInfo?.stanzaId;
          if (_replyCtxId) {
            console.log(`[FW-TRACE] تخطي رد من صاحب القناة (رسالة مقتبسة): ${fromJid}`);
            continue;
          }
        }

        // حذف الروابط إذا مفعّل
        if (rule.blockLinks && hasLinks(text)) {
          text = removeLinks(text);
          const isTextOnly = !!(m.conversation || m.extendedTextMessage);
          if (isTextOnly && !text) continue;
        }
        // [FIX-MEDIA-FILTER] فلترة الوسائط حسب إعدادات القاعدة
        if (rule.blockImages && m.imageMessage) continue;
        if (rule.blockVideos && m.videoMessage) continue;
        if (rule.blockAudios && (m.audioMessage)) continue;

        // [NEWSLETTER-FIX] رسائل القنوات (@newsletter) تحتوي على contextInfo خاص
        // يجعلها تظهر "ممسوخة" عند forward مباشر — نجبر وضع إعادة الإرسال دائماً
        const forceResend = isNewsletter || rule.noForward;

        let sent = false;
        let skipReason = null;

        if (forceResend) {
          if (m.conversation || m.extendedTextMessage) {
            if (text) { await sock.sendMessage(destJid, { text }); sent = true; }
            else skipReason = "نص فارغ";
          } else if (m.imageMessage) {
            const buf = await _downloadMedia(sock, msg);
            if (buf) { await sock.sendMessage(destJid, { image: buf, caption: text }); sent = true; }
            else if (!isNewsletter) { await sock.sendMessage(destJid, { forward: msg }); sent = true; }
            else skipReason = "فشل تنزيل الصورة";
          } else if (m.videoMessage) {
            const buf = await _downloadMedia(sock, msg);
            if (buf) { await sock.sendMessage(destJid, { video: buf, caption: text, mimetype: m.videoMessage.mimetype }); sent = true; }
            else if (!isNewsletter) { await sock.sendMessage(destJid, { forward: msg }); sent = true; }
            else skipReason = "فشل تنزيل الفيديو";
          } else if (m.audioMessage) {
            const buf = await _downloadMedia(sock, msg);
            if (buf) { await sock.sendMessage(destJid, { audio: buf, mimetype: m.audioMessage.mimetype || "audio/mp4", ptt: m.audioMessage.ptt }); sent = true; }
            else if (!isNewsletter) { await sock.sendMessage(destJid, { forward: msg }); sent = true; }
            else skipReason = "فشل تنزيل الصوت";
          } else if (m.stickerMessage) {
            const buf = await _downloadMedia(sock, msg);
            if (buf) { await sock.sendMessage(destJid, { sticker: buf }); sent = true; }
            else if (!isNewsletter) { await sock.sendMessage(destJid, { forward: msg }); sent = true; }
            else skipReason = "فشل تنزيل الملصق";
          } else if (m.documentMessage) {
            const buf = await _downloadMedia(sock, msg);
            if (buf) { await sock.sendMessage(destJid, { document: buf, mimetype: m.documentMessage.mimetype, fileName: m.documentMessage.fileName, caption: text }); sent = true; }
            else if (!isNewsletter) { await sock.sendMessage(destJid, { forward: msg }); sent = true; }
            else skipReason = "فشل تنزيل الملف";
          } else if (!isNewsletter) {
            await sock.sendMessage(destJid, { forward: msg }); sent = true;
          } else {
            // نوع رسالة غير مدعوم من القناة (poll، reaction، إلخ)
            const msgType = Object.keys(m).find(k => !["messageContextInfo","messageSecret"].includes(k)) || "غير معروف";
            skipReason = `نوع غير مدعوم من القنوات: ${msgType}`;
          }
        } else {
          await sock.sendMessage(destJid, { forward: msg }); sent = true;
        }

        // [LOG] إشعار دقيق بالنتيجة الحقيقية — الكاش O(1)
        const chats = _cacheGetChats();
        const srcName = chats.channels.find((c) => c.id === fromJid)?.name || fromJid;
        const dstName = chats.groups.find((g) => g.id === destJid)?.name || destJid;
        if (sent) {
          _fwLog(`✅ *تم التحويل بنجاح*\n📺 من: ${srcName}\n👥 إلى: ${dstName}`);
        } else if (skipReason) {
          _fwLog(`⏭️ *تم تخطي رسالة*\n📺 من: ${srcName}\n👥 إلى: ${dstName}\n⚠️ السبب: ${skipReason}`);
        }
      } catch (ruleErr) {
        console.error(`[FW-ERR] فشل التحويل | من: ${fromJid} | إلى: ${destJid} | خطأ: ${ruleErr?.message || String(ruleErr)}`);
        _fwLog(`❌ *فشل التحويل*\nمن: \`${fromJid}\`\nإلى: \`${destJid}\`\n\nالخطأ: ${ruleErr?.message || String(ruleErr)}`);
      }
    }
  } catch (err) {
    _fwLog(`❌ خطأ عام في نظام التحويل: ${err?.message || String(err)}`);
  }
}

async function _downloadMedia(sock, msg) {
  try {
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
    // [FIX-DOWNLOAD] reuploadRequest مربوط بشكل صحيح لتجنب خطأ 'this' context
    const reuploadRequest = sock?.updateMediaMessage
      ? (m) => sock.updateMediaMessage(m)
      : undefined;
    const buf = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      {
        logger: {
          info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
          child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
        },
        reuploadRequest,
      }
    );
    return buf && buf.length > 0 ? buf : null;
  } catch (e) {
    console.error("[FW] _downloadMedia error:", e?.message || String(e));
    return null;
  }
}

// ─── تسجيل قناة من رسالة واتساب واردة ───────────────────────────
// [FIX-AUTO-CH-SAVE] هذه الدالة موقوفة بطلب المستخدم — لا تُستدعى إلا للتوافق
export function autoDetectSource(_msg) {
  // تعطيل الحفظ التلقائي للقنوات — أوقف بطلب المستخدم لمنع حفظ قنوات غير مقصودة
  return;
}

// ═══════════════════════════════════════════════════════════════════
// مكوّنات لوحة المفاتيح
// ═══════════════════════════════════════════════════════════════════
const PAGE = 9;

function backHome(back = "fw_menu") {
  return [{ text: "🔙 رجوع", callback_data: back }, { text: "🏠 الرئيسية", callback_data: "home" }];
}

function fwMenuKb(n) {
  return {
    inline_keyboard: [
      [{ text: "➕ إضافة قاعدة تحويل", callback_data: "fw_add" }],
      [{ text: "📋 قواعد التحويل" + (n ? ` (${n})` : ""), callback_data: "fw_rules" }],
      [{ text: "📺 إدارة القنوات المحفوظة", callback_data: "fw_chm" }],
      [{ text: "🔍 تشخيص نظام التحويل", callback_data: "fw_diag" }],
      backHome("home"),
    ],
  };
}

function srcTypeKb() {
  return {
    inline_keyboard: [
      [{ text: "📺 قناة", callback_data: "fw_src_ch" }, { text: "👥 مجموعة", callback_data: "fw_src_gr" }],
      backHome("fw_menu"),
    ],
  };
}

// [FIX-MULTINUM-FORWARD] اختيار رقم واتساب قبل تحديد المصدر — كل قاعدة تحويل
// مرتبطة برقم مُحدَّد بدل الاعتماد على "آخر رقم اتصل"
function numberPickerKb(numbers) {
  const rows = numbers.map((num, i) => [{ text: `📱 ${num}`, callback_data: "fw_numpick_" + i }]);
  rows.push(backHome("fw_menu"));
  return { inline_keyboard: rows };
}

function dstTypeKb() {
  return {
    inline_keyboard: [
      [{ text: "📺 قناة", callback_data: "fw_dst_ch" }, { text: "👥 مجموعة", callback_data: "fw_dst_gr" }],
      [{ text: "👤 شخص (رقم هاتف)", callback_data: "fw_dst_person" }],
      backHome("fw_add"),
    ],
  };
}

function settingsKb(bl, nf, bi, bv, ba) {
  return {
    inline_keyboard: [
      [{ text: (bl ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0631\u0648\u0627\u0628\u0637", callback_data: "fw_set_lnk" }],
      [{ text: (bi ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631", callback_data: "fw_set_img" }, { text: (bv ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0641\u064A\u062F\u064A\u0648", callback_data: "fw_set_vid" }],
      [{ text: (ba ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u062A", callback_data: "fw_set_aud" }],
      [{ text: (nf ? "\u2705" : "\u274C") + " \u0628\u062F\u0648\u0646 \u0639\u0644\u0627\u0645\u0629 \u0625\u0639\u0627\u062F\u0629 \u062A\u0648\u062C\u064A\u0647", callback_data: "fw_set_fwd" }],
      [{ text: "\uD83D\uDCBE \u062D\u0641\u0638 \u0627\u0644\u0642\u0627\u0639\u062F\u0629", callback_data: "fw_save" }],
      backHome("fw_dst_type"),
    ],
  };
}
function ruleKb(rule) {
  return {
    inline_keyboard: [
      [{ text: rule.enabled ? "\u23F8\uFE0F \u0625\u064A\u0642\u0627\u0641" : "\u25B6\uFE0F \u062A\u0641\u0639\u064A\u0644", callback_data: "fw_en_" + rule.id }],
      [{ text: (rule.blockLinks ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0631\u0648\u0627\u0628\u0637", callback_data: "fw_lnk_" + rule.id }],
      [{ text: (rule.blockImages ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631", callback_data: "fw_img_" + rule.id }, { text: (rule.blockVideos ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0641\u064A\u062F\u064A\u0648", callback_data: "fw_vid_" + rule.id }],
      [{ text: (rule.blockAudios ? "\u2705" : "\u274C") + " \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u062A", callback_data: "fw_aud_" + rule.id }],
      [{ text: (rule.noForward ? "\u2705" : "\u274C") + " \u0628\u062F\u0648\u0646 \u0625\u0639\u0627\u062F\u0629 \u062A\u0648\u062C\u064A\u0647", callback_data: "fw_nfwd_" + rule.id }],
      [{ text: "\uD83D\uDDD1\uFE0F \u062D\u0630\u0641 \u0627\u0644\u0642\u0627\u0639\u062F\u0629", callback_data: "fw_del_" + rule.id }],
      backHome("fw_rules"),
    ],
  };
}
function rulesListKb(rules, page = 0) {
  // [FIX-04] استخدام PAGE الموحّد بدلاً من P=8 المحلي
  const slice = rules.slice(page * PAGE, (page + 1) * PAGE);
  const rows = slice.map((r) => [{
    text: (r.enabled ? "🟢 " : "🔴 ") + r.name.slice(0, 40),
    callback_data: "fw_rl_" + r.id,
  }]);
  const nav = [];
  if (page > 0) nav.push({ text: "◀️ السابق", callback_data: "fw_rls_p" + (page - 1) });
  if ((page + 1) * PAGE < rules.length) nav.push({ text: "التالي ▶️", callback_data: "fw_rls_p" + (page + 1) });
  if (nav.length) rows.push(nav);
  rows.push(backHome("fw_menu"));
  return { inline_keyboard: rows };
}

// قائمة مجموعات أو قنوات مع pagination وبحث
function chatListKb(items, page, prefix, selected = [], multi = true, backCb = "fw_menu") {
  const start = page * PAGE;
  const pageItems = items.slice(start, start + PAGE);
  const total = Math.ceil(items.length / PAGE);

  const rows = pageItems.map((item, i) => {
    const idx = start + i;
    const isSel = selected.includes(item.id);
    return [{ text: (isSel ? "✅ " : "⬜ ") + item.name.slice(0, 38), callback_data: prefix + "t" + idx }];
  });

  // Pagination
  const nav = [];
  if (page > 0) nav.push({ text: "◀️ السابقة", callback_data: prefix + "p" + (page - 1) });
  nav.push({ text: `📄 ${page + 1}/${total || 1}`, callback_data: "noop" });
  if (page < total - 1) nav.push({ text: "التالية ▶️", callback_data: prefix + "p" + (page + 1) });
  rows.push(nav);

  // Actions
  rows.push([
    { text: "🔍 بحث", callback_data: prefix + "srch" },
    { text: "🔄 تحديث", callback_data: prefix + "ref" },
  ]);

  if (multi && selected.length > 0) {
    rows.push([{ text: `⬅️ التالي — اختر الوجهة (${selected.length} محدد)`, callback_data: prefix + "ok" }]);
  }
  rows.push(backHome(backCb));
  return { inline_keyboard: rows };
}

function chMgrKb() {
  return {
    inline_keyboard: [
      [{ text: "🔍 بحث في القنوات العامة", callback_data: "fw_ch_search" }],
      [{ text: "➕ إضافة قناة يدوياً (JID أو رابط)", callback_data: "fw_ch_add" }],
      [{ text: "📺 القنوات المحفوظة", callback_data: "fw_ch_list" }],
      [{ text: "👥 المجموعات المحفوظة", callback_data: "fw_gr_list" }],
      [{ text: "🔄 تحديث المجموعات من واتساب", callback_data: "fw_gr_ref" }],
      backHome("fw_menu"),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
// معالج callbacks التيليجرام
// ═══════════════════════════════════════════════════════════════════
export async function handleForwardCallback(query) {
  if (!_bot) return false;
  const data = (query.data || "").trim();
  if (!data.startsWith("fw_")) return false;

  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const uid = String(query.from.id);

  const ans = (t = "") => _bot.answerCallbackQuery(query.id, { text: t }).catch(() => {});
  const edit = async (txt, kb) => {
    try {
      await _bot.editMessageText(txt, { chat_id: chatId, message_id: msgId, reply_markup: kb, parse_mode: "Markdown" });
    } catch {
      // [FIX-03] حذف الرسالة القديمة قبل إرسال الجديدة لمنع تراكم الرسائل
      try { await _bot.deleteMessage(chatId, msgId); } catch {}
      await _bot.sendMessage(chatId, txt, { reply_markup: kb, parse_mode: "Markdown" }).catch(() => {});
    }
  };
  const send = (txt, kb) => _bot.sendMessage(chatId, txt, { reply_markup: kb, parse_mode: "Markdown" }).catch(() => {});

  const sess = gs(uid);

  // ── القائمة الرئيسية ──────────────────────────────────────────
  if (data === "fw_menu") {
    ans();
    await edit("📡 *قسم التحويل*\n\nأنشئ قواعد لتوجيه الرسائل بين القنوات والمجموعات تلقائياً.\nتحويل شامل: قناة→مجموعة، مجموعة→مجموعة، مجموعة→شخص...", fwMenuKb(loadRules().length));
    return true;
  }

  // ── تشخيص نظام التحويل ────────────────────────────────────────
  if (data === "fw_diag") {
    ans("⏳ جاري الفحص...");
    try {
      const rules = loadRules();
      const chats = loadChats();
      const sockOk = !!_sock;
      const botOk = !!_bot;
      let diagLines = [
        `*🔍 تشخيص نظام التحويل*\n`,
        `واتساب: ${sockOk ? "✅ متصل" : "❌ غير متصل"}`,
        `تيليجرام: ${botOk ? "✅ متصل" : "❌ غير متصل"}`,
        ``,
        `📺 القنوات المحفوظة: ${chats.channels.length}`,
      ];
      for (const ch of chats.channels) diagLines.push(`  • ${ch.name}\n    \`${ch.id}\``);
      diagLines.push(`\n📋 قواعد التحويل: ${rules.length}`);
      for (const r of rules) {
        const srcName = chats.channels.find(c => r.sources.includes(c.id))?.name || r.sources[0] || "؟";
        const dstName = chats.groups.find(g => g.id === r.destination)?.name || r.destination || "؟";
        diagLines.push(`  • ${r.enabled ? "✅" : "⏸️"} ${srcName} → ${dstName}`);
      }
      if (sockOk && chats.channels.length > 0) {
        diagLines.push(`\n🔔 محاولة إعادة الاشتراك في القنوات...`);
        let subOk = 0, subFail = 0;
        for (const ch of chats.channels) {
          if (ch.id?.endsWith("@newsletter")) {
            try { await _sock.subscribeNewsletterUpdates(ch.id); subOk++; }
            catch { subFail++; }
          }
        }
        diagLines.push(`نتيجة الاشتراك: ✅ ${subOk} نجح، ❌ ${subFail} فشل`);
      }
      if (rules.length === 0) diagLines.push(`\n⚠️ *لا توجد قواعد تحويل* — أضف قاعدة أولاً من "➕ إضافة قاعدة تحويل"`);
      if (chats.channels.length === 0) diagLines.push(`\n⚠️ *لا توجد قنوات محفوظة* — أضف القناة أولاً من "إدارة القنوات"`);
      await edit(diagLines.join("\n"), { inline_keyboard: [backHome("fw_menu")] });
    } catch (e) {
      await edit(`❌ خطأ في التشخيص: ${e?.message || e}`, { inline_keyboard: [backHome("fw_menu")] });
    }
    return true;
  }

  // ── إدارة القنوات ─────────────────────────────────────────────
  if (data === "fw_chm") { ans(); await edit("📺 *إدارة القنوات والمجموعات*", chMgrKb()); return true; }

  if (data === "fw_ch_add") {
    ans();
    ss(uid, { step: "add_ch_jid" });
    await send("📺 *إضافة قناة*\n\nأرسل رابط القناة مباشرة:\n`https://whatsapp.com/channel/...`\n\nأو JID مباشرة:\n`120363...@newsletter`\n\n_البوت سيجلب الاسم الحقيقي ويشترك تلقائياً._");
    return true;
  }

  if (data === "fw_gr_ref") {
    if (!_sock) {
      ans("⚠️ واتساب غير متصل");
      await edit("⚠️ *واتساب غير متصل بعد*\n\nاربط رقم واتساب أولاً ثم اضغط تحديث مجدداً.", chMgrKb());
      return true;
    }
    ans("🔄 جاري جلب المجموعات...");
    const groups = await fetchGroups();
    const chats = loadChats();
    chats.groups = groups;
    saveChats(chats);
    await edit(`✅ *تم تحديث المجموعات*\n\n📊 عدد المجموعات: ${groups.length}`, chMgrKb());
    return true;
  }

  if (data === "fw_ch_list") {
    ans();
    const chats = loadChats();
    ss(uid, { listType: "channels", listPage: 0 });
    const items = chats.channels;
    if (!items.length) { await edit("📺 *القنوات المحفوظة*\n\nلا توجد قنوات محفوظة بعد.\nأضف قناة أو دع البوت يكتشفها تلقائياً.", chMgrKb()); return true; }
    // [FIX-05] كل عنصر قابل للضغط (حذف) بدلاً من noop
    const rows = items.slice(0, 20).map((c, i) => [{ text: "🗑️ " + c.name, callback_data: "fw_ch_del_" + i }]);
    rows.push(backHome("fw_chm"));
    await edit(`📺 *القنوات المحفوظة* (${items.length})\n\n_اضغط على أي قناة لحذفها_`, { inline_keyboard: rows });
    return true;
  }

  // [FIX-05] حذف قناة من القائمة المحفوظة
  if (data.startsWith("fw_ch_del_")) {
    ans();
    const idx = parseInt(data.slice(10));
    const chats = loadChats();
    if (isNaN(idx) || idx >= chats.channels.length) { ans("⚠️ خطأ في الفهرس"); return true; }
    const removed = chats.channels.splice(idx, 1)[0];
    saveChats(chats);
    if (!chats.channels.length) {
      await edit("📺 *القنوات المحفوظة*\n\nلا توجد قنوات محفوظة بعد.", chMgrKb());
      return true;
    }
    const rows = chats.channels.slice(0, 20).map((c, i) => [{ text: "🗑️ " + c.name, callback_data: "fw_ch_del_" + i }]);
    rows.push(backHome("fw_chm"));
    await edit(`📺 *القنوات المحفوظة* (${chats.channels.length})\n\n✅ تم حذف: ${removed.name}\n\n_اضغط على أي قناة لحذفها_`, { inline_keyboard: rows });
    return true;
  }

  // ── بحث عن قناة واتساب عامة ─────────────────────────────────
  if (data === "fw_ch_search") {
    ans();
    ss(uid, { step: "ch_search" });
    await send(
      "🔍 *البحث عن قناة واتساب عامة*\n\nأرسل رابط القناة أو JID الخاص بها:\n\n" +
      "• رابط: `https://whatsapp.com/channel/0029Va...`\n" +
      "• JID: `120363...@newsletter`\n\n" +
      "_البوت سيجلب اسمها ومشتركيها وصورتها تلقائياً._"
    );
    return true;
  }

  // ── حفظ قناة من نتائج البحث ─────────────────────────────────
  if (data === "fw_chsave") {
    ans();
    const result = gs(uid).chSearchResult;
    if (!result?.id) { ans("⚠️ لا توجد قناة في الجلسة — ابحث أولاً"); return true; }
    const chats = loadChats();
    if (chats.channels.find((c) => c.id === result.id)) { ans("ℹ️ القناة محفوظة مسبقاً"); return true; }
    chats.channels.push({ id: result.id, name: result.name });
    saveChats(chats);
    // [NEWSLETTER-FIX] الاشتراك لاستقبال رسائل القناة فوراً
    if (_sock?.subscribeNewsletterUpdates) _sock.subscribeNewsletterUpdates(result.id).catch(() => {});
    ans("✅ تم الحفظ والاشتراك في تحديثات القناة");
    return true;
  }

  // ── اشتراك في القناة (follow) ────────────────────────────────
  if (data === "fw_chfollow") {
    ans("⏳ جاري الاشتراك...");
    const result = gs(uid).chSearchResult;
    if (!result?.id) { ans("⚠️ لا توجد قناة في الجلسة"); return true; }
    if (!_sock) { ans("⚠️ واتساب غير متصل"); return true; }
    try {
      await _sock.newsletterFollow(result.id);
      await _sock.subscribeNewsletterUpdates(result.id).catch(() => {});
      ans("✅ تم الاشتراك في القناة بنجاح");
    } catch {
      ans("❌ تعذّر الاشتراك — تأكد من الاتصال");
    }
    return true;
  }

  // ── تنزيل بروفايل القناة (كامل: صورة + اسم + وصف + مشتركين) ──
  if (data === "fw_chpic") {
    ans("⏳ جاري تنزيل البروفايل الكامل...");
    const result = gs(uid).chSearchResult;
    if (!result?.id) { await send("⚠️ لا توجد قناة في الجلسة"); return true; }
    if (!_sock) { await send("⚠️ واتساب غير متصل"); return true; }
    // [CHPROFILE-FULL] 1) اجلب أحدث بيانات القناة (اسم/وصف/مشتركين/توثيق/تاريخ)
    let _meta = null;
    try {
      _meta = await _sock.newsletterMetadata(result.type === "invite" ? "invite" : "jid", result.key || result.id);
    } catch {}
    const _nm = (_meta?.name && String(_meta.name).trim()) || result.name || result.id;
    const _dsc = _meta?.description ? String(_meta.description).slice(0, 600) : "";
    const _sbs = _meta?.subscribers ? Number(_meta.subscribers).toLocaleString("ar-SA") : "—";
    const _vrf = _meta?.verification === "VERIFIED" ? " ✅ موثّقة" : "";
    const _crt = _meta?.creation_time ? new Date(Number(_meta.creation_time) * 1000).toLocaleDateString("ar") : "";
    const _cap = `📺 *${_nm}*${_vrf}\n\n👥 المشتركون: ${_sbs}${_crt ? `\n📅 تاريخ الإنشاء: ${_crt}` : ""}\n🆔 \`${result.id}\`${_dsc ? `\n\n📝 *الوصف:*\n${_dsc}` : ""}`;
    // 2) حاول تنزيل الصورة وإرسالها مع البيانات؛ وإلا أرسل البيانات نصاً
    try {
      let url;
      try { url = await _sock.profilePictureUrl(result.id, "image"); }
      catch { url = await _sock.profilePictureUrl(result.id, "preview"); }
      const _picRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 WhatsApp/2.24.3.84" },
        signal: AbortSignal.timeout(15000),
      });
      if (!_picRes.ok) throw new Error("HTTP " + _picRes.status);
      const _picBuf = Buffer.from(await _picRes.arrayBuffer());
      if (!_picBuf.length) throw new Error("empty buffer");
      await _bot.sendPhoto(
        chatId,
        _picBuf,
        { caption: _cap, parse_mode: "Markdown" },
        { filename: "profile.jpg", contentType: "image/jpeg" }
      );
    } catch (e) {
      console.error("[FW] fw_chpic pic error:", e?.message || String(e));
      // لا صورة؟ أرسل البروفايل النصي الكامل بدلاً من رسالة فشل جافة
      await send(_cap + "\n\n⚠️ _القناة لا تملك صورة بروفايل قابلة للتنزيل._");
    }
    return true;
  }

  // ── تحديث معلومات القناة الحالية ─────────────────────────────
  if (data === "fw_chref") {
    ans("🔄 جاري التحديث...");
    const result = gs(uid).chSearchResult;
    if (!result?.id) { ans("⚠️ لا توجد قناة في الجلسة — ابحث أولاً"); return true; }
    await _fetchAndShowNewsletter(uid, result.type || "jid", result.key || result.id, edit);
    return true;
  }

  // ── عرض قائمة المجموعات المحفوظة ────────────────────────────
  if (data === "fw_gr_list" || data.startsWith("fw_grl_p")) {
    ans();
    const p = data.startsWith("fw_grl_p") ? (parseInt(data.slice(8)) || 0) : 0;
    const chats = loadChats();
    const items = chats.groups;
    if (!items.length) {
      await edit("👥 *المجموعات المحفوظة*\n\nلا توجد مجموعات بعد.\nاضغط 🔄 تحديث لجلبها من واتساب.", chMgrKb());
      return true;
    }
    const total = Math.ceil(items.length / PAGE);
    const slice = items.slice(p * PAGE, (p + 1) * PAGE);
    const rows = slice.map((g) => [{ text: g.name.slice(0, 40), callback_data: "noop" }]);
    const nav = [];
    if (p > 0) nav.push({ text: "◀️ السابق", callback_data: "fw_grl_p" + (p - 1) });
    nav.push({ text: `📄 ${p + 1}/${total}`, callback_data: "noop" });
    if (p < total - 1) nav.push({ text: "التالي ▶️", callback_data: "fw_grl_p" + (p + 1) });
    rows.push(nav);
    rows.push(backHome("fw_chm"));
    await edit(`👥 *المجموعات المحفوظة* (${items.length})`, { inline_keyboard: rows });
    return true;
  }

  // ── إضافة قاعدة — أولاً: اختيار رقم واتساب ثم نوع المصدر ────────
  if (data === "fw_add") {
    ans();
    const numbers = getConnectedForwardNumbers();
    if (!numbers.length) {
      await edit("⚠️ لا يوجد أي رقم واتساب متصل حالياً بالبوت.\nاربط رقماً أولاً ثم أعد المحاولة.", { inline_keyboard: [backHome("fw_menu")] });
      return true;
    }
    ss(uid, { step: "pick_number", fwNumberList: numbers, sources: [], srcIdxMap: [], srcPage: 0, dstPage: 0, blockLinks: false, blockImages: false, blockVideos: false, blockAudios: false, noForward: false });
    await edit("➕ *إضافة قاعدة تحويل*\n\n📱 اختر *رقم الواتساب* الذي تريد إنشاء التحويل عليه:", numberPickerKb(numbers));
    return true;
  }

  if (data.startsWith("fw_numpick_")) {
    ans();
    const idx = parseInt(data.slice("fw_numpick_".length));
    const numbers = gs(uid).fwNumberList || getConnectedForwardNumbers();
    const fwNumber = numbers[idx];
    if (!fwNumber) { ans("⚠️ رقم غير صالح — أعد المحاولة"); return true; }
    ss(uid, { fwNumber, step: "src_type" });
    await edit(`➕ *إضافة قاعدة تحويل*\n\n📱 الرقم المختار: \`${fwNumber}\`\n\nاختر *نوع المصدر* — من أين تأتي الرسائل؟`, srcTypeKb());
    return true;
  }

  if (data === "fw_src_ch" || data === "fw_src_gr") {
    ans();
    const isCh = data === "fw_src_ch";
    const fwNumber = gs(uid).fwNumber;
    if (!fwNumber) { ans("⚠️ اختر رقم واتساب أولاً"); return true; }
    const chats = loadChats();
    let items = isCh ? chats.channels : chats.groups;
    if (!isCh) {
      // [FIX-MULTINUM-FORWARD] المجموعات تُجلب من جلسة الرقم المختار تحديداً
      const fetched = await fetchGroups(_sockForNumber(fwNumber));
      if (fetched.length) { chats.groups = fetched; saveChats(chats); items = fetched; }
    }
    ss(uid, { srcType: isCh ? "ch" : "gr", srcPage: 0, srcItems: items });
    const prefix = isCh ? "fw_sch_" : "fw_sgr_";
    const title = isCh ? "📺 اختر القنوات المصدر" : "👥 اختر المجموعات المصدر";
    const body = items.length
      ? "\n\n_يمكنك اختيار أكثر من واحدة ثم اضغط تأكيد._"
      : "\n\n⚠️ لا توجد عناصر. اضغط 🔄 تحديث.";
    await edit(`*${title}*${body}`, chatListKb(items, 0, prefix, gs(uid).sources || [], true, "fw_add"));
    return true;
  }

  // ── Pagination مصادر ────────────────────────────────────────
  const srcPfxCh = "fw_sch_p"; const srcPfxGr = "fw_sgr_p";
  if (data.startsWith(srcPfxCh) || data.startsWith(srcPfxGr)) {
    ans();
    const isCh = data.startsWith(srcPfxCh);
    const page = parseInt(data.slice(isCh ? srcPfxCh.length : srcPfxGr.length)) || 0;
    ss(uid, { srcPage: page });
    const s = gs(uid);
    let items = s.srcItems || [];
    // [FIX-PAGINATION] استعادة القائمة من الملف إذا ضاعت الجلسة (إعادة تشغيل البوت)
    if (!items.length) {
      const chats = loadChats();
      items = isCh ? chats.channels : chats.groups;
      if (!items.length && !isCh) {
        items = await fetchGroups(_sockForNumber(s.fwNumber)).catch(() => []);
        if (items.length) { chats.groups = items; saveChats(chats); }
      }
      ss(uid, { srcItems: items });
    }
    const prefix = isCh ? "fw_sch_" : "fw_sgr_";
    const title = isCh ? "📺 اختر القنوات المصدر" : "👥 اختر المجموعات المصدر";
    await edit(`*${title}*`, chatListKb(items, page, prefix, s.sources || [], true, "fw_add"));
    return true;
  }

  // ── Toggle مصدر ─────────────────────────────────────────────
  const srcTogCh = "fw_sch_t"; const srcTogGr = "fw_sgr_t";
  if (data.startsWith(srcTogCh) || data.startsWith(srcTogGr)) {
    ans();
    const isCh = data.startsWith(srcTogCh);
    const idx = parseInt(data.slice(isCh ? srcTogCh.length : srcTogGr.length));
    const s = gs(uid);
    const items = s.srcItems || [];
    if (isNaN(idx) || idx >= items.length) { ans("⚠️ خطأ في الفهرس"); return true; }
    const itemId = items[idx].id;
    let sources = s.sources || [];
    let justAdded = false;
    if (sources.includes(itemId)) sources = sources.filter((x) => x !== itemId);
    else { sources.push(itemId); justAdded = true; }
    ss(uid, { sources });
    // [FIX-MULTINUM-FORWARD] عند اختيار قناة كمصدر، اشترك بها تلقائياً على الرقم المختار إن لم يكن مشتركاً
    if (isCh && justAdded && itemId.endsWith("@newsletter")) {
      const numSock = _sockForNumber(s.fwNumber);
      if (numSock?.subscribeNewsletterUpdates) {
        numSock.subscribeNewsletterUpdates(itemId).catch(() => {});
      }
    }
    const prefix = isCh ? "fw_sch_" : "fw_sgr_";
    const title = isCh ? "📺 اختر القنوات المصدر" : "👥 اختر المجموعات المصدر";
    await edit(`*${title}*\n\n_يمكنك اختيار أكثر من واحدة._`, chatListKb(items, s.srcPage || 0, prefix, sources, true, "fw_add"));
    return true;
  }

  // ── Refresh مصادر ───────────────────────────────────────────
  if (data === "fw_sch_ref" || data === "fw_sgr_ref") {
    const isCh = data === "fw_sch_ref";
    // [FIX-07] القنوات تُكتشف تلقائياً — لا يمكن جلبها من واتساب
    if (isCh) { ans("ℹ️ القنوات تُكتشف تلقائياً عند وصول رسائل منها"); return true; }
    const numSock = _sockForNumber(gs(uid).fwNumber);
    // [FIX-07] فحص الاتصال قبل جلب المجموعات
    if (!numSock) { ans("⚠️ واتساب غير متصل — اربط الرقم أولاً"); return true; }
    ans("🔄 جاري التحديث...");
    const chats = loadChats();
    let items;
    if (!isCh) { items = await fetchGroups(numSock); chats.groups = items; saveChats(chats); }
    else items = chats.channels;
    ss(uid, { srcItems: items, srcPage: 0 });
    const prefix = isCh ? "fw_sch_" : "fw_sgr_";
    const title = isCh ? "📺 القنوات المصدر" : "👥 المجموعات المصدر";
    await edit(`*${title}*\n\n✅ تم التحديث (${items.length} عنصر)`, chatListKb(items, 0, prefix, gs(uid).sources || [], true, "fw_add"));
    return true;
  }

  // ── بحث مصادر ───────────────────────────────────────────────
  if (data === "fw_sch_srch" || data === "fw_sgr_srch") {
    ans();
    const isCh = data === "fw_sch_srch";
    ss(uid, { searchMode: "src", searchIsCh: isCh });
    await send("🔍 اكتب اسم " + (isCh ? "القناة" : "المجموعة") + " أو جزءاً منه:");
    return true;
  }

  // ── تأكيد اختيار المصادر ─────────────────────────────────────
  if (data === "fw_sch_ok" || data === "fw_sgr_ok") {
    ans();
    const s = gs(uid);
    if (!s.sources?.length) { ans("⚠️ اختر مصدراً على الأقل"); return true; }
    // مصدر قناة → اختر نوع الوجهة (قناة/مجموعة/شخص)
    if (data === "fw_sch_ok") {
      ss(uid, { step: "dst_type" });
      await edit(`➕ *إضافة قاعدة*\n\n✅ تم اختيار ${s.sources.length} مصدر\n\nاختر *نوع الوجهة*:`, dstTypeKb());
      return true;
    }
    // مصدر مجموعة → انتقل مباشرة لاختيار المجموعة الوجهة
    const chats = loadChats();
    let items = chats.groups;
    if (!items.length) { items = await fetchGroups(_sockForNumber(s.fwNumber)); chats.groups = items; saveChats(chats); }
    ss(uid, { step: "dst_type", dstType: "gr", dstItems: items, dstPage: 0 });
    await edit(
      `➕ *إضافة قاعدة*\n\n✅ تم اختيار ${s.sources.length} مصدر\n\n👥 *اختر المجموعة الوجهة*\n\nاضغط على المجموعة مباشرة لاختيارها.`,
      chatListKb(items, 0, "fw_dgr_", [], false, "fw_add")
    );
    return true;
  }

  // ── اختيار الوجهة ────────────────────────────────────────────
  if (data === "fw_dst_type") {
    ans();
    await edit("➕ *إضافة قاعدة*\n\nاختر *نوع الوجهة*:", dstTypeKb());
    return true;
  }

  if (data === "fw_dst_ch" || data === "fw_dst_gr") {
    ans();
    const isCh = data === "fw_dst_ch";
    const chats = loadChats();
    let items = isCh ? chats.channels : chats.groups;
    if (!items.length && !isCh) { items = await fetchGroups(_sockForNumber(gs(uid).fwNumber)); chats.groups = items; saveChats(chats); }
    ss(uid, { dstType: isCh ? "ch" : "gr", dstItems: items, dstPage: 0 });
    const prefix = isCh ? "fw_dch_" : "fw_dgr_";
    const title = isCh ? "📺 اختر القناة الوجهة" : "👥 اختر المجموعة الوجهة";
    await edit(`*${title}*\n\nاختر وجهة واحدة فقط.`, chatListKb(items, 0, prefix, [], false, "fw_dst_type"));
    return true;
  }

  if (data === "fw_dst_person") {
    ans();
    ss(uid, { dstType: "person", step: "dst_phone" });
    await send("👤 *تحديد الشخص الوجهة*\n\nأرسل رقم الهاتف مع رمز الدولة\n\nمثال: `9665XXXXXXXX`\n_(أرقام فقط، بدون + أو مسافات)_");
    return true;
  }

  // ── Pagination وجهة ─────────────────────────────────────────
  // [FIX-PAGINATION-v2] حذف الرسالة القديمة وإرسال جديدة لضمان ظهور القائمة الصحيحة
  const dstPCh = "fw_dch_p"; const dstPGr = "fw_dgr_p";
  if (data.startsWith(dstPCh) || data.startsWith(dstPGr)) {
    ans();
    const isCh = data.startsWith(dstPCh);
    const page = parseInt(data.slice(isCh ? dstPCh.length : dstPGr.length)) || 0;
    ss(uid, { dstPage: page });
    const s = gs(uid);
    let items = s.dstItems || [];
    // استعادة القائمة من الملف إذا ضاعت الجلسة
    if (!items.length) {
      const chats = loadChats();
      items = isCh ? chats.channels : chats.groups;
      if (!items.length && !isCh) {
        items = await fetchGroups(_sockForNumber(s.fwNumber)).catch(() => []);
        if (items.length) { chats.groups = items; saveChats(chats); }
      }
      ss(uid, { dstItems: items });
    }
    const prefix = isCh ? "fw_dch_" : "fw_dgr_";
    const total = Math.ceil(items.length / 9);
    const title = `${isCh ? "📺 اختر القناة الوجهة" : "👥 اختر المجموعة الوجهة"} (صفحة ${page + 1}/${total || 1})`;
    const kb = chatListKb(items, page, prefix, [], false, "fw_dst_type");
    // حذف الرسالة القديمة دائماً ثم إرسال جديدة لضمان عرض الصفحة الصحيحة
    try {
      await _bot.deleteMessage(chatId, msgId).catch(() => {});
    } catch {}
    await _bot.sendMessage(chatId, `*${title}*`, { parse_mode: "Markdown", reply_markup: kb });
    return true;
  }

  // ── Toggle وجهة (اختيار واحد) ────────────────────────────────
  const dstTCh = "fw_dch_t"; const dstTGr = "fw_dgr_t";
  if (data.startsWith(dstTCh) || data.startsWith(dstTGr)) {
    ans();
    const isCh = data.startsWith(dstTCh);
    const idx = parseInt(data.slice(isCh ? dstTCh.length : dstTGr.length));
    const s = gs(uid);
    const items = s.dstItems || [];
    if (isNaN(idx) || idx >= items.length) { ans("⚠️ خطأ في الفهرس"); return true; }
    const item = items[idx];
    ss(uid, { destJid: item.id, destName: item.name, step: "settings" });
    const s2 = gs(uid);
    await edit(`⚙️ *إعدادات التحويل*\n\n📌 *الوجهة:* ${item.name}\n\nاضبط الخيارات ثم احفظ:`, settingsKb(s2.blockLinks, s2.noForward, s2.blockImages, s2.blockVideos, s2.blockAudios));
    return true;
  }

  // ── Refresh وجهة ─────────────────────────────────────────────
  if (data === "fw_dch_ref" || data === "fw_dgr_ref") {
    const isCh = data === "fw_dch_ref";
    // [FIX-07] القنوات تُكتشف تلقائياً — لا يمكن جلبها من واتساب
    if (isCh) { ans("ℹ️ القنوات تُكتشف تلقائياً عند وصول رسائل منها"); return true; }
    const fwNumber = gs(uid).fwNumber;
    const numSock = _sockForNumber(fwNumber);
    // [FIX-07] فحص الاتصال قبل جلب المجموعات
    if (!numSock) { ans("⚠️ واتساب غير متصل — اربط الرقم أولاً"); return true; }
    ans("🔄 جاري التحديث...");
    const chats = loadChats();
    let items;
    if (!isCh) { items = await fetchGroups(numSock); chats.groups = items; saveChats(chats); }
    else items = chats.channels;
    ss(uid, { dstItems: items, dstPage: 0 });
    const prefix = isCh ? "fw_dch_" : "fw_dgr_";
    const title = isCh ? "📺 القناة الوجهة" : "👥 المجموعة الوجهة";
    await edit(`*${title}*\n\n✅ تم التحديث (${items.length} عنصر)`, chatListKb(items, 0, prefix, [], false, "fw_dst_type"));
    return true;
  }

  // ── بحث وجهة ────────────────────────────────────────────────
  if (data === "fw_dch_srch" || data === "fw_dgr_srch") {
    ans();
    const isCh = data === "fw_dch_srch";
    ss(uid, { searchMode: "dst", searchIsCh: isCh });
    await send("🔍 اكتب اسم " + (isCh ? "القناة" : "المجموعة") + " للبحث:");
    return true;
  }

  // ── الإعدادات ─────────────────────────────────────────────────
  if (data === "fw_set_lnk") {
    ans();
    ss(uid, { blockLinks: !gs(uid).blockLinks });
    const s = gs(uid);
    await edit("⚙️ *إعدادات التحويل*", settingsKb(s.blockLinks, s.noForward, s.blockImages, s.blockVideos, s.blockAudios));
    return true;
  }

  // [FIX-MEDIA-HANDLERS] فلترة الصور/الفيديو/الصوت في إعدادات قاعدة جديدة
  if (data === "fw_set_img" || data === "fw_set_vid" || data === "fw_set_aud") {
    ans();
    const _mediaKey = data === "fw_set_img" ? "blockImages" : data === "fw_set_vid" ? "blockVideos" : "blockAudios";
    ss(uid, { [_mediaKey]: !gs(uid)[_mediaKey] });
    const s = gs(uid);
    await edit("⚙️ *إعدادات التحويل*", settingsKb(s.blockLinks, s.noForward, s.blockImages, s.blockVideos, s.blockAudios));
    return true;
  }

  if (data === "fw_set_fwd") {
    ans();
    ss(uid, { noForward: !gs(uid).noForward });
    const s = gs(uid);
    await edit("⚙️ *إعدادات التحويل*", settingsKb(s.blockLinks, s.noForward, s.blockImages, s.blockVideos, s.blockAudios));
    return true;
  }

  // ── حفظ القاعدة ──────────────────────────────────────────────
  if (data === "fw_save") {
    ans();
    const s = gs(uid);
    if (!s.sources?.length || !s.destJid) { ans("⚠️ بيانات ناقصة — أعد المحاولة"); return true; }

    const chats = loadChats();
    const allItems = [...chats.groups, ...chats.channels];
    const srcNames = s.sources.map((id) => {
      const found = allItems.find((x) => x.id === id);
      return found?.name || id.split("@")[0];
    }).join(" + ");
    const dstName = s.destName || allItems.find((x) => x.id === s.destJid)?.name || s.destJid.split("@")[0];

    const rule = {
      id: randomUUID(),
      name: srcNames + " → " + dstName,
      sources: s.sources,
      destination: s.destJid,
      // [FIX-MULTINUM-FORWARD] الرقم الذي أُنشئت عليه القاعدة — يُستخدم للتحقق وقت التنفيذ
      sourceNumber: s.fwNumber || null,
      blockLinks: s.blockLinks || false,
      blockImages: s.blockImages || false,
      blockVideos: s.blockVideos || false,
      blockAudios: s.blockAudios || false,
      noForward: s.noForward || false,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    const rules = loadRules();
    rules.push(rule);
    saveRules(rules);
    cs(uid);

    await edit(
      `✅ *تم حفظ القاعدة بنجاح!*\n\n📌 ${rule.name}\n🔗 حذف الروابط: ${rule.blockLinks ? "نعم ✅" : "لا ❌"}\n↩️ بدون إعادة توجيه: ${rule.noForward ? "نعم ✅" : "لا ❌"}\n\n_القاعدة مفعّلة الآن._`,
      fwMenuKb(rules.length)
    );
    return true;
  }

  // ── قائمة القواعد ────────────────────────────────────────────
  if (data === "fw_rules" || data.startsWith("fw_rls_p")) {
    ans();
    const page = data.startsWith("fw_rls_p") ? parseInt(data.slice(8)) || 0 : 0;
    const rules = loadRules();
    if (!rules.length) {
      await edit("📋 *قواعد التحويل*\n\nلا توجد قواعد بعد.", {
        inline_keyboard: [[{ text: "➕ إضافة قاعدة", callback_data: "fw_add" }], backHome("fw_menu")],
      });
      return true;
    }
    await edit(`📋 *قواعد التحويل* (${rules.length})\n\nاضغط على قاعدة لإدارتها:`, rulesListKb(rules, page));
    return true;
  }

  // ── تفاصيل قاعدة ─────────────────────────────────────────────
  if (data.startsWith("fw_rl_")) {
    ans();
    const ruleId = data.slice(6);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) { ans("⚠️ القاعدة غير موجودة"); return true; }
    const status = rule.enabled ? "🟢 مفعّلة" : "🔴 موقوفة";
    const chats = loadChats();
    const allItems = [...chats.groups, ...chats.channels];
    // [FIX-CHANNEL-NAME] عرض اسم ودود بدلاً من الرقم الطويل عند غياب الاسم الحقيقي
    const _friendlyId = (id) => {
      if (!id) return "—";
      const raw = id.split("@")[0];
      const isNewsletterJid = id.endsWith("@newsletter");
      const found = allItems.find((x) => x.id === id);
      if (found?.name) return found.name;
      return isNewsletterJid ? `📺 قناة ...${raw.slice(-6)}` : `👥 ...${raw.slice(-6)}`;
    };
    const srcNames = rule.sources.map(_friendlyId).join("\n  • ");
    const dstName = _friendlyId(rule.destination);
    await edit(
      `📌 *${rule.name}*\n\n📊 الحالة: ${status}\n\n📥 *المصادر:*\n  • ${srcNames}\n📤 *الوجهة:* ${dstName || "—"}\n\n🔗 حذف الروابط: ${rule.blockLinks ? "✅" : "❌"}\n↩️ بدون إعادة توجيه: ${rule.noForward ? "✅" : "❌"}`,
      ruleKb(rule)
    );
    return true;
  }

  // ── تفعيل/إيقاف قاعدة ───────────────────────────────────────
  if (data.startsWith("fw_en_")) {
    ans();
    const ruleId = data.slice(6);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) { ans("⚠️ القاعدة غير موجودة"); return true; }
    rule.enabled = !rule.enabled;
    saveRules(rules);
    ans(rule.enabled ? "✅ تم التفعيل" : "⏸️ تم الإيقاف");
    await edit(`📌 *${rule.name}*\n\n📊 الحالة: ${rule.enabled ? "🟢 مفعّلة" : "🔴 موقوفة"}`, ruleKb(rule));
    return true;
  }

  // ── تبديل حذف الروابط ──────────────────────────────────────
  if (data.startsWith("fw_lnk_")) {
    ans();
    const ruleId = data.slice(7);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return true;
    rule.blockLinks = !rule.blockLinks;
    saveRules(rules);
    ans(rule.blockLinks ? "✅ حذف الروابط مفعّل" : "❌ حذف الروابط معطّل");
    await edit(`📌 *${rule.name}*`, ruleKb(rule));
    return true;
  }

  // ── تبديل بدون إعادة توجيه ─────────────────────────────────
  if (data.startsWith("fw_nfwd_")) {
    ans();
    const ruleId = data.slice(8);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return true;
    rule.noForward = !rule.noForward;
    saveRules(rules);
    ans(rule.noForward ? "✅ بدون علامة إعادة توجيه" : "❌ مع علامة إعادة توجيه");
    await edit(`📌 *${rule.name}*`, ruleKb(rule));
    return true;
  }

  // [FIX-MEDIA-FILTER] تبديل حذف الصور/الفيديو/الصوت في قاعدة موجودة
  if (data.startsWith("fw_img_")) {
    ans();
    const ruleId = data.slice(7);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return true;
    rule.blockImages = !rule.blockImages;
    saveRules(rules);
    ans(rule.blockImages ? "\u2705 \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u0645\u0641\u0639\u0651\u0644" : "\u274C \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u0645\u0639\u0637\u0651\u0644");
    await edit(`\uD83D\uDCCC *${rule.name}*`, ruleKb(rule));
    return true;
  }
  if (data.startsWith("fw_vid_")) {
    ans();
    const ruleId = data.slice(7);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return true;
    rule.blockVideos = !rule.blockVideos;
    saveRules(rules);
    ans(rule.blockVideos ? "\u2705 \u062D\u0630\u0641 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u0645\u0641\u0639\u0651\u0644" : "\u274C \u062D\u0630\u0641 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u0645\u0639\u0637\u0651\u0644");
    await edit(`\uD83D\uDCCC *${rule.name}*`, ruleKb(rule));
    return true;
  }
  if (data.startsWith("fw_aud_")) {
    ans();
    const ruleId = data.slice(7);
    const rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return true;
    rule.blockAudios = !rule.blockAudios;
    saveRules(rules);
    ans(rule.blockAudios ? "\u2705 \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u062A \u0645\u0641\u0639\u0651\u0644" : "\u274C \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u062A \u0645\u0639\u0637\u0651\u0644");
    await edit(`\uD83D\uDCCC *${rule.name}*`, ruleKb(rule));
    return true;
  }

  // ── حذف قاعدة ────────────────────────────────────────────────
  if (data.startsWith("fw_del_")) {
    ans();
    const ruleId = data.slice(7);
    let rules = loadRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return true;
    rules = rules.filter((r) => r.id !== ruleId);
    saveRules(rules);
    await edit(`🗑️ *تم حذف القاعدة*\n\n${rule.name}`, fwMenuKb(rules.length));
    return true;
  }

  return false; // غير معالج
}

// ═══════════════════════════════════════════════════════════════════
// معالج رسائل النصية (للبحث وإدخال الرقم)
// ═══════════════════════════════════════════════════════════════════
export async function handleForwardText(msg) {
  if (!_bot) return false;
  const chatId = msg.chat?.id;
  const uid = String(msg.from?.id || "");
  if (!chatId || !uid) return false;
  const text = msg.text?.trim() || "";
  if (!text) return false;
  const sess = gs(uid);

  const send = (txt, kb) =>
    _bot.sendMessage(chatId, txt, { parse_mode: "Markdown", reply_markup: kb }).catch(() => {});

  // ── إدخال رقم هاتف للوجهة ────────────────────────────────────
  if (sess.step === "dst_phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      await send("⚠️ رقم غير صالح. أرسل الرقم مع رمز الدولة (أرقام فقط)\nمثال: `9665XXXXXXXX`");
      return true;
    }
    const jid = digits + "@s.whatsapp.net";
    ss(uid, { destJid: jid, destName: "👤 +" + digits, step: "settings" });
    const s = gs(uid);
    await send(`✅ تم تحديد الشخص: +${digits}\n\nاضبط إعدادات التحويل:`, settingsKb(s.blockLinks, s.noForward, s.blockImages, s.blockVideos, s.blockAudios));
    return true;
  }

  // ── إضافة قناة يدوياً ────────────────────────────────────────
  if (sess.step === "add_ch_jid") {
    const input = text.trim();
    // [FIX] دعم روابط WhatsApp — جلب JID الحقيقي واسم القناة
    if (input.includes("whatsapp.com/channel/")) {
      const match = input.match(/channel\/([A-Za-z0-9_\-]+)/);
      if (!match) { await send("⚠️ رابط غير صالح — تأكد من نسخ الرابط كاملاً"); return true; }
      await send("⏳ جاري جلب معلومات القناة...");
      ss(uid, { step: null });
      try {
        let metaId = null, metaName = null;
        // حاول أولاً عبر WhatsApp API
        if (_sock?.newsletterMetadata) {
          try {
            const meta = await _sock.newsletterMetadata("invite", match[1]);
            if (meta?.id) {
              metaId = meta.id;
              const _rawName = typeof meta.name === "string" ? meta.name.trim() : null;
              // تجاهل الاسم لو كان فارغ أو أرقام فقط (API رجع ID بدل الاسم الحقيقي)
              metaName = (_rawName && !/^\d+$/.test(_rawName)) ? _rawName : null;
            }
          } catch {}
        }
        // إذا لم يُعطِ API اسماً — اجلب الاسم من صفحة الويب
        if (metaId && !metaName) {
          const webName = await _fetchChannelNameFromWeb(match[1]);
          if (webName) metaName = webName;
        }
        // إذا ما عندنا ID بعد — أوقف
        if (!metaId) throw new Error("no meta");
        const name = metaName || ("📺 " + metaId.split("@")[0]);
        const chats = loadChats();
        if (!chats.channels.find((c) => c.id === metaId)) {
          chats.channels.push({ id: metaId, name });
          saveChats(chats);
          if (_sock?.subscribeNewsletterUpdates) _sock.subscribeNewsletterUpdates(metaId).catch(() => {});
        }
        await send(`✅ *تم إضافة القناة:*\n\n📺 ${name}\n\`${metaId}\`\n\nالبوت مشترك الآن ويستقبل رسائلها.`, chMgrKb());
      } catch {
        await send("❌ *تعذّر جلب القناة*\n\nتأكد من:\n• صحة الرابط\n• أن واتساب متصل\n• أن القناة عامة");
      }
      return true;
    }
    // JID مباشر أو رقم
    const digits = input.replace(/\D/g, "");
    let jid;
    if (input.includes("@")) {
      jid = input;
    } else if (digits.length >= 5) {
      jid = digits + "@newsletter";
    } else {
      await send("⚠️ أدخل رابط القناة أو JID مباشرةً\nمثال: `https://whatsapp.com/channel/...`");
      return true;
    }
    const chats = loadChats();
    const label = jid.endsWith("@newsletter") ? "📺 قناة " : "👤 ";
    if (!chats.channels.find((c) => c.id === jid)) {
      // [FIX-CHANNEL-NAME] جلب الاسم الحقيقي للقناة — API ثم الويب fallback
      let chName = label + digits;
      if (jid.endsWith("@newsletter")) {
        // أولاً: جرّب WhatsApp API
        if (_sock?.newsletterMetadata) {
          try {
            const meta = await _sock.newsletterMetadata("jid", jid);
            if (meta?.name && typeof meta.name === "string" && meta.name.trim() && !/^\d+$/.test(meta.name.trim())) {
              chName = meta.name.trim();
            }
          } catch {}
        }
        // ثانياً: إذا ما عندنا اسم، جلبه من صفحة الويب بالـ invite code (من JID)
        if (chName === label + digits) {
          // نستخدم JID كـ invite نظري — نحاول بناء invite code من الرابط لو وُجد
          // وإلا نترك الاسم كما هو (لا يمكن fetch بدون invite code)
        }
      }
      chats.channels.push({ id: jid, name: chName });
      saveChats(chats);
      if (jid.endsWith("@newsletter") && _sock?.subscribeNewsletterUpdates) {
        _sock.subscribeNewsletterUpdates(jid).catch(() => {});
      }
    }
    ss(uid, { step: null });
    await send(`✅ تم حفظ: \`${jid}\`\n📺 ${jid.endsWith("@newsletter") ? (chats.channels.find(c => c.id === jid)?.name || jid) : jid}`, chMgrKb());
    return true;
  }

  // ── بحث عن قناة واتساب عامة ──────────────────────────────────
  if (sess.step === "ch_search") {
    ss(uid, { step: null });
    const input = text.trim();
    let type, key;
    if (input.includes("whatsapp.com/channel/")) {
      const match = input.match(/channel\/([A-Za-z0-9_\-]+)/);
      if (!match) {
        await send("⚠️ رابط غير صالح.\n\nأرسل رابطاً صحيحاً مثل:\n`https://whatsapp.com/channel/0029Va...`");
        return true;
      }
      type = "invite"; key = match[1];
    } else if (input.endsWith("@newsletter")) {
      type = "jid"; key = input;
    } else {
      await send(
        "⚠️ *مدخل غير مدعوم*\n\nأرسل:\n" +
        "• رابط القناة: `https://whatsapp.com/channel/...`\n" +
        "• أو JID: `120363...@newsletter`"
      );
      return true;
    }
    await send("⏳ جاري البحث عن القناة...");
    await _fetchAndShowNewsletter(
      uid, type, key,
      (t, kb) => _bot.sendMessage(chatId, t, { parse_mode: "Markdown", reply_markup: kb }).catch(() => {})
    );
    return true;
  }

  // ── وضع البحث ────────────────────────────────────────────────
  if (sess.searchMode) {
    const mode = sess.searchMode; // "src" | "dst"
    const isCh = sess.searchIsCh;
    const chats = loadChats();
    const pool = isCh ? chats.channels : chats.groups;
    const q = text.toLowerCase();
    const filtered = pool.filter((i) => i.name.toLowerCase().includes(q));

    ss(uid, { searchMode: null });

    if (!filtered.length) {
      await send(`🔍 لا توجد نتائج لـ "${text}"\n\nجرّب كلمة أخرى.`);
      return true;
    }

    if (mode === "src") {
      ss(uid, { srcItems: filtered, srcPage: 0 });
      const prefix = isCh ? "fw_sch_" : "fw_sgr_";
      const title = isCh ? "📺 نتائج البحث — اختر المصادر" : "👥 نتائج البحث — اختر المصادر";
      await send(`*${title}* (${filtered.length})`, chatListKb(filtered, 0, prefix, gs(uid).sources || [], true, "fw_add"));
    } else {
      ss(uid, { dstItems: filtered, dstPage: 0 });
      const prefix = isCh ? "fw_dch_" : "fw_dgr_";
      const title = isCh ? "📺 نتائج البحث — الوجهة" : "👥 نتائج البحث — الوجهة";
      await send(`*${title}* (${filtered.length})`, chatListKb(filtered, 0, prefix, [], false, "fw_dst_type"));
    }
    return true;
  }

  return false;
}

// ─── مساعدات خارجية ───────────────────────────────────────────────
export function isForwardCb(data) {
  return typeof data === "string" && data.startsWith("fw_");
}

// [NEWSLETTER-FIX] الاشتراك في كل القنوات المحفوظة لاستقبال رسائلها الحية
export async function subscribeForwardChannels(sock) {
  if (!sock?.subscribeNewsletterUpdates) {
    console.log("[FORWARD] subscribeNewsletterUpdates غير موجود في السوكت");
    return;
  }
  try {
    const chats = loadChats();
    const channels = chats.channels.filter(ch => ch.id?.endsWith("@newsletter"));
    if (!channels.length) {
      console.log("[FORWARD] لا توجد قنوات محفوظة للاشتراك");
      return;
    }
    for (const ch of channels) {
      try {
        const res = await sock.subscribeNewsletterUpdates(ch.id);
        const dur = res?.duration;
        console.log(`[FORWARD] ✅ اشتراك ناجح في القناة: ${ch.id} | مدة الاشتراك: ${dur ?? "غير محدد"}`);
        // [FIX] أُلغيت رسالة الإشعار للمطوّر عند كل اشتراك — كانت تتكرر مع كل تشغيل للبوت (طلب المستخدم)
      } catch (e) {
        console.log(`[FORWARD] ❌ فشل الاشتراك في القناة: ${ch.id} | ${e?.message}`);
      }
    }
  } catch (e) {
    console.log(`[FORWARD] خطأ في subscribeForwardChannels: ${e?.message}`);
  }
}

// إعادة اشتراك دورية كل 60 ثانية — مدة الاشتراك 90 ثانية فقط
let _renewTimer = null;
export function startNewsletterRenewal(sock) {
  if (_renewTimer) clearInterval(_renewTimer);
  _renewTimer = setInterval(async () => {
    const chats = loadChats();
    const channels = chats.channels.filter(ch => ch.id?.endsWith("@newsletter"));
    if (!channels.length || !sock?.subscribeNewsletterUpdates) return;
    for (const ch of channels) {
      try {
        await sock.subscribeNewsletterUpdates(ch.id);
      } catch {}
    }
  }, 60 * 1000); // كل 60 ثانية (الاشتراك مدته 90 ثانية)
}
export function isForwardSession(uid) {
  const s = SESSION.get(String(uid));
  return !!(s && (s.searchMode || s.step === "dst_phone" || s.step === "add_ch_jid" || s.step === "ch_search"));
}
// [FIX-06] getForwardMenuButton() حُذفت — لم تكن مستخدمة في أي مكان
