
/* 验收构建：预置开关（脚本本体加载前生效） */
(function () {
    window.LocalFrog = window.LocalFrog || {};
    var preset = window.LocalFrog.flags || {};
    var values = {verboseLog: true, diagFile: true, diagEndpoint: "http://10.0.2.2:8799"};
    for (var key in values) { if (Object.prototype.hasOwnProperty.call(values, key)) { preset[key] = values[key]; } }
    window.LocalFrog.flags = preset;
})();

/* 验收构建探针：脚本加载与错误上报 */
(function () {
    var endpoint = "http://10.0.2.2:8799";
    function send(path, body) {
        try {
            var request = new XMLHttpRequest();
            request.open("POST", endpoint + path, true);
            request.setRequestHeader("Content-Type", "application/json");
            request.send(JSON.stringify(body));
        } catch (error) {}
    }
    window.__lfProbe = send;
    send("/probe", {stage: "script-load", href: String(location.href), ua: String(navigator.userAgent)});
    window.addEventListener("error", function (event) {
        send("/probe", {stage: "window-error", message: String(event.message), source: String(event.filename), line: event.lineno});
    });
    window.addEventListener("unhandledrejection", function (event) {
        send("/probe", {stage: "unhandled-rejection", reason: String(event.reason && event.reason.message ? event.reason.message : event.reason)});
    });
    var originalError = console.error;
    console.error = function () {
        send("/probe", {stage: "console-error", message: Array.prototype.slice.call(arguments).map(String).join(" ")});
        if (originalError) { originalError.apply(console, arguments); }
    };
    var originalLog = console.log;
    console.log = function () {
        var text = Array.prototype.slice.call(arguments).map(String).join(" ");
        if (text.indexOf("[LF]") === 0 || text.indexOf("LocalFrog") >= 0) {
            send("/probe", {stage: "log", message: text.slice(0, 2000)});
        }
        if (originalLog) { originalLog.apply(console, arguments); }
    };
    window.__lfFlag = true;
})();
/* ---- 00_header.js ---- */
/*
 * 旅行青蛙 · 单机版本地服务 (M0 状态底座 / M1 设施与基础操作)
 *
 * 该文件在 main.min.js 之后加载，向客户端注入一层“本地权威服务”：
 *   - 唯一的权威状态容器 + 事务提交 + 原子持久化 (A01/A05/A06)
 *   - 协议适配层：复用 core.SocketManage 的 session/回调/推送契约 (A02/A03)
 *   - 启动同步：本地身份 -> 存档 -> 配置 -> 时间追赶 -> 模型装载 -> UI 刷新 (A04)
 *   - 本地时钟、调度与可复现随机 (A07/A08/A09)
 *   - 存档校验/迁移/恢复与诊断工具 (A10/A12)
 *   - B01 角色与设置、B02 钱包与库存、B03 草田、B04 商店、B05 行囊与桌子、
 *     B09 工作台、B10 堆肥箱、B11 庭院设施的权威状态与结算
 *
 * 设计约定：
 *   1. 客户端 Model 只是本地状态的投影。Model 上的“空方法”(addClover/addHouseItem 等)
 *      保持为空，避免与服务器推送重复结算；权威数值通过 clover_update/item_update 等
 *      推送以“绝对值”形式回写，天然幂等。
 *   2. 所有状态变更都经过 LF.tx.commit()，一次操作 = 一次落盘 = 一次推送。
 *   3. 未知协议不返回伪造的成功：返回通用错误码并记录到诊断清单。
 *
 * 构建：python tools/build-local-service.py
 */
(function (global) {
    "use strict";

    var LF = global.LocalFrog = global.LocalFrog || {};

    LF.VERSION = "0.1.1";
    LF.RULES_VERSION = 1;
    LF.SAVE_FORMAT = "frog-local-save";
    LF.SAVE_FORMAT_VERSION = 1;
    LF.SAVE_KEY = "frog_local_save_v1";
    LF.SAVE_BACKUP_KEY = "frog_local_save_v1_backup";
    LF.SAVE_TMP_KEY = "frog_local_save_v1_tmp";
    LF.SAVE_CORRUPT_KEY = "frog_local_save_v1_corrupt";

    /* 服务器错误码（取自包内 errcode_json，避免自造码造成 UI 无提示） */
    LF.ERR = {
        OK: 0,
        GENERIC: 1,          // 服务器通用错误码（未支持协议使用）
        ILLEGAL_PARAM: 5,    // 参数非法
        ILLEGAL_OP: 6,       // 非法操作
        DESYNC: 7,           // 客户端数据与服务器不一致
        NO_SPACE: 41,        // 空间不足
        NO_ITEM: 42,         // 物品不足
        NO_RESOURCE: 61      // 资源不足（三叶草/兑换券）
    };

    /* 本地规则来源说明：见 docs/本地服务实现说明.md */
    LF.RULES = {
        CLOVER_MAX: 20,
        CLOVER_REBIRTH_MU: 7200,
        CLOVER_REBIRTH_SIGMA: 1800,
        CLOVER_REBIRTH_MIN: 900,
        CLOVER_REBIRTH_MAX: 10800,
        CLOVER_FOUR_LEAF_PERCENT: 0.5,
        CLOVER_START_SLOTS: 6,
        WEATHER_CHANGE_SECONDS: 6 * 3600,
        AUTOSAVE_INTERVAL_MS: 30000,
        HOOK_ATTEMPTS: 60,
        HOOK_INTERVAL_MS: 250
    };

    var presetFlags = LF.flags || {};
    LF.flags = {
        enabled: true,
        /* M1 保持季节资源键与包内资源一致（B13 在 M2 打开） */
        seasonFromClock: false,
        /* 门店/商人始终在场：M1 先按“已解锁工作台 + 商人在场”的新档模板实现 */
        verboseLog: false,
        /* 验收构建：把状态快照写到设备文件（A12），正式发行保持关闭 */
        diagFile: false,
        diagFileIntervalMs: 10000
    };
    /* 允许构建/启动参数在脚本加载前预置开关 */
    for (var presetKey in presetFlags) {
        if (Object.prototype.hasOwnProperty.call(presetFlags, presetKey)) {
            LF.flags[presetKey] = presetFlags[presetKey];
        }
    }

    LF.diag = LF.diag || {
        logs: [],
        events: [],
        unsupported: {},
        errors: [],
        boot: null
    };

/* ---- 10_util.js ---- */
    /* ------------------------------------------------------------------
     * 10 基础工具
     * ------------------------------------------------------------------ */
    var util = LF.util = {};

    util.clone = function (value) {
        if (value === undefined) {
            return undefined;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return null;
        }
    };

    util.isObject = function (value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    };

    util.isNumber = function (value) {
        return typeof value === "number" && isFinite(value);
    };

    util.toInt = function (value, fallback) {
        var number = Number(value);
        if (!isFinite(number)) {
            return fallback === undefined ? 0 : fallback;
        }
        return Math.floor(number);
    };

    util.toArray = function (value) {
        if (value === null || value === undefined) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    };

    util.has = function (object, key) {
        return !!object && Object.prototype.hasOwnProperty.call(object, key);
    };

    /* 只补齐缺失字段，不覆盖已有值（用于旧档迁移/未知字段保留） */
    util.fillDefaults = function (target, defaults) {
        if (target === null || target === undefined) {
            target = {};
        }
        for (var key in defaults) {
            if (!util.has(defaults, key)) {
                continue;
            }
            var fallback = defaults[key];
            if (target[key] === undefined || target[key] === null) {
                target[key] = util.clone(fallback);
            } else if (util.isObject(fallback) && util.isObject(target[key])) {
                util.fillDefaults(target[key], fallback);
            }
        }
        return target;
    };

    util.uuid = function () {
        if (typeof core !== "undefined" && core.String && core.String.uuid) {
            return core.String.uuid();
        }
        var text = "";
        var alphabet = "0123456789abcdef";
        while (text.length < 32) {
            text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        return text;
    };

    util.pad2 = function (value) {
        return (value < 10 ? "0" : "") + value;
    };

    util.dayKey = function (seconds) {
        var date = new Date(seconds * 1000);
        return date.getFullYear() + "-" + util.pad2(date.getMonth() + 1) + "-" + util.pad2(date.getDate());
    };

    util.percent = function (value) {
        return Math.round(value * 10000) / 100;
    };

    LF.log = function (level, message, data) {
        var entry = {
            t: Math.floor(Date.now() / 1000),
            level: level,
            msg: String(message)
        };
        if (data !== undefined) {
            entry.data = data;
        }
        LF.diag.logs.push(entry);
        while (LF.diag.logs.length > 400) {
            LF.diag.logs.shift();
        }
        if (level === "error") {
            LF.diag.errors.push(entry);
            while (LF.diag.errors.length > 50) {
                LF.diag.errors.shift();
            }
        }
        /* 统一走 console，安全环境下（Egret/WebView）直接可见 */
        var console2 = global.console;
        if (console2 && console2.log) {
            if (LF.flags.verboseLog || level === "error" || level === "warn") {
                console2.log("[LF][" + level + "] " + message, data === undefined ? "" : data);
            }
        }
    };

    LF.info = function (message, data) {
        LF.log("info", message, data);
    };
    LF.warn = function (message, data) {
        LF.log("warn", message, data);
    };
    LF.error = function (message, data) {
        LF.log("error", message, data);
    };

    /* 诊断事件：影响存档的行为都会落一条，便于验收与回放 */
    LF.record = function (type, detail) {
        var entry = {
            t: Math.floor(Date.now() / 1000),
            rev: LF.state.data ? LF.state.data.header.revision : 0,
            type: type
        };
        if (detail !== undefined) {
            entry.detail = detail;
        }
        LF.diag.events.push(entry);
        while (LF.diag.events.length > 300) {
            LF.diag.events.shift();
        }
        if (LF.flags.verboseLog) {
            LF.info("event " + type, detail);
        }
    };

    LF.markUnsupported = function (name, reason) {
        var entry = LF.diag.unsupported[name];
        if (!entry) {
            entry = LF.diag.unsupported[name] = {count: 0, firstAt: Math.floor(Date.now() / 1000), reason: reason || ""};
        }
        entry.count++;
        entry.lastAt = Math.floor(Date.now() / 1000);
    };

    LF.model = function (Type) {
        try {
            return core.ModelManage.getInstance().getModel(Type);
        } catch (error) {
            return null;
        }
    };

    LF.dispatchClientEvent = function (type, param0, param1) {
        try {
            var target = LF.control();
            if (target && target.dispatchEvent) {
                target.dispatchEvent(new core.Event(type, param0, param1));
                return true;
            }
        } catch (error) {
            LF.error("dispatchClientEvent failed: " + type, String(error));
        }
        return false;
    };

    LF.control = function () {
        if (typeof NetworkControl !== "undefined" && NetworkControl.getInstance) {
            return NetworkControl.getInstance();
        }
        return null;
    };


/* ---- 10_util.js ---- */
    /* ------------------------------------------------------------------
     * 10 基础工具
     * ------------------------------------------------------------------ */
    var util = LF.util = {};

    util.clone = function (value) {
        if (value === undefined) {
            return undefined;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return null;
        }
    };

    util.isObject = function (value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    };

    util.isNumber = function (value) {
        return typeof value === "number" && isFinite(value);
    };

    util.toInt = function (value, fallback) {
        var number = Number(value);
        if (!isFinite(number)) {
            return fallback === undefined ? 0 : fallback;
        }
        return Math.floor(number);
    };

    util.toArray = function (value) {
        if (value === null || value === undefined) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    };

    util.has = function (object, key) {
        return !!object && Object.prototype.hasOwnProperty.call(object, key);
    };

    /* 只补齐缺失字段，不覆盖已有值（用于旧档迁移/未知字段保留） */
    util.fillDefaults = function (target, defaults) {
        if (target === null || target === undefined) {
            target = {};
        }
        for (var key in defaults) {
            if (!util.has(defaults, key)) {
                continue;
            }
            var fallback = defaults[key];
            if (target[key] === undefined || target[key] === null) {
                target[key] = util.clone(fallback);
            } else if (util.isObject(fallback) && util.isObject(target[key])) {
                util.fillDefaults(target[key], fallback);
            }
        }
        return target;
    };

    util.uuid = function () {
        if (typeof core !== "undefined" && core.String && core.String.uuid) {
            return core.String.uuid();
        }
        var text = "";
        var alphabet = "0123456789abcdef";
        while (text.length < 32) {
            text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        return text;
    };

    util.pad2 = function (value) {
        return (value < 10 ? "0" : "") + value;
    };

    util.dayKey = function (seconds) {
        var date = new Date(seconds * 1000);
        return date.getFullYear() + "-" + util.pad2(date.getMonth() + 1) + "-" + util.pad2(date.getDate());
    };

    util.percent = function (value) {
        return Math.round(value * 10000) / 100;
    };

    LF.log = function (level, message, data) {
        var entry = {
            t: Math.floor(Date.now() / 1000),
            level: level,
            msg: String(message)
        };
        if (data !== undefined) {
            entry.data = data;
        }
        LF.diag.logs.push(entry);
        while (LF.diag.logs.length > 400) {
            LF.diag.logs.shift();
        }
        if (level === "error") {
            LF.diag.errors.push(entry);
            while (LF.diag.errors.length > 50) {
                LF.diag.errors.shift();
            }
        }
        /* 统一走 console，安全环境下（Egret/WebView）直接可见 */
        var console2 = global.console;
        if (console2 && console2.log) {
            if (LF.flags.verboseLog || level === "error" || level === "warn") {
                console2.log("[LF][" + level + "] " + message, data === undefined ? "" : data);
            }
        }
    };

    LF.info = function (message, data) {
        LF.log("info", message, data);
    };
    LF.warn = function (message, data) {
        LF.log("warn", message, data);
    };
    LF.error = function (message, data) {
        LF.log("error", message, data);
    };

    /* 诊断事件：影响存档的行为都会落一条，便于验收与回放 */
    LF.record = function (type, detail) {
        var entry = {
            t: Math.floor(Date.now() / 1000),
            rev: LF.state.data ? LF.state.data.header.revision : 0,
            type: type
        };
        if (detail !== undefined) {
            entry.detail = detail;
        }
        LF.diag.events.push(entry);
        while (LF.diag.events.length > 300) {
            LF.diag.events.shift();
        }
        if (LF.flags.verboseLog) {
            LF.info("event " + type, detail);
        }
    };

    LF.markUnsupported = function (name, reason) {
        var entry = LF.diag.unsupported[name];
        if (!entry) {
            entry = LF.diag.unsupported[name] = {count: 0, firstAt: Math.floor(Date.now() / 1000), reason: reason || ""};
        }
        entry.count++;
        entry.lastAt = Math.floor(Date.now() / 1000);
    };

    LF.model = function (Type) {
        try {
            return core.ModelManage.getInstance().getModel(Type);
        } catch (error) {
            return null;
        }
    };

    LF.dispatchClientEvent = function (type, param0, param1) {
        try {
            var target = LF.control();
            if (target && target.dispatchEvent) {
                target.dispatchEvent(new core.Event(type, param0, param1));
                return true;
            }
        } catch (error) {
            LF.error("dispatchClientEvent failed: " + type, String(error));
        }
        return false;
    };

    LF.control = function () {
        if (typeof NetworkControl !== "undefined" && NetworkControl.getInstance) {
            return NetworkControl.getInstance();
        }
        return null;
    };

/* ---- 20_clock.js ---- */
    /* ------------------------------------------------------------------
     * 20 本地时钟与可复现随机 (A07 / A09)
     *
     * 时间基准：state.clock 保存“服务器时间锚点 + 本机时间锚点”。
     * 单调性：任何情况下 now() 都不会小于上一次返回值；设备时间回拨只记录事件，
     *         不会让草田/制作/商店队列回到过去或死循环。
     * ------------------------------------------------------------------ */
    var clock = LF.clock = {};

    clock.defaults = function () {
        var now = Math.floor(Date.now() / 1000);
        return {
            anchorServer: now,
            anchorLocal: now,
            lastNow: now,
            lastLocalSeen: now,
            rollbackCount: 0,
            timeTravelSeconds: 0
        };
    };

    clock.init = function () {
        var data = LF._transactionState || LF.state.data;
        util.fillDefaults(data.clock, clock.defaults());
        data.clock.lastNow = Math.max(data.clock.lastNow || 0, data.clock.anchorServer);
    };

    /** 本地权威时间（秒）。 */
    clock.now = function () {
        var data = LF._transactionState || LF.state.data;
        if (!data) {
            return Math.floor(Date.now() / 1000);
        }
        var state = data.clock;
        var localNow = Math.floor(Date.now() / 1000);
        if (localNow < state.lastLocalSeen) {
            state.rollbackCount = (state.rollbackCount || 0) + 1;
            LF.record("clock.rollback", {from: state.lastLocalSeen, to: localNow});
            state.anchorLocal = localNow;
            state.anchorServer = state.lastNow - (state.timeTravelSeconds || 0);
        }
        var elapsed = localNow - state.anchorLocal;
        var current = state.anchorServer + elapsed + (state.timeTravelSeconds || 0);
        state.lastLocalSeen = localNow;
        if (current < state.lastNow) {
            current = state.lastNow;
        }
        state.lastNow = current;
        return current;
    };

    /** 把本地时钟同步到 core.Time，保证 UI 与规则层使用同一时间基准。 */
    clock.syncClient = function () {
        try {
            if (typeof core !== "undefined" && core.Time && core.Time.setServerTime) {
                core.Time.setServerTime(clock.now());
            }
        } catch (error) {
            LF.warn("clock.syncClient failed", String(error));
        }
    };

    clock.dayKey = function () {
        return util.dayKey(clock.now());
    };

    /** 诊断用：受控时间推进，不修改设备时间。 */
    clock.timeTravel = function (seconds) {
        var amount = util.toInt(seconds, 0);
        LF.state.data.clock.timeTravelSeconds = (LF.state.data.clock.timeTravelSeconds || 0) + amount;
        LF.state.data.clock.lastNow += amount;
        LF.record("clock.timeTravel", {seconds: amount});
        clock.syncClient();
        return clock.now();
    };

    /* ------------------------------------------------------------------
     * 可复现随机：种子与计数都落在存档里，同样的存档重放同样的结果。
     * ------------------------------------------------------------------ */
    var rng = LF.rng = {};

    rng.defaults = function () {
        return {
            seed: (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() & 0xffffffff)) >>> 0,
            counter: 0
        };
    };

    rng.init = function () {
        var data = LF.state.data;
        util.fillDefaults(data.rng, rng.defaults());
        rng._value = data.rng.seed >>> 0;
        rng._counter = data.rng.counter || 0;
        rng._spin();
    };

    /* 计数器混入，保证重进游戏后序列不重复。 */
    rng._spin = function () {
        var state = (LF._transactionState || LF.state.data).rng;
        var seed = (state.seed >>> 0) + (state.counter >>> 0) * 0x9e3779b1;
        var value = seed >>> 0;
        value ^= value << 13;
        value >>>= 0;
        value ^= value >> 17;
        value ^= value << 5;
        value >>>= 0;
        rng._value = value;
    };

    rng.next = function () {
        var data = LF._transactionState || LF.state.data;
        var state = data && data.rng;
        if (!state) {
            /* 存档尚未建立（新档生成阶段）时使用进程内回退序列 */
            rng._fallback = ((rng._fallback || 0x2545f491) * 1664525 + 1013904223) >>> 0;
            return rng._fallback / 4294967296;
        }
        state.counter = (state.counter || 0) + 1;
        rng._spin();
        return rng._value / 4294967296;
    };

    rng.range = function (min, max) {
        return min + (max - min) * rng.next();
    };

    rng.int = function (min, max) {
        if (max < min) {
            var swap = min;
            min = max;
            max = swap;
        }
        return min + Math.floor(rng.next() * (max - min + 1));
    };

    rng.chance = function (percent) {
        return rng.next() * 100 < percent;
    };

    /** 截断正态：草田再生时间使用（规则来自客户端 CloverFarm 常量）。 */
    rng.normalClamped = function (mu, sigma, min, max) {
        var u1 = Math.max(rng.next(), 1e-9);
        var u2 = rng.next();
        var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        var value = mu + sigma * z;
        if (value < min) {
            value = min;
        }
        if (value > max) {
            value = max;
        }
        return Math.round(value);
    };

    rng.pick = function (list) {
        if (!list || list.length === 0) {
            return null;
        }
        return list[rng.int(0, list.length - 1)];
    };

    rng.reseed = function (seed) {
        var state = LF.state.data.rng;
        state.seed = util.toInt(seed, 1) >>> 0;
        state.counter = 0;
        rng._spin();
        LF.record("rng.reseed", {seed: state.seed});
        return state.seed;
    };


/* ---- 30_state.js ---- */
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
    compost.start = function (work, effects) {
        if (!compost.isOpen(work)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"compost-unavailable"};
        if (work.compost.process && work.compost.process.state === "running") return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"compost-running"};
        var filled=work.compost.box_list.filter(function(id){return util.toInt(id,-1)>=0;}).length;
        if (!filled) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"compost-empty"};
        var now=clock.now(); work.compost.process={state:"running",started_at:now,finish_at:now+3600,reward_clover:filled*10};
        work.compost.state=1; rules.effect(effects,"compost"); return {ok:true,code:LF.ERR.OK,finish_at:now+3600};
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
        return {
            show_list: util.clone(util.toArray(work.flowerpot.show_list)),
            list: util.clone(util.toArray(work.flowerpot.list)),
            plant_list: util.clone(util.toArray(work.flowerpot.plant_list))
        };
    };
    rules.flowerpot = rules.flowerpot || {};
    var flowerpot = rules.flowerpot;
    flowerpot.ensure = function (work) {
        if (!util.isObject(work.flowerpot)) work.flowerpot = {show_list: [], list: [], plant_list: []};
        if (!Array.isArray(work.flowerpot.show_list)) work.flowerpot.show_list = [];
        if (!Array.isArray(work.flowerpot.list)) work.flowerpot.list = [];
        if (!Array.isArray(work.flowerpot.plant_list)) work.flowerpot.plant_list = [];
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
        return {duration: Math.max(1, duration), reward_id: rewardId, reward_count: rewardCount};
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
        var now = clock.now(), plant = {type:type, index:index, id:seedId, seed_id:seedId, stage:1, state:"growing", started_at:now, finish_time:now + recipe.duration, reward_id:recipe.reward_id, reward_count:recipe.reward_count};
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

/* ---- 63_activities.js ---- */
    /* ------------------------------------------------------------------
     * 63 活动玩法本地容器（C01-C17）
     * 活动规则尚未有统一的原版配方时，先提供可持久化、可恢复、可领取一次的
     * 状态接口。未知字段原样保留，便于在线账号导入和后续按活动逐项替换规则。
     * ------------------------------------------------------------------ */
    var activities = LF.activities = {};
    activities.keys = ["visit", "story", "misc_moment", "easteregg", "touch", "wishingpool", "lottery", "animpicture", "museum", "calendar", "calendar_note", "recharge", "recharge_gift", "recharge_num", "adsmgr", "rank", "cooking", "capsule", "greetcard", "springcard", "partycake", "museumday", "pray"];
    activities.ensure = function (work) {
        if (!util.isObject(work.activities)) work.activities = {};
        activities.keys.forEach(function (key) {
            if (!util.isObject(work.activities[key])) work.activities[key] = {};
        });
        return work.activities;
    };
    activities.read = function (work, key) {
        var all = activities.ensure(work);
        return util.clone(all[key] || {});
    };
    activities.merge = function (work, key, patch, effects) {
        if (activities.keys.indexOf(key) < 0 || !util.isObject(patch)) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:"activity"};
        var all = activities.ensure(work), target = all[key];
        Object.keys(patch).forEach(function (field) { target[field] = util.clone(patch[field]); });
        rules.effect(effects, "activities");
        return {ok:true, code:LF.ERR.OK, changed:{activity:key, fields:Object.keys(patch)}};
    };
    activities.claim = function (work, key, params, effects) {
        var all = activities.ensure(work), target = all[key];
        if (!target || !util.isObject(target)) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"activity"};
        var claimKey = String((params && params.key) || "claimed");
        if (target[claimKey] === true) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"already-claimed"};
        target[claimKey] = true;
        rules.effect(effects, "activities");
        return {ok:true, code:LF.ERR.OK, changed:{activity:key, claim:claimKey}};
    };
    activities.snapshot = function (work) { return util.clone(activities.ensure(work)); };

    /* C06 祈福/手作：材料消耗和成品确认采用与工作台相同的持久化事务。 */
    var pray = rules.pray = {};
    pray.ensure = function (work) {
        var value = activities.ensure(work).pray;
        if (!util.isObject(value)) value = activities.ensure(work).pray = {};
        if (!Array.isArray(value.wishs)) value.wishs = [];
        if (!Array.isArray(value.stamps)) value.stamps = [];
        if (!Array.isArray(value.boxes)) value.boxes = [];
        return value;
    };
    pray.compose = function (work, params, effects) {
        params = util.isObject(params) ? params : {};
        var value = pray.ensure(work);
        if (value.process && (value.process.state === "running" || value.process.state === "ready")) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"pray-running"};
        var output = util.toInt(params.output_id !== undefined ? params.output_id : params.item_id, -1), count = Math.max(1,util.toInt(params.output_count || params.count,1));
        if (output < 0 || !rules.itemInfo(output)) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"pray-output"};
        var inputs = Array.isArray(params.inputs) ? params.inputs : [];
        for (var i=0;i<inputs.length;i++) { var id=util.toInt(inputs[i].item_id !== undefined ? inputs[i].item_id : inputs[i].id,-1), n=Math.max(1,util.toInt(inputs[i].count || inputs[i].num,1)); if(id<0 || !rules.itemInfo(id) || rules.items.count(work,id)<n)return {ok:false,code:LF.ERR.NO_ITEM,reason:"pray-material:"+id}; }
        for (var j=0;j<inputs.length;j++) { var cid=util.toInt(inputs[j].item_id !== undefined ? inputs[j].item_id : inputs[j].id,-1); var taken=rules.items.consume(work,cid,Math.max(1,util.toInt(inputs[j].count || inputs[j].num,1)),effects); if(!taken.ok)return taken; }
        var now=clock.now(), finish=now+Math.max(1,util.toInt(params.duration,3600));
        value.process={state:"running",output_id:output,output_count:count,started_at:now,finish_at:finish,inputs:util.clone(inputs)};
        rules.effect(effects,"activities"); return {ok:true,code:LF.ERR.OK,finish_at:finish};
    };
    pray.finish = function (work,effects,now) { var v=pray.ensure(work),p=v.process;if(!p||p.state!=="running"||util.toInt(p.finish_at,0)>now)return {ok:true,skipped:true};p.state="ready";rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK}; };
    pray.confirm = function (work,effects) { var v=pray.ensure(work),p=v.process;if(!p||p.state!=="ready"||p.finish_at>clock.now())return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"pray-not-ready"};var add=rules.items.add(work,p.output_id,p.output_count,effects);if(!add.ok)return add;v.boxes.push({item_id:p.output_id,count:p.output_count,created_at:clock.now(),claimed:false});v.process=null;rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK,item_list:[{item_id:p.output_id,count:p.output_count}]}; };

    /* C02/C03 ?????????????? */
    rules.visit = rules.visit || {};
    rules.visit.open = function(work, params, effects) { var v=activities.ensure(work).visit;if(v.visitor && v.visitor.status !== "closed" && v.visitor.status !== "expired") return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"visitor-exists"};var now=clock.now(), visitorId=util.toInt(params&& (params.id||params.visitor_id),1);v.visitor_id=visitorId;v.visitor={id:visitorId,visitor_id:util.toInt(params&&params.visitor_id,0),name:String((params&&params.name)||""),arrived_at:now,expires_at:util.toInt(params&&params.expire_at,now+86400),status:"open",carpet_id:util.toInt(params&&params.carpet_id,0),served:false};rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK,visitor:util.clone(v.visitor)}; };
    rules.visit.setExpire = function(work, params, effects) { var v=activities.ensure(work).visit;if(!v.visitor)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"visitor-none"};var at=util.toInt(params&& (params.time||params.expire_at),0);if(at<=clock.now())return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:"expire-time"};v.visitor.expires_at=at;rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK}; };
    rules.story = rules.story || {};
    rules.story.read = function(work, params, effects) { var v=activities.ensure(work).story;var id=params&& (params.id||params.story_id);v.read_ids=Array.isArray(v.read_ids)?v.read_ids:[];if(id!==undefined&&v.read_ids.indexOf(id)<0)v.read_ids.push(id);v.story_id=id;v.new_story_id=0;rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK}; };
    rules.story.sendGift = function(work, params, effects) { var v=activities.ensure(work).story;var id=util.toInt(params&& (params.item_id||params.gift_id),-1);if(id<0)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:"gift"};var take=rules.items.consume(work,id,1,effects);if(!take.ok)return take;v.gifts=Array.isArray(v.gifts)?v.gifts:[];v.gifts.push({story_id:params.story_id||params.id,item_id:id,at:clock.now()});rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK}; };
    /* ---------------- C14 日历/签到 ----------------
     * 日历是一个独立的持久化分区。服务器原本会按自然日下发任务和
     * 幸运/特殊日结果；离线版在首次读取或提交时完成换日，并以 claim
     * 键保证奖励只结算一次。配置存在时优先使用 CalendarData，缺少
     * 配置时保留空列表，避免把未知的原版奖励误当成已解锁内容。
     */
    var calendar = rules.calendar = {};
    calendar.dayKey = function (at) {
        var date = new Date(util.toInt(at, clock.now()) * 1000);
        return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
    };
    calendar.ensure = function (work, effects) {
        var all = activities.ensure(work), value = all.calendar;
        if (!util.isObject(value) || Array.isArray(value)) value = all.calendar = {};
        if (!Array.isArray(value.new_flag)) value.new_flag = [];
        if (!Array.isArray(value.note_list)) value.note_list = [];
        if (!Array.isArray(value.lucky_days)) value.lucky_days = [];
        if (!Array.isArray(value.st_days)) value.st_days = [];
        if (!Array.isArray(value.task_list)) value.task_list = [];
        if (!util.isObject(value.claimed)) value.claimed = {};
        var key = calendar.dayKey(clock.now());
        if (value.day_key && value.day_key !== key) {
            value.day_key = key;
            value.new_flag = [];
            value.lucky_days = [];
            value.st_days = [];
            value.task_list = [];
            /* claim history is intentionally retained; it is part of the save. */
            if (effects) rules.effect(effects, "activities");
        }
        if (!value.day_key) value.day_key = key;
        return value;
    };
    calendar.snapshot = function (work) {
        var value = calendar.ensure(work);
        /* Existing global tasks remain visible for old saves and clients. */
        var tasks = value.task_list.length ? value.task_list : (rules.tasks && rules.tasks.snapshot ? rules.tasks.snapshot(work).tasks : []);
        return {
            new_flag: util.clone(value.new_flag),
            task_list: util.clone(tasks),
            lucky_days: util.clone(value.lucky_days),
            st_days: util.clone(value.st_days),
            refresh_time: clock.now() + 86400
        };
    };
    calendar.noteSnapshot = function (work) {
        var all = activities.ensure(work), note = all.calendar_note;
        if (!util.isObject(note)) note = all.calendar_note = {};
        if (!Array.isArray(note.list)) note.list = [];
        return {list: util.clone(note.list)};
    };
    calendar.taskUpdate = function (work, params, effects) {
        params = util.isObject(params) ? params : {};
        var value = calendar.ensure(work, effects), id = params.id !== undefined ? params.id : params.task_id;
        if (id === undefined || id === null) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:"calendar-task-id"};
        var amount = Math.max(1, util.toInt(params.num !== undefined ? params.num : params.amount, 1));
        var found = null;
        for (var i = 0; i < value.task_list.length; i++) if (String(value.task_list[i].id) === String(id)) found = value.task_list[i];
        if (!found) { found = {id:id, progress:0, target:1, claimed:false}; value.task_list.push(found); }
        found.progress = Math.min(Math.max(0, util.toInt(found.target, 1)), Math.max(0, util.toInt(found.progress, 0) + amount));
        /* Keep the legacy task model in sync so imported saves using tasks.list continue to work. */
        if (rules.tasks && rules.tasks.update) rules.tasks.update(work, id, amount, effects);
        rules.effect(effects, "activities");
        return {ok:true, code:LF.ERR.OK, task:util.clone(found)};
    };
    calendar.findReward = function (list, day) {
        var key = String(util.toInt(day, 0));
        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            if (row && String(row.day) === key) return row;
        }
        return null;
    };
    calendar.claim = function (work, kind, params, effects) {
        params = util.isObject(params) ? params : {};
        var value = calendar.ensure(work, effects), day = util.toInt(params.day, 0), claimKey = kind + ":" + (day || value.day_key);
        if (value.claimed[claimKey]) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"already-claimed"};
        var row = null, reward = null;
        if (kind === "beginner") {
            if (day < 1 || day > 7) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:"beginner-day"};
            row = config.get("CalendarData", "beginner");
            row = Array.isArray(row) ? row[day - 1] : null;
            reward = row ? {item_id:util.toInt(row.item_id, -1), count:Math.max(1, util.toInt(row.num || row.count, 1))} : {clover:10};
        } else {
            row = calendar.findReward(kind === "luck" ? value.lucky_days : value.st_days, day);
            if (!row) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"calendar-reward-unavailable"};
            reward = {item_id:util.toInt(row.item_id, -1), count:Math.max(1, util.toInt(row.count, 1))};
        }
        var granted;
        if (reward.clover) granted = rules.wallet.grant(work, {clover:reward.clover}, effects);
        else if (reward.item_id >= 0) granted = rules.items.add(work, reward.item_id, reward.count, effects);
        else return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"calendar-reward-invalid"};
        if (!granted.ok) return granted;
        value.claimed[claimKey] = true;
        if (kind === "beginner") value.new_flag[day - 1] = 1;
        else if (row) row.claimed = true;
        rules.effect(effects, "activities");
        return {ok:true, code:LF.ERR.OK, day:day, reward:reward};
    };

/* ---- 65_travel.js ---- */
    /* M2.1 local travel state machine */
    var travel = LF.rules.travel = {};
    travel.DURATION_SECONDS = 3600;
    travel.ensure = function (work) {
        if (!util.isObject(work.travel)) { work.travel = util.clone(LF.stateDefaults().travel); }
        if (!Array.isArray(work.travel.bag)) { work.travel.bag = []; }
        if (!util.isObject(work.events)) { work.events = {pending: [], settled: [], nextId: 1}; }
        if (!Array.isArray(work.events.pending)) { work.events.pending = []; }
        if (!Array.isArray(work.events.settled)) { work.events.settled = []; }
        if (!util.isObject(work.mail)) { work.mail = {mails: [], nextId: 1, pictures: [], specialtys: [], notes: []}; }
        if (!Array.isArray(work.mail.pictures)) { work.mail.pictures = []; }
        if (!Array.isArray(work.mail.specialtys)) { work.mail.specialtys = []; }
        if (!Array.isArray(work.mail.notes)) { work.mail.notes = []; }
        return work.travel;
    };
    travel.snapshot = function (work) {
        var v = travel.ensure(work);
        return {status:v.status, trip_id:v.tripId, destination_id:util.toInt(v.destinationId,0), companion_id:util.toInt(v.companionId,0), started_at:util.toInt(v.startedAt,0), eta_at:util.toInt(v.etaAt,0), returned_at:util.toInt(v.returnedAt,0), bag:util.clone(v.bag), result:util.clone(v.result), settled:!!v.settled, last_trip_id:v.lastTripId || '', next_event_at:util.toInt(v.nextEventAt,0)};
    };
    travel.event = function (work, type, value, stringValue, picture) {
        var id = util.toInt(work.events.nextId,1); work.events.nextId = id + 1;
        return {id:id, evt_id:id, evt_type:type, evt_value:util.clone(value || []), evt_string:util.clone(stringValue || []), evt_pic:picture || null, created_at:clock.now()};
    };
    travel.addEvent = function (work, event, effects) {
        work.events.pending.push(event); while (work.events.pending.length > 100) { work.events.pending.shift(); } rules.effect(effects,'events');
    };
    travel.prepare = function (work, params, effects) {
        var v=travel.ensure(work); params=params || {};
        if (v.status !== 'home' && !(v.status === 'result' && v.settled)) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'travel-not-at-home'};
        var bag=util.toArray(work.items.bag).filter(function(id){return util.toInt(id,-1)>=0;});
        if (params.requireBag && bag.length===0) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'empty-bag'};
        var now=clock.now(); var tripId=String(params.tripId || (work.header.saveId+'-'+now+'-'+util.toInt(work.header.revision,0)));
        v.status='ready'; v.tripId=tripId; v.destinationId=util.toInt(params.destinationId,1); v.companionId=util.toInt(params.companionId,0); v.startedAt=0; v.etaAt=0; v.returnedAt=0; v.bag=bag; v.result=null; v.settled=false; v.nextEventAt=0;
        work.items.bag=[-1,-1,-1,-1]; work.items.bagCompleted=false; work.role.frogStatus=0; work.role.frogMotion=0;
        rules.effect(effects,'travel'); rules.effect(effects,'container'); rules.effect(effects,'role');
        return {ok:true,code:LF.ERR.OK,changed:{status:v.status,tripId:tripId,bag:bag}};
    };
    travel.start = function (work, params, effects) {
        var v=travel.ensure(work); params=params || {}; if (v.status !== 'ready') return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'travel-not-ready'};
        var now=clock.now(); var duration=util.toInt(params.duration,travel.DURATION_SECONDS); if (duration<60) duration=60;
        v.status='traveling'; v.startedAt=now; v.etaAt=now+duration; v.nextEventAt=v.etaAt; work.role.frogStatus=1; work.role.frogMotion=1;
        travel.addEvent(work,travel.event(work,1,[v.companionId>0?1:0],[v.tripId]),effects); rules.effect(effects,'travel'); rules.effect(effects,'role');
        return {ok:true,code:LF.ERR.OK,changed:{status:v.status,etaAt:v.etaAt}};
    };
    travel.prepareAndStart = function(work,params,effects){var a=travel.prepare(work,params,effects); if(!a.ok)return a; var b=travel.start(work,params,effects); if(!b.ok)return b; return {ok:true,code:LF.ERR.OK,changed:{prepared:a.changed,started:b.changed}};};
    travel.advance = function(work,effects,now){
        var v=travel.ensure(work); now=now || clock.now(); if(v.status!=='traveling' || !v.etaAt || now<v.etaAt)return {ok:true,skipped:true};
        var reward=10+Math.min(20,v.bag.length*2); var picture={id:v.tripId+'-picture',pic_id:v.destinationId,long_id:v.tripId,destination_id:v.destinationId,layers:[],created_at:now};
        v.status='result'; v.returnedAt=now; v.nextEventAt=0; v.result={clover:reward,ticket:0,items:[],picture:picture,source:'local'}; v.settled=false; work.role.frogStatus=0; work.role.frogMotion=0;
        travel.addEvent(work,travel.event(work,2,[reward,0,-1],[v.tripId],picture),effects); rules.effect(effects,'travel'); rules.effect(effects,'role');
        return {ok:true,changed:{status:v.status,reward:reward}};
    };
    travel.claim = function(work,params,effects){
        var v=travel.ensure(work); params=params || {}; if(v.status!=='result' || v.settled || !v.result)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'travel-result-unavailable'}; if(params.tripId && String(params.tripId)!==String(v.tripId))return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'trip-id'};
        var result=v.result; var grant=rules.wallet.grant(work,{clover:util.toInt(result.clover,0),ticket:util.toInt(result.ticket,0)},effects); if(!grant.ok)return grant;
        if(result.picture) { work.mail.pictures.push(util.clone(result.picture)); }
        if (rules.tasks && rules.tasks.update) { rules.tasks.update(work, 'travel_return', 1, effects); }
        var pending=work.events.pending; for(var i=pending.length-1;i>=0;i--){if(pending[i] && pending[i].evt_pic && pending[i].evt_pic.long_id===v.tripId){work.events.settled.push(pending[i]);pending.splice(i,1);}}
        v.status='home'; v.lastTripId=v.tripId; v.settled=true; v.result=null; v.bag=[]; v.tripId=''; rules.effect(effects,'travel'); rules.effect(effects,'events');
        return {ok:true,code:LF.ERR.OK,changed:{status:v.status,clover:result.clover,picture:!!result.picture}};
    };
    travel.confirmEvent = function(work,id,effects){
        var target=util.toInt(id,-1), pending=util.toArray(work.events.pending); for(var i=0;i<pending.length;i++){var e=pending[i]; if(util.toInt(e && (e.id!==undefined?e.id:e.evt_id),-1)!==target)continue; if(e.evt_type===2 && work.travel.status==='result')return travel.claim(work,{tripId:work.travel.tripId},effects); pending.splice(i,1); work.events.settled.push(e); rules.effect(effects,'events'); return {ok:true,code:LF.ERR.OK,changed:{confirmed:target}};} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'event-not-found'};
    };
    travel.eventsSnapshot=function(work){travel.ensure(work);return util.clone(work.events.pending);};
    travel.noteSnapshot=function(work){travel.ensure(work);return {note_list:util.clone(work.mail.notes)};};
    travel.giftSnapshot=function(work){travel.ensure(work);return {pictures:util.clone(work.mail.pictures),specialtys:util.clone(work.mail.specialtys)};};

/* ---- 67_album.js ---- */
    /* B07: the client AlbumView renders six pictures per page. Item 9000 is
     * a permanent extra page, also used by its expansion tooltip. */
    var album = LF.rules.album = {};
    album.BASE_PAGES = 30;
    album.MAX_EXTRA_PAGES = 56;
    album.PICTURES_PER_PAGE = 6;
    album.PAGE_ITEM = 9000;
    album.PRICES = [1000, 1250, 1500, 2000, 3000, 2000, 1500, 1250];

    album.ensure = function (work) {
        if (!util.isObject(work.album)) { work.album = {}; }
        var a = work.album;
        ["pictures", "newPictures", "deleted"].forEach(function (key) {
            if (!Array.isArray(a[key])) { a[key] = []; }
        });
        if (a.mechanismVersion !== 2) {
            // Old local builds stored pages in capacity but enforced a photo limit.
            // Preserve paid pages; the old expansionCount counted purchases, not pages.
            var extra = Math.max(0, util.toInt(a.capacity, 30) - 30,
                util.toInt(work.items.house[album.PAGE_ITEM], 0));
            extra = Math.min(album.MAX_EXTRA_PAGES, extra);
            a.capacity = album.BASE_PAGES + extra;
            a.expansionCount = extra;
            if (extra > 0) { work.items.house[album.PAGE_ITEM] = extra; }
            a.mechanismVersion = 2;
        }
        a.capacity = Math.min(86, Math.max(30, util.toInt(a.capacity, 30)));
        a.expansionCount = a.capacity - album.BASE_PAGES;
        return a;
    };
    album.limit = function (work) { return album.ensure(work).capacity * album.PICTURES_PER_PAGE; };
    album.snapshot = function (work) {
        var a = album.ensure(work);
        return {pictures: util.clone(a.pictures), new_pictures: util.clone(a.newPictures),
            deleted: util.clone(a.deleted), total: a.pictures.length, capacity: a.capacity,
            photo_capacity: album.limit(work), expansion_count: a.expansionCount};
    };
    album.nextPrice = function (work) {
        var a = album.ensure(work);
        return a.expansionCount >= album.MAX_EXTRA_PAGES ? null : album.PRICES[a.expansionCount % 8];
    };
    album.expand = function (work, params, effects) {
        var a = album.ensure(work), pages = params && params.pages;
        if (pages !== undefined && Number(pages) !== 1) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "album-one-page-per-purchase"};
        }
        var cost = album.nextPrice(work);
        if (cost === null) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "album-max"}; }
        var paid = rules.wallet.consume(work, {clover: cost}, effects);
        if (!paid.ok) { return paid; }
        a.capacity++;
        a.expansionCount++;
        work.items.house[album.PAGE_ITEM] = a.expansionCount;
        rules.effect(effects, "items", album.PAGE_ITEM);
        rules.effect(effects, "album");
        return {ok: true, code: LF.ERR.OK, changed: {capacity: a.capacity, cost: cost, pages: 1}};
    };
    album.indexOf = function (list, id) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === String(id)) { return i; }
        }
        return -1;
    };
    album.forget = function (list, id) {
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i] && String(list[i].id) === String(id)) { list.splice(i, 1); }
        }
    };
    album.trash = function (work, picture, effects) {
        var a = album.ensure(work);
        album.forget(a.deleted, picture.id);
        a.deleted.push(picture);
        while (a.deleted.length > 6) { a.deleted.shift(); }
        rules.effect(effects, "album");
    };
    album.load = function (work, start, count) {
        var a = album.ensure(work), s = Math.max(1, util.toInt(start, 1));
        var list = a.pictures.slice(s - 1, s - 1 + Math.max(1, util.toInt(count, 6)));
        return {pictures: util.clone(list), start: s, total: a.pictures.length, count: list.length};
    };
    album.loadIds = function (work, ids) {
        var wanted = util.toArray(ids).map(String);
        return {pic_list: util.clone(album.ensure(work).pictures.filter(function (p) {
            return p && wanted.indexOf(String(p.id)) >= 0;
        }))};
    };
    album.remove = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.pictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "picture-not-found"}; }
        album.trash(work, a.pictures.splice(index, 1)[0], effects);
        return {ok: true, code: LF.ERR.OK};
    };
    album.recover = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.deleted, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "picture-not-in-trash"}; }
        if (a.pictures.length >= album.limit(work)) {
            return {ok: false, code: 75, reason: "album-full"};
        }
        a.pictures.push(a.deleted.splice(index, 1)[0]);
        rules.effect(effects, "album");
        return {ok: true, code: LF.ERR.OK};
    };
    album.saveNew = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.newPictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "new-picture-not-found"}; }
        // A failed save leaves the photo pending. Only explicit rejection trashes it.
        if (a.pictures.length >= album.limit(work)) {
            album.trash(work, a.newPictures.splice(index, 1)[0], effects);
            return {ok: true, code: 75, response: {code: 75}, reason: "album-full"};
        }
        a.pictures.push(a.newPictures.splice(index, 1)[0]);
        rules.effect(effects, "album");
        if (rules.tasks) { rules.tasks.update(work, "album_save", 1, effects); }
        return {ok: true, code: LF.ERR.OK};
    };
    album.deleteNew = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.newPictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "new-picture-not-found"}; }
        album.trash(work, a.newPictures.splice(index, 1)[0], effects);
        return {ok: true, code: LF.ERR.OK};
    };
    album.toGift = function (work, id, effects) {
        var a = album.ensure(work), m = rules.mail.ensure(work), index = album.indexOf(a.pictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "picture-not-found"}; }
        var picture = a.pictures.splice(index, 1)[0];
        album.forget(m.pictures, id);
        album.forget(a.newPictures, id);
        album.forget(a.deleted, id);
        m.pictures.push(picture);
        rules.effect(effects, "album"); rules.effect(effects, "mail");
        return {ok: true, code: LF.ERR.OK};
    };
    album.fromGift = function (work, id, effects) {
        var a = album.ensure(work), m = rules.mail.ensure(work), index = album.indexOf(m.pictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "gift-picture-not-found"}; }
        if (album.indexOf(a.pictures, id) < 0 && a.pictures.length >= album.limit(work)) {
            return {ok: false, code: 101, reason: "album-full"};
        }
        var picture = m.pictures.splice(index, 1)[0];
        album.forget(a.pictures, id);
        album.forget(a.newPictures, id);
        album.forget(a.deleted, id);
        a.pictures.push(picture);
        rules.effect(effects, "album"); rules.effect(effects, "mail");
        return {ok: true, code: LF.ERR.OK};
    };

/* ---- 68_mail.js ---- */
    /* M2.3 本地邮件与旅行礼品盒。 */
    var mail = LF.rules.mail = {};
    mail.ensure = function (work) {
        if (!util.isObject(work.mail)) { work.mail = {mails: [], nextId: 1, pictures: [], specialtys: [], notes: []}; }
        if (!Array.isArray(work.mail.mails)) { work.mail.mails = []; }
        if (!Array.isArray(work.mail.specialtys)) { work.mail.specialtys = []; }
        if (!Array.isArray(work.mail.pictures)) { work.mail.pictures = []; }
        if (!Array.isArray(work.mail.notes)) { work.mail.notes = []; }
        return work.mail;
    };
    mail.list = function (work, start, count) { var m=mail.ensure(work), s=Math.max(1,util.toInt(start,1)), c=Math.max(1,util.toInt(count,5)), rows=m.mails.slice(s-1,s-1+c); return {mails:util.clone(rows),start:s,count:rows.length,total:m.mails.length}; };
    mail.read = function (work,id,effects) { var m=mail.ensure(work); for(var i=0;i<m.mails.length;i++){if(util.toInt(m.mails[i].id,-1)===util.toInt(id,-1)){m.mails[i].read=true; rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK};}} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'mail-not-found'}; };
    mail.open = function (work,id,effects) { var m=mail.ensure(work); for(var i=0;i<m.mails.length;i++){var row=m.mails[i]; if(util.toInt(row.id,-1)!==util.toInt(id,-1))continue; if(row.opened)return {ok:true,code:LF.ERR.OK}; var grant=rules.wallet.grant(work,row.resource||{},effects); if(!grant.ok)return grant; util.toArray(row.items).forEach(function(item){rules.items.add(work,item.item_id,util.toInt(item.count,1),effects);}); row.opened=true; row.read=true; rules.effect(effects,'mail'); rules.effect(effects,'container'); return {ok:true,code:LF.ERR.OK}; } return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'mail-not-found'}; };
    mail.snapshot = function (work) { return mail.list(work,1,util.toInt(mail.ensure(work).mails.length,0)||1); };
    mail.expire = function (work, effects) { mail.ensure(work); return {ok:true,code:LF.ERR.OK,removed:0}; };
    mail.giftToBag = function (work,id,effects) { var m=mail.ensure(work), key=util.toInt(id,-1); for(var i=0;i<m.specialtys.length;i++){if(util.toInt(m.specialtys[i].item_id,-1)===key){var add=rules.items.add(work,key,1,effects);if(!add.ok)return add;m.specialtys.splice(i,1);rules.effect(effects,'mail');rules.effect(effects,'container');return {ok:true,code:LF.ERR.OK};}} return {ok:false,code:LF.ERR.NO_ITEM,reason:'gift-item-not-found'}; };
    mail.giftDeletePicture = function (work,id,effects) { var m=mail.ensure(work), key=String(id); for(var i=0;i<m.pictures.length;i++){if(String(m.pictures[i].id)===key){m.pictures.splice(i,1);rules.effect(effects,'mail');return {ok:true,code:LF.ERR.OK};}} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'gift-picture-not-found'}; };

/* ---- 70_server.js ---- */
    /* ------------------------------------------------------------------
     * 70 本地服务器 (A02/A03)
     *
     * 复用客户端 core.SocketManage 的完整契约：
     *   - 请求经原 send() 生成 {session, timestamp, cmd, data}
     *   - 响应/推送回灌 AnalysisProtocol，因此 session 回调、Model 回调、
     *     无回调命令、服务器主动推送四种路径的行为与联机时一致
     *   - 请求异步处理（定时器 0ms），避免同步回调破坏客户端的乐观更新顺序
     * ------------------------------------------------------------------ */
    var server = LF.server = {};

    server.queue = [];
    server.handlers = {};
    server.stats = {requests: 0, responses: 0, pushes: 0, failed: 0, unsupported: 0};
    server.recentRequests = [];
    /* Client session counters restart from zero on every process launch. */
    server.sessionEpoch = util.uuid();

    server.schedule = function (fn) {
        try {
            if (global.setTimeout) {
                global.setTimeout(fn, 0);
                return;
            }
        } catch (error) {
            /* ignore */
        }
        try {
            egret.setTimeout(fn, null, 0);
        } catch (error2) {
            /* ignore */
        }
    };

    /** 收到一条“网络”请求（由 fake socket 调用）。 */
    server.receive = function (text) {
        var request;
        try {
            request = JSON.parse(text);
        } catch (error) {
            LF.error("无法解析客户端请求", String(error));
            return;
        }
        server.queue.push(request);
        if (server.pendingFlush) {
            return;
        }
        server.pendingFlush = true;
        server.schedule(function () {
            server.pendingFlush = false;
            server.flush();
        });
    };

    server.flush = function () {
        var guard = 0;
        while (server.queue.length > 0 && guard < 200) {
            guard++;
            var request = server.queue.shift();
            try {
                server.dispatch(request);
            } catch (error) {
                LF.error("协议处理异常: " + request.cmd, String(error && error.stack ? error.stack : error));
                server.respond(request, {code: LF.ERR.GENERIC, msg: String(error)});
            }
        }
        if (guard >= 200) {
            LF.warn("单次处理请求过多，剩余 " + server.queue.length + " 条延后");
            if (server.queue.length && !server.pendingFlush) {
                server.pendingFlush = true;
                server.schedule(function () {
                    server.pendingFlush = false;
                    server.flush();
                });
            }
        }
    };

    server.protocolName = function (request) {
        return String(request.cmd || "").replace(".", "_");
    };

    server.respond = function (request, data) {
        server.stats.responses++;
        var socketManage = core.SocketManage.getInstance();
        var payload = {data: data === undefined ? {} : data};
        if (request.session !== undefined && request.session !== null && request.session !== "") {
            payload.session = request.session;
        } else {
            payload.cmd = String(request.cmd || "");
        }
        socketManage.AnalysisProtocol(egret.WebSocket.TYPE_STRING, JSON.stringify(payload));
    };

    server.push = function (cmd, data) {
        server.stats.pushes++;
        var socketManage = core.SocketManage.getInstance();
        var name = String(cmd).replace("_", ".");
        socketManage.AnalysisProtocol(egret.WebSocket.TYPE_STRING,
            JSON.stringify({cmd: name, data: data === undefined ? {} : data}));
    };

    server.dispatch = function (request) {
        server.stats.requests++;
        var name = server.protocolName(request);
        if (boot.failed) {
            server.respond(request, {code: LF.ERR.GENERIC, msg: "local-boot-failed"});
            return;
        }
        server.recentRequests.push({
            at: Math.floor(Date.now() / 1000),
            cmd: name,
            data: util.clone(request.data || {})
        });
        while (server.recentRequests.length > 30) {
            server.recentRequests.shift();
        }
        if (LF.flags.verboseLog) {
            LF.info("协议请求: " + name, request.data || {});
        }
        /* 兜底：请求先到而存档尚未装载时，先完成本地启动同步 */
        if (!LF.state.data) {
            LF.warn("收到协议请求但存档未装载，触发兜底启动: " + name);
            boot.ensureStarted();
            if (!LF.state.data) {
                server.respond(request, {code: LF.ERR.GENERIC, msg: "local-save-not-loaded"});
                return;
            }
        }
        var params = request.data || {};
        var spec = server.handlers[name];
        var protocol = null;
        try {
            protocol = ProtocolList.protocolList[name];
        } catch (error) {
            protocol = null;
        }
        if (!protocol) {
            /* 未在协议表登记：不假装成功，明确返回错误并留档 */
            server.stats.unsupported++;
            LF.markUnsupported(name, "not-in-protocol-list");
            LF.warn("未登记的协议请求: " + name, params);
            server.respond(request, {code: LF.ERR.GENERIC, msg: "local-unsupported-protocol", protocol: name});
            return;
        }
        if (!spec) {
            server.stats.unsupported++;
            LF.markUnsupported(name, "no-local-handler");
            LF.warn("协议尚无本地实现: " + name, params);
            server.respond(request, {code: LF.ERR.GENERIC, msg: "local-unsupported-protocol", protocol: name});
            return;
        }

        if (spec.read) {
            var readData = spec.read(LF.state.data, params, request);
            if (readData && readData.__error) {
                server.respond(request, {code: readData.__error, msg: readData.msg || ""});
                return;
            }
            server.respond(request, readData === undefined ? {} : readData);
            return;
        }

        var effects = {};
        var response = null;
        var detail = null;
        var outcome = LF.tx.commit(function (work) {
            var result = spec.apply(work, params, effects, request);
            if (!result) {
                result = {ok: true, code: LF.ERR.OK};
            }
            if (result.ok === false) {
                return result;
            }
            response = result.response;
            detail = result.changed || null;
            return {ok: true, changed: detail, response: response};
        }, {
            reason: name,
            /*
             * 幂等键使用客户端请求的 session（core.SocketManage 每次会话请求都会递增）。
             * 只有“同一条请求被重复投递”才会命中重复；玩家连续两次相同操作是两次不同请求，
             * 不能被误判成重放（这是原服务器用 session 做去重的语义）。
             */
            opId: spec.idempotent && request.session !== undefined && request.session !== null
                ? server.sessionEpoch + ":" + name + "#" + request.session : null
        });

        if (!outcome.ok) {
            server.stats.failed++;
            if (spec.resyncOnFailure) {
                server.resync(spec.resyncOnFailure);
            }
            var failure = {
                code: spec.failureCode === undefined
                    ? (outcome.code === undefined ? LF.ERR.GENERIC : outcome.code) : spec.failureCode,
                conflict: spec.conflictOnFailure ? 1 : 0,
                msg: outcome.reason || "failed"
            };
            if (spec.failureData) {
                var extra = spec.failureData(LF.state.data, params);
                for (var key in extra) {
                    if (util.has(extra, key)) {
                        failure[key] = extra[key];
                    }
                }
            }
            server.respond(request, failure);
            return;
        }
        if (outcome.duplicate) {
            server.respond(request, outcome.response === undefined ? {code: LF.ERR.OK} : outcome.response);
            return;
        }

        /*
         * 推送与回调的顺序：
         *   默认先推数据再回调（数据先更新，展示结果在后）。
         *   但有的协议回调里客户端会“再扣一次/再加一次”本地副本（例如家具商店在成功回调里
         *   把货架 num--），此时必须先回调、再用绝对值推送纠正，否则会出现“剩 -1 个”。
         */
        var reply = response === undefined || response === null ? {code: LF.ERR.OK} : response;
        if (spec.respondFirst) {
            server.respond(request, reply);
            server.emitEffects(effects);
        } else {
            server.emitEffects(effects);
            if (spec.pushAfter) {
                spec.pushAfter(LF.state.data, params, request);
            }
            server.respond(request, reply);
        }
        if (detail) {
            LF.record("op." + name, detail);
        }
    };

    server.resync = function (kind) {
        var work = LF.state.data;
        if (kind === "items" || kind === "container") {
            server.push("item_load_items", rules.snapshot.items(work));
        }
        if (kind === "clover") {
            server.push("clover_load_clovers", rules.clover.snapshot(work));
        }
        if (kind === "furniture") {
            server.push("furniture_load_furniture", rules.snapshot.furniture(work));
        }
        if (kind === "compost") {
            server.push("furniture_load_compost", rules.snapshot.compost(work));
        }
    };

    /** effects -> 推送（全部是绝对值，重复推送安全）。 */
    server.emitEffects = function (effects) {
        var work = LF.state.data;
        if (!effects) {
            return;
        }
        if (effects.wallet) {
            server.push("clover_update", {clover: util.toInt(work.wallet.clover, 0)});
        }
        if (effects.ticket) {
            server.push("item_update_ticket", {ticket: util.toInt(work.wallet.ticket, 0)});
        }
        if (effects.items && effects.items.length) {
            for (var index = 0; index < effects.items.length; index++) {
                var itemId = effects.items[index];
                var info = rules.itemInfo(itemId);
                if (!info) {
                    continue;
                }
                server.push("item_update", {
                    item: {item_id: itemId, count: rules.items.count(work, itemId)}
                });
            }
        }
        if (effects.container) {
            server.push("item_load_items", rules.snapshot.items(work));
        }
        if (effects.shop) {
            server.push("item_load_shop_info", rules.snapshot.shop(work));
        }
        if (effects.role) {
            server.push("client_load_role", rules.snapshot.role(work));
        }
        if (effects.decorate) {
            server.push("client_load_decorate", {
                has_list: util.clone(util.toArray(work.role.decorationList)),
                put_id: util.toInt(work.role.decorationPutID, 0),
                status: util.toInt(work.role.decorationStatus, 0)
            });
        }
        if (effects.furniture || effects.bench) {
            server.push("furniture_load_furniture", rules.snapshot.furniture(work));
        }
        if (effects.tumbler) {
            server.push("furniture_load_tumbler", rules.snapshot.tumbler(work));
        }
        if (effects.compost) {
            server.push("furniture_load_compost", rules.snapshot.compost(work));
            /*
             * 客户端已知缺陷：FurnitureModel.furniture_load_compost 派发的是
             * FurnitureEventType.UPDATE_TUMBER，而主场景订阅的是 UPDATE_COMPOST，
             * 于是“数据到了但界面不刷新”。这里补一条正确事件，避免堆肥箱空贴图。
             */
            server.notifyCompostChanged();
        }
        if (effects.pocket) {
            server.push("furniture_load_pocket", rules.snapshot.pocket(work));
        }
        if (effects.flowerpot) {
            server.push("furniture_load_flowerpot", rules.snapshot.flowerpot(work));
        }
        if (effects.clover) {
            server.push("clover_load_clovers", rules.clover.snapshot(work));
        }
        if (effects.weather) {
            server.push("weather_load", rules.snapshot.weather(work));
        }
        if (effects.travel || effects.events) {
            server.push("client_load_events", rules.travel.eventsSnapshot(work));
        }
        if (effects.album) {
            var albumState = rules.album.ensure(work);
            server.push("album_load_all", {id_list: util.clone(albumState.pictures).map(function(p){ return {id:p.id, pic_id:p.pic_id}; })});
            server.push("album_load_new", {pictures: util.clone(albumState.newPictures), visted_pic: [], has_ads: false, is_share: false});
            server.push("album_load_recover", {pictures: util.clone(albumState.deleted)});
        }
        if (effects.activities) {
            server.push("activity_update", {activities: LF.activities.snapshot(work)});
        }
        if (effects.gacha) {
            server.push("item_load_items", rules.snapshot.items(work));
        }
    };

    /* ------------------------------------------------------------------
     * 协议实现表
     * ------------------------------------------------------------------ */

    server.handlers.client_hello = {
        read: function () {
            return {timestamp: clock.now()};
        }
    };

    server.handlers.client_load_all_info = {
        read: function () {
            LF.boot.emitModelLoads();
            return {code: LF.ERR.OK};
        }
    };

    server.handlers.client_load_role = {
        read: function (work) {
            return rules.snapshot.role(work);
        }
    };

    server.handlers.hall_login = {
        read: function () {
            return {code: LF.ERR.OK, account: "local"};
        }
    };

    server.handlers.hall_gen_token = {
        read: function () {
            return {code: LF.ERR.OK, token: "local"};
        }
    };

    server.handlers.hall_enter_game = {
        read: function () {
            return {code: LF.ERR.OK};
        }
    };

    server.handlers.client_set_client = {
        apply: function (work, params, effects) {
            var result = rules.role.setClient(work, params.client, effects);
            return result;
        }
    };

    server.handlers.client_set_name = {
        idempotent: true,
        apply: function (work, params, effects) {
            var cost = util.toInt(work.pendingRenameCost, rules.role.renameCost());
            var result = rules.role.rename(work, params.name, cost, effects);
            return result;
        }
    };

    server.handlers.client_rename_cost = {
        read: function () {
            return {clover: rules.role.renameCost()};
        }
    };

    server.handlers.client_set_icon = {
        apply: function (work, params, effects) {
            return rules.role.setIcon(work, params.id, effects);
        }
    };

    server.handlers.client_set_achieve = {
        apply: function (work, params, effects) {
            return rules.role.setAchieve(work, params.id, effects);
        }
    };

    server.handlers.client_set_pic_show = {
        apply: function (work, params, effects) {
            return rules.role.setPicture(work, params.id, effects);
        }
    };

    server.handlers.client_switch_push = {
        apply: function (work, params, effects) {
            var result = rules.role.setSwitch(work, "push", params.turnon, effects);
            if (result.ok) {
                result.response = {push_switch: work.settings.push_switch};
            }
            return result;
        }
    };

    server.handlers.client_switch_rank = {
        apply: function (work, params, effects) {
            var result = rules.role.setSwitch(work, "rank", params.turnon, effects);
            if (result.ok) {
                result.response = {rank_switch: work.settings.rank_switch};
            }
            return result;
        }
    };

    server.handlers.client_change_decorate = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.role.changeDecoration(work, params.id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.client_load_decorate = {
        read: function (work) {
            return {
                has_list: util.clone(util.toArray(work.role.decorationList)),
                put_id: util.toInt(work.role.decorationPutID, 0),
                status: util.toInt(work.role.decorationStatus, 0)
            };
        }
    };

    /* ---- 草田 ---- */
    server.handlers.clover_load_clovers = {
        read: function (work) {
            return rules.clover.snapshot(work);
        }
    };

    server.handlers.clover_harvest = {
        idempotent: true,
        resyncOnFailure: "clover",
        apply: function (work, params, effects) {
            var result = rules.clover.harvest(work, params.clover_id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK, clover_id: util.toInt(params.clover_id, -1)};
            }
            return result;
        }
    };

    server.handlers.clover_harvest_resend = {
        idempotent: true,
        resyncOnFailure: "clover",
        apply: function (work, params, effects) {
            var list = util.toArray(params.list);
            var handled = 0;
            for (var index = 0; index < list.length; index++) {
                var entry = list[index];
                if (!entry) {
                    continue;
                }
                var result = rules.clover.harvest(work, entry.clover_id, effects);
                if (result.ok) {
                    handled++;
                }
            }
            return {ok: true, code: LF.ERR.OK, changed: {resend: handled}};
        }
    };

    server.handlers.clover_update = {
        read: function (work) {
            return {clover: util.toInt(work.wallet.clover, 0)};
        }
    };

    /* ---- 库存 / 商店 ---- */
    server.handlers.item_load_items = {
        read: function (work) {
            return rules.snapshot.items(work);
        }
    };

    server.handlers.item_load_handbook = {
        read: function (work) {
            return rules.snapshot.handbook(work);
        }
    };

    server.handlers.item_load_shop_info = {
        read: function (work) {
            return rules.snapshot.shop(work);
        }
    };

    server.handlers.item_putin_bag = {
        idempotent: true,
        conflictOnFailure: true,
        resyncOnFailure: "container",
        apply: function (work, params, effects) {
            var result = rules.container.putIn(work, "bag", params.pos, params.item_id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK, conflict: 0};
            }
            return result;
        }
    };

    server.handlers.item_takeout_bag = {
        idempotent: true,
        conflictOnFailure: true,
        resyncOnFailure: "container",
        apply: function (work, params, effects) {
            var result = rules.container.takeOut(work, "bag", params.pos, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK, conflict: 0};
            }
            return result;
        }
    };

    server.handlers.item_putin_desk = {
        idempotent: true,
        conflictOnFailure: true,
        resyncOnFailure: "container",
        apply: function (work, params, effects) {
            var result = rules.container.putIn(work, "desk", params.pos, params.item_id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK, conflict: 0};
            }
            return result;
        }
    };

    server.handlers.item_takeout_desk = {
        idempotent: true,
        conflictOnFailure: true,
        resyncOnFailure: "container",
        apply: function (work, params, effects) {
            var result = rules.container.takeOut(work, "desk", params.pos, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK, conflict: 0};
            }
            return result;
        }
    };

    server.handlers.item_set_bag_completed = {
        apply: function (work, params, effects) {
            var result = rules.container.setCompleted(work, params.completed, effects);
            if (result.ok && params.completed && work.travel && work.travel.status === "home") {
                var travelResult = rules.travel.prepareAndStart(work, params, effects);
                if (!travelResult.ok) { return travelResult; }
                result.changed = {completed: true, travel: travelResult.changed};
            }
            return result;
        }
    };

    server.handlers.item_buy = {
        idempotent: true,
        /* 客户端回调里会自行 purchasedMap[id]++，先回调再用绝对值推送纠正 */
        respondFirst: true,
        apply: function (work, params, effects) {
            var result = rules.shop.buy(work, params.shop_id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.item_gacha = {
        idempotent: true,
        apply: function (work, params, effects) {
            if (params.is_reward) {
                var pending = work.items.gacha.pending;
                if (pending && !pending.settled) {
                    return {
                        ok: true,
                        code: LF.ERR.OK,
                        response: {ticket: util.toInt(pending.rank, -1)},
                        changed: {replay: true}
                    };
                }
                return {
                    ok: true,
                    code: LF.ERR.OK,
                    response: {ticket: -1},
                    changed: {replay: false}
                };
            }
            var result = rules.gacha.roll(work, effects);
            if (result.ok) {
                result.response = result.response || {ticket: util.toInt(work.items.gacha.color_ball, -1)};
                /* 抽奖结果只走 Model 推送，避免客户端回调重复播动画 */
                effects.gacha = false;
            }
            return result;
        }
    };

    server.handlers.item_redeem_prize = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.gacha.redeem(work, params.prize_id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.item_load_select_gift = {
        read: function (work) {
            return {list: util.clone(util.toArray(work.items.selectGift))};
        }
    };

    /* ---- 家具 / 工作台 / 堆肥 / 庭院 ---- */
    server.handlers.furniture_load_furniture = {
        read: function (work) {
            return rules.snapshot.furniture(work);
        }
    };

    server.handlers.furniture_load_tumbler = {
        read: function (work) {
            return rules.snapshot.tumbler(work);
        }
    };

    server.handlers.furniture_load_compost = {
        read: function (work) {
            return rules.snapshot.compost(work);
        }
    };

    server.handlers.furniture_load_pocket = {
        read: function (work) {
            return rules.snapshot.pocket(work);
        }
    };

    server.handlers.furniture_load_flowerpot = {
        read: function (work) {
            return rules.snapshot.flowerpot(work);
        }
    };

    server.handlers.furniture_buy_shop = {
        idempotent: true,
        /* FurnitureShopView 的成功回调会把货架 num--，先回调再推权威快照 */
        respondFirst: true,
        apply: function (work, params, effects) {
            var result = rules.furniture.buyShop(work, params.shop_id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.furniture_putin_bench = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.bench.putIn(work, params.pos, params.id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.furniture_takeout_bench = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.bench.takeOut(work, params.pos, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.furniture_craft_start = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.craft.start(work, params || {}, effects);
            if (result.ok) result.response = {code: LF.ERR.OK, finish_at: result.finish_at};
            return result;
        }
    };

    server.handlers.furniture_craft_collect = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.craft.collect(work, effects);
            if (result.ok) result.response = {code: LF.ERR.OK, item_list: [result.output]};
            return result;
        }
    };

    server.handlers.furniture_putin_box = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.compost.putIn(work, params.pos, params.id, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.furniture_takeout_box = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.compost.takeOut(work, params.pos, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.furniture_replace_fur = {
        idempotent: true,
        failureCode: -1,
        resyncOnFailure: "furniture",
        apply: function (work, params, effects) {
            var result = rules.furniture.replaceFur(work, params.id, effects);
            return result.ok ? {ok: true, code: LF.ERR.OK, response: {code: 0}, changed: result.changed}
                : {ok: false, code: LF.ERR.ILLEGAL_OP, reason: result.reason, ret: 1};
        }
    };

    server.handlers.furniture_replace_tumbler = {
        idempotent: true,
        failureCode: -1,
        apply: function (work, params, effects) {
            var result = rules.furniture.replaceOf(work, "tumbler", params.index, effects);
            return result.ok ? {ok: true, code: LF.ERR.OK, response: {code: 0}}
                : result;
        }
    };

    server.handlers.furniture_replace_compost = {
        idempotent: true,
        failureCode: -1,
        apply: function (work, params, effects) {
            var result = rules.furniture.replaceOf(work, "compost", params.index, effects);
            return result.ok ? {ok: true, code: LF.ERR.OK, response: {code: 0}}
                : result;
        }
    };

    server.handlers.furniture_replace_pocket = {
        idempotent: true,
        failureCode: -1,
        apply: function (work, params, effects) {
            var result = rules.furniture.replaceOf(work, "pocket", params.index, effects);
            return result.ok ? {ok: true, code: LF.ERR.OK, response: {code: 0}}
                : result;
        }
    };

    server.handlers.furniture_pocket_get = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.furniture.pocketGet(work, effects);
            if (result.ok) {
                result.response = {code: LF.ERR.OK};
            }
            return result;
        }
    };

    server.handlers.furniture_flowerpot_harvest = {
        apply: function (work, params, effects) {
            /* M1 尚未实现花盆生长结算：返回空产物，界面正常关闭且不发放任何奖励 */
            var location = params && params.type !== undefined
                ? {type: params.type, index: params.index !== undefined ? params.index : params.pos}
                : (params.pos !== undefined ? params.pos : (params.index !== undefined ? params.index : 1));
            var result = rules.flowerpot.harvest(work, location, effects);
            if (result.ok) { result.response = {code: LF.ERR.OK, item_list: result.item_list}; }
            return result;
        }
    };

    /* ---- 天气 ---- */
    /* Local extension: planting is absent from the legacy protocol list, but this handler gives diagnostic tools and a future UI an atomic endpoint. */
    server.handlers.furniture_flowerpot_plant = {
        idempotent: true,
        apply: function (work, params, effects) {
            var result = rules.flowerpot.plant(work, params || {}, effects);
            if (result.ok) result.response = {code: LF.ERR.OK, finish_at: result.finish_at, plant: result.plant};
            return result;
        }
    };
    server.handlers.flowerpot_plant = server.handlers.furniture_flowerpot_plant;

    server.handlers.weather_load = {
        read: function (work) {
            return rules.snapshot.weather(work);
        }
    };

    /* ---- 只做“空数据占位”的 P2/P3 协议 ----
     * M1 不实现这些玩法，但必须让界面拿到结构合法的空数据（而不是 null），
     * 否则打开对应窗口会报错。所有占位数据都在 docs 里标注为“未实现玩法”。
     */
    server.placeholder = function (name, payload) {
        server.handlers[name] = {
            read: function () {
                return util.clone(typeof payload === "function" ? payload() : payload);
            }
        };
    };

    server.handlers.annual_load = { read: function (work) { return {is_share:false, save_id:work.header.saveId, created_at:work.header.createdAt, updated_at:work.header.updatedAt, travel_count:work.journal.commitCount, picture_count:rules.album.ensure(work).pictures.length, clover:work.wallet.clover}; } };
    server.handlers.task_load = { read: function (work) { return rules.tasks.snapshot(work); } };
    server.handlers.task_load_list = { read: function (work) { return rules.tasks.snapshot(work); } };
    server.handlers.task_update = { apply: function (work, params, effects) { return rules.tasks.update(work, params.id || params.task_id, params.num || params.amount || 1, effects); } };
    server.handlers.task_reward = { apply: function (work, params, effects) { return rules.tasks.claim(work, params.id || params.task_id, effects); } };
    server.handlers.mail_load = { read: function (work) { return rules.mail.snapshot(work).mails; } };
    server.handlers.mail_load_mails = { read: function (work, params) { return rules.mail.list(work, params.start, params.count); } };
    server.handlers.album_load_all = { read: function (work) { return {id_list: util.clone(rules.album.ensure(work).pictures).map(function(p){ return {id:p.id, pic_id:p.pic_id}; })}; } };
    server.handlers.album_load = { read: function (work, params) { return rules.album.load(work, params.start, params.count); } };
    server.handlers.album_load_by_id_list = { read: function (work, params) { return rules.album.loadIds(work, params.id_list); } };
    /* has_ads/is_share 必须为 false：为 true 时客户端会走“看广告/分享微信换照片”的
     * 在线流程（D03/D05），离线版没有对应能力，只能明确不提供。 */
    server.handlers.album_load_new = { read: function (work) { var a=rules.album.ensure(work); return {pictures:util.clone(a.newPictures),visted_pic:[],has_ads:false,is_share:false}; } };
    server.handlers.album_load_recover = { read: function (work) { return {pictures:util.clone(rules.album.ensure(work).deleted)}; } };
    server.handlers.client_load_events = { read: function (work) { return rules.travel.eventsSnapshot(work); } };
    server.handlers.guest_load = { read: function (work) { var g=work.guests||{current:null,history:[]}; return {guest_list:g.current?[g.current]:[], drawing:{}}; } };
    server.handlers.guest_confirm = { apply: function (work, params, effects) { work.guests=work.guests||{current:null,history:[]}; if(work.guests.current)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-exists'}; var now=clock.now(); work.guests.current={id:params.id||params.guest_id||1,name:params.name||'',arrived_at:now,expires_at:util.toInt(params.expires_at||params.expire_at,now+86400),served:false}; rules.effect(effects,'guests'); return {ok:true,code:LF.ERR.OK}; } };
    server.handlers.guest_set_expire_time = { apply: function (work, params, effects) { var g=work.guests&&work.guests.current;if(!g)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-none'};var at=util.toInt(params.time||params.expire_at||params.expires_at,0);if(at<=clock.now())return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'expire-time'};g.expires_at=at;rules.effect(effects,'guests');return {ok:true,code:LF.ERR.OK,expires_at:at}; } };
    server.handlers.guest_serve = { apply: function (work, params, effects) { var g=work.guests&&work.guests.current;if(!g)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-none'}; var item=util.toInt(params.item_id||params.id,-1), take=rules.items.consume(work,item,1,effects);if(!take.ok)return take;g.served=true;rules.effect(effects,'guests');return {ok:true,code:LF.ERR.OK,item_id:item}; } };
    server.handlers.guest_finish = { apply: function (work, params, effects) { work.guests=work.guests||{current:null,history:[]};if(!work.guests.current)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-none'};work.guests.history=util.toArray(work.guests.history);work.guests.history.push(work.guests.current);work.guests.current=null;rules.effect(effects,'guests');return {ok:true,code:LF.ERR.OK}; } };
    server.handlers.guest_load_drawing = { read: function (work) { work.guests=work.guests||{}; return util.clone(work.guests.drawing||{is_accept:false,bag:[-1,-1,-1,-1],locked:false,gifts:[]}); } };
    server.handlers.guest_accept_invit = { apply: function (work, params, effects) { work.guests=work.guests||{current:null,history:[]}; work.guests.drawing=work.guests.drawing||{is_accept:false,bag:[-1,-1,-1,-1],locked:false,gifts:[]}; if (work.guests.drawing.is_accept) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-invite-set'}; work.guests.drawing.is_accept=!!(params.is_accept===undefined?true:params.is_accept); rules.effect(effects,'guests'); return {ok:true,code:LF.ERR.OK}; } };
    server.handlers.guest_lock_bag = { apply: function (work, params, effects) { work.guests.drawing=work.guests.drawing||{bag:[-1,-1,-1,-1]}; work.guests.drawing.locked=true; rules.effect(effects,'guests'); return {ok:true,code:LF.ERR.OK}; } };
    server.handlers.guest_putin_bag = { apply: function (work, params, effects) { var d=work.guests&&work.guests.drawing;if(!d||d.locked)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-bag-locked'};var pos=util.toInt(params.pos,0)-1,id=util.toInt(params.id,-1);if(pos<0||pos>=4||id<0)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'guest-bag'};var take=rules.items.consume(work,id,1,effects);if(!take.ok)return take;d.bag[pos]=id;rules.effect(effects,'guests');return {ok:true,code:LF.ERR.OK}; } };
    server.handlers.guest_takeout_bag = { apply: function (work, params, effects) { var d=work.guests&&work.guests.drawing;if(!d||d.locked)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'guest-bag-locked'};var pos=util.toInt(params.pos,0)-1;if(pos<0||pos>=4||util.toInt(d.bag[pos],-1)<0)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'guest-bag'};var id=d.bag[pos],add=rules.items.add(work,id,1,effects);if(!add.ok)return add;d.bag[pos]=-1;rules.effect(effects,'guests');return {ok:true,code:LF.ERR.OK}; } };
    server.handlers.travel_load_note = { read: function (work) { return rules.travel.noteSnapshot(work); } };
    server.handlers.travel_load_gift = { read: function (work) { return rules.travel.giftSnapshot(work); } };
    server.placeholder("visit_load", {visitor: null, acquire: []});
    server.placeholder("story_load", {stories: [], new_story_id: 0});
    server.placeholder("misc_moment_load", {list: []});
    server.placeholder("easteregg_load", {egg_list: []});
    server.placeholder("other_load_touch", {cur: 0, list: []});
    server.placeholder("wishingpool_load", {end_time: 0, coin: 0, items: []});
    server.placeholder("lottery_load", {});
    server.placeholder("animpicture_load", {guide: 0, page_num: 0, item_num: 0, making_index: 0, pic_list: []});
    server.placeholder("museum_load", {museum_list: []});
    server.handlers.encyclopedia_load = { read: function (work) { var ids=Object.keys(work.items.house).map(function(id){return util.toInt(id,0);}); return {unlock_list:ids, unlock_desc:[], show_sub:[]}; } };
    server.handlers.encytravel_load = { read: function (work) { var a=rules.album.ensure(work); return {unlock_list:a.pictures.map(function(p){return p.pic_id||p.id;}), unlock_desc:[], show_sub:[]}; } };
    server.handlers.calendar_load = { read: function (work) { return rules.calendar.snapshot(work); } };
    server.handlers.calendar_load_note = { read: function (work) { return rules.calendar.noteSnapshot(work); } };
    server.handlers.calendar_task_update = { apply: function (work, params, effects) {
        return rules.calendar.taskUpdate(work, params, effects);
    } };
    server.handlers.calendar_get_beginer_reward = { apply: function (work, params, effects) {
        return rules.calendar.claim(work, "beginner", params, effects);
    } };
    server.handlers.calendar_get_code_reward = { apply: function (work, params, effects) {
        return rules.calendar.claim(work, "beginner", params, effects);
    } };
    server.handlers.calendar_get_luck_reward = { apply: function (work, params, effects) {
        return rules.calendar.claim(work, "luck", params, effects);
    } };
    server.handlers.calendar_get_st_reward = { apply: function (work, params, effects) {
        return rules.calendar.claim(work, "st", params, effects);
    } };
    server.placeholder("recharge_load", {water: 0, change: 0, field: [], sack: []});
    server.placeholder("recharge_load_gift", {gift: []});
    server.placeholder("recharge_update_num", {});
    server.placeholder("adsmgr_load", {
        can_pop: false, can_banner: false, day_left: 0, gift_id: 0, gift_time: 0,
        gift_can_get: 0, gift_get: 0, item_list: []
    });
    server.handlers.share_load = { read: function (work) { return {pic_list:util.clone(rules.album.ensure(work).pictures), is_share:false}; } };
    server.placeholder("rank_load", {});
    server.placeholder("rank_get_intro", {});
    server.placeholder("cooking_load_cooking", {
        month: 0, month_pro: 0, week: 0, complete: true, select: 0, refresh_time: 0, task_list: []
    });
    server.placeholder("cooking_task_update", {});
    server.placeholder("capsule_load", {end_time: 0, coin: 0, pre_coin: 0, reward_list: [], task_list: [], patch_num: 0});
    server.placeholder("capsule_load_coin", {coin: 0, pre_coin: 0});
    server.placeholder("capsule_load_task", {task_list: []});
    server.placeholder("greetcard_load", {end_time: 0, card_info: {bg: 0, bless: 0, tags: [0, 0, 0]}, send_list: [], get_list: [], items: [], task_item: [], can_reward: false});
    server.placeholder("greetcard_load_count", {});
    server.placeholder("springcard_load", {end_time: 0, card_info: {bg: 0, bless: 0, tags: [0, 0, 0]}, items: [], task_item: [], reward_list: []});
    server.placeholder("springcard_load_count", {});
    server.placeholder("springcard_load_task_item", {});
    server.placeholder("partycake_load", {end_time: 0, cream: 0, sugar: 0, cur_state: 0, part: 0, layers: [], task_list: [], share_get: []});
    server.placeholder("partycake_load_mate", {});
    server.placeholder("partycake_load_qa", {});
    server.placeholder("partycake_load_task", {});
    server.placeholder("museumday_load", {
        end_time: 0, inspire_num: 0, inspire_time: 0, museum_list: [], cur_museum: 0, compass: 0,
        task_num: 0, frog: 0, next: 0, left_num: 0, desc_id: 0, pic_id: 0, items: [], get_items: [], log_list: [], path: []
    });
    server.placeholder("museumday_info", {});
    server.placeholder("pray_load_grays", {wishs: [], stamps: [], boxes: [], wish_new: null, stamp_new: null});
    server.placeholder("client_load_publicity", {id_list: []});

    /* C01-C17 ??????????????????????????????? */
    (function () {
        var activityCommands = {
            visit: ["visit_load", "visit_open", "visit_set_carpet", "visit_set_expire_time"],
            story: ["story_load", "story_read_new_story", "story_send_gift", "story_feedback_gift"],
            misc_moment: ["misc_moment_load", "misc_moment_unlock"], easteregg: ["easteregg_load"],
            touch: ["other_load_touch", "other_req_touch"], wishingpool: ["wishingpool_load", "wishingpool_wish"], lottery: ["lottery_load", "lottery_open", "lottery_select", "lottery_confirm_reward"],
            animpicture: ["animpicture_load", "animpicture_add_pic", "animpicture_album_add_pic", "animpicture_album_remove_pic", "animpicture_get_item", "animpicture_guide", "animpicture_open_album", "animpicture_remove_pic", "animpicture_select_pic", "animpicture_use_item"],
            museum: ["museum_load"], calendar_note: ["calendar_load_note"], recharge: ["recharge_load", "recharge_change", "recharge_water"], recharge_gift: ["recharge_load_gift"], recharge_num: ["recharge_update_num"], adsmgr: ["adsmgr_load"], rank: ["rank_load", "rank_get_intro"],
            cooking: ["cooking_load_cooking", "cooking_complete_task", "cooking_look_ad", "cooking_refresh_task", "cooking_select", "cooking_start_cooking", "cooking_task_update"], capsule: ["capsule_load", "capsule_load_coin", "capsule_load_task", "capsule_fast_task", "capsule_get_coin", "capsule_patch", "capsule_twist"],
            greetcard: ["greetcard_load", "greetcard_load_count", "greetcard_buy", "greetcard_change_bg", "greetcard_change_bless", "greetcard_feedback_gift", "greetcard_get_reward", "greetcard_get_task_item", "greetcard_get_task_reward", "greetcard_put_tags", "greetcard_read_new", "greetcard_send", "greetcard_send_gift", "greetcard_stock"],
            springcard: ["springcard_load", "springcard_load_count", "springcard_load_task_item", "springcard_buy", "springcard_change_bg", "springcard_change_bless", "springcard_get_reward", "springcard_get_task_item", "springcard_get_task_reward", "springcard_put_tags", "springcard_send"],
            partycake: ["partycake_load", "partycake_load_mate", "partycake_load_qa", "partycake_load_task", "partycake_answer", "partycake_get_mate", "partycake_light", "partycake_make", "partycake_reward_light", "partycake_reward_make", "partycake_reward_qa", "partycake_reward_share"],
            museumday: ["museumday_load", "museumday_info", "museumday_load_path", "museumday_arrive", "museumday_dir_compass", "museumday_get_items", "museumday_inspire", "museumday_random_compass", "museumday_refresh", "museumday_start_advance"], pray: ["pray_load_grays", "pray_compose", "pray_confirm_make_box"]
        };
        Object.keys(activityCommands).forEach(function (key) {
            activityCommands[key].forEach(function (name) {
                /* Capture both values per handler; a plain var closure here makes every
                 * activity endpoint use the final loop key (pray). */
                (function (activityKey, protocolName) {
                    if (protocolName.indexOf("_load") >= 0 || protocolName === "museumday_info" || protocolName === "rank_get_intro") {
                        server.handlers[protocolName] = {read: function (work) { return LF.activities.read(work, activityKey); }};
                    } else {
                        server.handlers[protocolName] = {idempotent: true, apply: function (work, params, effects) {
                            var result = LF.activities.merge(work, activityKey, params || {}, effects);
                            if (result.ok) result.response = {code: LF.ERR.OK};
                            return result;
                        }};
                    }
                })(key, name);
            });
        });
    })();

    /* ---- 本地可确认的运营/统计类协议 ---- */
    server.handlers.pray_load_grays = {read:function(work){ return rules.pray ? rules.pray.ensure(work) : LF.activities.read(work, "pray"); }};
    server.handlers.pray_compose = {idempotent:true,apply:function(work,params,effects){ return rules.pray.compose(work,params,effects); }};
    server.handlers.pray_confirm_make_box = {idempotent:true,apply:function(work,params,effects){ return rules.pray.confirm(work,effects); }};

    server.handlers.visit_open = {idempotent:true,apply:function(work,params,effects){return rules.visit.open(work,params,effects);}};
    server.handlers.visit_set_expire_time = {idempotent:true,apply:function(work,params,effects){return rules.visit.setExpire(work,params,effects);}};
    server.handlers.visit_set_carpet = {idempotent:true,apply:function(work,params,effects){var v=work.activities&&work.activities.visit&&work.activities.visit.visitor;if(!v)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"visitor-none"};v.carpet_id=util.toInt(params.id,-1);rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK};}};
    server.handlers.story_read_new_story = {idempotent:true,apply:function(work,params,effects){return rules.story.read(work,params,effects);}};
    server.handlers.story_send_gift = {idempotent:true,apply:function(work,params,effects){return rules.story.sendGift(work,params.gift||params,effects);}};

    var ackOnly = [
        "client_set_ads", "client_set_channel", "client_set_channel_id", "client_set_client_envinfo",
        "client_user_action", "hall_report_remote_addr", "client_set_lang", "client_add_push_id",
        "hall_leave_game", "client_get_push_reward", "client_get_my_wx_reward",
        "client_set_wx_open_id"
    ];
    for (var ackIndex = 0; ackIndex < ackOnly.length; ackIndex++) {
        (function (name) {
            server.handlers[name] = {
                read: function () {
                    LF.record("ack." + name);
                    return {code: LF.ERR.OK};
                }
            };
            /* client_set_wx_open_id 的响应结构不同（push_list） */
            if (name === "client_set_wx_open_id") {
                server.handlers[name].read = function () {
                    return {code: LF.ERR.OK, push_list: []};
                };
            }
        })(ackOnly[ackIndex]);
    }

    server.handlers.client_confirm_event = {
        apply: function (work, params, effects) {
            var result = rules.travel.confirmEvent(work, params.id, effects);
            if (result.ok) { result.response = {code: LF.ERR.OK}; }
            return result;
        }
    };
    server.handlers.furniture_compost_start = { apply: function (work, params, effects) { return rules.compost.start(work, effects); } };
    server.handlers.furniture_compost_collect = { apply: function (work, params, effects) { return rules.compost.collect(work, effects); } };

    server.handlers.album_delete = {idempotent:true, apply:function(work, params, effects){return rules.album.remove(work, params.id, effects);}};
    server.handlers.album_recover = {idempotent:true, apply:function(work, params, effects){return rules.album.recover(work, params.id, effects);}};
    server.handlers.album_save_new = {idempotent:true, apply:function(work, params, effects){return rules.album.saveNew(work, params.id, effects);}};
    server.handlers.album_delete_new = {idempotent:true, apply:function(work, params, effects){return rules.album.deleteNew(work, params.id, effects);}};
    server.handlers.album_expand = {idempotent:true, apply:function(work, params, effects){return rules.album.expand(work, params, effects);}};
    server.handlers.mail_read = {idempotent:true, apply:function(work, params, effects){return rules.mail.read(work, params.id, effects);}};
    server.handlers.mail_open = {idempotent:true, apply:function(work, params, effects){return rules.mail.open(work, params.id, effects);}};
    server.handlers.travel_gift_to_bag = {idempotent:true, apply:function(work, params, effects){return rules.mail.giftToBag(work, params.item_id, effects);}};
    server.handlers.travel_gift_delete_album = {idempotent:true, apply:function(work, params, effects){return rules.mail.giftDeletePicture(work, params.id, effects);}};
    server.handlers.travel_gift_to_album = {idempotent:true, apply:function(work, params, effects){var a=rules.album.ensure(work),m=rules.mail.ensure(work),key=String(params.picture_id);for(var i=0;i<m.pictures.length;i++){if(String(m.pictures[i].id)===key){a.pictures.push(m.pictures.splice(i,1)[0]);rules.effect(effects,'album');rules.effect(effects,'mail');return {ok:true,code:LF.ERR.OK};}}return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'gift-picture-not-found'};}};
    server.handlers.travel_album_to_gift = {idempotent:true, apply:function(work, params, effects){var a=rules.album.ensure(work),m=rules.mail.ensure(work),key=String(params.picture_id);for(var i=0;i<a.pictures.length;i++){if(String(a.pictures[i].id)===key){m.pictures.push(a.pictures.splice(i,1)[0]);rules.effect(effects,'album');rules.effect(effects,'mail');return {ok:true,code:LF.ERR.OK};}}return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'picture-not-found'};}};

    server.handlers.travel_read_note = {
        idempotent: true,
        apply: function (work, params, effects) {
            var id = util.toInt(params.id, -1);
            for (var i = 0; i < work.mail.notes.length; i++) {
                if (util.toInt(work.mail.notes[i].id, -1) === id) { work.mail.notes[i].read = true; rules.effect(effects, "events"); return {ok:true, code:LF.ERR.OK, response:{code:LF.ERR.OK}}; }
            }
            return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:"note-not-found"};
        }
    };

    server.handlers.item_gift_open = { apply: function (work, params, effects) {
        var gifts=util.toArray(work.items.selectGift); if(!gifts.length)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"gift-empty"};
        var granted=[]; for(var i=0;i<gifts.length;i++){var g=gifts[i]||{}, id=util.toInt(g.item_id||g.id,-1), count=Math.max(1,util.toInt(g.count||g.num,1)); if(id<0)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:"gift-item"}; var add=rules.items.add(work,id,count,effects); if(!add.ok)return add; granted.push({item_id:id,count:count});}
        work.items.selectGift=[]; rules.effect(effects,"items"); return {ok:true,code:LF.ERR.OK,items:granted};
    } };

    /** 主动通知堆肥箱变化（补偿客户端回调派发的事件类型错误）。 */
    server.notifyCompostChanged = function () {
        try {
            var model = LF.model(FurnitureModel);
            if (model && typeof FurnitureEventType !== "undefined") {
                model.dispatchEvent(new core.Event(FurnitureEventType.UPDATE_COMPOST));
            }
        } catch (error) {
            LF.warn("notifyCompostChanged failed", String(error));
        }
    };


/* ---- 75_schedule.js ---- */
    /* ------------------------------------------------------------------
     * 75 持久化调度器 (A08)
     *
     * M1 需要离线推进的任务：草田成熟、口袋积累、天气/时段刷新、商人离开。
     * 每个任务都有唯一 id 与下次到期时间，暂停/恢复后按“已过去的时间”补算，
     * 长时间离线不会漏结算，也不会因为设备时间回拨而死循环（clock 单调）。
     * 旅行/制作/邮件等任务族在 M2 追加到同一张表。
     * ------------------------------------------------------------------ */
    var scheduler = LF.scheduler = {};

    scheduler.defaults = function () {
        var now = Math.floor(Date.now() / 1000);
        return {
            lastRunAt: now,
            nextDueAt: now,
            lastTasks: [],
            totalRuns: 0,
            history: []
        };
    };

    scheduler.tasks = function (work, now) {
        var list = [];
        var nextClover = 0;
        work.clover.slots.forEach(function (slot) {
            if (slot.last_harvest > 0) {
                var due = slot.last_harvest + slot.rebirth_span;
                if (!nextClover || due < nextClover) { nextClover = due; }
            }
        });
        list.push({
            id: "clover.mature",
            dueAt: nextClover,
            run: function (effects) {
                return rules.clover.mature(work, effects);
            }
        });
        list.push({
            id: "pocket.accrue",
            dueAt: work.pocket.list.length ? util.toInt(work.pocket.lastAccrual, now) + 1800 : 0,
            run: function (effects) {
                return rules.furniture.pocketAccrue(work, effects);
            }
        });
        list.push({
            id: "weather.roll",
            dueAt: util.toInt(work.weather.nextAt, now),
            run: function (effects) {
                return rules.weather.roll(work, effects);
            }
        });
        list.push({
            id: "compost.finish",
            dueAt: work.compost.process && work.compost.process.state === "running" ? util.toInt(work.compost.process.finish_at, 0) : 0,
            run: function (effects) {
                if (work.compost.process && work.compost.process.finish_at <= now) { work.compost.process.state = "ready"; rules.effect(effects, "compost"); return {ok:true,code:LF.ERR.OK,changed:{ready:true}}; }
                return {ok:true,skipped:true};
            }
        });
        list.push({
            id: "flowerpot.finish",
            dueAt: (work.flowerpot && work.flowerpot.plant_list || []).reduce(function (next, plant) {
                if (!plant || plant.state === "done") return next;
                var at = util.toInt(plant.finish_time || plant.end_time || plant.harvest_at, 0);
                return at && (next === 0 || at < next) ? at : next;
            }, 0),
            run: function (effects) {
                return rules.flowerpot ? rules.flowerpot.finish(work, effects, now) : {ok:true, skipped:true};
            }
        });
        list.push({
            id: "furniture.craft.finish",
            dueAt: work.furniture.craft && work.furniture.craft.state === "running" ? util.toInt(work.furniture.craft.finish_at, 0) : 0,
            run: function (effects) {
                return rules.craft ? rules.craft.finish(work, effects, now) : {ok:true, skipped:true};
            }
        });
        list.push({id:"mail.expire",dueAt:(work.mail.mails||[]).reduce(function(next,row){var at=util.toInt(row.expire_at||row.expireAt,0);return at&&(next===0||at<next)?at:next;},0),run:function(effects){return rules.mail.expire(work,effects);}});
        list.push({
            id: "travel.arrive",
            dueAt: work.travel && work.travel.status === "traveling" ? util.toInt(work.travel.etaAt, 0) : 0,
            run: function (effects) {
                return rules.travel.advance(work, effects, now);
            }
        });
        list.push({
            id: "shop.leave",
            dueAt: work.furniture.shop.leaveNotifiedAt === work.furniture.shop.leave_time
                ? 0 : util.toInt(work.furniture.shop.leave_time, 0),
            run: function (effects) {
                if (work.furniture.shop.leave_time > 0 && now >= work.furniture.shop.leave_time) {
                    /* 商人离开：工作台保持解锁（start_time 不变） */
                    rules.effect(effects, "furniture");
                    work.furniture.shop.leaveNotifiedAt = work.furniture.shop.leave_time;
                    return {ok: true, code: LF.ERR.OK, changed: {left: true}};
                }
                return {ok: true, code: LF.ERR.OK, skipped: true};
            }
        });
        list.push({
            id: "guest.expire",
            dueAt: work.guests && work.guests.current ? util.toInt(work.guests.current.expires_at || work.guests.current.expire_at, 0) : 0,
            run: function (effects) {
                var guest = work.guests && work.guests.current;
                if (!guest || util.toInt(guest.expires_at || guest.expire_at, 0) > now) return {ok:true, skipped:true};
                work.guests.history = util.toArray(work.guests.history);
                guest.status = "expired";
                work.guests.history.push(guest);
                work.guests.current = null;
                rules.effect(effects, "guests");
                return {ok:true, code:LF.ERR.OK, changed:{expired:true}};
            }
        });
        list.push({
            id: "visit.expire",
            dueAt: work.activities && work.activities.visit && work.activities.visit.visitor ? util.toInt(work.activities.visit.visitor.expires_at, 0) : 0,
            run: function (effects) {
                var visitor = work.activities && work.activities.visit && work.activities.visit.visitor;
                if (!visitor || util.toInt(visitor.expires_at, 0) > now) return {ok:true, skipped:true};
                visitor.status = "expired";
                rules.effect(effects, "activities");
                return {ok:true, code:LF.ERR.OK, changed:{expired:true}};
            }
        });
        list.push({
            id: "pray.finish",
            dueAt: work.activities && work.activities.pray && work.activities.pray.process && work.activities.pray.process.state === "running"
                ? util.toInt(work.activities.pray.process.finish_at, 0) : 0,
            run: function (effects) { return rules.pray ? rules.pray.finish(work, effects, now) : {ok:true, skipped:true}; }
        });
        return list;
    };

    /**
     * 追赶：在事务里执行所有到期任务。
     * 返回 {ran: [taskId], effects}
     */
    scheduler.catchUp = function (work, effects, now) {
        now = now || clock.now();
        var due = [];
        var tasks = scheduler.tasks(work, now);
        for (var index = 0; index < tasks.length; index++) {
            var task = tasks[index];
            if (!task.dueAt) {
                continue;
            }
            if (now >= task.dueAt) {
                due.push(task);
            }
        }
        var ran = [];
        for (var d = 0; d < due.length; d++) {
            var result = due[d].run(effects);
            if (result && result.ok && !result.skipped) {
                ran.push(due[d].id);
            }
        }
        work.scheduler.lastRunAt = now;
        work.scheduler.totalRuns = util.toInt(work.scheduler.totalRuns, 0) + 1;
        if (ran.length > 0) {
            work.scheduler.lastTasks = ran;
            work.scheduler.history.push({at: now, tasks: ran});
            while (work.scheduler.history.length > 40) {
                work.scheduler.history.shift();
            }
        }
        var next = 0;
        var after = scheduler.tasks(work, now);
        for (var n = 0; n < after.length; n++) {
            var at = after[n].dueAt;
            if (at && (next === 0 || at < next)) {
                next = at;
            }
        }
        work.scheduler.nextDueAt = next || (now + LF.RULES.WEATHER_CHANGE_SECONDS);
        return {ran: ran, nextDueAt: work.scheduler.nextDueAt};
    };

    scheduler.describe = function (work) {
        work = work || LF.state.data;
        var now = clock.now();
        var tasks = scheduler.tasks(work, now);
        var list = [];
        for (var index = 0; index < tasks.length; index++) {
            list.push({
                id: tasks[index].id,
                dueAt: tasks[index].dueAt,
                due: tasks[index].dueAt ? tasks[index].dueAt - now : null
            });
        }
        return list;
    };


/* ---- 80_boot.js ---- */
    /* ------------------------------------------------------------------
     * 80 启动同步 (A04)
     *
     * 不再用“跳过网络 = 加载完成”的方式进游戏，而是：
     *   本地身份 -> 读档/迁移 -> 配置 -> 时钟 -> 离线追赶 -> 模型装载 -> UI 刷新 -> 同步完成
     * 装载过程复用客户端自己的联机流程 (UserEventType.enterGame -> client_load_all_info
     * -> syncComplete)，因此回调顺序与联机一致。
     * ------------------------------------------------------------------ */
    var boot = LF.boot = {};

    boot.installed = false;
    boot.started = false;
    boot.report = null;

    /** 与 core.SocketManage 期望一致的最小 socket 实现。 */
    boot.localSocket = {
        name: "local-socket",
        getState: function () {
            return core.SocketState.ConnectionSucceed;
        },
        send: function (text) {
            server.receive(text);
        },
        connect: function () {},
        connectByUrl: function () {},
        destroy: function () {},
        close: function () {},
        addEventListener: function () {},
        removeEventListener: function () {},
        addEventListeners: function () {},
        removeEventListeners: function () {}
    };

    boot.install = function () {
        if (boot.installed) {
            return true;
        }
        LF.info("开始安装本地服务", {
            core: typeof core,
            socketManage: typeof core !== "undefined" && !!core.SocketManage,
            networkControl: typeof NetworkControl,
            runtime: typeof egret !== "undefined" && egret.Capabilities ? egret.Capabilities.runtimeType : "unknown"
        });
        if (typeof core === "undefined" || !core.SocketManage || !core.ModelManage) {
            LF.warn("客户端 core 尚未就绪，延迟安装本地服务");
            return false;
        }

        var originalSend = core.SocketManage.prototype.send;
        core.SocketManage.prototype.send = function (cmd, action) {
            if (!LF.flags.enabled) {
                return originalSend.apply(this, arguments);
            }
            if (this._socket !== boot.localSocket) {
                this._socket = boot.localSocket;
            }
            return originalSend.apply(this, arguments);
        };
        boot.originalSend = originalSend;

        if (typeof NetworkControl !== "undefined") {
            boot.originalLogin = NetworkControl.prototype.login;
            NetworkControl.prototype.login = function (callback) {
                LF.info("本地 login 被调用");
                if (!LF.flags.enabled) {
                    return boot.originalLogin.apply(this, arguments);
                }
                this.serverListIndex = 0;
                this.loginCallback = callback;
                try {
                    boot.start(this);
                } catch (error) {
                    LF.error("本地启动同步失败", String(error && error.stack ? error.stack : error));
                    boot.fail(this, error);
                }
            };
        }

        boot.installLifecycle();
        boot.installSceneHook();
        boot.installErrorTrap();
        boot.installed = true;
        LF.info("本地服务已安装", {version: LF.VERSION, rules: LF.RULES_VERSION});
        return true;
    };

    /**
     * 捕获进入游戏后才安装的 window.onerror（Main 会覆盖它）。
     * 用属性拦截而不是直接赋值，这样之后任何赋值都会被我们记录，
     * 崩溃原因才能落到诊断日志/状态文件里。
     */
    boot.installErrorTrap = function () {
        if (boot.errorTrapInstalled) {
            return;
        }
        boot.errorTrapInstalled = true;
        boot.lastError = null;
        boot.errorLog = [];
        var record = function (message, source, line, column, error) {
            var text = String(message) + " @ " + String(source) + ":" + line + ":" + column;
            if (error && error.stack) {
                text += "\n" + String(error.stack);
            }
            boot.lastError = {
                at: Math.floor(Date.now() / 1000),
                message: String(message),
                source: String(source),
                line: line,
                stack: error && error.stack ? String(error.stack) : null
            };
            boot.errorLog.push(boot.lastError);
            while (boot.errorLog.length > 10) {
                boot.errorLog.shift();
            }
            LF.error("window.onerror: " + text);
            diagFile.write(true);
        };
        boot.recordError = record;
        var current = global.onerror;
        var handler = function (message, source, line, column, error) {
            record(message, source, line, column, error);
            if (typeof current === "function") {
                return current.apply(this, arguments);
            }
            return false;
        };
        handler.__lfWrapped = true;
        try {
            Object.defineProperty(global, "onerror", {
                configurable: true,
                enumerable: true,
                get: function () {
                    return handler;
                },
                set: function (fn) {
                    if (fn !== handler) { current = fn; }
                }
            });
        } catch (error) {
            /* 不支持 defineProperty 时退化为一次性包装 */
            global.onerror = handler;
        }
        if (global.addEventListener) {
            global.addEventListener("error", function (event) {
                if (event && event.message) {
                    record(event.message, event.filename, event.lineno, event.colno, event.error);
                }
            });
            global.addEventListener("unhandledrejection", function (event) {
                var reason = event && event.reason;
                boot.lastError = {
                    at: Math.floor(Date.now() / 1000),
                    message: "unhandledrejection",
                    stack: reason && reason.stack ? String(reason.stack) : String(reason)
                };
                LF.error("unhandledrejection: " + boot.lastError.stack);
                diagFile.write(true);
            });
        }
    };

    /**
     * Main 在构造时会重新赋值 window.onerror，所以进入场景后再包一层；
     * 同时记录 NetworkControl.reloading，崩溃前最后一条业务日志能直接定位玩法。
     */
    boot.wrapClientErrorHandler = function () {
        try {
            var current = global.onerror;
            if (typeof current === "function" && !current.__lfWrapped) {
                var wrapped = function (message, source, line, column, error) {
                    boot.recordError(message, source, line, column, error);
                    return current.apply(this, arguments);
                };
                wrapped.__lfWrapped = true;
                global.onerror = wrapped;
                LF.info("已包装客户端 window.onerror");
            }
        } catch (error) {
            LF.warn("包装 window.onerror 失败", String(error));
        }
        try {
            if (typeof NetworkControl !== "undefined" && NetworkControl.prototype.reloading
                && !NetworkControl.prototype.reloading.__lfWrapped) {
                var originalReloading = NetworkControl.prototype.reloading;
                var wrappedReloading = function (reason) {
                    boot.lastReload = {
                        at: Math.floor(Date.now() / 1000),
                        reason: reason,
                        lastOps: util.toArray(LF.state.data && LF.state.data.journal.lastOps).slice(-5),
                        lastRequests: server.recentRequests.slice(-10)
                    };
                    LF.error("客户端触发 reloading", boot.lastReload);
                    diagFile.write(true);
                    return originalReloading.apply(this, arguments);
                };
                wrappedReloading.__lfWrapped = true;
                NetworkControl.prototype.reloading = wrappedReloading;
            }
        } catch (error2) {
            LF.warn("包装 reloading 失败", String(error2));
        }
    };

    /**
     * 场景钩子：不同运行时的进入游戏路径不同
     *   - 网页/测试通道：LoadingController -> NetworkControl.login（已由 login 补丁覆盖）
     *   - EgretNative/混合包：WebLoadingController 直接 addViewControl(MainOutController)
     * 这里在主场景出现时兜底触发本地同步，保证两条路径都能装载权威状态。
     */
    boot.installSceneHook = function () {
        if (!core.PageManage || !core.PageManage.prototype.addViewControl) {
            LF.warn("PageManage.addViewControl 不可用，场景钩子未安装");
            return;
        }
        var originalAdd = core.PageManage.prototype.addViewControl;
        core.PageManage.prototype.addViewControl = function (controlType) {
            try {
                if (typeof MainOutController !== "undefined" && controlType === MainOutController) {
                    if (!boot.ensureStarted()) { return null; }
                }
            } catch (error) {
                LF.warn("场景钩子异常", String(error));
            }
            return originalAdd.apply(this, arguments);
        };
        boot.originalAddViewControl = originalAdd;
    };

    /** 兜底启动：主场景出现但 login 未被调用时使用。 */
    boot.ensureStarted = function () {
        if (boot.failed) { return false; }
        if (boot.started) {
            return true;
        }
        var control = LF.control();
        if (!control) {
            LF.warn("ensureStarted: NetworkControl 不可用");
            return false;
        }
        LF.info("场景钩子触发本地启动同步");
        try {
            boot.wrapClientErrorHandler();
            if (!control.loginCallback) {
                control.loginCallback = function () {};
            }
            boot.start(control);
        } catch (error) {
            LF.error("场景钩子启动失败", String(error && error.stack ? error.stack : error));
            boot.fail(control, error);
        }
        return !boot.failed;
    };

    boot.installLifecycle = function () {
        /* 前后台切换/退出时保存（A05） */
        try {
            if (typeof egret !== "undefined" && egret.lifecycle) {
                var originalPause = egret.lifecycle.onPause;
                var originalResume = egret.lifecycle.onResume;
                egret.lifecycle.onPause = function () {
                    try {
                        store.save("lifecycle.pause");
                    } catch (error) {
                        /* ignore */
                    }
                    if (typeof originalPause === "function") {
                        originalPause.apply(this, arguments);
                    }
                };
                egret.lifecycle.onResume = function () {
                    try {
                        boot.resume();
                    } catch (error) {
                        /* ignore */
                    }
                    if (typeof originalResume === "function") {
                        originalResume.apply(this, arguments);
                    }
                };
            }
        } catch (error) {
            LF.warn("生命周期钩子安装失败", String(error));
        }
        if (global.addEventListener) {
            global.addEventListener("pagehide", function () {
                store.save("pagehide");
            });
            global.addEventListener("beforeunload", function () {
                store.save("beforeunload");
            });
        }
        boot.autosave = setIntervalSafe(function () {
            if (!boot.failed && LF.state.data && LF.state.data.journal) {
                if (LF.state.data.scheduler.nextDueAt <= clock.now()) {
                    boot.resume();
                } else {
                    store.save("autosave");
                }
            }
        }, LF.RULES.AUTOSAVE_INTERVAL_MS);
    };

    function setIntervalSafe(fn, ms) {
        try {
            if (global.setInterval) {
                return global.setInterval(fn, ms);
            }
        } catch (error) {
            /* ignore */
        }
        try {
            return egret.setInterval(fn, null, ms);
        } catch (error2) {
            return 0;
        }
    }

    /** 恢复：追赶离线时间并刷新模型。 */
    boot.resume = function () {
        if (boot.failed || !LF.state.data) {
            return;
        }
        clock.syncClient();
        var effects = {};
        var outcome = LF.tx.commit(function (work) {
            var catchUp = scheduler.catchUp(work, effects);
            return {ok: true, changed: catchUp};
        }, {reason: "resume.catchUp"});
        if (outcome.ok) {
            server.emitEffects(effects);
        }
    };

    boot.start = function (control) {
        LF.info("本地启动同步开始");
        if (boot.started) {
            if (control && control.loginCallback) {
                control.loginCallback();
            }
            return;
        }
        boot.started = true;
        if (control && !control.loginCallback) {
            control.loginCallback = function () {};
        }
        var startedAt = Date.now();

        config.install();

        var report = store.load();
        boot.report = report;
        LF.info("存档装载结果: " + report.action, {issues: report.issues});
        LF.diag.boot = {report: report, at: Math.floor(startedAt / 1000)};
        if (!report.ok) {
            boot.fail(control, new Error(report.issues.join("；")));
            return;
        }

        clock.init();
        rng.init();
        LF.state.data.header.source = LF.state.data.header.source || "new";
        template.ensureStarterKit();
        if (template.lastOutcome && !template.lastOutcome.ok) {
            boot.fail(control, new Error("初始存档保存失败，请检查存储空间后重试"));
            return;
        }
        clock.syncClient();

        /* 离线追赶（草田成熟/口袋积累/天气刷新/商人离开） */
        var effects = {};
        var catchUpResult = LF.tx.commit(function (work) {
            var catchUp = scheduler.catchUp(work, effects);
            return {ok: true, changed: catchUp};
        }, {reason: "boot.catchUp"});

        if (!catchUpResult.ok) {
            boot.fail(control, new Error("本地存档保存失败，请检查存储空间后重试"));
            return;
        }
        diagFile.write(true);
        diagFile.start();
        LF.record("boot.done", {
            action: report.action,
            issues: report.issues.length,
            ms: Date.now() - startedAt
        });

        if (!report.ok) {
            boot.fail(control, new Error("存档装载失败"));
            return;
        }
        if (report.issues.length > 0) {
            LF.reportToPlayer("存档已修复：" + report.issues.length + " 处问题，详见诊断信息");
        }
        boot.restoreSettings();

        /* 复用客户端联机流程：enterGame -> client_set_* -> client_load_all_info
           -> 服务器推送模型数据 -> syncComplete -> loginCallback -> 进入场景 */
        if (control && typeof control.totalEvents === "function") {
            control.totalEvents(new core.Event(UserEventType.enterGame));
        } else {
            boot.fail(control, new Error("NetworkControl 不可用"));
        }
    };

    boot.fail = function (control, error) {
        boot.failed = true;
        boot.started = false;
        store.writeBlocked = true;
        LF.error("启动失败", String(error && error.message ? error.message : error));
        if (control) { control.syncComplete = false; }
        LF.reportToPlayer("本地存档未能加载，原存档已保留。" + String(error && error.message || error));
    };

    /** 新档赠送：配置在启动时才可用，因此这里做一次补偿。 */
    template.ensureStarterKit = function () {
        template.lastOutcome = null;
        var data = LF.state.data;
        var kit = data.header.starterKit;
        if (kit && kit.source === "config-driven" && kit.version === template.VERSION) {
            return kit;
        }
        if (!config.ready()) {
            LF.warn("配置未就绪，暂缓发放新档赠送");
            return kit;
        }
        var effects = {};
        var applied = null;
        template.lastOutcome = LF.tx.commit(function (work) {
            if (work.header.starterKit && work.header.starterKit.source === "config-driven") {
                return {ok: true, changed: {skipped: true}};
            }
            /* 只对“新档/恢复档”补偿，导入档必须保持原样 */
            if (work.header.source !== "new" && work.header.source !== "recovered") {
                return {ok: true, changed: {skipped: "import"}};
            }
            applied = template.applyStarterKit(work);
            rules.effect(effects, "clover");
            rules.effect(effects, "furniture");
            rules.effect(effects, "compost");
            rules.effect(effects, "tumbler");
            rules.effect(effects, "pocket");
            rules.effect(effects, "weather");
            return {ok: true, changed: {starterKit: applied.source}};
        }, {reason: "template.starterKit"});
        if (applied && template.lastOutcome.ok) {
            server.emitEffects(effects);
        }
        return template.lastOutcome.ok ? (applied || LF.state.data.header.starterKit) : null;
    };

    /** 启动时把所有已本地化的模型数据推给客户端。 */
    boot.emitModelLoads = function () {
        var work = LF.state.data;
        server.push("client_load_role", rules.snapshot.role(work));
        server.push("item_load_items", rules.snapshot.items(work));
        server.push("item_load_handbook", rules.snapshot.handbook(work));
        server.push("item_load_shop_info", rules.snapshot.shop(work));
        server.push("client_load_decorate", {
            has_list: util.clone(util.toArray(work.role.decorationList)),
            put_id: util.toInt(work.role.decorationPutID, 0),
            status: util.toInt(work.role.decorationStatus, 0)
        });
        server.push("clover_load_clovers", rules.clover.snapshot(work));
        server.push("weather_load", rules.snapshot.weather(work));
        server.push("furniture_load_furniture", rules.snapshot.furniture(work));
        server.push("furniture_load_tumbler", rules.snapshot.tumbler(work));
        server.push("furniture_load_compost", rules.snapshot.compost(work));
        server.push("furniture_load_pocket", rules.snapshot.pocket(work));
        server.push("furniture_load_flowerpot", rules.snapshot.flowerpot(work));
        server.push("task_load", rules.tasks ? rules.tasks.snapshot(work) : {tasks: [], list: []});
        server.push("task_load_list", rules.tasks ? rules.tasks.snapshot(work) : {reward: []});
        server.push("client_load_events", rules.travel.eventsSnapshot(work));
        server.push("mail_load", rules.mail.snapshot(work).mails);
        server.push("album_load_all", {id_list: util.clone(rules.album.ensure(work).pictures).map(function(p){return {id:p.id,pic_id:p.pic_id};})});
        server.push("album_load_new", {pictures: util.clone(rules.album.ensure(work).newPictures), visted_pic: [], has_ads: false, is_share: false});
        server.push("travel_load_note", rules.travel.noteSnapshot(work));
        server.push("travel_load_gift", rules.travel.giftSnapshot(work));
        LF.record("boot.modelLoads", {count: 20});
        boot.scheduleSceneRefresh();
    };

    boot.restoreSettings = function () {
        /* 单机版从新手教程完成后的可玩状态启动，避免客户端每次进入都重新展示旅行商人教程。 */
        if (LF.state.data && LF.state.data.settings && LF.state.data.settings.client) {
            LF.state.data.settings.client.guideFurniture = 5;
            LF.state.data.settings.client.guideFurnitureNotice = false;
        }
        var user = LF.model(UserModel);
        if (user) {
            user.clientSettings = util.fillDefaults(util.clone(LF.state.data.settings.client), new SettingsInfo());
        }
    };

    /**
     * 数据推送完成后刷新主场景。
     *
     * 进入游戏的路径有两类，混合包会先创建 MainOut 场景再拿到数据，
     * 此时草田/堆肥箱等一次性初始化的视图需要显式刷新（A04 的“UI 刷新”）。
     */
    boot.scheduleSceneRefresh = function (delay) {
        if (boot.refreshTimer) {
            return;
        }
        boot.refreshTimer = global.setTimeout(function () {
            boot.refreshTimer = 0;
            boot.refreshScene();
        }, delay === undefined ? 400 : delay);
    };

    boot.refreshScene = function () {
        try {
            if (typeof core === "undefined" || !core.PageManage || typeof MainOutController === "undefined") {
                return;
            }
            var controller = core.PageManage.getInstance().getControl(MainOutController, core.ViewLayerType.SceneLayer);
            var view = controller && controller.view;
            if (!view) {
                return;
            }
            /* 草田视图只在场景创建时构建一次，需要重建才能显示已成熟草位 */
            if (typeof view.initCloverPoint === "function") {
                if (view.cloverFarm && typeof view.cloverFarm.destroy === "function") {
                    view.cloverFarm.destroy();
                }
                view.cloverFarm = null;
                try {
                    view.initCloverPoint();
                    LF.diagSceneRefreshError = null;
                } catch (cloverError) {
                    LF.diagSceneRefreshError = String(cloverError && cloverError.stack
                        ? cloverError.stack : cloverError);
                    LF.error("草田视图刷新失败", LF.diagSceneRefreshError);
                }
            }
            if (typeof view.update_compost === "function") {
                boot.callView(view, "update_compost");
            }
            if (typeof view.update_tumber === "function") {
                boot.callView(view, "update_tumber");
            }
            if (typeof view.update_pocket === "function") {
                boot.callView(view, "update_pocket");
            }
            if (typeof view.update_flowerpot === "function") {
                boot.callView(view, "update_flowerpot");
            }
            if (typeof view.updateFurniture === "function") {
                boot.callView(view, "updateFurniture");
            }
            if (typeof view.updateCloverPanel === "function") {
                boot.callView(view, "updateCloverPanel");
            }
            LF.record("boot.sceneRefresh", {});
        } catch (error) {
            LF.diagSceneRefreshError = String(error && error.stack ? error.stack : error);
            LF.error("场景刷新失败", String(error && error.stack ? error.stack : error));
        }
    };

    /** 单个视图刷新失败不应影响其它设施（记录到诊断但不中断）。 */
    boot.callView = function (view, method) {
        try {
            view[method]();
        } catch (error) {
            var detail = method + ": " + String(error && error.message ? error.message : error);
            LF.diagViewRefreshErrors = LF.diagViewRefreshErrors || {};
            LF.diagViewRefreshErrors[method] = detail;
            LF.warn("视图刷新失败 " + detail);
        }
    };

    /** UI 提示：失败/修复必须让玩家看到，不能静默。 */
    LF.reportToPlayer = function (message) {
        LF.record("player.notice", {message: message});
        try {
            if (typeof core !== "undefined" && core.DisplayManage && core.DisplayManage.getInstance().getNoticeLayer) {
                var layer = core.DisplayManage.getInstance().getNoticeLayer();
                if (layer && typeof ModalAlert !== "undefined") {
                    layer.addChild(new ModalAlert(message));
                    return;
                }
            }
        } catch (error) {
            /* 进入场景前可能还没有 UI，降级为日志 */
        }
        LF.warn("提示玩家: " + message);
    };

    /** 等客户端脚本就绪后安装（本地服务脚本在 main.min.js 之后加载，通常立即成功）。 */
    boot.autoInstall = function () {
        var attempts = 0;
        var attempt = function () {
            attempts++;
            if (boot.install()) {
                return;
            }
            if (attempts >= LF.RULES.HOOK_ATTEMPTS) {
                LF.error("本地服务安装超时");
                return;
            }
            try {
                setTimeout(attempt, LF.RULES.HOOK_INTERVAL_MS);
            } catch (error) {
                /* ignore */
            }
        };
        attempt();
    };


/* ---- 85_diag.js ---- */
    /* ------------------------------------------------------------------
     * 85 本地诊断与验收工具 (A12)
     *
     * 只在控制台/测试端点使用，不进入正常玩家流程（默认不自动上报）。
     * 能力：状态摘要、存档导出/导入、受控时间推进、固定随机、未支持协议清单、
     *       操作日志、存档差异、新档自检。
     * ------------------------------------------------------------------ */
    LF.diagStatus = function () {
        var data = LF.state.data;
        if (!data) {
            return {loaded: false};
        }
        var work = data;
        return {
            loaded: true,
            version: LF.VERSION,
            rulesVersion: LF.RULES_VERSION,
            format: work.header.format,
            formatVersion: work.header.formatVersion,
            saveId: work.header.saveId,
            source: work.header.source,
            revision: work.header.revision,
            clientVersion: work.header.clientVersion,
            createdAt: work.header.createdAt,
            updatedAt: work.header.updatedAt,
            serverTime: clock.now(),
            dayKey: clock.dayKey(),
            wallet: {clover: work.wallet.clover, ticket: work.wallet.ticket},
            items: Object.keys(work.items.house).length,
            houseSample: (function () {
                var sample = [];
                for (var key in work.items.house) {
                    if (!util.has(work.items.house, key) || sample.length >= 12) {
                        continue;
                    }
                    var info = rules.itemInfo(key);
                    sample.push({
                        item_id: util.toInt(key, 0),
                        count: util.toInt(work.items.house[key], 0),
                        type: info ? util.toInt(info.type, -1) : -1,
                        sub_type: info ? util.toInt(info.sub_type, -1) : -1
                    });
                }
                return sample;
            })(),
            bag: util.clone(work.items.bag),
            desk: util.clone(work.items.desk),
            bagCompleted: work.items.bagCompleted,
            furniture: {
                benchOpen: work.furniture.shop.start_time > 0,
                shopPresent: work.furniture.shop.start_time <= clock.now() && work.furniture.shop.leave_time >= clock.now(),
                shopLeaveAt: work.furniture.shop.leave_time,
                bench: util.clone(work.furniture.bench),
                hasFur: util.toArray(work.furniture.has_fur).length,
                putFur: util.toArray(work.furniture.put_fur).length,
                shopList: util.toArray(work.furniture.shop.shop_list).length,
                shopStock: util.toArray(work.furniture.shop.shop_list).slice(0, 12).map(function (row) {
                    var entry = config.get("FurnitureShopDB", util.toInt(row.shop_id, -1));
                    return {
                        shop_id: util.toInt(row.shop_id, -1),
                        item_id: util.toInt(row.item_id, -1),
                        num: util.toInt(row.num, 0),
                        price: entry ? util.toInt(entry.price, 0) : null
                    };
                })
            },
            compost: {
                owned: util.toArray(work.compost.compost_list).length,
                showIndex: work.compost.show_index,
                state: work.compost.state,
                boxes: util.clone(work.compost.box_list)
            },
            tumbler: util.clone(work.tumbler),
            pocket: util.clone(work.pocket),
            flowerpot: util.clone(work.flowerpot),
            clover: {
                total: util.toArray(work.clover.slots).length,
                ready: util.toArray(work.clover.slots).filter(function (slot) {
                    return rules.clover.ready(slot, clock.now());
                }).length,
                readyIds: util.toArray(work.clover.slots).filter(function (slot) {
                    return rules.clover.ready(slot, clock.now());
                }).slice(0, 10).map(function (slot) {
                    return util.toInt(slot.clover_id, 0);
                })
            },
            weather: util.clone(work.weather),
            travel: LF.rules.travel.snapshot(work),
            album: LF.rules.album.snapshot(work),
            events: {pending: util.toArray(work.events.pending).length, settled: util.toArray(work.events.settled).length},
            gacha: util.clone(work.items.gacha),
            scheduler: LF.scheduler.describe(work),
            journal: {
                commits: work.journal.commitCount,
                lastReason: work.journal.lastCommitReason,
                lastAt: work.journal.lastCommitAt,
                lastSaveError: work.journal.lastSaveError || null,
                recovered: util.clone(util.toArray(work.journal.recovered)),
                recentOps: util.clone(util.toArray(work.journal.lastOps).slice(-5))
            },
            diagnostics: {
                unsupported: LF.diag.unsupported,
                errors: util.toArray(LF.diag.errors).slice(-5),
                server: LF.server.stats,
                configSample: LF.diagConfigSample || null,
                viewSample: LF.diagViewSample || null,
                configRefs: LF.diagValidate || null,
                statusFile: {
                    enabled: !!LF.flags.diagFile,
                    path: diagFile.pathResolved,
                    error: diagFile.lastError
                },
                lastExecutedSeq: remote.lastExecutedSeq
            },
            recentRequests: util.clone(server.recentRequests.slice(-10)),
            lastError: LF.boot.lastError || null,
            errorLog: util.toArray(LF.boot.errorLog).slice(-3),
            lastReload: LF.boot.lastReload || null,
            viewRefreshErrors: LF.diagViewRefreshErrors || null,
            sceneRefreshError: LF.diagSceneRefreshError || null
        };
    };

    LF.diagSaveText = function () {
        return JSON.stringify(LF.state.data);
    };

    LF.diagImportSave = function (text) {
        var parsed = store.parse(text);
        if (!parsed || !store.checkIntegrity(parsed)) {
            LF.record("diag.importRejected", {});
            return {ok: false, reason: "invalid-save"};
        }
        if (parsed.header.formatVersion > LF.SAVE_FORMAT_VERSION) {
            return {ok: false, reason: "unsupported-version"};
        }
        var migrated = state.migrate(parsed);
        var validated = state.validate(migrated.data);
        if (!validated.data) {
            return {ok: false, reason: "validate-failed"};
        }
        /* 导入是原子操作：失败保留旧档，成功前先备份当前档 */
        var persisted = store.save("import", validated.data);
        LF.record("diag.import", {ok: persisted, issues: validated.issues.length});
        return {ok: persisted, issues: validated.issues, report: validated.issues.slice(0, 10)};
    };

    LF.diagDiff = function (before, after) {
        before = before || {};
        after = after || LF.state.data;
        var keys = ["wallet", "items", "role", "furniture", "clover", "pocket", "compost", "tumbler", "settings"];
        var diff = {};
        for (var index = 0; index < keys.length; index++) {
            var key = keys[index];
            var a = JSON.stringify(before[key]);
            var b = JSON.stringify(after[key]);
            if (a !== b) {
                diff[key] = {before: util.clone(before[key]), after: util.clone(after[key])};
            }
        }
        return diff;
    };

    /** 受控时间推进：推进后立即补算并刷新界面。 */
    LF.diagTimeTravel = function (seconds) {
        var amount = Number(seconds);
        if (!isFinite(amount) || amount < 0) { return {ok: false, reason: "invalid-duration"}; }
        var second;
        var effects = {};
        var outcome = LF.tx.commit(function (work) {
            work.clock.timeTravelSeconds += Math.floor(amount);
            second = clock.now();
            var catchUp = scheduler.catchUp(work, effects);
            return {ok: true, changed: catchUp};
        }, {reason: "diag.timeTravel"});
        if (outcome.ok) {
            clock.syncClient();
            server.emitEffects(effects);
        }
        return {ok: outcome.ok, serverTime: outcome.ok ? second : clock.now(), tasks: outcome.changed};
    };

    LF.diagUnsupported = function () {
        return util.clone(LF.diag.unsupported);
    };

    LF.diagLogs = function () {
        return util.clone(LF.diag.logs.slice(-100));
    };

    /** 破坏性操作：必须显式 confirm。 */
    LF.diagReset = function (options) {
        options = options || {};
        if (options.confirm !== true) {
            return {ok: false, reason: "需要 diagReset({confirm:true}) 才可清档"};
        }
        var fresh = state.newSave({source: "new", clientVersion: store.clientVersion()});
        if (!store.save("diag.reset", fresh)) { return {ok: false, reason: "save-failed"}; }
        clock.init();
        rng.init();
        template.ensureStarterKit();
        LF.record("diag.reset", {});
        return {ok: true};
    };

    /** 自检：新档/当前档的硬性不变量。 */
    LF.selftest = function () {
        var results = [];
        function check(name, condition, detail) {
            results.push({name: name, ok: !!condition, detail: detail});
        }
        var work = LF.state.data;
        check("存档已装载", !!work);
        if (!work) {
            return {ok: false, results: results};
        }
        check("格式版本正确", work.header.format === LF.SAVE_FORMAT && work.header.formatVersion === LF.SAVE_FORMAT_VERSION);
        check("钱包非负", work.wallet.clover >= 0 && work.wallet.ticket >= 0);
        var negative = Object.keys(work.items.house).filter(function (key) {
            return work.items.house[key] < 0;
        });
        check("库存无负数", negative.length === 0, negative.join(","));
        check("行囊槽位数量正确", util.toArray(work.items.bag).length === 4);
        check("桌子槽位数量正确", util.toArray(work.items.desk).length === 8);
        check("工作台槽位数量正确", util.toArray(work.furniture.bench).length === 10);
        check("堆肥槽位数量正确", util.toArray(work.compost.box_list).length === 6);
        var placedIds = util.toArray(work.furniture.put_fur).map(function (item) {
            return item.id;
        });
        var ownedIds = util.toArray(work.furniture.has_fur);
        var orphan = placedIds.filter(function (id) {
            return ownedIds.indexOf(id) < 0;
        });
        check("已摆放家具均属于拥有清单", orphan.length === 0, orphan.join(","));
        check("时间单调", clock.now() >= work.clock.anchorServer);
        var json = JSON.stringify(work);
        check("存档可序列化", typeof json === "string" && json.length > 0, json.length + " bytes");
        check("存档可回读", !!store.parse(json));
        var status = LF.diagStatus();
        check("诊断可用", status.loaded === true);
        return {
            ok: results.every(function (item) {
                return item.ok;
            }),
            results: results,
            status: status
        };
    };

    /* ------------------------------------------------------------------
     * 设备文件通道（验收用，默认关闭）
     *
     * 通过客户端自带的 core.PlatformFile 原生桥写出状态快照，
     * 便于在没有控制台的设备上核对 M0/M1 的权威状态。
     * ------------------------------------------------------------------ */
    var diagFile = LF.diagFile = {};

    diagFile.path = "lf_status.json";
    diagFile.pathResolved = null;
    diagFile.lastWriteAt = 0;
    diagFile.lastError = null;

    diagFile.write = function (force) {
        if (!LF.flags.diagFile) {
            return;
        }
        var now = Date.now();
        if (!force && now - diagFile.lastWriteAt < LF.flags.diagFileIntervalMs) {
            return;
        }
        diagFile.lastWriteAt = now;
        if (typeof core === "undefined" || !core.PlatformFile || !core.PlatformFile.getPath) {
            diagFile.lastError = "PlatformFile 不可用";
            return;
        }
        var payload = JSON.stringify({
            writtenAt: Math.floor(now / 1000),
            localService: LF.VERSION,
            rulesVersion: LF.RULES_VERSION,
            status: LF.diagStatus(),
            selftest: LF.selftest(),
            unsupported: LF.diagUnsupported(),
            logs: LF.diagLogs().slice(-30)
        }, null, 2);
        try {
            core.PlatformFile.getPath(diagFile.path).then(function (path) {
                diagFile.pathResolved = path;
                return core.PlatformFile.writeFile(path, payload);
            }).then(function (ok) {
                diagFile.lastError = ok === false ? "writeFile=false" : null;
            })["catch"](function (error) {
                diagFile.lastError = String(error);
            });
        } catch (error) {
            diagFile.lastError = String(error);
        }
    };

    diagFile.start = function () {
        if (!LF.flags.diagFile || diagFile.timer) {
            return;
        }
        var tick = function () {
            diagFile.write(false);
        };
        try {
            diagFile.timer = global.setInterval(tick, LF.flags.diagFileIntervalMs);
        } catch (error) {
            diagFile.timer = 0;
        }
        diagFile.startCommandPoll();
    };

    /**
     * 命令文件通道：主机把命令写到 PlatformFile 目录下的 lf_command.json，
     * 客户端读取后立即删除。该通道不依赖网络，适合真机验收。
     */
    diagFile.commandName = "lf_command.json";
    diagFile.commandSeq = [];

    diagFile.startCommandPoll = function () {
        if (diagFile.commandTimer) {
            return;
        }
        var poll = function () {
            if (typeof core === "undefined" || !core.PlatformFile || !core.PlatformFile.getPath) {
                return;
            }
            var path = diagFile.commandPath;
            var chain = path ? Promise.resolve(path) : core.PlatformFile.getPath(diagFile.commandName);
            chain.then(function (resolved) {
                diagFile.commandPath = resolved;
                return core.PlatformFile.readFile(resolved);
            }).then(function (text) {
                if (!text || typeof text !== "string") {
                    return;
                }
                var commands;
                try {
                    commands = JSON.parse(text);
                } catch (error) {
                    LF.warn("命令文件解析失败", String(text).slice(0, 120));
                    core.PlatformFile.clearFile(diagFile.commandPath);
                    return;
                }
                core.PlatformFile.clearFile(diagFile.commandPath);
                remote.execute(Array.isArray(commands) ? commands : [commands]);
            })["catch"](function () {
                /* 文件不存在时 readFile 会失败，这里静默忽略 */
            });
        };
        try {
            diagFile.commandTimer = global.setInterval(poll, 2000);
        } catch (error) {
            diagFile.commandTimer = 0;
        }
    };

    /* ------------------------------------------------------------------
     * 远程诊断桥（验收用，默认关闭）
     *
     * 打开方式：启动参数 ?lfdiag=http://10.0.2.2:8799 或
     *           localStorage["lf_diag_endpoint"] = "http://10.0.2.2:8799"
     * 用途：在真机/模拟器上自动化验收 M0/M1（读取权威状态、推进时间、导出存档）。
     * 正式发行构建不配置端点即完全静默。
     * ------------------------------------------------------------------ */
    var remote = LF.diagRemote = {};

    remote.enabled = false;
    remote.endpoint = "";
    remote.timer = null;
    remote.lastReport = null;
    remote.pollSeq = 0;

    remote.detect = function () {
        var endpoint = "";
        try {
            if (typeof core !== "undefined" && core.String && core.String.getQueryString) {
                endpoint = core.String.getQueryString("lfdiag") || "";
            }
        } catch (error) {
            endpoint = "";
        }
        if (!endpoint) {
            try {
                endpoint = store.rawGet("lf_diag_endpoint") || "";
            } catch (error2) {
                endpoint = "";
            }
        }
        if (endpoint) {
            remote.start(endpoint);
        }
        return endpoint;
    };

    remote.start = function (endpoint) {
        remote.endpoint = String(endpoint).replace(/\/$/, "");
        remote.enabled = true;
        LF.info("远程诊断已启用: " + remote.endpoint);
        if (remote.timer) {
            return;
        }
        var tick = function () {
            try {
                remote.poll();
            } catch (error) {
                LF.warn("远程诊断轮询失败", String(error));
            }
        };
        tick();
        try {
            remote.timer = global.setInterval(tick, 3000);
        } catch (error) {
            try {
                remote.timer = egret.setInterval(tick, null, 3000);
            } catch (error2) {
                remote.timer = 0;
            }
        }
    };

    remote.post = function (path, body) {
        if (!remote.enabled || !global.XMLHttpRequest) {
            return;
        }
        try {
            var request = new global.XMLHttpRequest();
            /* 时间戳查询参数：EgretNative 会缓存同 URL 的响应，必须逐次唯一 */
            request.open("POST", remote.endpoint + path + "?t=" + Date.now(), true);
            request.setRequestHeader("Content-Type", "application/json");
            request.send(JSON.stringify(body));
        } catch (error) {
            LF.warn("远程诊断上报失败", String(error));
        }
    };

    remote.poll = function () {
        if (!remote.enabled || !global.XMLHttpRequest) {
            return;
        }
        var status = LF.diagStatus();
        remote.lastReport = status;
        remote.post("/report", {
            status: status,
            save: JSON.parse(JSON.stringify(LF.state.data)),
            selftest: LF.selftest(),
            logs: LF.diagLogs().slice(-20)
        });
        var request = new global.XMLHttpRequest();
        request.onreadystatechange = function () {
            if (request.readyState !== 4) {
                return;
            }
            var text = "";
            try {
                text = request.responseText;
            } catch (error) {
                text = "";
            }
            if (typeof text !== "string" || text.length === 0) {
                try {
                    if (typeof request.response === "string") {
                        text = request.response;
                    }
                } catch (error2) {
                    text = "";
                }
            }
            if (typeof text !== "string" || text.length === 0 || text === "undefined") {
                return;
            }
            var commands;
            try {
                commands = JSON.parse(text);
            } catch (error) {
                LF.warn("远程诊断指令解析失败", text.slice(0, 120));
                return;
            }
            remote.execute(commands);
        };
        try {
            request.open("GET", remote.endpoint + "/command?t=" + Date.now() + "-" + remote.pollSeq, true);
            remote.pollSeq++;
            request.send(null);
        } catch (error) {
            LF.warn("远程诊断指令读取失败", String(error));
        }
    };

    remote.execute = function (commands) {
        if (!Array.isArray(commands)) {
            return;
        }
        for (var index = 0; index < commands.length; index++) {
            var command = commands[index] || {};
            if (!remote.claim(command)) {
                continue;
            }
            var op = String(command.op || "");
            var arg = command.arg;
            LF.record("diag.remoteCommand", {op: op, arg: arg});
            if (op === "timeTravel") {
                LF.diagTimeTravel(arg || 0);
            } else if (op === "seed") {
                rng.reseed(arg);
            } else if (op === "import") {
                LF.diagImportSave(arg);
            } else if (op === "reset") {
                LF.diagReset({confirm: true});
                boot.emitModelLoads();
            } else if (op === "grant") {
                remote.grant(arg);
            } else if (op === "prepareTravel") {
                remote.prepareTravel(arg || {});
            } else if (op === "startTravel") {
                remote.startTravel(arg || {});
            } else if (op === "advanceTravel") {
                remote.advanceTravel();
            } else if (op === "claimTravel") {
                remote.claimTravel(arg || {});
            } else if (op === "confirmEvent") {
                remote.confirmEvent(arg);
            } else if (op === "harvest") {
                remote.harvest(arg);
            } else if (op === "buy") {
                remote.protocol("item_buy", {shop_id: arg && arg.shopId !== undefined ? arg.shopId : arg});
            } else if (op === "buyFurniture") {
                remote.protocol("furniture_buy_shop",
                    {shop_id: arg && arg.shopId !== undefined ? arg.shopId : arg});
            } else if (op === "buyFurnitureUi") {
                remote.buyFurnitureUi(arg && arg.shopId !== undefined ? arg.shopId : arg);
            } else if (op === "protocol") {
                remote.protocol(arg && arg.cmd, (arg && arg.data) || {});
            } else if (op === "config") {
                remote.configSample(arg);
            } else if (op === "view") {
                remote.viewSample();
            } else if (op === "refresh") {
                boot.refreshScene();
                remote.viewSample();
            } else if (op === "validate") {
                remote.validateRefs();
            } else if (op === "openShop") {
                remote.openView(FurnitureShopController);
            } else if (op === "openBench") {
                remote.openView(FurnitureBenchViewController);
            } else if (op === "closeWindows") {
                try {
                    core.PageManage.getInstance().removeControlAll(core.ViewLayerType.WindowLayer);
                } catch (error) {
                    LF.warn("closeWindows failed", String(error));
                }
            } else if (op === "reloadModels") {
                boot.emitModelLoads();
            }
        }
    };

    /**
     * 读取主场景视图的关键显示状态（验收“设施真的显示了”这一条，
     * 而不是只看存档里有没有数据）。
     */
    remote.viewSample = function () {
        var sample = {at: Math.floor(Date.now() / 1000), found: false};
        try {
            var pageManage = core.PageManage.getInstance();
            var controller = pageManage.getControl(MainOutController, core.ViewLayerType.SceneLayer);
            var view = controller && controller.view;
            if (view) {
                sample.found = true;
                sample.benchVisible = !!(view.imgFurnitureBench && view.imgFurnitureBench.visible);
                sample.benchSource = view.imgFurnitureBench ? String(view.imgFurnitureBench.source) : null;
                sample.benchEmptyVisible = !!(view.imgFurnitureBenchEmpty && view.imgFurnitureBenchEmpty.visible);
                sample.enterBenchBtnVisible = !!(view.btn_enterFurnitureBench && view.btn_enterFurnitureBench.visible);
                sample.shopVisible = !!(view.shop_mc && view.shop_mc.visible);
                sample.compostSource = view.compost ? String(view.compost.source) : null;
                sample.landSource = view.land ? String(view.land.source) : null;
                sample.pocketSource = view.imgPocket ? String(view.imgPocket.source) : null;
                sample.tumblerChildren = view.groupTumber ? view.groupTumber.numChildren : null;
                sample.cloverOnField = view.cloverFarm && view.cloverFarm.viewList
                    ? view.cloverFarm.viewList.length : null;
                sample.cloverPointCount = view.cloverPointList ? view.cloverPointList.length : null;
                sample.cloverPointText = view.cloverPoint ? String(view.cloverPoint.text) : null;
                sample.seasonKey = view.seasonKey;
                sample.guideFurnitureView = !!view.guideFurnitureView;
                sample.shopDragonbones = !!view.shop_dragonbones;
                try {
                    sample.eventsDisposeComplete = NetworkControl.getInstance().isEventsDisposeComplete;
                } catch (error2) {
                    sample.eventsDisposeComplete = null;
                }
                try {
                    sample.guideStep = core.ModelManage.getInstance().getModel(UserModel)
                        .getClientSettings().guideStep;
                    sample.guideFurniture = core.ModelManage.getInstance().getModel(UserModel)
                        .getClientSettings().guideFurniture;
                    sample.guideFurnitureNotice = core.ModelManage.getInstance().getModel(UserModel)
                        .getClientSettings().guideFurnitureNotice;
                } catch (error3) {
                    sample.guideReadError = String(error3);
                }
                /* 客户端侧的实际显示数据：用于核对“权威值 vs 客户端展示值”是否一致 */
                try {
                    var furnitureModel = core.ModelManage.getInstance().getModel(FurnitureModel);
                    var itemModel = core.ModelManage.getInstance().getModel(ItemModel);
                    sample.clientShopList = util.toArray(furnitureModel.serverData.shop.shop_list)
                        .map(function (row) {
                            return [util.toInt(row.shop_id, -1), util.toInt(row.num, -99)];
                        }).slice(0, 8);
                    sample.clientClover = core.ModelManage.getInstance().getModel(UserModel).getClover();
                    sample.clientPurchasedMap = util.clone(itemModel.purchasedMap);
                } catch (error4) {
                    sample.clientReadError = String(error4);
                }
                sample.refreshError = LF.diagSceneRefreshError || null;
                sample.viewRefreshErrors = LF.diagViewRefreshErrors || null;
            }
        } catch (error) {
            sample.error = String(error);
        }
        LF.diagViewSample = sample;
        LF.record("diag.viewSample", sample);
        return sample;
    };

    remote.executedSeq = [];

    /**
     * 走与界面确认按钮完全相同的客户端入口（FurnitureModel.requestBuy），
     * 用于复现/验证“客户端回调自行扣库存”的显示问题。
     */
    remote.prepareTravel = function (arg) {
        var effects = {}; var out = LF.tx.commit(function (work) { return LF.rules.travel.prepare(work, arg || {}, effects); }, {reason:"diag.prepareTravel"});
        if (out.ok) { server.emitEffects(effects); } return out;
    };
    remote.startTravel = function (arg) {
        var effects = {}; var out = LF.tx.commit(function (work) { return LF.rules.travel.start(work, arg || {}, effects); }, {reason:"diag.startTravel"});
        if (out.ok) { server.emitEffects(effects); } return out;
    };
    remote.advanceTravel = function () {
        var effects = {}; var out = LF.tx.commit(function (work) { return LF.rules.travel.advance(work, effects); }, {reason:"diag.advanceTravel"});
        if (out.ok) { server.emitEffects(effects); } return out;
    };
    remote.claimTravel = function (arg) {
        var effects = {}; var out = LF.tx.commit(function (work) { return LF.rules.travel.claim(work, arg || {}, effects); }, {reason:"diag.claimTravel"});
        if (out.ok) { server.emitEffects(effects); boot.emitModelLoads(); } return out;
    };
    remote.confirmEvent = function (id) {
        var effects = {}; var out = LF.tx.commit(function (work) { return LF.rules.travel.confirmEvent(work, id, effects); }, {reason:"diag.confirmEvent"});
        if (out.ok) { server.emitEffects(effects); boot.emitModelLoads(); } return out;
    };
    remote.expandAlbum = function (pages) {
        var effects = {}; var out = LF.tx.commit(function (work) {
            return LF.rules.album.expand(work, {pages: pages}, effects);
        }, {reason: "diag.expandAlbum"});
        if (out.ok) { server.emitEffects(effects); boot.emitModelLoads(); }
        return out;
    };

    remote.buyFurnitureUi = function (shopId) {
        var model = LF.model(FurnitureModel);
        if (!model || typeof model.requestBuy !== "function") {
            LF.info("buyFurnitureUi: FurnitureModel 不可用", {shopId: shopId});
            return false;
        }
        var entry = config.get("FurnitureShopDB", shopId);
        var roleModel = LF.model(RoleModel);
        LF.info("buyFurnitureUi: 调用 requestBuy", {
            shopId: shopId,
            entry: entry ? {id: entry.id, item_id: entry.item_id, price: entry.price} : null,
            pendingResend: roleModel ? util.toArray(roleModel.harvestCloverList).length : -1,
            clover: LF.state.data.wallet.clover
        });
        model.requestBuy(shopId, new core.Action1(function () {
            LF.info("buyFurnitureUi: requestBuy 回调完成", {shopId: shopId});
            LF.record("diag.buyFurnitureUi.done", {shopId: shopId});
            diagFile.write(true);
        }));
        return true;
    };

    /** 验收用：直接打开某个界面（与点击入口走同一条 addViewControl 路径）。 */
    remote.openView = function (Controller) {
        try {
            core.PageManage.getInstance().addViewControl(
                Controller, core.ViewLayerType.WindowLayer, core.RemoveViewType.HideBefore);
            LF.record("diag.openView", {name: String(Controller && Controller.name)});
            return true;
        } catch (error) {
            LF.error("打开界面失败", String(error && error.stack ? error.stack : error));
            return false;
        }
    };

    /**
     * 交叉校验包内配置：商店货架/家具商店引用的物品必须在 ItemDB 中存在，
     * 否则客户端渲染货架时会取到 undefined 并抛异常（表现为点开商人就崩）。
     */
    remote.validateRefs = function () {
        var result = {at: Math.floor(Date.now() / 1000), missing: [], checked: 0};
        var ids = config.ids("FurnitureShopDB");
        for (var index = 0; index < ids.length; index++) {
            var entry = config.get("FurnitureShopDB", ids[index]);
            if (!entry) {
                continue;
            }
            result.checked++;
            if (!config.get("ItemDB", entry.item_id)) {
                result.missing.push({shop_id: entry.id, item_id: entry.item_id});
            }
        }
        var shopIds = config.ids("ShopDataDB");
        for (var s = 0; s < shopIds.length; s++) {
            var shopEntry = config.get("ShopDataDB", shopIds[s]);
            if (!shopEntry) {
                continue;
            }
            result.checked++;
            if (!config.get("ItemDB", shopEntry.itemId)) {
                result.missing.push({shop_id: shopEntry.id, item_id: shopEntry.itemId, table: "ShopDataDB"});
            }
        }
        LF.diagValidate = result;
        LF.record("diag.validateRefs", {missing: result.missing.length, checked: result.checked});
        return result;
    };
    remote.lastExecutedSeq = 0;

    /** 去重：EgretNative 的 XHR 在失败时可能复用上一次响应文本 */
    remote.claim = function (command) {
        if (command.seq === undefined || command.seq === null) {
            return true;
        }
        var token = String(command.seq);
        if (remote.executedSeq.indexOf(token) >= 0) {
            return false;
        }
        remote.executedSeq.push(token);
        var numeric = Number(token);
        if (isFinite(numeric) && numeric > remote.lastExecutedSeq) {
            remote.lastExecutedSeq = numeric;
        }
        LF.record("diag.commandExecuted", {seq: token});
        while (remote.executedSeq.length > 128) {
            remote.executedSeq.shift();
        }
        return true;
    };

    /** 读取包内配置样本（诊断/验收用；不修改任何状态）。 */
    remote.configSample = function (arg) {
        arg = arg || {};
        var tableName = arg.table || "ShopDataDB";
        var limit = Math.max(1, Math.min(40, util.toInt(arg.limit, 5)));
        var where = util.isObject(arg.where) ? arg.where : null;
        var ids = config.ids(tableName);
        var table = config.table(tableName);
        var src = table && table.src;
        var rows = [];
        for (var index = 0; index < ids.length && rows.length < limit; index++) {
            var entry = config.get(tableName, ids[index]);
            if (!entry) {
                continue;
            }
            if (where) {
                var matched = true;
                for (var key in where) {
                    if (util.has(where, key) && entry[key] !== where[key]) {
                        matched = false;
                        break;
                    }
                }
                if (!matched) {
                    continue;
                }
            }
            rows.push(entry);
        }
        LF.diagConfigSample = {
            table: tableName,
            total: ids.length,
            rows: rows,
            where: where,
            shape: {
                isArray: Array.isArray(src),
                kind: src === null || src === undefined ? "missing" : (Array.isArray(src) ? "array" : typeof src),
                length: Array.isArray(src) ? src.length : (src ? Object.keys(src).length : 0),
                firstKeys: src && !Array.isArray(src) ? Object.keys(src).slice(0, 6) : null,
                getterKind: table && table.count ? "IdGetter" : (table && table.get ? "KeyGetter" : "unknown")
            },
            at: Math.floor(Date.now() / 1000)
        };
        LF.record("diag.configSample", {table: tableName, total: ids.length});
        return LF.diagConfigSample;
    };

    remote.commandSeq = 900000;

    /** 以普通协议请求的形式驱动本地服务（与游戏内点击完全相同的代码路径）。 */
    remote.protocol = function (cmd, data) {
        if (!cmd) {
            return null;
        }
        remote.commandSeq++;
        var result = {cmd: cmd, data: data || {}};
        LF.record("diag.protocol", result);
        server.dispatch({cmd: String(cmd).replace(".", "_"), data: data || {}, session: remote.commandSeq});
        return result;
    };

    /** 采集第一个成熟草位（验收用）。 */
    remote.harvest = function () {
        var slots = LF.state.data.clover.slots;
        for (var index = 0; index < slots.length; index++) {
            if (rules.clover.ready(slots[index], clock.now())) {
                return remote.protocol("clover_harvest", {clover_id: slots[index].clover_id});
            }
        }
        return null;
    };

    /** 验收用发放：走与游戏内完全一致的结算路径。 */
    remote.grant = function (arg) {
        arg = arg || {};
        var effects = {};
        var outcome = LF.tx.commit(function (work) {
            var result;
            if (arg.clover || arg.ticket) {
                result = rules.wallet.grant(work, {clover: arg.clover, ticket: arg.ticket}, effects);
            }
            if (arg.itemId) {
                result = rules.items.add(work, arg.itemId, arg.count || 1, effects);
            }
            return result || {ok: true, code: LF.ERR.OK};
        }, {reason: "diag.grant"});
        if (outcome.ok) {
            server.emitEffects(effects);
        }
        return outcome;
    };


/* ---- 99_footer.js ---- */
    /* ------------------------------------------------------------------
     * 99 启动：脚本加载即安装本地服务
     * ------------------------------------------------------------------ */
    if (typeof core !== "undefined" && core.SocketManage) {
        boot.autoInstall();
    } else {
        /* main.min.js 尚未执行完（理论上不会发生）：等 DOMContentLoaded 后重试 */
        if (global.document && global.document.addEventListener) {
            global.document.addEventListener("DOMContentLoaded", function () {
                boot.autoInstall();
            });
        } else {
            boot.autoInstall();
        }
    }

    /* 对外暴露诊断/验收入口（只读 + 显式确认的破坏性操作） */
    LF.status = LF.diagStatus;
    LF.save = LF.diagSaveText;
    LF.import = LF.diagImportSave;
    LF.timeTravel = LF.diagTimeTravel;
    LF.unsupported = LF.diagUnsupported;
    LF.logs = LF.diagLogs;
    LF.reset = LF.diagReset;
    LF.checkNewSave = function () {
        return template.checkNewSave();
    };
    LF.connectDiagnostics = function (endpoint) {
        remote.start(endpoint);
    };

    LF.info("本地服务脚本已加载 v" + LF.VERSION);
})(typeof window !== "undefined" ? window : this);

/* 验收构建：启用远程诊断桥 */
(function () { if (window.LocalFrog) { window.LocalFrog.connectDiagnostics("http://10.0.2.2:8799"); } })();

/* 验收构建：启用设备文件状态快照 */
(function () { if (window.LocalFrog) { window.LocalFrog.flags.diagFile = true; } })();

/* 验收构建：启用远程诊断桥 */
(function () { if (window.LocalFrog) { window.LocalFrog.connectDiagnostics("http://10.0.2.2:8799"); } })();

/* 验收构建：启用设备文件状态快照 */
(function () { if (window.LocalFrog) { window.LocalFrog.flags.diagFile = true; } })();
