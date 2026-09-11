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
