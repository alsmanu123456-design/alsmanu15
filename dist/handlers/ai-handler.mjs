// dist/handlers/ai-handler.mjs
// Domain: AI — /ai /ai_menu + callbacks

export const pluginManifest = {
  name: 'ai',
  version: '1.0.0',
  type: 'handler',
  description: 'الذكاء الاصطناعي: /ai /ai_menu + callbacks',
  textOrder: 7,
  cbOrder: 6,
  enabled: true,
};

let _deps = null;
export function setDeps(d) { _deps = d; }

export async function handleText(bot, msg) {
  if (!msg.text) return false;
  const text = msg.text;
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id);

  if (text === '/ai' || text === '/ai_menu') {
    await _deps.handleAiMenu(bot, chatId, userId);
    return true;
  }
  return false;
}

export async function handleCallback(bot, query) {
  const data = query.data || '';
  const chatId = query.message?.chat.id;
  const userId = String(query.from.id);

  if (data === 'menu_ai' || data.startsWith('ai_')) {
    const handled = await _deps.handleAiCallback2(bot, chatId, userId, data);
    if (!handled) await _deps.handleAiCallback(bot, chatId, userId, data);
    return true;
  }

  return false;
}
