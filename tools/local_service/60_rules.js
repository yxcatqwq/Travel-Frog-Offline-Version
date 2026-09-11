    /* ------------------------------------------------------------------
     * 60 结算规则层 (B02/B04/B05)
     *
     * 所有函数都操作“被提交的副本 work”，返回：
     *   {ok, code, changed, effects}
     * effects 描述需要推送哪些“绝对值”更新，由 server 模块转成推送，
     * 保证客户端展示的数据永远等于权威状态，且重复推送无副作用。
     * ------------------------------------------------------------------ */
    var rules = LF.rules = {};

    rules.define = function () {
        try {
            return Tabikaeru.Define;
        } catch (error) {
            return null;
        }
    };

    rules.itemTypes = function () {
        try {
            return Tabikaeru.DataType.ItemType;
        } catch (error) {
            return null;
        }
    };

    rules.resourceTypes = function () {
        try {
            return Tabikaeru.DataType.ItemResourceType;
        } catch (error) {
            return null;
        }
    };

    rules.itemInfo = function (itemId) {
        return config.get("ItemDB", itemId);
    };

    rules.effect = function (effects, key, value) {
        if (key === "items") {
            effects.items = effects.items || [];
            if (value !== undefined && effects.items.indexOf(value) < 0) {
                effects.items.push(value);
            }
            return;
        }
        effects[key] = value === undefined ? true : value;
    };

    /* ---------------- 钱包 ---------------- */
    var wallet = rules.wallet = {};

    wallet.grant = function (work, amount, effects) {
        if (!wallet.valid(amount)) { return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "amount"}; }
        var changed = {};
        if (amount.clover) {
            work.wallet.clover = Math.max(0, work.wallet.clover + amount.clover);
            changed.clover = work.wallet.clover;
            rules.effect(effects, "wallet");
        }
        if (amount.ticket) {
            work.wallet.ticket = Math.max(0, work.wallet.ticket + amount.ticket);
            changed.ticket = work.wallet.ticket;
            rules.effect(effects, "ticket");
        }
        return {ok: true, code: LF.ERR.OK, changed: changed};
    };

    wallet.consume = function (work, amount, effects) {
        if (!wallet.valid(amount)) { return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "amount"}; }
        if ((amount.clover || 0) > work.wallet.clover) {
            return {ok: false, code: LF.ERR.NO_RESOURCE, reason: "clover"};
        }
        if ((amount.ticket || 0) > work.wallet.ticket) {
            return {ok: false, code: LF.ERR.NO_RESOURCE, reason: "ticket"};
        }
        if (amount.clover) {
            work.wallet.clover -= amount.clover;
            rules.effect(effects, "wallet");
        }
        if (amount.ticket) {
            work.wallet.ticket -= amount.ticket;
            rules.effect(effects, "ticket");
        }
        return {ok: true, code: LF.ERR.OK};
    };

    wallet.valid = function (amount) {
        return ["clover", "ticket"].every(function (key) {
            var value = amount[key];
            return value === undefined || (typeof value === "number" && isFinite(value) && value >= 0 && Math.floor(value) === value);
        });
    };

    /* ---------------- 库存 ---------------- */
    var items = rules.items = {};

    items.count = function (work, itemId) {
        return util.toInt(work.items.house[itemId], 0);
    };

    items.ownedCount = function (work, itemId) {
        var count = items.count(work, itemId);
        [work.items.bag, work.items.desk, work.furniture.bench, work.compost.box_list].forEach(function (slots) {
            slots.forEach(function (id) { if (id === itemId) { count++; } });
        });
        return count;
    };

    /**
     * 入库。资源类物品（三叶草/兑换券）按客户端 doAddHouseItem 的分流规则处理，
     * 不走 item_update（否则客户端会去访问尚未装载的 P2 Model 数据）。
     */
    items.add = function (work, itemId, count, effects) {
        var amount = util.toInt(count, 0);
        if (amount <= 0) {
            return {ok: true, code: LF.ERR.OK, noop: true};
        }
        var info = rules.itemInfo(itemId);
        if (!info) {
            /* 未知物品：不假装成功，也不写入无法展示的 ID */
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-item:" + itemId};
        }
        var itemTypes = rules.itemTypes();
        var resourceTypes = rules.resourceTypes();
        if (itemTypes && info.type === itemTypes.RESOURCE && resourceTypes) {
            if (info.sub_type === resourceTypes.CLOVER) {
                return wallet.grant(work, {clover: amount}, effects);
            }
            if (info.sub_type === resourceTypes.TICKET) {
                return wallet.grant(work, {ticket: amount}, effects);
            }
            /* 指南针/水/置换券：M1 先存权威值，等待对应玩法本地化（M2/D02） */
            work.items.resourceExtras = work.items.resourceExtras || {};
            work.items.resourceExtras[info.sub_type] =
                util.toInt(work.items.resourceExtras[info.sub_type], 0) + amount;
            return {
                ok: true,
                code: LF.ERR.OK,
                deferred: true,
                changed: {resource: info.sub_type, count: work.items.resourceExtras[info.sub_type]}
            };
        }
        var max = rules.define() ? rules.define().HaveItemMax : 99;
        var total = items.count(work, itemId) + amount;
        if (total > max) {
            total = max;
        }
        work.items.house[itemId] = total;
        rules.effect(effects, "items", itemId);
        return {ok: true, code: LF.ERR.OK, changed: {itemId: itemId, count: total}};
    };

    items.consume = function (work, itemId, count, effects) {
        var amount = util.toInt(count, 0);
        if (amount <= 0) {
            return {ok: true, code: LF.ERR.OK, noop: true};
        }
        var info = rules.itemInfo(itemId);
        var itemTypes = rules.itemTypes();
        var resourceTypes = rules.resourceTypes();
        if (info && itemTypes && info.type === itemTypes.RESOURCE && resourceTypes) {
            if (info.sub_type === resourceTypes.CLOVER) {
                return wallet.consume(work, {clover: amount}, effects);
            }
            if (info.sub_type === resourceTypes.TICKET) {
                return wallet.consume(work, {ticket: amount}, effects);
            }
            var extras = util.toInt((work.items.resourceExtras || {})[info.sub_type], 0);
            if (extras < amount) {
                return {ok: false, code: LF.ERR.NO_ITEM, reason: "resource:" + info.sub_type};
            }
            work.items.resourceExtras[info.sub_type] = extras - amount;
            return {ok: true, code: LF.ERR.OK};
        }
        var current = items.count(work, itemId);
        if (current < amount) {
            return {ok: false, code: LF.ERR.NO_ITEM, reason: "item:" + itemId};
        }
        var left = current - amount;
        if (left > 0) {
            work.items.house[itemId] = left;
        } else {
            delete work.items.house[itemId];
        }
        rules.effect(effects, "items", itemId);
        return {ok: true, code: LF.ERR.OK, changed: {itemId: itemId, count: left}};
    };

    /** 按协议 item_update 的语义把数量设为绝对值。 */
    items.setCount = function (work, itemId, count, effects) {
        var target = util.toInt(count, 0);
        var current = items.count(work, itemId);
        if (target === current) {
            return {ok: true, code: LF.ERR.OK, noop: true};
        }
        if (target > current) {
            return items.add(work, itemId, target - current, effects);
        }
        return items.consume(work, itemId, current - target, effects);
    };

    /* ---------------- 行囊 / 桌子 (B05) ---------------- */
    var container = rules.container = {};

    container.KEY = {bag: "bag", desk: "desk"};

    container.slots = function (work, kind) {
        return kind === container.KEY.bag ? work.items.bag : work.items.desk;
    };

    container.inOther = function (work, kind, itemId) {
        var other = kind === container.KEY.bag ? work.items.desk : work.items.bag;
        return util.toArray(other).indexOf(itemId) >= 0;
    };

    container.putIn = function (work, kind, pos, itemId, effects) {
        var list = container.slots(work, kind);
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index >= list.length) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "pos"};
        }
        if (util.toInt(itemId, -1) < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "item"};
        }
        if (!rules.itemInfo(itemId)) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-item:" + itemId};
        }
        var types = rules.itemTypes();
        var expected = kind === "bag" ? [types.LunchBox, types.Amulet, types.Tools, types.Tools]
            : [types.LunchBox, types.LunchBox, types.Amulet, types.Amulet, types.Tools, types.Tools, types.Tools, types.Tools];
        if (rules.itemInfo(itemId).type !== expected[index]) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "slot-type"};
        }
        if (kind === "bag" && work.role.frogStatus === 1) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "frog-away"};
        }
        if (util.toInt(list[index], -1) === itemId) {
            return {ok: true, code: LF.ERR.OK, noop: true};
        }
        if (items.count(work, itemId) < 1) {
            return {ok: false, code: LF.ERR.NO_ITEM, reason: "not-owned:" + itemId};
        }
        if (container.inOther(work, kind, itemId)) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "in-other-container"};
        }
        var previous = util.toInt(list[index], -1);
        if (previous === itemId) {
            return {ok: true, code: LF.ERR.OK, noop: true, changed: {pos: pos}};
        }
        if (previous >= 0) {
            var back = items.add(work, previous, 1, effects);
            if (!back.ok) {
                return back;
            }
        }
        var taken = items.consume(work, itemId, 1, effects);
        if (!taken.ok) {
            return taken;
        }
        list[index] = itemId;
        rules.effect(effects, "container");
        return {ok: true, code: LF.ERR.OK, changed: {pos: pos, itemId: itemId}};
    };

    container.takeOut = function (work, kind, pos, effects) {
        if (kind === "bag" && work.role.frogStatus === 1) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "frog-away"};
        }
        var list = container.slots(work, kind);
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index >= list.length) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "pos"};
        }
        var current = util.toInt(list[index], -1);
        if (current < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "empty-slot"};
        }
        var back = items.add(work, current, 1, effects);
        if (!back.ok) {
            return back;
        }
        list[index] = -1;
        rules.effect(effects, "container");
        return {ok: true, code: LF.ERR.OK, changed: {pos: pos, itemId: current}};
    };

    container.setCompleted = function (work, completed, effects) {
        work.items.bagCompleted = !!completed;
        rules.effect(effects, "container");
        return {ok: true, code: LF.ERR.OK, changed: {completed: work.items.bagCompleted}};
    };

    /* ---------------- 工作台 (B09) ---------------- */
    var bench = rules.bench = {};

    bench.slotKind = function (pos) {
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index > 9) {
            return null;
        }
        return index < 5 ? "tool" : "material";
    };

    bench.isOpen = function (work) {
        return work.furniture.shop.start_time > 0;
    };

    bench.accepts = function (kind, itemId) {
        var info = rules.itemInfo(itemId);
        var itemTypes = rules.itemTypes();
        if (!info || !itemTypes) {
            return false;
        }
        if (kind === "tool") {
            return info.type === itemTypes.FURNITURE_TOOL;
        }
        if (kind === "material") {
            return info.type === itemTypes.FURNITURE_ITEM;
        }
        return false;
    };

    bench.putIn = function (work, pos, itemId, effects) {
        if (!bench.isOpen(work)) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "bench-locked"};
        }
        if (work.furniture.bench_lock) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "bench-locked-flag"};
        }
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index > 9) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "pos"};
        }
        var kind = bench.slotKind(pos);
        if (!bench.accepts(kind, itemId)) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "slot-type:" + kind};
        }
        if (items.count(work, itemId) < 1) {
            return {ok: false, code: LF.ERR.NO_ITEM, reason: "not-owned:" + itemId};
        }
        var previous = util.toInt(work.furniture.bench[index], -1);
        if (previous === itemId) {
            return {ok: true, code: LF.ERR.OK, noop: true};
        }
        if (previous >= 0) {
            var back = items.add(work, previous, 1, effects);
            if (!back.ok) {
                return back;
            }
        }
        var taken = items.consume(work, itemId, 1, effects);
        if (!taken.ok) {
            return taken;
        }
        work.furniture.bench[index] = itemId;
        rules.effect(effects, "bench");
        rules.effect(effects, "items", itemId);
        return {ok: true, code: LF.ERR.OK, changed: {pos: pos, itemId: itemId}};
    };

    bench.takeOut = function (work, pos, effects) {
        if (!bench.isOpen(work) || work.furniture.bench_lock) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "bench-locked"};
        }
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index > 9) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "pos"};
        }
        var current = util.toInt(work.furniture.bench[index], -1);
        if (current < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "empty-slot"};
        }
        var back = items.add(work, current, 1, effects);
        if (!back.ok) {
            return back;
        }
        work.furniture.bench[index] = -1;
        rules.effect(effects, "bench");
        rules.effect(effects, "items", current);
        return {ok: true, code: LF.ERR.OK, changed: {pos: pos, itemId: current}};
    };

    /* ---------------- 堆肥箱 (B10，M1 只做状态/放取) ---------------- */
    var compost = rules.compost = {};

    compost.putIn = function (work, pos, itemId, effects) {
        if (!compost.isOpen(work)) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "compost-unavailable"}; }
        var info = rules.itemInfo(itemId), types = rules.itemTypes();
        if (!info || !(info.type === types.Specialty || (info.type === types.Courtyard && info.sub_type === 1))) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "compost-item-type"};
        }
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index > 5) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "pos"};
        }
        if (work.compost.box_index > 0 && work.compost.box_index === pos) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "slot-locked"};
        }
        if (items.count(work, itemId) < 1) {
            return {ok: false, code: LF.ERR.NO_ITEM, reason: "not-owned:" + itemId};
        }
        var previous = util.toInt(work.compost.box_list[index], -1);
        if (previous === itemId) {
            return {ok: true, code: LF.ERR.OK, noop: true};
        }
        if (previous >= 0) {
            var back = items.add(work, previous, 1, effects);
            if (!back.ok) {
                return back;
            }
        }
        var taken = items.consume(work, itemId, 1, effects);
        if (!taken.ok) {
            return taken;
        }
        work.compost.box_list[index] = itemId;
        rules.effect(effects, "compost");
        rules.effect(effects, "items", itemId);
        return {ok: true, code: LF.ERR.OK, changed: {pos: pos, itemId: itemId}};
    };

    compost.takeOut = function (work, pos, effects) {
        if (!compost.isOpen(work)) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "compost-unavailable"}; }
        var index = util.toInt(pos, 0) - 1;
        if (index < 0 || index > 5) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "pos"};
        }
        if (work.compost.box_index > 0 && work.compost.box_index === pos) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "slot-locked"};
        }
        var current = util.toInt(work.compost.box_list[index], -1);
        if (current < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "empty-slot"};
        }
        var back = items.add(work, current, 1, effects);
        if (!back.ok) {
            return back;
        }
        work.compost.box_list[index] = -1;
        rules.effect(effects, "compost");
        rules.effect(effects, "items", current);
        return {ok: true, code: LF.ERR.OK, changed: {pos: pos, itemId: current}};
    };

    compost.replace = function (work, index, effects) {
        var list = util.toArray(work.compost.compost_list);
        var target = util.toInt(index, 0);
        if (target <= 0 || target > list.length) {
            work.compost.replace_index = 0;
            rules.effect(effects, "compost");
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "not-owned", ret: 1};
        }
        work.compost.replace_index = target;
        work.compost.show_index = target;
        rules.effect(effects, "compost");
        return {ok: true, code: LF.ERR.OK};
    };

    compost.isOpen = function (work) {
        return work.compost.show_index > 0 && !!work.compost.compost_list[work.compost.show_index - 1];
    };
    compost.start = function (work, effects, params) {
        if (!compost.isOpen(work)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"compost-unavailable"};
        if (work.compost.process && work.compost.process.state === "running") return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"compost-running"};
        var filled=work.compost.box_list.filter(function(id){return util.toInt(id,-1)>=0;}).length;
        if (!filled) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"compost-empty"};
        params = util.isObject(params) ? params : {};
        var now=clock.now();
        /* CompostData may expose a fertility/star speed multiplier. Keep the
         * fallback at the legacy one-hour duration when imported configs do not. */
        var compostId = util.toInt(work.compost.compost_list[work.compost.show_index - 1], -1);
        var definition = config.get("CompostData", compostId) || config.get("compostData", compostId) || {};
        var fertility = util.toInt(params.fertility !== undefined ? params.fertility : (definition.fertility !== undefined ? definition.fertility : (definition.star !== undefined ? definition.star : definition.level)), 1);
        var speed = Number(params.speed_rate !== undefined ? params.speed_rate : (definition.speed_rate !== undefined ? definition.speed_rate : (definition.speedRate !== undefined ? definition.speedRate : 1)));
        if (!(speed > 0)) speed = 1;
        /* A three-star box is explicitly faster; config can override the rate. */
        if (speed === 1 && fertility > 1) speed = 1 + Math.min(2, fertility - 1) * 0.25;
        var duration = Math.max(60, Math.round(3600 / speed));
        work.compost.process={state:"running",started_at:now,finish_at:now+duration,reward_clover:filled*10,fertility:fertility,speed_rate:speed};
        work.compost.state=1; rules.effect(effects,"compost"); return {ok:true,code:LF.ERR.OK,finish_at:now+duration,duration:duration,fertility:fertility};
    };
    compost.collect = function (work, effects) {
        var p=work.compost.process;
        if (!p || (p.state !== "running" && p.state !== "ready") || util.toInt(p.finish_at,0)>clock.now()) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"compost-not-ready"};
        var reward=Math.max(0,util.toInt(p.reward_clover,0)); work.wallet.clover+=reward;
        work.compost.box_list=[-1,-1,-1,-1,-1,-1]; work.compost.process=null; work.compost.state=0;
        rules.effect(effects,"compost"); rules.effect(effects,"wallet"); if(rules.tasks&&rules.tasks.update)rules.tasks.update(work,"compost_collect",1,effects); return {ok:true,code:LF.ERR.OK,reward_clover:reward};
    };

    /* ---------------- 商店与抽奖 (B04) ---------------- */
    var shop = rules.shop = {};

    shop.buy = function (work, shopId, effects) {
        var entry = config.get("ShopDataDB", shopId);
        if (!entry) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-shop:" + shopId};
        }
        var limit = util.toInt(entry.limit, 0);
        var bought = util.toInt(work.items.purchased[shopId], 0);
        if (limit > 0 && bought >= limit) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "limit"};
        }
        var price = util.toInt(entry.price, 0);
        if (price > work.wallet.clover) {
            return {ok: false, code: LF.ERR.NO_RESOURCE, reason: "clover"};
        }
        var payload = util.toInt(entry.itemId, -1);
        if (payload === 9000 && rules.album) {
            var expanded = rules.album.expand(work, {pages: 1}, effects);
            if (!expanded.ok) { return expanded; }
            work.items.purchased[shopId] = bought + 1;
            rules.effect(effects, "shop");
            return {ok: true, code: LF.ERR.OK, changed: {shopId: shopId, itemId: payload, price: price, capacity: expanded.changed.capacity}};
        }
        var info = payload >= 0 ? rules.itemInfo(payload) : null;
        if (payload >= 0 && !info) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-item:" + payload};
        }
        var need = info ? util.toInt(info.own_num, 0) : 0;
        if (need > 0 && items.ownedCount(work, payload) + 1 > need) {
            return {ok: false, code: LF.ERR.NO_SPACE, reason: "own-num"};
        }
        var paid = wallet.consume(work, {clover: price}, effects);
        if (!paid.ok) {
            return paid;
        }
        if (payload >= 0) {
            var added = items.add(work, payload, 1, effects);
            if (!added.ok) {
                return added;
            }
        }
        work.items.purchased[shopId] = bought + 1;
        rules.effect(effects, "shop");
        return {ok: true, code: LF.ERR.OK, changed: {shopId: shopId, itemId: payload, price: price}};
    };

    var gacha = rules.gacha = {};

    gacha.ranks = function () {
        var define = rules.define();
        var weights = define ? define.PrizeBalls : null;
        if (!weights) {
            return [];
        }
        var list = [];
        for (var rank in weights) {
            if (!util.has(weights, rank)) {
                continue;
            }
            var numeric = Number(rank);
            if (isNaN(numeric) || numeric < 0) {
                continue;
            }
            list.push({rank: numeric, weight: Number(weights[rank])});
        }
        list.sort(function (a, b) {
            return a.rank - b.rank;
        });
        return list;
    };

    gacha.roll = function (work, effects) {
        if (work.items.gacha.pending && !work.items.gacha.pending.settled) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unclaimed-prize"};
        }
        var cost = rules.define() ? rules.define().RAFFEL_NEEDTICKETS : 5;
        var paid = wallet.consume(work, {ticket: cost}, effects);
        if (!paid.ok) {
            return paid;
        }
        var candidates = gacha.ranks();
        if (candidates.length === 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "no-prize-config"};
        }
        var total = 0;
        for (var index = 0; index < candidates.length; index++) {
            total += candidates[index].weight;
        }
        var point = rng.range(0, total);
        var picked = candidates[candidates.length - 1].rank;
        var acc = 0;
        for (var c = 0; c < candidates.length; c++) {
            acc += candidates[c].weight;
            if (point <= acc) {
                picked = candidates[c].rank;
                break;
            }
        }
        var prizeIds = gacha.prizesOfRank(picked);
        work.items.gacha.color_ball = picked;
        work.items.gacha.pending = {
            rank: picked,
            prizes: prizeIds,
            at: clock.now(),
            settled: false
        };
        rules.effect(effects, "gacha");
        return {
            ok: true,
            code: LF.ERR.OK,
            changed: {rank: picked, prizes: prizeIds, cost: cost},
            response: {ticket: picked}
        };
    };

    gacha.prizesOfRank = function (rank) {
        return config.filterIds("PrizeDB", function (prize) {
            return util.toInt(prize.rank, -1) === rank;
        });
    };

    gacha.redeem = function (work, prizeId, effects) {
        var prize = config.get("PrizeDB", prizeId);
        if (!prize) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-prize:" + prizeId};
        }
        var pending = work.items.gacha.pending;
        if (!pending || pending.settled) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "no-pending-draw"};
        }
        if (pending.prizes.indexOf(util.toInt(prizeId, -1)) < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "prize-not-rolled:" + prizeId};
        }
        var itemId = util.toInt(prize.itemId, -1);
        var stock = util.toInt(prize.stock, 1);
        var added = items.add(work, itemId, stock, effects);
        if (!added.ok) {
            return added;
        }
        pending.settled = true;
        pending.settledAt = clock.now();
        pending.redeemed = prizeId;
        work.items.gacha.color_ball = -1;
        rules.effect(effects, "gacha");
        return {ok: true, code: LF.ERR.OK, changed: {prizeId: prizeId, itemId: itemId, count: stock}};
    };
