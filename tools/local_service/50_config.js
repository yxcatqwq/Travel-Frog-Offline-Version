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
