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

