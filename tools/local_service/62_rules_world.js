    /* ------------------------------------------------------------------
     * 62 草田 / 家具 / 天气 / 角色设置规则
     * ------------------------------------------------------------------ */

    /* ---------------- 草田 (B03，M1 负责状态恢复与收割一致性) ---------------- */
    var clover = rules.clover = {};

    /**
     * 草位是否可收割。
     *
     * 客户端 CloverFarm.initData 的判定是
     *   !(last_harvest == -1 || (last_harvest > 0 && last_harvest + rebirth_span > now))
     * 即：last_harvest <= 0（未采过，客户端用 -1 表示“刚采完待确认”）或已过再生期才算成熟；
     * 生长中的草位是 last_harvest > 0 且还没到再生时间。
     */
    clover.ready = function (slot, now) {
        if (!slot) {
            return false;
        }
        var last = util.toInt(slot.last_harvest, 0);
        if (last === -1) { return false; }
        if (last <= 0) {
            return true;
        }
        return last + util.toInt(slot.rebirth_span, LF.RULES.CLOVER_REBIRTH_MU) <= now;
    };

    clover.find = function (work, cloverId) {
        var slots = work.clover.slots;
        for (var index = 0; index < slots.length; index++) {
            if (util.toInt(slots[index].clover_id, -1) === util.toInt(cloverId, -1)) {
                return slots[index];
            }
        }
        return null;
    };

    /** 收割：一次只结算一次，成功后立刻进入下一轮生长。 */
    clover.harvest = function (work, cloverId, effects) {
        var now = clock.now();
        var slot = clover.find(work, cloverId);
        if (!slot) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "unknown-clover:" + cloverId};
        }
        if (!clover.ready(slot, now)) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "not-mature"};
        }
        var awards = [];
        var element = util.toInt(slot.element, 0);
        var sprite = util.toInt(slot.sprite, 1);
        var fourLeafId = rules.define() ? rules.define().FourLeafCloverID : 1000;
        var result;
        if (element === 0) {
            result = rules.wallet.grant(work, {clover: 1}, effects);
            awards.push({clover: 1});
        } else if (element === 1) {
            result = rules.items.add(work, fourLeafId, 1, effects);
            awards.push({itemId: fourLeafId, count: 1});
        } else if (element === 2) {
            result = rules.items.add(work, sprite, 1, effects);
            awards.push({itemId: sprite, count: 1});
        } else {
            result = {ok: true, code: LF.ERR.OK, deferred: true};
        }
        if (!result.ok) {
            return result;
        }
        slot.last_harvest = now;
        slot.rebirth_span = rng.normalClamped(
            LF.RULES.CLOVER_REBIRTH_MU,
            LF.RULES.CLOVER_REBIRTH_SIGMA,
            LF.RULES.CLOVER_REBIRTH_MIN,
            LF.RULES.CLOVER_REBIRTH_MAX);
        rules.effect(effects, "clover");
        return {
            ok: true,
            code: LF.ERR.OK,
            changed: {cloverId: cloverId, awards: awards, rebirthSpan: slot.rebirth_span}
        };
    };

    /** 成熟推进：离线关闭期间成熟的草位在重进时补齐。 */
    clover.mature = function (work, effects) {
        var now = clock.now();
        var matured = 0;
        for (var index = 0; index < work.clover.slots.length; index++) {
            var slot = work.clover.slots[index];
            if (slot.last_harvest > 0 && slot.last_harvest + slot.rebirth_span <= now) {
                clover.grow(slot, index);
                matured++;
            }
        }
        if (matured > 0) {
            rules.effect(effects, "clover");
        }
        return {ok: true, code: LF.ERR.OK, matured: matured};
    };

    /**
     * 生成下一次收割物。规则来源：客户端 CloverFarm 常量
     * (clover_mu/clover_sigma/cloverSpanMin/cloverSpanMax/fourLeaf_percent)。
     * element: 0 三叶草, 1 四叶草, 2 花(由草田产出的特殊产物)。
     */
    clover.grow = function (slot, index) {
        var fourLeafId = rules.define() ? rules.define().FourLeafCloverID : 1000;
        if (rng.chance(LF.RULES.CLOVER_FOUR_LEAF_PERCENT)) {
            slot.element = 1;
            slot.sprite = 1;
            slot.preview = fourLeafId;
        } else {
            slot.element = 0;
            slot.sprite = rng.chance(20) ? 2 : 1;
        }
        /* 0 = 已成熟待收割（客户端会渲染出来） */
        slot.last_harvest = 0;
        slot.clover_id = util.toInt(slot.clover_id, index + 1);
        return slot;
    };

    clover.snapshot = function (work) {
        var list = [];
        for (var index = 0; index < work.clover.slots.length; index++) {
            var slot = work.clover.slots[index];
            list.push({
                clover_id: util.toInt(slot.clover_id, index + 1),
                element: util.toInt(slot.element, 0),
                sprite: util.toInt(slot.sprite, 1),
                last_harvest: util.toInt(slot.last_harvest, -1),
                rebirth_span: util.toInt(slot.rebirth_span, LF.RULES.CLOVER_REBIRTH_MU)
            });
        }
        return list;
    };

    /* ---------------- 家具 / 工作台 / 商人 (B09) ---------------- */
    var furniture = rules.furniture = {};

    furniture.buyShop = function (work, shopId, effects) {
        var now = clock.now();
        if (work.furniture.shop.start_time <= 0 || work.furniture.shop.start_time > now || work.furniture.shop.leave_time <= now) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "shop-closed"};
        }
        var entry = config.get("FurnitureShopDB", shopId);
        if (!entry) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-furniture-shop:" + shopId};
        }
        var slot = null;
        var list = util.toArray(work.furniture.shop.shop_list);
        for (var index = 0; index < list.length; index++) {
            if (util.toInt(list[index].shop_id, -1) === util.toInt(shopId, -1)) {
                slot = list[index];
                break;
            }
        }
        if (!slot) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "not-on-shelf"}; }
        if (util.toInt(slot.num, 0) <= 0) {
            return {ok: false, code: LF.ERR.NO_SPACE, reason: "sold-out"};
        }
        var price = util.toInt(entry.price, 0);
        var itemId = util.toInt(entry.item_id, -1);
        if (itemId < 0 || !rules.itemInfo(itemId)) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-item:" + itemId};
        }
        var paid = rules.wallet.consume(work, {clover: price}, effects);
        if (!paid.ok) {
            return paid;
        }
        var added = rules.items.add(work, itemId, 1, effects);
        if (!added.ok) {
            return added;
        }
        if (slot) {
            slot.num = util.toInt(slot.num, 0) - 1;
        }
        var info = rules.itemInfo(itemId);
        var itemTypes = rules.itemTypes();
        if (itemTypes && info.type === itemTypes.Furniture) {
            /* 家具本体进入拥有清单 */
            if (util.toArray(work.furniture.has_fur).indexOf(itemId) < 0) {
                work.furniture.has_fur.push(itemId);
            }
        }
        rules.effect(effects, "furniture");
        rules.effect(effects, "items", itemId);
        return {ok: true, code: LF.ERR.OK, changed: {shopId: shopId, itemId: itemId, price: price}};
    };

    furniture.furnitureType = function (id) {
        var entry = config.get("FurnitureDB", id);
        return entry ? util.toInt(entry.type, -1) : -1;
    };

    furniture.replaceFur = function (work, id, effects) {
        var target = util.toInt(id, -1);
        var owned = util.toArray(work.furniture.has_fur);
        if (target < 0 || owned.indexOf(target) < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "not-owned:" + id, ret: 1};
        }
        var type = furniture.furnitureType(target);
        if (type < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "unknown-furniture:" + id, ret: 1};
        }
        var put = util.toArray(work.furniture.put_fur);
        for (var index = put.length - 1; index >= 0; index--) {
            if (util.toInt(put[index].type, -1) === type) {
                put.splice(index, 1);
            }
        }
        put.push({type: type, id: target});
        work.furniture.put_fur = put;
        var replaced = util.toArray(work.furniture.replace_fur);
        var at = replaced.indexOf(type);
        if (at >= 0) {
            replaced.splice(at, 1);
        }
        work.furniture.replace_fur = replaced;
        rules.effect(effects, "furniture");
        return {ok: true, code: LF.ERR.OK, changed: {id: target, type: type}};
    };

    furniture.replaceOf = function (work, kind, index, effects) {
        var target = util.toInt(index, 0);
        var list;
        if (kind === "tumbler") {
            list = util.toArray(work.tumbler.tumbler_list);
        } else if (kind === "pocket") {
            list = util.toArray(work.pocket.list);
        } else {
            list = util.toArray(work.compost.compost_list);
        }
        var holder = kind === "tumbler" ? work.tumbler : (kind === "pocket" ? work.pocket : work.compost);
        if (target <= 0 || target > list.length) {
            holder.replace_index = 0;
            rules.effect(effects, kind);
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "not-owned", ret: 1};
        }
        holder.replace_index = target;
        holder.show_index = target;
        rules.effect(effects, kind);
        return {ok: true, code: LF.ERR.OK, changed: {kind: kind, index: target}};
    };

    furniture.pocketGet = function (work, effects) {
        var amount = util.toInt(work.pocket.clover, 0);
        if (amount <= 0) {
            return {ok: false, code: LF.ERR.NO_RESOURCE, reason: "empty"};
        }
        var granted = rules.wallet.grant(work, {clover: amount}, effects);
        if (!granted.ok) {
            return granted;
        }
        work.pocket.clover = 0;
        work.pocket.lastAccrual = clock.now();
        rules.effect(effects, "pocket");
        return {ok: true, code: LF.ERR.OK, changed: {clover: amount}};
    };

    /**
     * 口袋积累。本地规则（待与实机核对）：每 30 分钟 +1，上限取 pocketCommonData.base_info。
     * 计量从 lastAccrual 起算，离线照常累计。
     */
    furniture.pocketAccrue = function (work, effects) {
        var cap = util.toInt(config.get("pocketCommonData", "base_info"), 50);
        if (!cap) {
            cap = 50;
        }
        var now = clock.now();
        var last = util.toInt(work.pocket.lastAccrual, now);
        if (util.toArray(work.pocket.list).length === 0) {
            work.pocket.lastAccrual = now;
            return {ok: true, code: LF.ERR.OK, added: 0};
        }
        if (now <= last) {
            return {ok: true, code: LF.ERR.OK, added: 0};
        }
        var steps = Math.floor((now - last) / 1800);
        if (steps <= 0) {
            return {ok: true, code: LF.ERR.OK, added: 0};
        }
        var before = util.toInt(work.pocket.clover, 0);
        var after = Math.min(cap, before + steps);
        work.pocket.clover = after;
        work.pocket.lastAccrual = last + steps * 1800;
        if (after !== before) {
            rules.effect(effects, "pocket");
        }
        return {ok: true, code: LF.ERR.OK, added: after - before};
    };

    /* 工作台制作：本地服务保存材料扣除与完成时间，离线期间由 scheduler 补算。
     * 配方由调用方传入，方便先兼容不同版本的 FurnitureRecipeDB；正式配置存在时也可只传 recipe_id。 */
    var craft = rules.craft = {};
    craft.ensure = function (work) {
        var value = work.furniture.craft;
        if (!util.isObject(value) || Array.isArray(value)) {
            value = {state: "idle", recipe_id: 0, output_id: 0, output_count: 0, inputs: [], started_at: 0, finish_at: 0};
            work.furniture.craft = value;
        }
        value.state = value.state || "idle";
        value.inputs = util.toArray(value.inputs);
        return value;
    };
    craft.recipe = function (recipeId, params) {
        var row = recipeId ? config.get("FurnitureRecipeDB", recipeId) : null;
        row = row || {};
        var outputId = util.toInt(params.output_id !== undefined ? params.output_id : (row.output_id !== undefined ? row.output_id : row.item_id), -1);
        var outputCount = Math.max(1, util.toInt(params.output_count !== undefined ? params.output_count : (row.output_count !== undefined ? row.output_count : row.count), 1));
        var duration = Math.max(1, util.toInt(params.duration !== undefined ? params.duration : (row.duration !== undefined ? row.duration : row.need_time), 3600));
        var raw = params.inputs !== undefined ? params.inputs : row.inputs;
        var inputs = [];
        if (Array.isArray(raw)) {
            raw.forEach(function (entry) {
                var id = util.toInt(entry && (entry.item_id !== undefined ? entry.item_id : entry.id), -1);
                var count = Math.max(1, util.toInt(entry && (entry.count !== undefined ? entry.count : entry.num), 1));
                if (id >= 0) { inputs.push({item_id: id, count: count}); }
            });
        } else if (util.isObject(raw)) {
            for (var key in raw) if (util.has(raw, key)) inputs.push({item_id: util.toInt(key, -1), count: Math.max(1, util.toInt(raw[key], 1))});
        }
        return {recipe_id: util.toInt(recipeId, 0), output_id: outputId, output_count: outputCount, duration: duration, inputs: inputs};
    };
    craft.start = function (work, params, effects) {
        params = util.isObject(params) ? params : {};
        var active = craft.ensure(work);
        if (!bench.isOpen(work) || work.furniture.bench_lock) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"bench-locked"};
        if (active.state === "running" || active.state === "ready") return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"craft-running"};
        var recipe = craft.recipe(params.recipe_id || params.id, params);
        if (recipe.output_id < 0 || !rules.itemInfo(recipe.output_id)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"unknown-output"};
        for (var i=0; i<recipe.inputs.length; i++) {
            var input = recipe.inputs[i];
            if (input.item_id < 0 || !rules.itemInfo(input.item_id)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"unknown-input:"+input.item_id};
            if (rules.items.count(work, input.item_id) < input.count) return {ok:false, code:LF.ERR.NO_ITEM, reason:"not-owned:"+input.item_id};
        }
        for (var j=0; j<recipe.inputs.length; j++) {
            var consumed = rules.items.consume(work, recipe.inputs[j].item_id, recipe.inputs[j].count, effects);
            if (!consumed.ok) return consumed;
        }
        var now = clock.now();
        work.furniture.craft = {state:"running", recipe_id:recipe.recipe_id, output_id:recipe.output_id, output_count:recipe.output_count,
            inputs:util.clone(recipe.inputs), started_at:now, finish_at:now + recipe.duration};
        rules.effect(effects, "furniture");
        return {ok:true, code:LF.ERR.OK, finish_at:now + recipe.duration, changed:util.clone(work.furniture.craft)};
    };
    craft.finish = function (work, effects, now) {
        var active = craft.ensure(work);
        if (active.state !== "running" || util.toInt(active.finish_at, 0) > now) return {ok:true, code:LF.ERR.OK, skipped:true};
        active.state = "ready";
        rules.effect(effects, "furniture");
        return {ok:true, code:LF.ERR.OK, changed:{ready:true, output_id:active.output_id}};
    };
    craft.collect = function (work, effects) {
        var active = craft.ensure(work);
        if (active.state !== "ready" || util.toInt(active.finish_at, 0) > clock.now()) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"craft-not-ready"};
        var added = rules.items.add(work, active.output_id, active.output_count, effects);
        if (!added.ok) return added;
        var output = {item_id:active.output_id, count:active.output_count};
        work.furniture.craft = {state:"idle", recipe_id:0, output_id:0, output_count:0, inputs:[], started_at:0, finish_at:0};
        if (rules.tasks && rules.tasks.update) rules.tasks.update(work, "furniture_craft", 1, effects);
        rules.effect(effects, "furniture");
        return {ok:true, code:LF.ERR.OK, output:output};
    };

    /* ---------------- 天气 / 季节（M1 只做数据与时间锚点） ---------------- */
    var weather = rules.weather = {};

    weather.season = function (date) {
        var month = date.getMonth() + 1;
        if (month >= 3 && month <= 5) {
            return 1;
        }
        if (month >= 6 && month <= 8) {
            return 2;
        }
        if (month >= 9 && month <= 11) {
            return 3;
        }
        return 4;
    };

    weather.hoursType = function (date) {
        var hour = date.getHours();
        if (hour >= 6 && hour < 17) {
            return 1;
        }
        if (hour >= 17 && hour < 20) {
            return 2;
        }
        if (hour >= 20 || hour < 1) {
            return 3;
        }
        return 4;
    };

    weather.roll = function (work, effects) {
        var now = clock.now();
        var date = new Date(now * 1000);
        var data = work.weather;
        data.anchor = now;
        data.nextAt = now + LF.RULES.WEATHER_CHANGE_SECONDS;
        if (LF.flags.seasonFromClock) {
            data.season = weather.season(date);
            data.hours_type = weather.hoursType(date);
        } else {
            /* M1：保持包内已有季节资源组（季节 3、时段 1），B13 在 M2 打开 */
            data.season = 3;
            data.hours_type = 1;
        }
        var types = [];
        try {
            for (var key in Tabikaeru.Define.WeatherType) {
                if (util.has(Tabikaeru.Define.WeatherType, key)) {
                    types.push(Tabikaeru.Define.WeatherType[key]);
                }
            }
        } catch (error) {
            types = [1];
        }
        data.weather = rng.pick(types.length ? types : [1]);
        rules.effect(effects, "weather");
        return {ok: true, code: LF.ERR.OK, changed: {season: data.season, hours_type: data.hours_type, weather: data.weather}};
    };

    /* ---------------- 角色与设置 (B01) ---------------- */
    var role = rules.role = {};

    role.renameCost = function () {
        return util.toInt(config.get("ShopDataDB", "rename"), 0);
    };

    role.rename = function (work, name, cost, effects) {
        var text = String(name === undefined || name === null ? "" : name);
        if (text.length === 0 || text.length > 5) {
            return {ok: false, code: text.length > 5 ? 32 : 5, reason: "name-length"};
        }
        var payment = util.toInt(cost, 0);
        if (payment > 0) {
            var paid = rules.wallet.consume(work, {clover: payment}, effects);
            if (!paid.ok) {
                return paid;
            }
        }
        work.role.name = text;
        rules.effect(effects, "role");
        return {ok: true, code: LF.ERR.OK, changed: {name: text, cost: payment}};
    };

    role.setIcon = function (work, iconId, effects) {
        work.role.iconID = util.toInt(iconId, 0);
        rules.effect(effects, "role");
        return {ok: true, code: LF.ERR.OK};
    };

    role.setAchieve = function (work, achieveId, effects) {
        var target = util.toInt(achieveId, -1);
        var list = util.toArray(work.role.achieveList);
        if (target >= 0 && list.indexOf(target) < 0) {
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "achieve-not-owned:" + target};
        }
        work.role.useAchieveID = target;
        rules.effect(effects, "role");
        return {ok: true, code: LF.ERR.OK};
    };

    role.setPicture = function (work, pictureId, effects) {
        /* 展示照片只影响角色展示字段；照片实例数据属于 M2/B07 */
        work.role.pictureInfo = work.role.pictureInfo || {};
        work.role.pictureInfo.showId = util.toInt(pictureId, 0);
        rules.effect(effects, "role");
        return {ok: true, code: LF.ERR.OK};
    };

    role.setClient = function (work, clientJson, effects) {
        var parsed;
        try {
            parsed = typeof clientJson === "string" ? JSON.parse(clientJson) : clientJson;
        } catch (error) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "client-json"};
        }
        if (!util.isObject(parsed)) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "client-json"};
        }
        /* 保留未识别键：只覆盖客户端实际提交的字段 */
        for (var key in parsed) {
            if (util.has(parsed, key)) {
                work.settings.client[key] = parsed[key];
            }
        }
        /* 新手流程已完成时，客户端旧缓存不得重新打开家具/旅行商人引导。 */
        if (work.settings.client.guideStep === "Complete") {
            work.settings.client.guideFurniture = 5;
            work.settings.client.guideFurnitureNotice = false;
        }
        return {ok: true, code: LF.ERR.OK, changed: {keys: Object.keys(parsed).length}};
    };

    role.setSwitch = function (work, key, value, effects) {
        if (key === "push") {
            work.settings.push_switch = !!value;
        } else if (key === "rank") {
            work.settings.rank_switch = !!value;
        } else {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "switch:" + key};
        }
        return {ok: true, code: LF.ERR.OK, changed: {key: key, value: !!value}};
    };

    role.changeDecoration = function (work, id, effects) {
        var target = util.toInt(id, -1);
        var list = util.toArray(work.role.decorationList);
        var found = -1;
        for (var index = 0; index < list.length; index++) {
            if (util.toInt(list[index].id, -1) === target) {
                found = index;
                break;
            }
        }
        if (found < 0) {
            return {ok: false, code: LF.ERR.NO_ITEM, reason: "decoration-not-owned:" + id};
        }
        var entry = list[found];
        entry.num = util.toInt(entry.num, 0) - 1;
        if (entry.num <= 0) {
            list.splice(found, 1);
        }
        work.role.decorationList = list;
        work.role.decorationPutID = target;
        work.role.decorationStatus = 1;
        work.decorate.list = util.clone(list);
        work.decorate.put_id = target;
        work.decorate.status = 1;
        rules.effect(effects, "decorate");
        return {ok: true, code: LF.ERR.OK, changed: {id: target}};
    };

    /* ---------------- 钱包/库存推送所需的快照 ---------------- */
    rules.snapshot = {};

    rules.snapshot.items = function (work) {
        var house = [];
        for (var key in work.items.house) {
            if (!util.has(work.items.house, key)) {
                continue;
            }
            house.push({item_id: util.toInt(key, 0), count: util.toInt(work.items.house[key], 0)});
        }
        return {
            house: house,
            bag: util.clone(work.items.bag),
            desk: util.clone(work.items.desk),
            bag_completed: !!work.items.bagCompleted,
            bag_conflict: !!work.items.bagConflict,
            desk_conflict: !!work.items.deskConflict,
            gacha: {color_ball: util.toInt(work.items.gacha.color_ball, -1)}
        };
    };

    rules.snapshot.handbook = function (work) {
        return {
            collections: util.clone(work.items.collections),
            specialtys: util.clone(work.items.specialtys)
        };
    };

    rules.snapshot.shop = function (work) {
        var purchased = [];
        for (var key in work.items.purchased) {
            if (!util.has(work.items.purchased, key)) {
                continue;
            }
            purchased.push({item_id: util.toInt(key, 0), count: util.toInt(work.items.purchased[key], 0)});
        }
        return {purchased: purchased};
    };

    rules.snapshot.furniture = function (work) {
        return {
            shop: {
                start_time: util.toInt(work.furniture.shop.start_time, 0),
                leave_time: util.toInt(work.furniture.shop.leave_time, 0),
                shop_list: util.clone(util.toArray(work.furniture.shop.shop_list))
            },
            mood: util.toInt(work.furniture.mood, 0),
            bench_lock: !!work.furniture.bench_lock,
            bench: util.clone(util.toArray(work.furniture.bench)),
            craft: util.clone(work.furniture.craft || {state:"idle", inputs:[]}),
            put_fur: util.clone(util.toArray(work.furniture.put_fur)),
            has_fur: util.clone(util.toArray(work.furniture.has_fur)),
            mate_list: util.clone(util.toArray(work.furniture.mate_list)),
            replace_fur: util.clone(util.toArray(work.furniture.replace_fur))
        };
    };

    rules.snapshot.tumbler = function (work) {
        return {
            show_index: util.toInt(work.tumbler.show_index, 0),
            replace_index: util.toInt(work.tumbler.replace_index, 0),
            tumbler_list: util.clone(util.toArray(work.tumbler.tumbler_list))
        };
    };

    rules.snapshot.compost = function (work) {
        return {
            show_index: util.toInt(work.compost.show_index, 0),
            replace_index: util.toInt(work.compost.replace_index, 0),
            compost_list: util.clone(util.toArray(work.compost.compost_list)),
            state: util.toInt(work.compost.state, 0),
            box_index: util.toInt(work.compost.box_index, 0),
            box_list: util.clone(util.toArray(work.compost.box_list))
        };
    };

    rules.snapshot.pocket = function (work) {
        return {
            show_index: util.toInt(work.pocket.show_index, 0),
            replace_index: util.toInt(work.pocket.replace_index, 0),
            list: util.clone(util.toArray(work.pocket.list)),
            clover: util.toInt(work.pocket.clover, 0)
        };
    };

    rules.snapshot.flowerpot = function (work) {
        var f = flowerpot.ensure(work);
        return {
            show_list: util.clone(util.toArray(work.flowerpot.show_list)),
            list: util.clone(util.toArray(work.flowerpot.list)),
            plant_list: util.clone(util.toArray(work.flowerpot.plant_list)),
            harvest_count: f.harvest_count,
            harvested: util.clone(f.harvested)
        };
    };
    rules.flowerpot = rules.flowerpot || {};
    var flowerpot = rules.flowerpot;
    flowerpot.ensure = function (work) {
        if (!util.isObject(work.flowerpot)) work.flowerpot = {show_list: [], list: [], plant_list: []};
        if (!Array.isArray(work.flowerpot.show_list)) work.flowerpot.show_list = [];
        if (!Array.isArray(work.flowerpot.list)) work.flowerpot.list = [];
        if (!Array.isArray(work.flowerpot.plant_list)) work.flowerpot.plant_list = [];
        work.flowerpot.harvest_count = Math.max(0, util.toInt(work.flowerpot.harvest_count, 0));
        if (!util.isObject(work.flowerpot.harvested)) work.flowerpot.harvested = {};
        return work.flowerpot;
    };
    flowerpot.pot = function (work, type) {
        var f = flowerpot.ensure(work), wanted = util.toInt(type, 1);
        for (var i = 0; i < f.show_list.length; i++) {
            var row = f.show_list[i];
            if (util.isObject(row) && util.toInt(row.type, 1) === wanted) return row;
        }
        /* Older saves only have a numeric show entry. */
        if (f.show_list.length && wanted === 1) return {type: 1, id: util.toInt(f.show_list[0], 0)};
        return null;
    };
    flowerpot.slotCount = function (work, type) {
        var row = flowerpot.pot(work, type), count = 0;
        if (row) {
            var definition = config.get("flowerpotData", row.id);
            var positions = definition && (definition.pos_list || definition.positions);
            if (Array.isArray(positions)) count = positions.length;
        }
        /* Configuration is optional in imported saves; the client has one slot for
         * the default pot, while preserving imported plant indices is safer. */
        if (!count) count = 1;
        var f = flowerpot.ensure(work);
        f.plant_list.forEach(function (p) {
            if (util.isObject(p) && util.toInt(p.type, 1) === util.toInt(type, 1)) {
                count = Math.max(count, util.toInt(p.index, 0));
            }
        });
        return count;
    };
    flowerpot.find = function (work, type, index) {
        var list = flowerpot.ensure(work).plant_list, wantedType = util.toInt(type, 1), wantedIndex = util.toInt(index, 1);
        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            if (util.isObject(row) && util.toInt(row.type, wantedType) === wantedType && util.toInt(row.index, 0) === wantedIndex) return {row: row, offset: i};
        }
        return null;
    };
    flowerpot.recipe = function (seedId, params) {
        params = util.isObject(params) ? params : {};
        var row = config.get("FlowerData", seedId) || config.get("flowerData", seedId) || {};
        var duration = util.toInt(params.duration !== undefined ? params.duration : (row.grow_time || row.growTime || row.need_time || row.duration), 3600);
        var rewardId = util.toInt(params.reward_id !== undefined ? params.reward_id : (row.reward_id !== undefined ? row.reward_id : (row.flower_id !== undefined ? row.flower_id : (row.item_id !== undefined ? row.item_id : seedId))), seedId);
        var rewardCount = Math.max(1, util.toInt(params.reward_count !== undefined ? params.reward_count : (row.reward_count !== undefined ? row.reward_count : (row.count !== undefined ? row.count : 1)), 1));
        var seedDrop = params.seed_drop_id !== undefined ? params.seed_drop_id : (row.seed_drop_id !== undefined ? row.seed_drop_id : (row.seedDropId !== undefined ? row.seedDropId : row.drop_seed_id));
        seedDrop = seedDrop === undefined ? -1 : util.toInt(seedDrop, -1);
        var category = params.category || row.category || row.type_name || "";
        return {duration: Math.max(1, duration), reward_id: rewardId, reward_count: rewardCount, seed_drop_id: seedDrop, category: String(category || "")};
    };
    flowerpot.plant = function (work, params, effects) {
        params = util.isObject(params) ? params : {};
        var f = flowerpot.ensure(work), type = util.toInt(params.type, 1), index = util.toInt(params.index !== undefined ? params.index : params.pos, 1);
        var seedId = util.toInt(params.seed_id !== undefined ? params.seed_id : (params.item_id !== undefined ? params.item_id : params.id), -1);
        var amount = Math.max(1, util.toInt(params.count, 1));
        if (!flowerpot.pot(work, type)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"flowerpot-unavailable"};
        if (index < 1 || index > flowerpot.slotCount(work, type)) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:"flowerpot-position"};
        if (flowerpot.find(work, type, index)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"flowerpot-occupied"};
        if (seedId < 0 || !rules.itemInfo(seedId)) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:"flowerpot-seed"};
        if (rules.items.count(work, seedId) < amount) return {ok:false, code:LF.ERR.NO_ITEM, reason:"flowerpot-seed-not-owned"};
        var recipe = flowerpot.recipe(seedId, params), consumed = rules.items.consume(work, seedId, amount, effects);
        if (!consumed.ok) return consumed;
        var now = clock.now(), plant = {type:type, index:index, id:seedId, seed_id:seedId, stage:1, state:"growing", started_at:now, finish_time:now + recipe.duration, reward_id:recipe.reward_id, reward_count:recipe.reward_count, seed_drop_id:recipe.seed_drop_id, category:recipe.category};
        f.plant_list.push(plant);
        rules.effect(effects, "flowerpot");
        if (rules.tasks && rules.tasks.update) rules.tasks.update(work, "flowerpot_plant", 1, effects);
        return {ok:true, code:LF.ERR.OK, plant:util.clone(plant), finish_at:plant.finish_time};
    };
    flowerpot.finish = function (work, effects, now) {
        now = util.toInt(now, clock.now());
        var f = flowerpot.ensure(work), changed = 0;
        f.plant_list.forEach(function (plant) {
            if (!util.isObject(plant) || plant.state === "done") return;
            var finish = util.toInt(plant.finish_time || plant.end_time || plant.harvest_at, 0);
            if (finish > 0 && finish <= now) { plant.state = "done"; plant.stage = 3; changed++; }
        });
        if (changed) rules.effect(effects, "flowerpot");
        return {ok:true, code:LF.ERR.OK, changed:changed};
    };
    flowerpot.harvest = function (work, pos, effects) {
        var f = flowerpot.ensure(work), type = 1, index = 0, match = null;
        if (util.isObject(pos)) { type = util.toInt(pos.type, 1); index = util.toInt(pos.index !== undefined ? pos.index : pos.pos, 1); match = flowerpot.find(work, type, index); }
        else { index = util.toInt(pos, 1); if (index > 0 && index <= f.plant_list.length) match = {row:f.plant_list[index - 1], offset:index - 1}; }
        if (!match || !util.isObject(match.row)) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:"flowerpot-position"};
        var plant = match.row, finish = util.toInt(plant.finish_time || plant.end_time || plant.harvest_at, 0);
        if (!(plant.state === "done" || util.toInt(plant.state, 0) >= 2 || (finish > 0 && finish <= clock.now()))) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"flowerpot-not-ready"};
        var itemId = util.toInt(plant.reward_id || plant.item_id || plant.seed_id, -1), count = Math.max(1, util.toInt(plant.reward_count || plant.count, 1));
        if (itemId >= 0) { var added = rules.items.add(work, itemId, count, effects); if (!added.ok) return added; }
        var seedDrop = util.toInt(plant.seed_drop_id !== undefined ? plant.seed_drop_id : plant.next_seed_id, -1);
        if (seedDrop >= 0) { var seedAdded = rules.items.add(work, seedDrop, 1, effects); if (!seedAdded.ok) return seedAdded; }
        f.harvest_count += 1;
        var category = String(plant.category || "");
        if (category) f.harvested[category] = Math.max(0, util.toInt(f.harvested[category], 0)) + count;
        /* 客户端按固定槽位读取 plant_list，收获后保留空槽而不是缩短数组。 */
        f.plant_list[match.offset] = null; rules.effect(effects, "flowerpot");
        if (rules.tasks && rules.tasks.update) rules.tasks.update(work, "flowerpot_harvest", 1, effects);
        return {ok:true, code:LF.ERR.OK, item_list:itemId >= 0 ? [{item_id:itemId, count:count}] : []};
    };

    rules.snapshot.weather = function (work) {
        return {
            season: util.toInt(work.weather.season, 3),
            hours_type: util.toInt(work.weather.hours_type, 1),
            weather: util.toInt(work.weather.weather, 1)
        };
    };
    rules.tasks = rules.tasks || {};
    rules.tasks.ensure = function (work) { if (!util.isObject(work.tasks)) work.tasks={data:{},list:[],dataList:[],dataReward:{},redot:{}}; if(!Array.isArray(work.tasks.list))work.tasks.list=[]; return work.tasks; };
    rules.tasks.snapshot = function (work) { var t=rules.tasks.ensure(work); return {tasks:util.clone(t.list),list:util.clone(t.dataList),reward:util.clone(t.dataReward)}; };
    rules.tasks.update = function (work, id, amount, effects) { var t=rules.tasks.ensure(work), key=String(id), found=null; for(var i=0;i<t.list.length;i++) if(String(t.list[i].id)===key) found=t.list[i]; if(!found){found={id:id,progress:0,target:1,claimed:false};t.list.push(found);} found.progress=Math.min(Math.max(0,util.toInt(found.target,1)),Math.max(0,util.toInt(found.progress,0)+util.toInt(amount,1))); rules.effect(effects,"tasks"); return {ok:true,code:LF.ERR.OK,task:util.clone(found)}; };
    rules.tasks.claim = function (work, id, effects) { var t=rules.tasks.ensure(work), key=String(id); for(var i=0;i<t.list.length;i++){var task=t.list[i];if(String(task.id)===key){if(task.claimed||task.progress<util.toInt(task.target,1))return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"task-not-ready"};task.claimed=true;var reward=util.toInt(task.reward_clover,0);if(reward)work.wallet.clover+=reward;var achieve=util.toInt(task.achieve_id,-1);if(achieve>=0){work.role.achieveList=util.toArray(work.role.achieveList);if(work.role.achieveList.indexOf(achieve)<0)work.role.achieveList.push(achieve);work.role.achieveTime=util.toArray(work.role.achieveTime);work.role.achieveTime.push(clock.now());rules.effect(effects,"role");}rules.effect(effects,"tasks");rules.effect(effects,"wallet");return {ok:true,code:LF.ERR.OK,reward_clover:reward,achieve_id:achieve};}} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"task-not-found"}; };

    rules.snapshot.role = function (work) {
        var role = work.role;
        var achieves = util.toArray(role.achieveList);
        var achieveTime = util.toArray(role.achieveTime);
        var decorateList = util.toArray(role.decorationList);
        if (decorateList.length === 0 && util.toArray(work.decorate.list).length > 0) {
            decorateList = util.clone(work.decorate.list);
        }
        return {
            uid: role.uid || work.header.saveId,
            res: {
                clover_point: util.toInt(work.wallet.clover, 0),
                ticket: util.toInt(work.wallet.ticket, 0)
            },
            settings: {
                /*
                 * 不下发 client 设置：客户端设置（引导进度等）由客户端写入并通过
                 * client_set_client 回传，服务端若在其它推送里回灌旧值，会把玩家刚
                 * 完成的引导步骤冲回上一步（现象：教程反复出现）。
                 */
                client: "",
                push_switch: !!work.settings.push_switch,
                rank_switch: !!work.settings.rank_switch
            },
            frog: {
                name: role.name || "",
                cur_achieve: util.toInt(role.useAchieveID, -1),
                achieves: achieves,
                achieves_time: achieveTime,
                status: util.toInt(role.frogStatus, 0),
                motion: util.toInt(role.frogMotion, 0),
                icon: util.toInt(role.iconID, 0),
                pic_show: role.pictureInfo || {},
                today_step: util.toInt(role.todayStep, 0),
                decoration: decorateList,
                taobao_data: role.taobaoData || null
            },
            misc: {
                picture_cnt: util.toInt((work.mail && work.mail.pictureCount) || 0, 0),
                wx_push_reward: false,
                wx_my_reward: false,
                create_time: util.toInt(role.createTime, Math.floor(Date.now() / 1000))
            }
        };
    };
