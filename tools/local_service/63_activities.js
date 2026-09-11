    /* ------------------------------------------------------------------
     * 63 活动玩法本地容器（C01-C17）
     * 活动规则尚未有统一的原版配方时，先提供可持久化、可恢复、可领取一次的
     * 状态接口。未知字段原样保留，便于在线账号导入和后续按活动逐项替换规则。
     * ------------------------------------------------------------------ */
    var activities = LF.activities = {};
    activities.keys = ["visit", "story", "misc_moment", "easteregg", "touch", "wishingpool", "lottery", "animpicture", "museum", "encyclopedia", "encytravel", "calendar", "calendar_note", "recharge", "recharge_gift", "recharge_num", "adsmgr", "rank", "cooking", "capsule", "greetcard", "springcard", "partycake", "museumday", "pray"];
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
    /* C07 ??????????????????????????? */
    rules.cooking = rules.cooking || {};
    rules.cooking.ensure = function(work) { var v=activities.ensure(work).cooking; if(!util.isObject(v)) v=activities.ensure(work).cooking={}; if(!Array.isArray(v.task_list))v.task_list=[]; return v; };
    rules.cooking.start = function(work,params,effects) { params=util.isObject(params)?params:{}; var v=rules.cooking.ensure(work); if(v.process&&(v.process.state==='running'||v.process.state==='ready'))return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cooking-running'}; var output=util.toInt(params.output_id||params.item_id,-1), count=Math.max(1,util.toInt(params.output_count||params.count,1)); if(output<0||!rules.itemInfo(output))return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cooking-output'}; var inputs=Array.isArray(params.inputs)?params.inputs:[]; for(var i=0;i<inputs.length;i++){var id=util.toInt(inputs[i].item_id||inputs[i].id,-1),n=Math.max(1,util.toInt(inputs[i].count||inputs[i].num,1));if(id<0||!rules.itemInfo(id)||rules.items.count(work,id)<n)return {ok:false,code:LF.ERR.NO_ITEM,reason:'cooking-material:'+id};} for(var j=0;j<inputs.length;j++){var cid=util.toInt(inputs[j].item_id||inputs[j].id,-1);var take=rules.items.consume(work,cid,Math.max(1,util.toInt(inputs[j].count||inputs[j].num,1)),effects);if(!take.ok)return take;} var now=clock.now(),finish=now+Math.max(1,util.toInt(params.duration,1800));v.process={state:'running',output_id:output,output_count:count,started_at:now,finish_at:finish,inputs:util.clone(inputs)};v.select=util.toInt(params.theme||params.select,v.select||0);rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,finish_at:finish}; };
    rules.cooking.finish = function(work,effects,now){var v=rules.cooking.ensure(work),p=v.process;if(!p||p.state!=='running'||util.toInt(p.finish_at,0)>now)return {ok:true,skipped:true};p.state='ready';rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK};};
    rules.cooking.complete = function(work,effects){var v=rules.cooking.ensure(work),p=v.process;if(!p||p.state!=='ready'||p.finish_at>clock.now())return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cooking-not-ready'};var add=rules.items.add(work,p.output_id,p.output_count,effects);if(!add.ok)return add;v.process=null;v.complete=true;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,item_list:[{item_id:p.output_id,count:p.output_count}]};};
    /* C08 ??????????????????? */
    rules.capsule = rules.capsule || {};
    rules.capsule.ensure = function(work){var v=activities.ensure(work).capsule;if(!Array.isArray(v.reward_list))v.reward_list=[];if(!Array.isArray(v.task_list))v.task_list=[];v.coin=Math.max(0,util.toInt(v.coin,0));return v;};
    rules.capsule.getCoin = function(work,params,effects){var v=rules.capsule.ensure(work);var explicit=params&&params.count!==undefined,n=explicit?Math.max(0,util.toInt(params.count,0)):Math.max(0,util.toInt(v.pre_coin,0));v.coin+=n;if(!explicit)v.pre_coin=0;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,coin:v.coin,pre_coin:v.pre_coin};};
    rules.capsule.reward = function(params){params=util.isObject(params)?params:{};var id=util.toInt(params.output_id||params.item_id||params.reward_id,-1),count=Math.max(1,util.toInt(params.output_count||params.num||params.count,1));if(id>=0)return {id:id,count:count};var row=config.get('capsuleData','reward');if(Array.isArray(row)&&row.length)row=row[0];if(util.isObject(row)){id=util.toInt(row.id||row.item_id||row.reward_id,-1);count=Math.max(1,util.toInt(row.num||row.count,1));}if(id<0)id=1001;return {id:id,count:count};};
    rules.capsule.twist = function(work,params,effects){params=util.isObject(params)?params:{};var v=rules.capsule.ensure(work),cost=Math.max(1,util.toInt(params.cost,1));if(v.coin<cost)return {ok:false,code:LF.ERR.NO_RESOURCE,reason:'capsule-coin'};var reward=rules.capsule.reward(params),id=reward.id,count=reward.count;if(id<0||!rules.itemInfo(id))return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'capsule-output'};v.coin-=cost;var add=rules.items.add(work,id,count,effects);if(!add.ok)return add;v.reward_list.push(id);while(v.reward_list.length>16)v.reward_list.shift();rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,reward_id:id,item_list:[{item_id:id,count:count}],coin:v.coin};};

    /* C17 许愿池。活动状态、开放期限和请求去重都保存在存档中，
     * 这样离线推进或重启后重复点击不会再次扣币。奖池由导入档或
     * 调用参数提供；没有奖品配置时明确失败，避免凭空发放奖励。 */
    var wishingpool = rules.wishingpool = {};
    wishingpool.ensure = function (work) {
        var value = activities.ensure(work).wishingpool;
        if (!util.isObject(value) || Array.isArray(value)) value = activities.ensure(work).wishingpool = {};
        value.end_time = Math.max(0, util.toInt(value.end_time, 0));
        value.coin = Math.max(0, util.toInt(value.coin, 0));
        if (!Array.isArray(value.items)) value.items = [];
        if (!Array.isArray(value.reward_list)) value.reward_list = [];
        if (!util.isObject(value.requests)) value.requests = {};
        return value;
    };
    wishingpool.snapshot = function (work) {
        var value = wishingpool.ensure(work);
        return {end_time:value.end_time, coin:value.coin, items:util.clone(value.items), reward_list:util.clone(value.reward_list)};
    };
    wishingpool.wish = function (work, params, effects) {
        params = util.isObject(params) ? params : {};
        var value = wishingpool.ensure(work), requestId = params.request_id !== undefined ? String(params.request_id) : (params.req_id !== undefined ? String(params.req_id) : '');
        if (requestId && value.requests[requestId]) return util.clone(value.requests[requestId]);
        var now = clock.now();
        if (value.end_time <= now) return {ok:false, code:LF.ERR.ILLEGAL_OP, reason:'wishingpool-closed'};
        var cost = Math.max(1, util.toInt(params.cost, 1));
        if (value.coin < cost) return {ok:false, code:LF.ERR.NO_RESOURCE, reason:'wishingpool-coin'};
        var id = util.toInt(params.output_id !== undefined ? params.output_id : (params.item_id !== undefined ? params.item_id : params.reward_id), -1);
        var count = Math.max(1, util.toInt(params.output_count !== undefined ? params.output_count : (params.count !== undefined ? params.count : 1), 1));
        if (id < 0 && value.items.length) {
            var row = value.items[0];
            id = util.toInt(util.isObject(row) ? (row.item_id !== undefined ? row.item_id : (row.id !== undefined ? row.id : row.reward_id)) : row, -1);
            if (util.isObject(row)) count = Math.max(1, util.toInt(row.count !== undefined ? row.count : row.num, count));
        }
        if (id < 0 || !rules.itemInfo(id)) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:'wishingpool-reward'};
        value.coin -= cost;
        var add = rules.items.add(work, id, count, effects);
        if (!add.ok) return add;
        var result = {ok:true, code:LF.ERR.OK, item_list:[{item_id:id, count:count}], coin:value.coin, end_time:value.end_time};
        value.reward_list.push({item_id:id, count:count, at:now});
        while (value.reward_list.length > 32) value.reward_list.shift();
        if (requestId) value.requests[requestId] = util.clone(result);
        rules.effect(effects, 'activities');
        return result;
    };

    /* C16 瞬间/彩蛋/点击事件：记录每个点击 ID 的次数和解锁状态。
     * 奖励由请求或导入配置显式给出，避免把未知线上 ID 当成物品发放。 */
    var touch = rules.touch = {};
    touch.ensure = function (work) {
        var value = activities.ensure(work).touch;
        if (!util.isObject(value) || Array.isArray(value)) value = activities.ensure(work).touch = {};
        value.cur = Math.max(0, util.toInt(value.cur, 0));
        if (!Array.isArray(value.list)) value.list = [];
        if (!util.isObject(value.counts)) value.counts = {};
        if (!util.isObject(value.claimed)) value.claimed = {};
        return value;
    };
    touch.load = function (work) { return util.clone(touch.ensure(work)); };
    touch.request = function (work, params, effects) {
        params = util.isObject(params) ? params : {};
        var value = touch.ensure(work), id = util.toInt(params.id !== undefined ? params.id : (params.touch_id !== undefined ? params.touch_id : params.type), -1);
        if (id < 0) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:'touch-id'};
        var key = String(id), count = Math.max(0, util.toInt(value.counts[key], 0)) + 1;
        value.counts[key] = count; value.cur = id;
        var row = {id:id, count:count, at:clock.now()};
        value.list.push(row); while (value.list.length > 64) value.list.shift();
        var rewardId = util.toInt(params.reward_id !== undefined ? params.reward_id : params.item_id, -1), rewardCount = Math.max(1, util.toInt(params.reward_count || params.count, 1));
        if (rewardId >= 0 && rules.itemInfo(rewardId) && !value.claimed[key]) {
            var add = rules.items.add(work, rewardId, rewardCount, effects); if (!add.ok) return add;
            value.claimed[key] = true; row.reward_id = rewardId; row.reward_count = rewardCount;
        }
        rules.effect(effects, 'activities');
        return {ok:true, code:LF.ERR.OK, id:id, count:count, reward_id:row.reward_id, item_list:row.reward_id === undefined ? [] : [{item_id:row.reward_id, count:row.reward_count}]};
    };
    var moment = rules.moment = {};
    moment.ensure = function (work) { var value = activities.ensure(work).misc_moment; if (!util.isObject(value) || Array.isArray(value)) value = activities.ensure(work).misc_moment = {}; if (!Array.isArray(value.list)) value.list = []; return value; };
    moment.unlock = function (work, params, effects) {
        params = util.isObject(params) ? params : {}; var id = util.toInt(params.id !== undefined ? params.id : params.moment_id, -1);
        if (id < 0) return {ok:false, code:LF.ERR.ILLEGAL_PARAM, reason:'moment-id'};
        var value = moment.ensure(work), found = false; for (var i=0;i<value.list.length;i++) if (util.toInt(value.list[i].id, -2) === id) { found = true; break; }
        if (!found) value.list.push({id:id, unlocked_at:clock.now()}); rules.effect(effects, 'activities');
        return {ok:true, code:LF.ERR.OK, id:id, already:found};
    };
    var encyclopedia = rules.encyclopedia = {};
    encyclopedia.ensure = function (work) { var value=activities.ensure(work).encyclopedia; if(!util.isObject(value)||Array.isArray(value))value=activities.ensure(work).encyclopedia={}; if(!Array.isArray(value.unlock_list))value.unlock_list=[]; if(!Array.isArray(value.unlock_desc))value.unlock_desc=[]; if(!Array.isArray(value.show_sub))value.show_sub=[]; return value; };
    encyclopedia.unlock = function (work, params, effects) { params=util.isObject(params)?params:{}; var id=util.toInt(params.id!==undefined?params.id:params.item_id,-1), value=encyclopedia.ensure(work); if(id<0)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'ency-id'}; if(value.unlock_list.indexOf(id)<0)value.unlock_list.push(id); rules.effect(effects,'activities'); return {ok:true,code:LF.ERR.OK,id:id}; };
    encyclopedia.snapshot = function (work) { var value=encyclopedia.ensure(work); if(!value.unlock_list.length&&work.items&&util.isObject(work.items.house))Object.keys(work.items.house).forEach(function(id){if(util.toInt(work.items.house[id],0)>0)value.unlock_list.push(util.toInt(id,0));}); return {unlock_list:util.clone(value.unlock_list),unlock_desc:util.clone(value.unlock_desc),show_sub:util.clone(value.show_sub)}; };
    encyclopedia.travelSnapshot = function (work) { var value=activities.ensure(work).encytravel; if(!util.isObject(value)||Array.isArray(value))value=activities.ensure(work).encytravel={unlock_list:[],unlock_desc:[],show_sub:[]}; if(!Array.isArray(value.unlock_list))value.unlock_list=[]; var album=rules.album&&rules.album.ensure?rules.album.ensure(work):{pictures:[]}; album.pictures.forEach(function(p){var id=p&& (p.pic_id!==undefined?p.pic_id:p.id); if(value.unlock_list.indexOf(id)<0)value.unlock_list.push(id);}); return {unlock_list:util.clone(value.unlock_list),unlock_desc:util.clone(value.unlock_desc||[]),show_sub:util.clone(value.show_sub||[])}; };
    var museumday = rules.museumday = {};
    museumday.ensure = function(work){var v=activities.ensure(work).museumday;if(!util.isObject(v)||Array.isArray(v))v=activities.ensure(work).museumday={};v.end_time=Math.max(0,util.toInt(v.end_time,0));v.compass=Math.max(0,util.toInt(v.compass,0));v.inspire_num=Math.max(0,util.toInt(v.inspire_num,0));v.next=Math.max(0,util.toInt(v.next,0));v.left_num=Math.max(0,util.toInt(v.left_num,0));['museum_list','items','get_items','log_list','path'].forEach(function(k){if(!Array.isArray(v[k]))v[k]=[];});return v;};
    museumday.snapshot=function(work){var v=museumday.ensure(work);if(v.end_time&&v.end_time<clock.now())v.end_time=0;return util.clone(v);};
    museumday.startAdvance=function(work,params,effects){params=util.isObject(params)?params:{};var v=museumday.ensure(work),cost=Math.max(0,util.toInt(params.cost,100));if(v.end_time&&v.end_time<clock.now())return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'museum-closed'};var paid=rules.wallet.consume(work,{clover:cost},effects);if(!paid.ok)return paid;var id=util.toInt(params.id!==undefined?params.id:params.museum_id,v.cur_museum);if(v.museum_list.indexOf(id)<0)v.museum_list.push(id);v.cur_museum=id;v.compass=Math.max(v.compass,Math.max(1,util.toInt(params.compass,3)));v.next=0;v.path=[];rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,compass:v.compass,museum_list:util.clone(v.museum_list)};};
    museumday.randomCompass=function(work,params,effects){var v=museumday.ensure(work);if(v.end_time&&v.end_time<clock.now())return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'museum-closed'};if(v.compass<1)return {ok:false,code:LF.ERR.NO_RESOURCE,reason:'compass'};v.compass--;var next=(Math.abs((clock.now()+v.path.length*17)%3)+1);v.next=next;v.path.push(next);rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,next:next,inspire:v.inspire_num};};
    museumday.dirCompass=function(work,params,effects){params=util.isObject(params)?params:{};var dir=util.toInt(params.dir,0),v=museumday.ensure(work);if(dir<1||dir>4)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'direction'};if(v.compass<1)return {ok:false,code:LF.ERR.NO_RESOURCE,reason:'compass'};v.compass--;v.next=dir;v.path.push(dir);rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,next:dir};};
    museumday.inspire=function(work,params,effects){var v=museumday.ensure(work);if(v.inspire_num<1)return {ok:false,code:LF.ERR.NO_RESOURCE,reason:'inspire'};v.inspire_num--;v.next=(Math.abs((clock.now()+v.path.length)%4)+1);v.path.push(v.next);rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,next:v.next,inspire:v.inspire_num};};
    museumday.getItems=function(work,effects){var v=museumday.ensure(work),received=[];for(var i=0;i<v.items.length;i++){var row=v.items[i],id=util.toInt(row&&row.item_id,-1),num=Math.max(1,util.toInt(row&&row.num,1));if(id>=0&&rules.itemInfo(id)){var add=rules.items.add(work,id,num,effects);if(!add.ok)return add;received.push({item_id:id,num:num});}}v.get_items=v.get_items.concat(received);v.items=[];rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,get_items:util.clone(v.get_items)};};
    museumday.refresh=function(work,params,effects){var v=museumday.ensure(work);if(v.left_num<=0)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'refresh-limit'};v.left_num--;v.next=0;v.path=[];rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,left_num:v.left_num};};
    var partycake = rules.partycake = {};
    partycake.ensure=function(work){var v=activities.ensure(work).partycake;if(!util.isObject(v)||Array.isArray(v))v=activities.ensure(work).partycake={};v.end_time=Math.max(0,util.toInt(v.end_time,0));v.cream=Math.max(0,util.toInt(v.cream,0));v.sugar=Math.max(0,util.toInt(v.sugar,0));v.pre_cream=Math.max(0,util.toInt(v.pre_cream,0));v.pre_sugar=Math.max(0,util.toInt(v.pre_sugar,0));v.cur_state=Math.max(0,util.toInt(v.cur_state,0));v.part=Math.max(0,util.toInt(v.part,0));['layers','task_list','share_get'].forEach(function(k){if(!Array.isArray(v[k]))v[k]=[];});return v;};
    partycake.snapshot=function(work){return util.clone(partycake.ensure(work));};
    partycake.getMate=function(work,effects){var v=partycake.ensure(work);v.cream+=v.pre_cream;v.sugar+=v.pre_sugar;v.pre_cream=0;v.pre_sugar=0;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,cream:v.cream,sugar:v.sugar};};
    partycake.make=function(work,params,effects){params=util.isObject(params)?params:{};var v=partycake.ensure(work),layer=Math.max(1,util.toInt(params.layer,1)),cream=Math.max(0,util.toInt(params.cream,1)),sugar=Math.max(0,util.toInt(params.sugar,1));if(v.cur_state!==0&&v.cur_state!==2)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-state'};if(v.cream<cream||v.sugar<sugar)return {ok:false,code:LF.ERR.NO_RESOURCE,reason:'cake-material'};v.cream-=cream;v.sugar-=sugar;v.layers.push(layer);v.cur_state=1;v.part=layer;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,state:v.cur_state,layer:layer};};
    partycake.rewardMake=function(work,effects){var v=partycake.ensure(work);if(v.cur_state!==1)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-make-reward'};v.cur_state=2;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,state:v.cur_state};};
    partycake.answer=function(work,params,effects){params=util.isObject(params)?params:{};var v=partycake.ensure(work);if(v.cur_state!==2)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-qa-state'};v.answer=util.toInt(params.index,0);v.wrong=params.correct===false?1:0;v.cur_state=3;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,state:v.cur_state,wrong:v.wrong};};
    partycake.rewardQa=function(work,effects){var v=partycake.ensure(work);if(v.cur_state!==3)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-qa-reward'};v.cur_state=4;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,state:v.cur_state};};
    partycake.light=function(work,effects){var v=partycake.ensure(work);if(v.cur_state!==4)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-light-state'};v.cur_state=5;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,state:v.cur_state};};
    partycake.rewardLight=function(work,effects){var v=partycake.ensure(work);if(v.cur_state!==5)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-light-reward'};v.cur_state=6;rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,state:v.cur_state};};
    partycake.rewardShare=function(work,params,effects){params=util.isObject(params)?params:{};var v=partycake.ensure(work),index=Math.max(1,util.toInt(params.index,1));if(v.share_get[index-1])return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'cake-share-claimed'};v.share_get[index-1]=1;if(params.item_id!==undefined){var id=util.toInt(params.item_id,-1),num=Math.max(1,util.toInt(params.count,1));if(id<0||!rules.itemInfo(id))return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'cake-share-item'};var add=rules.items.add(work,id,num,effects);if(!add.ok)return add;}rules.effect(effects,'activities');return {ok:true,code:LF.ERR.OK,index:index,state:v.cur_state};};

    /* C15 动态照片基础状态：先落地加载、引导和制作道具领取，后续图片槽
     * 转移均复用该持久化对象，避免客户端只在内存中显示。 */
    var animpicture = rules.animpicture = {};
    animpicture.ensure = function (work) {
        var value = activities.ensure(work).animpicture;
        if (!util.isObject(value) || Array.isArray(value)) value = activities.ensure(work).animpicture = {};
        value.guide = Math.max(0, util.toInt(value.guide, 0)); value.page_num = Math.max(0, util.toInt(value.page_num, 0)); value.item_num = Math.max(0, util.toInt(value.item_num, 0)); value.making_index = Math.max(0, util.toInt(value.making_index, 0));
        if (!Array.isArray(value.pic_list)) value.pic_list = [];
        return value;
    };
    animpicture.snapshot = function (work) { var value = animpicture.ensure(work); return {guide:value.guide, page_num:value.page_num, item_num:value.item_num, making_index:value.making_index, pic_list:util.clone(value.pic_list)}; };
    animpicture.guide = function (work, effects) { var value=animpicture.ensure(work); value.guide++; rules.effect(effects,'activities'); return {ok:true,code:LF.ERR.OK,guide:value.guide}; };
    animpicture.getItem = function (work, params, effects) { var value=animpicture.ensure(work), count=Math.max(1,util.toInt(params&&params.count,1)); value.item_num+=count; rules.effect(effects,'activities'); return {ok:true,code:LF.ERR.OK,item_num:value.item_num}; };
    animpicture.photoList = function (work) { if (!util.isObject(work.mail)) work.mail={pictures:[]}; if (!Array.isArray(work.mail.pictures)) work.mail.pictures=[]; return work.mail.pictures; };
    animpicture.photoIndex = function (list, id) { for (var i=0;i<list.length;i++) if (list[i] && String(list[i].id)===String(id)) return i; return -1; };
    animpicture.select = function (work, params, effects) { params=util.isObject(params)?params:{}; var value=animpicture.ensure(work), id=params.pic_id!==undefined?params.pic_id:(params.picture_id!==undefined?params.picture_id:params.id), list=animpicture.photoList(work), at=animpicture.photoIndex(list,id); if(at<0)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'picture-not-found'}; var picture=list.splice(at,1)[0], index=value.pic_list.length+1; value.pic_list.push({id:index,put_num:0,pictures:[],phase:Math.max(0,util.toInt(params.phase,1)),exp_pic:[util.clone(picture)]}); value.making_index=index; rules.effect(effects,'activities'); rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,index:index,making_index:index,pic_list:util.clone(value.pic_list[index-1])}; };
    animpicture.entry = function (work, index) { var value=animpicture.ensure(work), at=util.toInt(index,0)-1; return at>=0&&at<value.pic_list.length&&util.isObject(value.pic_list[at])?value.pic_list[at]:null; };
    animpicture.add = function (work, params, effects) { params=util.isObject(params)?params:{}; var entry=animpicture.entry(work,params.index!==undefined?params.index:params.anim_index); if(!entry)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'anim-index'}; var ids=Array.isArray(params.ids)?params.ids:(Array.isArray(params.pic_ids)?params.pic_ids:(params.pic_id!==undefined?[params.pic_id]:[])), list=animpicture.photoList(work), moved=[]; for(var i=0;i<ids.length;i++){var at=animpicture.photoIndex(list,ids[i]);if(at>=0){moved.push(list.splice(at,1)[0]);}} if(!moved.length)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'picture-not-found'}; entry.exp_pic=Array.isArray(entry.exp_pic)?entry.exp_pic:[]; Array.prototype.push.apply(entry.exp_pic,moved); rules.effect(effects,'activities'); rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,exp_pic:util.clone(entry.exp_pic)}; };
    animpicture.remove = function (work, params, effects) { params=util.isObject(params)?params:{}; var entry=animpicture.entry(work,params.index!==undefined?params.index:params.anim_index); if(!entry)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'anim-index'}; var slot=util.toInt(params.pic_index,0)-1, list=animpicture.photoList(work); entry.exp_pic=Array.isArray(entry.exp_pic)?entry.exp_pic:[]; if(slot<0||slot>=entry.exp_pic.length||!entry.exp_pic[slot])return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'pic-index'}; var removed=entry.exp_pic.splice(slot,1)[0]; if(!params.is_delete)list.push(removed); rules.effect(effects,'activities'); rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,exp_pic:util.clone(entry.exp_pic)}; };
    animpicture.openAlbum = function (work, params, effects) { params=util.isObject(params)?params:{}; var entry=animpicture.entry(work,params.index!==undefined?params.index:params.anim_index); if(!entry)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'anim-index'}; entry.put_num=Math.max(0,util.toInt(entry.put_num,0))+1; if(!Array.isArray(entry.pictures))entry.pictures=[]; entry.pictures.push(null); rules.effect(effects,'activities'); return {ok:true,code:LF.ERR.OK,put_num:entry.put_num,pictures:util.clone(entry.pictures)}; };
    animpicture.albumAdd = function (work, params, effects) { params=util.isObject(params)?params:{}; var entry=animpicture.entry(work,params.anim_index!==undefined?params.anim_index:params.index), slot=util.toInt(params.pic_index!==undefined?params.pic_index:params.index2,0)-1; if(!entry||slot<0||slot>=entry.pictures.length)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'album-slot'}; if(entry.pictures[slot])return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'album-slot-used'}; var list=animpicture.photoList(work), at=animpicture.photoIndex(list,params.pic_uid!==undefined?params.pic_uid:(params.pic_id!==undefined?params.pic_id:params.picture_id)); if(at<0)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'picture-not-found'}; entry.pictures[slot]=list.splice(at,1)[0]; rules.effect(effects,'activities'); rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,pictures:util.clone(entry.pictures)}; };
    animpicture.albumRemove = function (work, params, effects) { params=util.isObject(params)?params:{}; var entry=animpicture.entry(work,params.anim_index!==undefined?params.anim_index:params.index), slot=util.toInt(params.pic_index!==undefined?params.pic_index:params.index2,0)-1; if(!entry||slot<0||slot>=entry.pictures.length||!entry.pictures[slot])return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'album-slot-empty'}; var picture=entry.pictures[slot]; entry.pictures[slot]=null; if(!params.is_delete)animpicture.photoList(work).push(picture); rules.effect(effects,'activities'); rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,pictures:util.clone(entry.pictures)}; };
    animpicture.useItem = function (work, params, effects) { params=util.isObject(params)?params:{}; var value=animpicture.ensure(work), entry=animpicture.entry(work,params.index!==undefined?params.index:value.making_index); if(!entry)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'anim-index'}; if(value.item_num<1)return {ok:false,code:LF.ERR.NO_RESOURCE,reason:'animpicture-item'}; value.item_num--; entry.phase=Math.max(0,util.toInt(params.phase,util.toInt(entry.phase,1)-1)); if(entry.phase===0){var list=animpicture.photoList(work); Array.prototype.push.apply(list,entry.exp_pic||[]); entry.exp_pic=[]; value.item_num++;} rules.effect(effects,'activities'); rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,phase:entry.phase,item_num:value.item_num,pic_list:util.clone(entry)}; };
    var easteregg = rules.easteregg = {};
    easteregg.ensure = function (work) { var value=activities.ensure(work).easteregg; if(!util.isObject(value)||Array.isArray(value))value=activities.ensure(work).easteregg={}; if(!Array.isArray(value.egg_list))value.egg_list=[]; if(!util.isObject(value.claimed))value.claimed={}; return value; };
    easteregg.snapshot = function (work) { var value=easteregg.ensure(work), now=clock.now(); if(value.active&&util.toInt(value.active.end_time,0)<=now)value.active=null; return util.clone(value); };
    easteregg.trigger = function (work, params, effects) { params=util.isObject(params)?params:{}; var value=easteregg.ensure(work), id=util.toInt(params.id!==undefined?params.id:params.egg_id,-1); if(id<0)return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'egg-id'}; var now=clock.now(), duration=Math.max(1,util.toInt(params.duration,60)); value.active={id:id,start_time:now,end_time:now+duration}; if(value.egg_list.indexOf(id)<0)value.egg_list.push(id); rules.effect(effects,'activities'); return {ok:true,code:LF.ERR.OK,active:util.clone(value.active),egg_list:util.clone(value.egg_list)}; };
    easteregg.finish = function (work, effects, now) { var value=easteregg.ensure(work); if(!value.active||util.toInt(value.active.end_time,0)>now)return {ok:true,skipped:true}; var id=value.active.id; value.active=null; value.last_finished_id=id; rules.effect(effects,'activities'); return {ok:true,code:LF.ERR.OK,finished_id:id}; };
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
