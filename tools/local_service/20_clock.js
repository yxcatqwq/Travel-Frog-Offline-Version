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

