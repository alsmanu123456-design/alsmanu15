// dist/handlers/forward-hook.mjs
// Phase 7: Forward Hook — مُستخرَج من dist/index.mjs
// [PATCH_PHASE7_FORWARD_HOOK_EXTRACTED]
//
// الواجهة:
//   register(dispatcherMod) — يُسجَّل prefix 'fw_' في الـ Dispatcher
//
// يُفوّض جميع callbacks التي تبدأ بـ fw_ إلى forward.mjs::handleForwardCallback

export function register(dispatcherMod) {
  dispatcherMod.registerPrefix('fw_', async (_data, _bot, _query) => {
    const { handleForwardCallback: _hfc } = await import('../forward.mjs');
    await _hfc(_query).catch(() => false);
  });
}
