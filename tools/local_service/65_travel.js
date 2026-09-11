    /* M2.1 local travel state machine */
    var travel = LF.rules.travel = {};
    travel.DURATION_SECONDS = 3600;
    travel.ensure = function (work) {
        if (!util.isObject(work.travel)) { work.travel = util.clone(LF.stateDefaults().travel); }
        if (!Array.isArray(work.travel.bag)) { work.travel.bag = []; }
        if (!util.isObject(work.events)) { work.events = {pending: [], settled: [], nextId: 1}; }
        if (!Array.isArray(work.events.pending)) { work.events.pending = []; }
        if (!Array.isArray(work.events.settled)) { work.events.settled = []; }
        if (!util.isObject(work.mail)) { work.mail = {mails: [], nextId: 1, pictures: [], specialtys: [], notes: []}; }
        if (!Array.isArray(work.mail.pictures)) { work.mail.pictures = []; }
        if (!Array.isArray(work.mail.specialtys)) { work.mail.specialtys = []; }
        if (!Array.isArray(work.mail.notes)) { work.mail.notes = []; }
        return work.travel;
    };
    travel.snapshot = function (work) {
        var v = travel.ensure(work);
        return {status:v.status, trip_id:v.tripId, destination_id:util.toInt(v.destinationId,0), companion_id:util.toInt(v.companionId,0), started_at:util.toInt(v.startedAt,0), eta_at:util.toInt(v.etaAt,0), returned_at:util.toInt(v.returnedAt,0), bag:util.clone(v.bag), result:util.clone(v.result), settled:!!v.settled, last_trip_id:v.lastTripId || '', next_event_at:util.toInt(v.nextEventAt,0)};
    };
    travel.event = function (work, type, value, stringValue, picture) {
        var id = util.toInt(work.events.nextId,1); work.events.nextId = id + 1;
        return {id:id, evt_id:id, evt_type:type, evt_value:util.clone(value || []), evt_string:util.clone(stringValue || []), evt_pic:picture || null, created_at:clock.now()};
    };
    travel.addEvent = function (work, event, effects) {
        work.events.pending.push(event); while (work.events.pending.length > 100) { work.events.pending.shift(); } rules.effect(effects,'events');
    };
    travel.prepare = function (work, params, effects) {
        var v=travel.ensure(work); params=params || {};
        if (v.status !== 'home' && !(v.status === 'result' && v.settled)) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'travel-not-at-home'};
        var bag=util.toArray(work.items.bag).filter(function(id){return util.toInt(id,-1)>=0;});
        if (params.requireBag && bag.length===0) return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'empty-bag'};
        var now=clock.now(); var tripId=String(params.tripId || (work.header.saveId+'-'+now+'-'+util.toInt(work.header.revision,0)));
        v.status='ready'; v.tripId=tripId; v.destinationId=util.toInt(params.destinationId,1); v.companionId=util.toInt(params.companionId,0); v.startedAt=0; v.etaAt=0; v.returnedAt=0; v.bag=bag; v.result=null; v.settled=false; v.nextEventAt=0;
        work.items.bag=[-1,-1,-1,-1]; work.items.bagCompleted=false; work.role.frogStatus=0; work.role.frogMotion=0;
        rules.effect(effects,'travel'); rules.effect(effects,'container'); rules.effect(effects,'role');
        return {ok:true,code:LF.ERR.OK,changed:{status:v.status,tripId:tripId,bag:bag}};
    };
    travel.start = function (work, params, effects) {
        var v=travel.ensure(work); params=params || {}; if (v.status !== 'ready') return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'travel-not-ready'};
        var now=clock.now(); var duration=util.toInt(params.duration,travel.DURATION_SECONDS); if (duration<60) duration=60;
        v.status='traveling'; v.startedAt=now; v.etaAt=now+duration; v.nextEventAt=v.etaAt; work.role.frogStatus=1; work.role.frogMotion=1;
        travel.addEvent(work,travel.event(work,1,[v.companionId>0?1:0],[v.tripId]),effects); rules.effect(effects,'travel'); rules.effect(effects,'role');
        return {ok:true,code:LF.ERR.OK,changed:{status:v.status,etaAt:v.etaAt}};
    };
    travel.prepareAndStart = function(work,params,effects){var a=travel.prepare(work,params,effects); if(!a.ok)return a; var b=travel.start(work,params,effects); if(!b.ok)return b; return {ok:true,code:LF.ERR.OK,changed:{prepared:a.changed,started:b.changed}};};
    travel.advance = function(work,effects,now){
        var v=travel.ensure(work); now=now || clock.now(); if(v.status!=='traveling' || !v.etaAt || now<v.etaAt)return {ok:true,skipped:true};
        var reward=10+Math.min(20,v.bag.length*2); var picture={id:v.tripId+'-picture',pic_id:v.destinationId,long_id:v.tripId,destination_id:v.destinationId,layers:[],created_at:now};
        v.status='result'; v.returnedAt=now; v.nextEventAt=0; v.result={clover:reward,ticket:0,items:[],picture:picture,source:'local'}; v.settled=false; work.role.frogStatus=0; work.role.frogMotion=0;
        travel.addEvent(work,travel.event(work,2,[reward,0,-1],[v.tripId],picture),effects); rules.effect(effects,'travel'); rules.effect(effects,'role');
        return {ok:true,changed:{status:v.status,reward:reward}};
    };
    travel.claim = function(work,params,effects){
        var v=travel.ensure(work); params=params || {}; if(v.status!=='result' || v.settled || !v.result)return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'travel-result-unavailable'}; if(params.tripId && String(params.tripId)!==String(v.tripId))return {ok:false,code:LF.ERR.ILLEGAL_PARAM,reason:'trip-id'};
        var result=v.result; var grant=rules.wallet.grant(work,{clover:util.toInt(result.clover,0),ticket:util.toInt(result.ticket,0)},effects); if(!grant.ok)return grant;
        if(result.picture) { work.mail.pictures.push(util.clone(result.picture)); }
        if (rules.tasks && rules.tasks.update) { rules.tasks.update(work, 'travel_return', 1, effects); }
        var pending=work.events.pending; for(var i=pending.length-1;i>=0;i--){if(pending[i] && pending[i].evt_pic && pending[i].evt_pic.long_id===v.tripId){work.events.settled.push(pending[i]);pending.splice(i,1);}}
        v.status='home'; v.lastTripId=v.tripId; v.settled=true; v.result=null; v.bag=[]; v.tripId=''; rules.effect(effects,'travel'); rules.effect(effects,'events');
        return {ok:true,code:LF.ERR.OK,changed:{status:v.status,clover:result.clover,picture:!!result.picture}};
    };
    travel.confirmEvent = function(work,id,effects){
        var target=util.toInt(id,-1), pending=util.toArray(work.events.pending); for(var i=0;i<pending.length;i++){var e=pending[i]; if(util.toInt(e && (e.id!==undefined?e.id:e.evt_id),-1)!==target)continue; if(e.evt_type===2 && work.travel.status==='result')return travel.claim(work,{tripId:work.travel.tripId},effects); pending.splice(i,1); work.events.settled.push(e); rules.effect(effects,'events'); return {ok:true,code:LF.ERR.OK,changed:{confirmed:target}};} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'event-not-found'};
    };
    travel.eventsSnapshot=function(work){travel.ensure(work);return util.clone(work.events.pending);};
    travel.noteSnapshot=function(work){travel.ensure(work);return {note_list:util.clone(work.mail.notes)};};
    travel.giftSnapshot=function(work){travel.ensure(work);return {pictures:util.clone(work.mail.pictures),specialtys:util.clone(work.mail.specialtys)};};
