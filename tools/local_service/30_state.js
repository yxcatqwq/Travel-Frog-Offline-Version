    /* ------------------------------------------------------------------
     * 30 本地权威状态容器 (A01) + 校验/迁移 (A10)
     *
     * 只有这一个对象是“权威”的；所有 Model 里的数据都是它的投影。
     * 任何变更都必须通过 LF.store.commit() 提交，因此不可能出现
     * “界面改了但存档没改”或“两个子系统各算一次”的情况。
     * ------------------------------------------------------------------ */
    var state = LF.state = {};

    state.schemaVersion = 1;

    LF.stateDefaults = function () {
        var now = Math.floor(Date.now() / 1000);
        return {
            header: {
                format: LF.SAVE_FORMAT,
                formatVersion: LF.SAVE_FORMAT_VERSION,
                mode: "local",
                saveId: util.uuid(),
                source: "new",
                sourceUid: "",
                createdAt: now,
                updatedAt: now,
                revision: 0,
                clientVersion: "unknown",
                ruleVersion: LF.RULES_VERSION,
                starterKit: null,
                repairs: []
            },
            clock: clock.defaults(),
            rng: rng.defaults(),
            role: {
                uid: "",
                name: "",
                createTime: now,
                iconID: 0,
                achieveList: [],
                achieveTime: [],
                useAchieveID: -1,
                pictureInfo: null,
                todayStep: 0,
                frogStatus: -1,
                frogMotion: -1,
                decorationList: [],
                decorationPutID: 0,
                decorationStatus: 0,
                taobaoData: null
            },
            settings: {
                client: {
                    guideStep: "Complete",
                    bgSound: 1,
                    effectSound: 1,
                    hasAchieve: false,
                    hasOpenAttributeView: false,
                    hasEnteredRaffle: false,
                    hasOpenedDesk: false,
                    hasBuyTool: false,
                    hasFriendVisit: false,
                    achieveList: [],
                    guideVisitor: false,
                    guideVisitorGift: false,
                    guideStory: false,
                    guideStoryGift: false,
                    hasOpenedNote: false,
                    guideNote: false,
                    guideHandCraft: false,
                    guideSlidePicture: false,
                    guideFurniture: 5,
                    guideAnnualReview: true,
                    guideFurnitureNotice: false,
                    guideDrawing: 0,
                    noticeDrawing: 0,
                    guideCamera: false
                },
                push_switch: true,
                rank_switch: false
            },
            wallet: {
                clover: 0,
                ticket: 0
            },
            items: {
                house: {},
                collections: [],
                specialtys: [],
                purchased: {},
                bag: [-1, -1, -1, -1],
                desk: [-1, -1, -1, -1, -1, -1, -1, -1],
                bagCompleted: false,
                bagConflict: false,
                deskConflict: false,
                gacha: {color_ball: -1},
                selectGift: []
            },
            furniture: {
                shop: {start_time: 0, leave_time: 0, shop_list: []},
                mood: 0,
                bench_lock: false,
                bench: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
                put_fur: [],
                has_fur: [],
                mate_list: [],
                replace_fur: [],
                craft: {state: "idle", recipe_id: 0, output_id: 0, output_count: 0, inputs: [], started_at: 0, finish_at: 0}
            },
            tumbler: {show_index: 0, replace_index: 0, tumbler_list: []},
            compost: {
                show_index: 0,
                replace_index: 0,
                compost_list: [],
                state: 0,
                box_index: 0,
                box_list: [-1, -1, -1, -1, -1, -1],
                process: null
            },
            pocket: {show_index: 0, replace_index: 0, list: [], clover: 0, lastAccrual: now},
            flowerpot: {show_list: [], list: [], plant_list: []},
            clover: {slots: [], lastRegrowAt: now},
            weather: {season: 0, hours_type: 0, weather: 0, anchor: now, nextAt: now},
            tasks: {data: {}, list: [], dataList: [], dataReward: {}, redot: {}},
            mail: {mails: [], nextId: 1, pictures: [], specialtys: [], notes: []},
            events: {pending: [], settled: [], nextId: 1},
            guests: {current: null, history: [], drawing: {is_accept: false, bag: [-1, -1, -1, -1], locked: false, gifts: []}},
            travel: {status: 'home', tripId: '', destinationId: 0, companionId: 0, startedAt: 0, etaAt: 0, returnedAt: 0, bag: [], result: null, settled: true, lastTripId: '', nextEventAt: 0},
            album: {pictures: [], newPictures: [], deleted: [], capacity: 30, expansionCount: 0},
            decorate: {list: [], put_id: 0, status: 0},
            journal: {
                appliedOps: [],
                lastOps: [],
                commitCount: 0,
                lastCommitReason: "",
                lastCommitAt: now,
                recovered: []
            },
            activities: {
                visit: {visitor: null, acquire: []}, story: {stories: [], new_story_id: 0},
                misc_moment: {list: []}, easteregg: {egg_list: []}, touch: {cur: 0, list: []},
                wishingpool: {end_time: 0, coin: 0, items: []}, lottery: {},
                animpicture: {guide: 0, page_num: 0, item_num: 0, making_index: 0, pic_list: []},
                museum: {museum_list: []},
                calendar: {
                    day_key: "", new_flag: [], note_list: [], lucky_days: [], st_days: [],
                    task_list: [], claimed: {}
                },
                calendar_note: {list: []},
                recharge: {water: 0, change: 0, field: [], sack: []}, recharge_gift: {gift: []}, recharge_num: {},
                adsmgr: {can_pop: false, can_banner: false, day_left: 0, gift_id: 0, gift_time: 0, gift_can_get: 0, gift_get: 0, item_list: []},
                rank: {}, cooking: {month: 0, month_pro: 0, week: 0, complete: true, select: 0, refresh_time: 0, task_list: []},
                capsule: {end_time: 0, coin: 0, pre_coin: 0, reward_list: [], task_list: [], patch_num: 0},
                greetcard: {end_time: 0, card_info: {bg: 0, bless: 0, tags: [0, 0, 0]}, send_list: [], get_list: [], items: [], task_item: [], can_reward: false},
                springcard: {end_time: 0, card_info: {bg: 0, bless: 0, tags: [0, 0, 0]}, items: [], task_item: [], reward_list: []},
                partycake: {end_time: 0, cream: 0, sugar: 0, cur_state: 0, part: 0, layers: [], task_list: [], share_get: []},
                museumday: {end_time: 0, inspire_num: 0, inspire_time: 0, museum_list: [], cur_museum: 0, compass: 0, task_num: 0, frog: 0, next: 0, left_num: 0, desc_id: 0, pic_id: 0, items: [], get_items: [], log_list: [], path: []},
                pray: {wishs: [], stamps: [], boxes: [], wish_new: null, stamp_new: null}
            },
            scheduler: {
                lastRunAt: now,
                nextDueAt: now,
                lastTasks: [],
                totalRuns: 0,
                history: []
            }
        };
    };

    /** 校验并就地修复；返回问题清单（不抛异常，坏档也要能进游戏）。 */
    state.validate = function (data) {
        var issues = [];

        function issue(kind, detail) {
            issues.push({kind: kind, detail: detail});
        }

        function number(value, fallback) {
            var parsed = Number(value);
            if (!isFinite(parsed)) {
                return fallback;
            }
            return parsed;
        }

        function slotList(value, length, fallbackFiller) {
            var list = util.toArray(value);
            while (list.length < length) {
                list.push(fallbackFiller);
            }
            if (list.length > length) {
                list = list.slice(0, length);
            }
            return list;
        }

        if (!util.isObject(data) || data.header === undefined) {
            issue("schema", "缺少 header，按新档处理");
            return {data: null, issues: issues};
        }

        var defaults = LF.stateDefaults();
        function restoreShape(target, shape, prefix) {
            Object.keys(shape).forEach(function (key) {
                var fallback = shape[key], value = target[key], path = prefix + key;
                var malformed = value !== undefined && value !== null &&
                    ((util.isObject(fallback) && !util.isObject(value)) ||
                     (Array.isArray(fallback) && !Array.isArray(value)));
                if (malformed) {
                    data.header.invalidFields = util.isObject(data.header.invalidFields) ? data.header.invalidFields : {};
                    data.header.invalidFields[path] = util.clone(value);
                    issue("schema", path + " 结构异常，原值已保留");
                    target[key] = util.clone(fallback);
                } else if (value === undefined || value === null) {
                    target[key] = util.clone(fallback);
                }
                if (util.isObject(fallback)) { restoreShape(target[key], fallback, path + "."); }
            });
        }
        restoreShape(data, defaults, "");

        /* ---- 钱包 ---- */
        var clover = number(data.wallet.clover, 0);
        if (clover < 0) {
            issue("wallet.clover", "负数修正为 0");
            clover = 0;
        }
        if (clover > 1e9) {
            issue("wallet.clover", "超出上限，截断");
            clover = 1e9;
        }
        data.wallet.clover = Math.floor(clover);
        var ticket = number(data.wallet.ticket, 0);
        if (ticket < 0) {
            issue("wallet.ticket", "负数修正为 0");
            ticket = 0;
        }
        data.wallet.ticket = Math.floor(ticket);

        /* ---- 库存 ---- */
        var house = util.isObject(data.items.house) ? data.items.house : {};
        var cleaned = {};
        for (var key in house) {
            if (!util.has(house, key)) {
                continue;
            }
            var id = util.toInt(key, -1);
            var count = number(house[key], 0);
            if (id < 0) {
                issue("items.house", "非法 item_id: " + key);
                continue;
            }
            if (count < 0) {
                issue("items.house", "负数数量修正: " + key);
                count = 0;
            }
            if (count > 0) {
                cleaned[id] = Math.floor(count);
            }
        }
        data.items.house = cleaned;
        data.items.bag = slotList(data.items.bag, 4, -1);
        data.items.desk = slotList(data.items.desk, 8, -1);
        data.items.bagConflict = !!data.items.bagConflict;
        data.items.deskConflict = !!data.items.deskConflict;
        data.items.bagCompleted = !!data.items.bagCompleted;

        /* Slots own their items: moving the last copy out of house is valid.
         * Keep unknown positive IDs for future content compatibility, too. */
        var index = 0;
        for (index = 0; index < data.items.bag.length; index++) {
            var bagItem = util.toInt(data.items.bag[index], -1);
            data.items.bag[index] = bagItem >= 0 ? bagItem : -1;
        }
        for (index = 0; index < data.items.desk.length; index++) {
            var deskItem = util.toInt(data.items.desk[index], -1);
            data.items.desk[index] = deskItem >= 0 ? deskItem : -1;
        }

        /* ---- 工作台 / 庭院 ---- */
        data.furniture.bench = slotList(data.furniture.bench, 10, -1);
        for (index = 0; index < data.furniture.bench.length; index++) {
            var benchItem = util.toInt(data.furniture.bench[index], -1);
            data.furniture.bench[index] = benchItem >= 0 ? benchItem : -1;
        }
        data.compost.box_list = slotList(data.compost.box_list, 6, -1);
        data.furniture.has_fur = util.toArray(data.furniture.has_fur);
        data.furniture.put_fur = util.toArray(data.furniture.put_fur);
        if (!util.isObject(data.furniture.craft) || Array.isArray(data.furniture.craft)) {
            data.furniture.craft = {state: "idle", recipe_id: 0, output_id: 0, output_count: 0, inputs: [], started_at: 0, finish_at: 0};
        }
        data.furniture.craft.state = ["idle", "running", "ready"].indexOf(String(data.furniture.craft.state)) >= 0
            ? String(data.furniture.craft.state) : "idle";
        data.furniture.craft.inputs = util.toArray(data.furniture.craft.inputs);
        data.furniture.craft.recipe_id = util.toInt(data.furniture.craft.recipe_id, 0);
        data.furniture.craft.output_id = util.toInt(data.furniture.craft.output_id, 0);
        data.furniture.craft.output_count = Math.max(0, util.toInt(data.furniture.craft.output_count, 0));
        data.furniture.craft.started_at = util.toInt(data.furniture.craft.started_at, 0);
        data.furniture.craft.finish_at = util.toInt(data.furniture.craft.finish_at, 0);
        data.furniture.shop.shop_list = util.toArray(data.furniture.shop.shop_list);
        /* 货架项必须能解析出 item_id，否则客户端渲染时取不到 ItemDB 记录（会崩） */
        for (index = data.furniture.shop.shop_list.length - 1; index >= 0; index--) {
            var shopRow = data.furniture.shop.shop_list[index];
            var shopConfig = config.get("FurnitureShopDB", util.toInt(shopRow.shop_id, -1));
            if (shopRow.item_id === undefined || shopRow.item_id === null) {
                if (shopConfig && shopConfig.item_id !== undefined) {
                    shopRow.item_id = shopConfig.item_id;
                } else {
                    issue("furniture.shop", "货架项缺少 item_id 且配置缺失，已下架: " + shopRow.shop_id);
                    data.furniture.shop.shop_list.splice(index, 1);
                    continue;
                }
            }
            if (!rules.itemInfo(shopRow.item_id)) {
                issue("furniture.shop", "货架项物品不在配置中，已下架: " + shopRow.item_id);
                data.furniture.shop.shop_list.splice(index, 1);
            }
        }

        /* 已摆放家具数量守恒检查：put_fur 必须是 has_fur 的子集 */
        var owned = {};
        for (index = 0; index < data.furniture.has_fur.length; index++) {
            owned[util.toInt(data.furniture.has_fur[index], -1)] = true;
        }
        for (index = data.furniture.put_fur.length - 1; index >= 0; index--) {
            var placed = data.furniture.put_fur[index];
            if (!placed || owned[util.toInt(placed.id, -1)] !== true) {
                issue("furniture.put_fur", "家具不在拥有清单中，已移除: " + (placed ? placed.id : "null"));
                data.furniture.put_fur.splice(index, 1);
            }
        }

        /* ---- 草田 ---- */
        data.clover.slots = util.toArray(data.clover.slots);
        if (data.clover.slots.length > LF.RULES.CLOVER_MAX) {
            issue("clover.slots", "草位数超过上限，截断");
            data.clover.slots = data.clover.slots.slice(0, LF.RULES.CLOVER_MAX);
        }
        for (index = 0; index < data.clover.slots.length; index++) {
            var slot = data.clover.slots[index];
            if (!util.isObject(slot)) {
                issue("clover.slots", "非法草位，已移除");
                data.clover.slots.splice(index, 1);
                index--;
                continue;
            }
            slot.clover_id = util.toInt(slot.clover_id, index + 1);
            slot.element = util.toInt(slot.element, 0);
            slot.sprite = util.toInt(slot.sprite, 1);
            slot.last_harvest = util.toInt(slot.last_harvest, 0);
            /* 未成熟的草位必须有正值再生周期，否则会被判成“已成熟” */
            slot.rebirth_span = slot.last_harvest > 0
                ? Math.max(LF.RULES.CLOVER_REBIRTH_MIN, util.toInt(slot.rebirth_span, LF.RULES.CLOVER_REBIRTH_MU))
                : util.toInt(slot.rebirth_span, 0);
        }

        /* ---- 时间 ---- */
        var now = Math.floor(Date.now() / 1000);
        var tenYears = 10 * 365 * 86400;
        var clockState = data.clock;
        clockState.anchorServer = number(clockState.anchorServer, now);
        clockState.anchorLocal = number(clockState.anchorLocal, now);
        clockState.lastNow = number(clockState.lastNow, clockState.anchorServer);
        clockState.lastLocalSeen = number(clockState.lastLocalSeen, now);
        if (clockState.anchorServer > now + tenYears) {
            issue("clock", "锚点时间异常，重置为当前时间");
            clockState.anchorServer = now;
            clockState.lastNow = now;
        }
        clockState.timeTravelSeconds = number(clockState.timeTravelSeconds, 0);

        data.header.revision = Math.max(0, util.toInt(data.header.revision, 0));
        data.header.formatVersion = util.toInt(data.header.formatVersion, LF.SAVE_FORMAT_VERSION);
        data.journal.appliedOps = util.toArray(data.journal.appliedOps);
        while (data.journal.appliedOps.length > 128) {
            data.journal.appliedOps.shift();
        }

        /* 离线版固定从新手教程完成后的状态继续游戏。 */
        if (data.settings.client.guideStep === "Complete") {
            data.settings.client.guideFurniture = 5;
            data.settings.client.guideFurnitureNotice = false;
        }

        return {data: data, issues: issues};
    };

    /** 跨版本迁移：目前只有 v1，占位并记录未知版本。 */
    state.migrate = function (raw) {
        var header = util.isObject(raw) && util.isObject(raw.header) ? raw.header : {};
        var version = util.toInt(header.formatVersion, 0);
        var notes = [];
        if (header.format !== LF.SAVE_FORMAT) {
            notes.push("未知格式标记: " + header.format);
        }
        if (version === 0) {
            notes.push("缺少 formatVersion，按 v1 解释");
            header.formatVersion = 1;
        } else if (version > LF.SAVE_FORMAT_VERSION) {
            notes.push("存档版本高于当前实现: " + version + "，保留字段并尝试读取");
        }
        return {data: raw, notes: notes};
    };

    state.newSave = function (options) {
        options = options || {};
        var data = LF.stateDefaults();
        data.header.clientVersion = options.clientVersion || "unknown";
        if (options.source) {
            data.header.source = options.source;
        }
        if (options.saveId) {
            data.header.saveId = options.saveId;
        }
        /* A candidate must not replace the current save until persistence succeeds. */
        var previousWork = LF._transactionState;
        LF._transactionState = data;
        try {
            LF.template.applyStarterKit(data);
        } finally {
            LF._transactionState = previousWork;
        }
        return data;
    };

    state.set = function (data) {
        LF.state.data = data;
    };

/* ---- 40_persist.js ---- */
    /* ------------------------------------------------------------------
     * 40 持久化事务 (A05 / A06)
     *
     * 提交顺序：tmp -> backup(旧主档) -> main。任何时刻至少有一份完整存档可读。
     * 幂等：带 opId 的提交只会生效一次（重放/重复回调不会重复发奖）。
     * ------------------------------------------------------------------ */
    var store = LF.store = {};

    store.storage = function () {
        try {
            if (typeof egret !== "undefined" && egret.localStorage) {
                return egret.localStorage;
            }
        } catch (error) {
            /* ignore */
        }
        try {
            if (global.localStorage) {
                return global.localStorage;
            }
        } catch (error2) {
            /* ignore */
        }
        return null;
    };

    store.rawGet = function (key) {
        var backend = store.storage();
        if (!backend) {
            store.readError = "storage-unavailable";
            return null;
        }
        try {
            return backend.getItem(key);
        } catch (error) {
            store.readError = String(error);
            LF.error("storage read failed: " + key, String(error));
            return null;
        }
    };

    store.rawSet = function (key, value) {
        var backend = store.storage();
        if (!backend) {
            return false;
        }
        try {
            /* Egret reports quota/native failures as false instead of throwing. */
            if (backend.setItem(key, value) === false) {
                return false;
            }
            return backend.getItem(key) === value;
        } catch (error) {
            LF.error("storage write failed: " + key, String(error));
            return false;
        }
    };

    store.rawRemove = function (key) {
        var backend = store.storage();
        if (!backend) {
            return;
        }
        try {
            backend.removeItem(key);
        } catch (error) {
            /* ignore */
        }
    };

    store.serialize = function (data) {
        return JSON.stringify(data);
    };

    store.checkIntegrity = function (data) {
        /* 轻量校验：header + 关键分区齐全即可，深度修复交给 state.validate */
        if (!util.isObject(data) || !util.isObject(data.header)) {
            return false;
        }
        if (data.header.format !== LF.SAVE_FORMAT) {
            return false;
        }
        return util.isObject(data.wallet) && util.isObject(data.items) && util.isObject(data.role);
    };

    store.parse = function (text) {
        try {
            return JSON.parse(text);
        } catch (error) {
            LF.error("存档解析失败", String(error));
            return null;
        }
    };

    store.keepCorrupt = function (text, reason) {
        var stamp = Math.floor(Date.now() / 1000);
        var key = LF.SAVE_CORRUPT_KEY + "_" + stamp;
        if (store.rawSet(key, text)) {
            LF.record("save.corruptPreserved", {key: key, reason: reason});
        }
        return key;
    };

    /** 装载存档：主档 -> 备份 -> 新档；任何降级都会留下完整性报告。 */
    store.load = function (options) {
        options = options || {};
        store.readError = null;
        var report = {action: "new", issues: [], source: null};
        var text = store.rawGet(LF.SAVE_KEY);
        if (store.readError) {
            store.writeBlocked = true;
            return {ok: false, action: "read-failed", issues: ["无法读取本地存档"], source: null};
        }
        var raw = null;

        if (text) {
            raw = store.parse(text);
            if (raw && raw.header && raw.header.formatVersion > LF.SAVE_FORMAT_VERSION) {
                store.writeBlocked = true;
                return {ok: false, action: "unsupported-version", issues: ["存档版本较新，请使用兼容版本打开"], source: null};
            }
            if (!raw) {
                report.issues.push("主存档 JSON 损坏");
                store.keepCorrupt(text, "parse-main");
                text = null;
            } else if (!store.checkIntegrity(raw)) {
                report.issues.push("主存档结构不完整");
                store.keepCorrupt(text, "integrity-main");
                raw = null;
                text = null;
            }
        }

        if (!raw) {
            var backupText = store.rawGet(LF.SAVE_BACKUP_KEY);
            if (store.readError) {
                store.writeBlocked = true;
                return {ok: false, action: "read-failed", issues: ["无法读取备份存档"], source: null};
            }
            if (backupText) {
                var backup = store.parse(backupText);
                if (backup && store.checkIntegrity(backup)) {
                    if (backup.header.formatVersion > LF.SAVE_FORMAT_VERSION) {
                        store.writeBlocked = true;
                        return {ok: false, action: "unsupported-version", issues: ["备份存档版本较新"], source: null};
                    }
                    raw = backup;
                    report.action = "restore-backup";
                    report.issues.push("使用备份存档恢复");
                    LF.warn("使用备份存档恢复");
                } else {
                    report.issues.push("备份存档同样不可用");
                    store.keepCorrupt(backupText, "parse-backup");
                }
            }
        }

        if (!raw) {
            if (options.forceNew) {
                report.action = "new-forced";
            } else if (report.issues.length === 0) {
                report.action = "new";
            } else {
                report.action = "new-after-loss";
            }
            var fresh = state.newSave({
                source: report.action === "new" ? "new" : "recovered",
                clientVersion: store.clientVersion()
            });
            fresh.journal.recovered.push({
                at: Math.floor(Date.now() / 1000),
                action: report.action,
                issues: report.issues.slice()
            });
            LF.state.set(fresh);
            LF.record("save.new", {action: report.action, issues: report.issues});
            report.ok = true;
            return report;
        }

        var migrated = state.migrate(raw);
        report.migration = migrated.notes;
        var validated = state.validate(migrated.data);
        if (!validated.data) {
            LF.error("存档校验失败，重建新档");
            var recreated = state.newSave({source: "recovered", clientVersion: store.clientVersion()});
            recreated.journal.recovered.push({
                at: Math.floor(Date.now() / 1000),
                action: "validate-failed",
                issues: report.issues.slice()
            });
            LF.state.set(recreated);
            report.action = "new-after-invalid";
            report.ok = true;
            return report;
        }

        var data = validated.data;
        if (validated.issues.length > 0) {
            report.issues = report.issues.concat(validated.issues.map(function (item) {
                return item.kind + ": " + item.detail;
            }));
            data.header.repairs.push({
                at: Math.floor(Date.now() / 1000),
                count: validated.issues.length,
                sample: report.issues.slice(-5)
            });
            while (data.header.repairs.length > 20) {
                data.header.repairs.shift();
            }
        }
        if (report.action !== "restore-backup") {
            report.action = "load";
        }
        LF.state.set(data);
        report.source = data.header.source;
        report.ok = true;
        LF.record("save.load", {action: report.action, issues: report.issues.length});
        return report;
    };

    store.clientVersion = function () {
        try {
            if (typeof GameConfig !== "undefined" && GameConfig.version) {
                return String(GameConfig.version);
            }
        } catch (error) {
            /* ignore */
        }
        return "unknown";
    };

    /** 立即落盘当前状态。返回是否成功（失败不谎报成功）。 */
    store.save = function (reason, candidate) {
        if (store.writeBlocked) { return false; }
        if (!candidate && !LF.state.data) {
            return false;
        }
        var data = util.clone(candidate || LF.state.data);
        if (!data || data.header.formatVersion > LF.SAVE_FORMAT_VERSION) {
            return false;
        }
        data.header.updatedAt = Math.floor(Date.now() / 1000);
        data.header.clientVersion = store.clientVersion();
        data.header.ruleVersion = LF.RULES_VERSION;
        data.journal.lastSaveError = null;
        data.journal.lastCommitAt = Math.floor(Date.now() / 1000);
        data.journal.lastCommitReason = reason || "";
        var text;
        try {
            text = store.serialize(data);
        } catch (error) {
            LF.error("存档序列化失败", String(error));
            return false;
        }

        var previous = store.rawGet(LF.SAVE_KEY);
        var okTmp = store.rawSet(LF.SAVE_TMP_KEY, text);
        if (!okTmp) {
            data.journal.lastSaveError = {at: Math.floor(Date.now() / 1000), reason: "tmp-write"};
            LF.record("save.failed", {stage: "tmp", reason: reason});
            return false;
        }
        var previousData = previous ? store.parse(previous) : null;
        /* Never overwrite a good backup with the damaged primary during recovery. */
        if (previousData && store.checkIntegrity(previousData) &&
                !store.rawSet(LF.SAVE_BACKUP_KEY, previous)) {
            store.rawRemove(LF.SAVE_TMP_KEY);
            LF.record("save.failed", {stage: "backup", reason: reason});
            return false;
        }
        var okMain = store.rawSet(LF.SAVE_KEY, text);
        if (!okMain) {
            store.rawRemove(LF.SAVE_TMP_KEY);
            data.journal.lastSaveError = {at: Math.floor(Date.now() / 1000), reason: "main-write"};
            LF.record("save.failed", {stage: "main", reason: reason});
            return false;
        }
        store.rawRemove(LF.SAVE_TMP_KEY);
        LF.state.set(data);
        return true;
    };

    store.hasApplied = function (opId) {
        if (!opId) {
            return false;
        }
        var applied = LF.state.data.journal.appliedOps;
        return applied.indexOf(opId) >= 0;
    };

    store.markApplied = function (opId) {
        if (!opId) {
            return;
        }
        var data = LF.state.data;
        data.journal.appliedOps.push(opId);
        while (data.journal.appliedOps.length > 128) {
            data.journal.appliedOps.shift();
        }
    };

    LF.tx = {};

    /**
     * 事务提交：mutator(work, context) 在副本上执行；返回 false/null 表示放弃本次变更。
     * meta: {reason, opId, persist(默认 true), silent}
     */
    LF.tx.commit = function (mutator, meta) {
        meta = meta || {};
        if (store.writeBlocked || !LF.state.data) {
            LF.error("提交事务时没有装载存档");
            return {ok: false, code: LF.ERR.GENERIC, reason: "no-save"};
        }
        if (meta.opId && store.hasApplied(meta.opId)) {
            LF.record("tx.duplicate", {opId: meta.opId, reason: meta.reason});
            var cached = (LF.state.data.journal.opResults || {})[meta.opId];
            return {ok: true, duplicate: true, code: LF.ERR.OK,
                response: cached ? util.clone(cached.response) : undefined};
        }
        if (LF._committing) {
            LF.error("事务重入被拒绝", meta.reason);
            return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "reentrant"};
        }

        LF._committing = true;
        var work;
        var result;
        try {
            work = util.clone(LF.state.data);
            LF._transactionState = work;
            result = mutator(work, meta);
        } catch (error) {
            LF._transactionState = null;
            LF._committing = false;
            LF.error("事务执行异常: " + meta.reason, String(error));
            return {ok: false, code: LF.ERR.GENERIC, reason: String(error)};
        }
        LF._transactionState = null;
        if (result === false || result === null || result === undefined) {
            LF._committing = false;
            return {ok: false, code: meta.code || LF.ERR.ILLEGAL_OP, reason: meta.reason, rejected: true};
        }
        if (result && result.ok === false) {
            LF._committing = false;
            return result;
        }

        var validated;
        try {
            validated = state.validate(work);
        } catch (validationError) {
            LF._committing = false;
            return {ok: false, code: LF.ERR.DESYNC, reason: "validate-failed"};
        }
        if (!validated.data) {
            LF._committing = false;
            LF.error("事务结果未通过校验，已回滚: " + meta.reason);
            return {ok: false, code: LF.ERR.DESYNC, reason: "validate-failed"};
        }
        work = validated.data;
        work.header.revision = (LF.state.data.header.revision || 0) + 1;
        work.journal.commitCount = (work.journal.commitCount || 0) + 1;
        if (meta.opId) {
            work.journal.appliedOps.push(meta.opId);
            work.journal.opResults = work.journal.opResults || {};
            work.journal.opResults[meta.opId] = {response: util.clone(result.response)};
            while (work.journal.appliedOps.length > 128) {
                delete work.journal.opResults[work.journal.appliedOps.shift()];
            }
        }
        work.journal.lastOps.push({
            at: Math.floor(Date.now() / 1000),
            rev: work.header.revision,
            op: meta.reason || "commit",
            opId: meta.opId || "",
            changed: result.changed || null
        });
        while (work.journal.lastOps.length > 64) {
            work.journal.lastOps.shift();
        }

        var persisted = true;
        if (meta.persist !== false) {
            persisted = store.save(meta.reason, work);
        } else {
            LF.state.set(work);
        }
        LF._committing = false;
        if (!persisted) {
            LF.record("tx.persistFailed", {reason: meta.reason});
            return {ok: false, persisted: false, code: LF.ERR.GENERIC, reason: "save-failed"};
        }
        result.persisted = persisted;
        result.ok = result.ok !== false;
        LF.record("tx." + (meta.reason || "commit"), result.changed || undefined);
        return result;
    };

    /** 只读快照：给诊断/测试用。 */
    store.snapshot = function () {
        return util.clone(LF.state.data);
    };

/* ---- 50_config.js ---- */
    /* ------------------------------------------------------------------
     * 50 配置服务 (A11)
     *
     * 复用包内配置（config.eab 由原生层解码后交给 RES），不复制数值；
     * 远端“功能开关/公告”在本地用一份显式清单代替，并标注规则版本。
     * ------------------------------------------------------------------ */
    var config = LF.config = {};

    /* 本地功能开关：只关闭无法离线成立的入口（D02/D03/D05/D07）。 */
    config.LOCAL_ADMIN_CONFIG = {
        hideShare: {value: "1", note: "没有跨玩家分享，分享入口离线不可用"},
        hideRechargeMerch: {value: "1", note: "离线不提供充值货架（D02）"}
    };

    config.LOCAL_ADMIN_NOTE = "本地功能开关表（M1），来源：单机替代策略，非原服务器下发值";

    config.dm = function () {
        try {
            if (typeof Tabikaeru !== "undefined" && Tabikaeru.DataManager) {
                return Tabikaeru.DataManager.instance();
            }
        } catch (error) {
            LF.warn("DataManager 不可用: " + error);
        }
        return null;
    };

    config.table = function (name) {
        var dm = config.dm();
        if (!dm) {
            return null;
        }
        return dm[name] || null;
    };

    /** 安全取配置项：Getter 可以是 get(id) / get(key)。 */
    config.get = function (tableName, key) {
        var table = config.table(tableName);
        if (!table) {
            return null;
        }
        try {
            if (typeof table.get === "function") {
                return table.get(key);
            }
            if (typeof table.getItem === "function") {
                return table.getItem(key);
            }
            if (typeof table.getName === "function") {
                return table.getName(key);
            }
            if (table.src) {
                return table.src[key];
            }
        } catch (error) {
            return null;
        }
        return null;
    };

    config.list = function (tableName) {
        var table = config.table(tableName);
        if (!table) {
            return [];
        }
        if (typeof table.list === "function") {
            try {
                return table.list() || [];
            } catch (error) {
                return [];
            }
        }
        if (typeof table.all === "function") {
            try {
                return table.all() || [];
            } catch (error) {
                return [];
            }
        }
        return [];
    };

    /**
     * 返回配置表的全部 id。
     * 包内 Getter（KeyGetter/IdGetter/NameGetter）都没有公开索引，
     * 但都以 src 保存原始 JSON，这里按 src 的形状枚举（字典取 key，数组取 id 字段）。
     */
    config.ids = function (tableName) {
        var table = config.table(tableName);
        if (!table) {
            return [];
        }
        if (typeof table.count === "function" && typeof table.index === "function") {
            var count = 0;
            try {
                count = table.count();
            } catch (error) {
                count = 0;
            }
            var collected = [];
            for (var position = 0; position < count; position++) {
                var row = table.index(position);
                if (row && row.id !== undefined) {
                    collected.push(row.id);
                } else if (row && row.itemId !== undefined) {
                    collected.push(row.itemId);
                }
            }
            return collected;
        }
        var src = table.src;
        if (!src) {
            return [];
        }
        var ids = [];
        if (Array.isArray(src)) {
            for (var index = 0; index < src.length; index++) {
                var entry = src[index];
                if (entry && entry.id !== undefined) {
                    ids.push(entry.id);
                }
            }
            return ids;
        }
        for (var key in src) {
            if (!util.has(src, key)) {
                continue;
            }
            var numeric = Number(key);
            ids.push(isFinite(numeric) ? numeric : key);
        }
        return ids;
    };

    /** 按配置字段筛查 id：config.filterIds("ItemDB", function(item){...}) */
    config.filterIds = function (tableName, predicate, limit) {
        var ids = config.ids(tableName);
        var result = [];
        for (var index = 0; index < ids.length; index++) {
            var entry = config.get(tableName, ids[index]);
            if (entry && predicate(entry, ids[index])) {
                result.push(ids[index]);
                if (limit && result.length >= limit) {
                    break;
                }
            }
        }
        return result;
    };

    /** 配置是否就绪：缺失配置时规则层必须给出明确失败，而不是静默成功。 */
    config.ready = function () {
        var dm = config.dm();
        return !!(dm && dm.ItemDB && dm.FurnitureDB);
    };

    config.describe = function () {
        var dm = config.dm();
        if (!dm) {
            return {ready: false, tables: 0};
        }
        var count = 0;
        for (var key in dm) {
            if (util.has(dm, key) && dm[key]) {
                count++;
            }
        }
        return {ready: true, tables: count};
    };

    /** 覆盖 GameConfig.getAdminConfig：远端公告缺失时使用本地清单。 */
    config.install = function () {
        if (typeof GameConfig === "undefined" || !GameConfig.getAdminConfig || GameConfig.__localPatched) {
            return;
        }
        var original = GameConfig.getAdminConfig;
        GameConfig.getAdminConfig = function (name) {
            var value = original.apply(this, arguments);
            if (value !== null && value !== undefined) {
                return value;
            }
            var local = config.LOCAL_ADMIN_CONFIG[name];
            if (local) {
                return local.value;
            }
            return value;
        };
        GameConfig.__localPatched = true;
        LF.info("已接管 GameConfig.getAdminConfig（本地开关表）");
    };

/* ---- 55_template.js ---- */
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

/* ---- 60_rules.js ---- */
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

/* ---- 62_rules_world.js ---- */
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
        return {
            show_list: util.clone(util.toArray(work.flowerpot.show_list)),
            list: util.clone(util.toArray(work.flowerpot.list)),
            plant_list: util.clone(util.toArray(work.flowerpot.plant_list))
        };
    };

    rules.snapshot.weather = function (work) {
        return {
            season: util.toInt(work.weather.season, 3),
            hours_type: util.toInt(work.weather.hours_type, 1),
            weather: util.toInt(work.weather.weather, 1)
        };
    };

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

