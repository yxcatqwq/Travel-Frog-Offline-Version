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
