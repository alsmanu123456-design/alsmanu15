let _deps = {};
export function setDeps(d) { _deps = d; }

export async function handleAiCallback2(bot2, chatId, userId, data) {
  const { getUser, saveUser, setState, cancelKeyboard, aiMenuKeyboard, init_ai_manager, ai_manager_exports } = _deps;
  const user = getUser(userId);
  if (data === "menu_ai") {
    const { hasNvidiaKey: hasNvidiaKey2, getUserSelectedModel: getUserSelectedModel2 } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    const hasKey = hasNvidiaKey2(userId);
    const model = getUserSelectedModel2(userId);
    const aiEnabled = user.aiEnabled || false;
    await bot2.sendMessage(chatId,
      `\u{1F916} *\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A*\n\n\u{1F511} \u0627\u0644\u0645\u0641\u062A\u0627\u062D: ${hasKey ? "\u2705 \u0645\u064F\u0636\u0627\u0641" : "\u274C \u0644\u0645 \u064A\u064F\u0636\u064E\u0641 \u0628\u0639\u062F"}\n\u{1F9E0} \u0627\u0644\u0646\u0645\u0648\u0630\u062C: ${model.split("/")[1] || model}\n\u26A1 \u0627\u0644\u062D\u0627\u0644\u0629: ${aiEnabled ? "\u2705 \u0645\u0641\u0639\u0651\u0644" : "\u274C \u0645\u0639\u0637\u0651\u0644"}\n\n${!hasKey ? "\u26A0\uFE0F \u0623\u0636\u0641 \u0645\u0641\u062A\u0627\u062D NVIDIA \u0645\u062C\u0627\u0646\u0627\u064B \u0645\u0646:\nhttps://build.nvidia.com" : "\u2705 \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0622\u0646 \u0625\u0636\u0627\u0641\u0629 \u0631\u062F\u0648\u062F \u0630\u0643\u0627\u0621 \u0627\u0635\u0637\u0646\u0627\u0639\u064A"}`,
      { parse_mode: "Markdown", reply_markup: aiMenuKeyboard(hasKey, aiEnabled) }
    );
    return true;
  }
  if (data === "ai_add_key") {
    setState(userId, "awaiting_nvidia_key");
    await bot2.sendMessage(chatId,
      `\u{1F511} *\u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D NVIDIA*\n\n1. \u0627\u0630\u0647\u0628 \u0625\u0644\u0649: https://build.nvidia.com\n2. \u0623\u0646\u0634\u0626 \u062D\u0633\u0627\u0628\u0627\u064B \u0645\u062C\u0627\u0646\u064A\u0627\u064B\n3. \u0627\u0636\u063A\u0637 "API Keys" \u2190 "Create key"\n4. \u0627\u0646\u0633\u062E \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0648\u0623\u0631\u0633\u0644\u0647 \u0647\u0646\u0627\n\n\u26A0\uFE0F \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u064A\u0628\u062F\u0623 \u0628\u0640 \`nvapi-\``,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
    return true;
  }
  if (data === "ai_toggle") {
    const aiEnabled = !user.aiEnabled;
    const { hasNvidiaKey: hasNvidiaKey2 } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    if (aiEnabled && !hasNvidiaKey2(userId)) {
      await bot2.sendMessage(chatId, "\u274C \u0623\u0636\u0641 \u0645\u0641\u062A\u0627\u062D NVIDIA \u0623\u0648\u0644\u0627\u064B \u0645\u0646 \u062E\u064A\u0627\u0631 \u{1F511} \u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D");
      return true;
    }
    saveUser(userId, { aiEnabled });
    const { getUserSelectedModel: getUserSelectedModel2 } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    await bot2.sendMessage(chatId,
      `${aiEnabled ? "\u2705 \u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A" : "\u274C \u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"}`,
      { reply_markup: aiMenuKeyboard(hasNvidiaKey2(userId), aiEnabled) }
    );
    return true;
  }
  if (data === "ai_select_model") {
    const { probeModels, getCachedWorkingModels, getAllModels, hasNvidiaKey: hasKey2 } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    const hasKey = hasKey2(userId);
    let models;
    if (hasKey) {
      const loadMsg = await bot2.sendMessage(chatId, "\u23F3 *\u062C\u0627\u0631\u064A \u0641\u062D\u0635 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0644\u0645\u0641\u062A\u0627\u062D\u0643...*", { parse_mode: "Markdown" });
      try {
        models = await probeModels(userId);
        if (!models || !models.length) models = getCachedWorkingModels(userId);
      } catch {
        models = getCachedWorkingModels(userId);
      }
      await bot2.deleteMessage(chatId, loadMsg.message_id).catch(() => {});
    } else {
      models = getAllModels();
    }
    if (!models || !models.length) models = getAllModels();
    const rows = models.map((m) => [{ text: m.name || m.label || m.id, callback_data: `ai_model_${m.id}` }]);
    rows.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "menu_ai" }]);
    const headerTxt = hasKey
      ? `\u{1F9E0} *\u0627\u062E\u062A\u0631 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A:*\n\n\u2705 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u062A\u0627\u0644\u064A\u0629 \u062A\u0639\u0645\u0644 \u0645\u0639 \u0645\u0641\u062A\u0627\u062D\u0643 (${models.length} \u0646\u0645\u0648\u0630\u062C):`
      : `\u{1F9E0} *\u0627\u062E\u062A\u0631 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A:*\n\n\u26A0\uFE0F \u0623\u0636\u0641 \u0645\u0641\u062A\u0627\u062D NVIDIA \u0644\u0641\u062D\u0635 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u0641\u0639\u0644\u064A\u0629`;
    await bot2.sendMessage(chatId, headerTxt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } });
    return true;
  }
  if (data.startsWith("ai_model_")) {
    const modelId = data.replace("ai_model_", "");
    const { setUserModel: setUserModel2 } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    setUserModel2(userId, modelId);
    await bot2.sendMessage(chatId, `\u2705 \u062A\u0645 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C: ${modelId.split("/")[1] || modelId}`);
    return true;
  }
  if (data === "ai_test") {
    const { hasNvidiaKey: hasNvidiaKey2 } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    if (!hasNvidiaKey2(userId)) { await bot2.sendMessage(chatId, "\u274C \u0623\u0636\u0641 \u0645\u0641\u062A\u0627\u062D NVIDIA \u0623\u0648\u0644\u0627\u064B"); return true; }
    setState(userId, "awaiting_ai_test_msg");
    await bot2.sendMessage(chatId, "\u{1F9EA} *\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A*\n\n\u0623\u0631\u0633\u0644 \u0631\u0633\u0627\u0644\u0629 \u0644\u0623\u0631\u0633\u0644\u0647\u0627 \u0644\u0644\u0646\u0645\u0648\u0630\u062C \u0648\u0623\u0639\u0631\u0636 \u0627\u0644\u0631\u062F:", { parse_mode: "Markdown", reply_markup: cancelKeyboard() });
    return true;
  }
  if (data === "ai_remove_key") {
    const { setUserNvidiaKey: _removeKey } = await Promise.resolve().then(() => (init_ai_manager(), ai_manager_exports));
    _removeKey(userId, null);
    saveUser(userId, { aiEnabled: false });
    await bot2.sendMessage(chatId, "\u2705 \u062A\u0645 \u062D\u0630\u0641 \u0645\u0641\u062A\u0627\u062D NVIDIA. \u0633\u064A\u062A\u0648\u0642\u0641 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A.");
    return true;
  }
  if (data === "ai_stats") {
    const aiStats = user.aiStats || { requests: 0, tokens: 0 };
    await bot2.sendMessage(chatId, `\u{1F4CA} *\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A*\n\n\u{1F522} \u0627\u0644\u0637\u0644\u0628\u0627\u062A: ${aiStats.requests || 0}\n\u{1F4DD} \u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629: ${(aiStats.tokens || 0).toLocaleString()}`, { parse_mode: "Markdown" });
    return true;
  }
  if (data === "ai_prompt") {
    setState(userId, "awaiting_ai_system_prompt");
    const currentPrompt = user.aiSystemPrompt || "";
    await bot2.sendMessage(chatId,
      `\u{1F4DD} *\u062A\u0639\u062F\u064A\u0644 System Prompt*\n\n\u0627\u0644\u062D\u0627\u0644\u064A:\n"${currentPrompt || "\u0644\u0645 \u064A\u064F\u0639\u064A\u064E\u0651\u0646 \u2014 \u0633\u064A\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0628\u0631\u0648\u0645\u062A \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A"}"\n\n\u0623\u0631\u0633\u0644 \u0627\u0644\u0628\u0631\u0648\u0645\u062A \u0627\u0644\u062C\u062F\u064A\u062F:`,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
    return true;
  }
  return false;
}
