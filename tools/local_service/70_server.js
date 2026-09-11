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

    server.handlers.wishingpool_load = {read:function(work){ return rules.wishingpool ? rules.wishingpool.snapshot(work) : LF.activities.read(work, "wishingpool"); }};
    server.handlers.wishingpool_wish = {idempotent:true,apply:function(work,params,effects){ return rules.wishingpool.wish(work,params,effects); }};
    server.handlers.other_load_touch = {read:function(work){ return rules.touch ? rules.touch.load(work) : LF.activities.read(work, "touch"); }};
    server.handlers.other_req_touch = {idempotent:true,apply:function(work,params,effects){ return rules.touch.request(work,params,effects); }};
    server.handlers.misc_moment_load = {read:function(work){ return rules.moment ? rules.moment.ensure(work) : LF.activities.read(work, "misc_moment"); }};
    server.handlers.misc_moment_unlock = {idempotent:true,apply:function(work,params,effects){ return rules.moment.unlock(work,params,effects); }};
    server.handlers.animpicture_load = {read:function(work){ return rules.animpicture.snapshot(work); }};
    server.handlers.animpicture_guide = {idempotent:true,apply:function(work,params,effects){ return rules.animpicture.guide(work,effects); }};
    server.handlers.animpicture_get_item = {idempotent:true,apply:function(work,params,effects){ return rules.animpicture.getItem(work,params,effects); }};

    server.handlers.visit_open = {idempotent:true,apply:function(work,params,effects){return rules.visit.open(work,params,effects);}};
    server.handlers.visit_set_expire_time = {idempotent:true,apply:function(work,params,effects){return rules.visit.setExpire(work,params,effects);}};
    server.handlers.visit_set_carpet = {idempotent:true,apply:function(work,params,effects){var v=work.activities&&work.activities.visit&&work.activities.visit.visitor;if(!v)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:"visitor-none"};v.carpet_id=util.toInt(params.id,-1);rules.effect(effects,"activities");return {ok:true,code:LF.ERR.OK};}};
    server.handlers.story_read_new_story = {idempotent:true,apply:function(work,params,effects){return rules.story.read(work,params,effects);}};
    server.handlers.story_send_gift = {idempotent:true,apply:function(work,params,effects){return rules.story.sendGift(work,params.gift||params,effects);}};

    server.handlers.cooking_start_cooking = {idempotent:true,apply:function(work,params,effects){return rules.cooking.start(work,params,effects);}};
    server.handlers.cooking_complete_task = {idempotent:true,apply:function(work,params,effects){return rules.cooking.complete(work,effects);}};
    server.handlers.cooking_select = {idempotent:true,apply:function(work,params,effects){return LF.activities.merge(work,"cooking",{select:util.toInt(params.index,0)},effects);}};

    server.handlers.capsule_get_coin = {idempotent:true,apply:function(work,params,effects){return rules.capsule.getCoin(work,params,effects);}};
    server.handlers.capsule_twist = {idempotent:true,apply:function(work,params,effects){return rules.capsule.twist(work,params,effects);}};
    server.handlers.capsule_patch = {idempotent:true,apply:function(work,params,effects){return LF.activities.merge(work,"capsule",params||{},effects);}};
    server.handlers.capsule_fast_task = {idempotent:true,apply:function(work,params,effects){return LF.activities.merge(work,"capsule",{fast_task:params||{}},effects);}};

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

