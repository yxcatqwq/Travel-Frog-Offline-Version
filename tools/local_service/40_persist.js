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
