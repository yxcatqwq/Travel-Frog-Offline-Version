# C01-C17 Activity Compatibility Layer

Updated 2026-09-11.

`tools/local_service/63_activities.js` stores visit, story, moment, easter egg, touch, wishing pool, lottery, animated picture, museum, recharge, cooking, capsule, greeting cards, spring cards, party cake, museum day, and prayer states in `state.activities`. Their load and write protocol handlers run inside local transactions and preserve unknown fields, so activity screens receive stable payloads offline.

C14 calendar additionally supports natural-day rollover, task progress, notes, local sign-in rewards, and one-time claims. C17 wishing pool supports local expiry checks, coin spending, configured rewards, and request de-duplication. Exact activity periods, lottery probabilities, synthesis recipes, and reward tables remain to be implemented item by item; this compatibility layer does not fabricate online rewards.
