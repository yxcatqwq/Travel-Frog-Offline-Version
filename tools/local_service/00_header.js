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
        seasonFromClock: true,
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

