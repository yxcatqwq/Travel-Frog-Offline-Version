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

