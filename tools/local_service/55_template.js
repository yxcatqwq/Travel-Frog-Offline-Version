    /* ------------------------------------------------------------------
     * 55 新档模板 (B01 + M1 基础设施初始赠送)
     *
     * 产品设定：新档视为“新手教程已完成”，并显式赠送一批基础设施，
     * 让工作台/堆肥箱等在满足真实状态条件时可见可操作。
     * 赠送清单全部写入 header.starterKit，导入档不会走这条路径。
     * ------------------------------------------------------------------ */
    var template = LF.template = {};

    template.VERSION = 2;

    template.starterKit = function (data) {
        var now = Math.floor(Date.now() / 1000);
        var kit = {
            version: template.VERSION,
            at: now,
            source: "config-driven",
            clover: 100,
            ticket: 0,
            items: {},
            cloverSlots: 0,
            furniture: {},
            notes: []
        };

        var itemTypes = null;
        try {
            itemTypes = Tabikaeru.DataType.ItemType;
        } catch (error) {
            itemTypes = null;
        }

        if (!itemTypes || !config.ready()) {
            kit.notes.push("配置未就绪：仅创建最小新档，未赠送设施");
            kit.source = "fallback";
            kit.cloverSlots = LF.RULES.CLOVER_START_SLOTS;
            data.role.frogStatus = 0;
            data.role.frogMotion = 0;
            data.role.name = data.role.name || "呱呱";
            return kit;
        }

        function grantByType(type, count, amount, label) {
            var ids = config.filterIds("ItemDB", function (item) {
                return item.type === type;
            }, count);
            for (var index = 0; index < ids.length; index++) {
                kit.items[ids[index]] = (kit.items[ids[index]] || 0) + amount;
            }
            if (ids.length < count) {
                kit.notes.push(label + " 只有 " + ids.length + " 项可用（期望 " + count + "）");
            }
            return ids;
        }

        /* 工作台：工具 + 材料（数量守恒，材料用于制作） */
        var tools = grantByType(itemTypes.FURNITURE_TOOL, 2, 1, "家具工具");
        var materials = grantByType(itemTypes.FURNITURE_ITEM, 3, 2, "家具材料");
        /* 旅行口粮 */
        grantByType(itemTypes.LunchBox, 2, 3, "口粮");

        kit.furniture.bench = {
            tools: tools.slice(0, 5),
            items: materials.slice(0, 3)
        };

        /* 工作台解锁：start_time > 0 即视为已解锁；商人在场由 leave_time 控制 */
        data.furniture.shop.start_time = now;
        data.furniture.shop.leave_time = now + 7 * 86400;
        /* 新档角色状态：在家、待机读书（frogMotion 0 = dokusyo_ie，避免引用未装载的手账数据） */
        data.role.frogStatus = 0;
        data.role.frogMotion = 0;
        var shopIds = config.ids("FurnitureShopDB");
        var stock = [];
        var skipped = [];
        for (var s = 0; s < shopIds.length; s++) {
            var shopEntry = config.get("FurnitureShopDB", shopIds[s]);
            if (!shopEntry) {
                continue;
            }
            /*
             * 货架项必须带上 item_id：客户端 FurnitureShopItem 渲染器会用
             * ItemDB.get(data.item_id).img 取图，缺字段会直接抛异常（点开商人即崩）。
             * type 998 是“看广告/分享微信获取”的商品（D03），离线版不上架。
             */
            if (shopEntry.type === 998 || shopEntry.type === "998") {
                skipped.push({shop_id: shopIds[s], reason: "share-or-ads"});
                continue;
            }
            if (!config.get("ItemDB", shopEntry.item_id)) {
                skipped.push({shop_id: shopIds[s], reason: "item-not-in-config", item_id: shopEntry.item_id});
                continue;
            }
            stock.push({
                shop_id: shopIds[s],
                item_id: shopEntry.item_id,
                num: util.toInt(shopEntry.num, 0) || util.toInt(shopEntry.count, 0) || 1
            });
        }
        data.furniture.shop.shop_list = stock;
        kit.furniture.shop = {shop_id_count: shopIds.length, stock: stock.length, skipped: skipped};
        if (skipped.length > 0) {
            kit.notes.push("货架跳过 " + skipped.length + " 项（分享/广告或配置缺失）");
        }

        /* 工具位与材料位 */
        for (var b = 0; b < tools.length && b < 5; b++) {
            data.furniture.bench[b] = tools[b];
        }
        for (var m = 0; m < materials.length && m < 5; m++) {
            data.furniture.bench[5 + m] = materials[m];
        }

        /* 堆肥箱：拥有 + 摆放 */
        var compostIds = config.ids("CompostData");
        if (compostIds.length > 0) {
            data.compost.compost_list = [compostIds[0]];
            data.compost.show_index = 1;
            kit.furniture.compost = compostIds[0];
        } else {
            kit.notes.push("compostData 中没有可用堆肥箱");
        }

        /* 不倒翁 */
        var tumblerIds = config.ids("TumblerData");
        if (tumblerIds.length > 0) {
            data.tumbler.tumbler_list = [tumblerIds[0]];
            data.tumbler.show_index = 1;
            kit.furniture.tumbler = tumblerIds[0];
        } else {
            kit.notes.push("tumblerData 中没有可用不倒翁");
        }

        /* 存草口袋 */
        var pocketIds = config.ids("pocketData");
        if (pocketIds.length > 0) {
            data.pocket.list = [pocketIds[0]];
            data.pocket.show_index = 1;
            data.pocket.replace_index = 0;
            kit.furniture.pocket = pocketIds[0];
        } else {
            kit.notes.push("pocketData 中没有可用口袋");
        }

        /* 花盆：只在能从配置解析出定义时摆放 */
        try {
            var pots = config.table("flowerpotData");
            var potTable = pots && pots.src && pots.src.flowerpot;
            if (potTable) {
                var potIds = Object.keys(potTable);
                var firstPot = potIds.length > 0 ? Number(potIds[0]) : NaN;
                if (!isNaN(firstPot)) {
                    /*
                     * 只给“拥有”，不默认摆放：MainOut 皮肤里的 flowerpotList 展示位
                     * 在当前离线皮肤中没有可用对象，摆放会触发 update_flowerpot 空引用；
                     * 种植/摆放属于 B11 的 M2 工作。拥有与摆放分开也是需求本身的要求。
                     */
                    data.flowerpot.list = [{type: 1, id: firstPot}];
                    kit.furniture.flowerpot = firstPot;
                } else {
                    kit.notes.push("flowerpotData 中没有可用花盆");
                }
            } else {
                kit.notes.push("flowerpotData 结构未知，未摆放花盆");
            }
        } catch (error) {
            kit.notes.push("花盆配置解析失败: " + error);
        }

        /* 草田：给几个可收割的草位，其它保持生长中 */
        var slots = [];
        for (var c = 0; c < LF.RULES.CLOVER_MAX; c++) {
            var ready = c < LF.RULES.CLOVER_START_SLOTS;
            slots.push({
                clover_id: c + 1,
                element: 0,
                sprite: 1,
                /* 0 = 已成熟；>0 = 该时间开始再生，需等 rebirth_span 后才成熟 */
                last_harvest: ready ? 0 : now,
                rebirth_span: ready ? 0 : rng.normalClamped(
                    LF.RULES.CLOVER_REBIRTH_MU,
                    LF.RULES.CLOVER_REBIRTH_SIGMA,
                    LF.RULES.CLOVER_REBIRTH_MIN,
                    LF.RULES.CLOVER_REBIRTH_MAX)
            });
        }
        data.clover.slots = slots;
        kit.cloverSlots = LF.RULES.CLOVER_START_SLOTS;

        /* 蛙名：教程已完成的档位必须已有名字 */
        data.role.name = data.role.name || "呱呱";

        return kit;
    };

    template.applyStarterKit = function (data) {
        var kit = template.starterKit(data);
        data.header.starterKit = kit;
        data.wallet.clover = Math.max(data.wallet.clover, kit.clover || 0);
        data.wallet.ticket = Math.max(data.wallet.ticket, kit.ticket || 0);
        for (var key in kit.items) {
            if (!util.has(kit.items, key)) {
                continue;
            }
            data.items.house[key] = (data.items.house[key] || 0) + kit.items[key];
        }
        /* The kit counts total ownership, including items preloaded on the bench. */
        if (kit.source === "config-driven") {
            for (var i = 0; i < data.furniture.bench.length; i++) {
                var id = data.furniture.bench[i];
                if (id >= 0 && kit.items[id]) {
                    data.items.house[id]--;
                    if (data.items.house[id] <= 0) { delete data.items.house[id]; }
                }
            }
        }
        LF.info("新档赠送清单", kit);
        return kit;
    };

    /** 诊断/验收：检查新档是否满足基础设施的最小状态条件。 */
    template.checkNewSave = function (data) {
        data = data || LF.state.data;
        var report = [];
        function check(name, ok, detail) {
            report.push({name: name, ok: !!ok, detail: detail});
        }
        check("工作台已解锁", data.furniture.shop.start_time > 0, "shop.start_time=" + data.furniture.shop.start_time);
        check("工作台有工具位", data.furniture.bench.slice(0, 5).filter(function (id) {
            return id !== -1;
        }).length > 0);
        check("堆肥箱已拥有并摆放", data.compost.show_index > 0 && data.compost.compost_list.length > 0);
        check("草田有可收割草位", data.clover.slots.some(function (slot) {
            return rules.clover.ready(slot, LF.clock.now());
        }));
        check("钱包可显示", typeof data.wallet.clover === "number");
        check("角色状态合法", data.role.frogStatus >= 0 && data.role.frogMotion >= 0,
            "status=" + data.role.frogStatus + ", motion=" + data.role.frogMotion);
        return report;
    };
