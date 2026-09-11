# Local implementation progress

Updated 2026-09-12.

The local service now covers the core save/restore path, clover field, pocket, compost, flowerpot, workbench, travel, album, gift box, mail, visitors, stories, prayer, cooking, capsule, calendar, wishing pool, touch/moments, dynamic pictures, encyclopedia, museum exploration, party cake, greeting cards, spring cards, and selection lottery protocols.

`tools/test-local-service.cjs` currently has 74 regression tests. They cover atomic writes, restart recovery, offline scheduler catch-up, duplicate requests, capacity boundaries, activity stage transitions, cross-container photo movement, travel specialty settlement, lucky-clover photo selection, flowerpot seed returns, and compost fertility timing.

Mechanism reference: `docs/旅行青蛙游戏机制完整整理.md`. Museum, flowerpot, compost, and lucky-clover behavior should follow that reference when reward tables and item mappings are available. Unknown reward IDs remain data-driven so imported saves are not silently rewritten.

Remaining work includes exact online reward tables and probabilities, weather effects on travel and plants, full party/card task tables, and online account snapshot import/export validation.
