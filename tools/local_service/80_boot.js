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

