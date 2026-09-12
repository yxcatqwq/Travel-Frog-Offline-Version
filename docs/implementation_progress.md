# Local implementation progress

Updated 2026-09-12.

The local service now covers the core save/restore path, clover field, pocket, compost, flowerpot, workbench, travel, album, gift box, mail, visitors, stories, prayer, cooking, capsule, calendar, wishing pool, touch/moments, dynamic pictures, encyclopedia, museum exploration, party cake, greeting cards, spring cards, and selection lottery protocols.

`tools/test-local-service.cjs` currently has 79 regression tests. They cover atomic writes, restart recovery, offline scheduler catch-up, duplicate requests, capacity boundaries, activity stage transitions, cross-container photo movement, travel specialty settlement, lucky-clover photo selection, flowerpot seed returns, compost fertility timing, local recharge entitlements, tutorial completion, task aliases, gift selection, gift-box transfers, and client-shaped activity loads.

Mechanism reference: `docs/旅行青蛙游戏机制完整整理.md`. Museum, flowerpot, compost, and lucky-clover behavior should follow that reference when reward tables and item mappings are available. Unknown reward IDs remain data-driven so imported saves are not silently rewritten.

Recharge entitlement state and deterministic local exchange handlers are now available; payment provider calls remain intentionally outside the offline save. Hall reconnect, tutorial steps, task reward aliases, clover notice, item gift selection, bag-to-gift transfers, and client-shaped activity loads are also local. Remaining work includes exact online reward tables and probabilities, weather effects on travel and plants, full party/card task tables, and online account snapshot import/export validation.
