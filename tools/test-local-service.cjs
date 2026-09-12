// Regression tests for the actual service modules, using only Node's stdlib.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const source = fs.readdirSync(path.join(__dirname, 'local_service')).sort()
  .filter(n => n.endsWith('.js') && n !== '99_footer.js')
  .map(n => fs.readFileSync(path.join(__dirname, 'local_service', n), 'utf8')).join('\n') + '\n})(this);';

function runtime(saved = new Map()) {
  const timers = [];
  const storage = {
    fail: null, silent: false,
    getItem(k) { return saved.has(k) ? saved.get(k) : null; },
    setItem(k, v) {
      if (this.fail === k) { if (this.silent) return false; throw Error('quota'); }
      saved.set(k, v); return true;
    },
    removeItem(k) { saved.delete(k); }
  };
  const c = vm.createContext({console: {log() {}}, localStorage: storage,
    setTimeout: fn => { timers.push(fn); return timers.length; }, setInterval: () => 1});
  vm.runInContext(source, c);
  c.window = c;
  vm.runInContext(fs.readFileSync(path.join(root, 'offline_build/web_game/dev/fixtures.js'), 'utf8'), c);
  const lf = c.LocalFrog;
  const types = {LunchBox: 0, Amulet: 1, Tools: 2, Specialty: 3, FURNITURE_ITEM: 11, FURNITURE_TOOL: 12, RESOURCE: 14, Courtyard: 15};
  c.Tabikaeru = {DataType: {ItemType: types, ItemResourceType: {CLOVER: 1, TICKET: 2}},
    Define: {FourLeafCloverID: 1000, RAFFEL_NEEDTICKETS: 5, PrizeBalls: [40,25,22,9,3,1]}};
  const tables = {ItemDB: 'Item_json', FurnitureShopDB: 'furnitureShopData_json',
    FurnitureDB: 'furnitureData_json', ShopDataDB: 'shopData_json', PrizeDB: 'Prize_json'};
  lf.config.get = (name, id) => {
    const rows = c.__fixtures[tables[name]];
    return Array.isArray(rows) ? rows.find(r => String(r.id) === String(id)) : null;
  };
  lf.config.ready = () => true;
  lf.state.set(lf.stateDefaults());
  lf.state.data.header.source = 'import';
  lf.state.data.furniture.shop.start_time = 1;
  lf.state.data.furniture.shop.leave_time = Math.floor(Date.now()/1000)+10000;
  lf.state.data.compost.show_index = 1;
  lf.state.data.compost.compost_list = [1];
  function commit(fn, meta = {}) { return lf.tx.commit(fn, {reason: 'test', ...meta}); }
  function reload() { const result = lf.store.load(); assert.equal(result.ok, true); }
  return {c, lf, storage, saved, timers, commit, reload};
}

for (const [kind, id, pos] of [['bag',1001,1], ['desk',1001,1], ['bench',2001,1], ['bench',3001,6]]) {
  test(`last copy survives ${kind} placement, restart, removal (${id})`, () => {
    const r = runtime(); const {lf} = r;
    lf.state.data.items.house[id] = 1;
    const ops = kind === 'bench' ? lf.rules.bench : {
      putIn: (w,p,id,e) => lf.rules.container.putIn(w,kind,p,id,e),
      takeOut: (w,p,e) => lf.rules.container.takeOut(w,kind,p,e)
    };
    assert.equal(r.commit(w => ops.putIn(w,pos,id,{})).ok, true);
    assert.equal(lf.state.data.items.house[id], undefined);
    r.reload();
    const slots = kind === 'bench' ? lf.state.data.furniture.bench : lf.state.data.items[kind];
    assert.equal(slots[pos-1], id);
    assert.equal(r.commit(w => ops.takeOut(w,pos,{})).ok, true);
    assert.equal(lf.state.data.items.house[id], 1);
    r.reload(); assert.equal(lf.state.data.items.house[id], 1);
  });
}

for (const stage of ['SAVE_TMP_KEY','SAVE_BACKUP_KEY','SAVE_KEY']) {
  for (const silent of [false,true]) {
    test(`failed ${stage} write (${silent ? 'Egret false' : 'throw'}) rolls back all state`, () => {
      const r = runtime(); const {lf} = r;
      assert.equal(lf.store.save('seed'), true);
      const before = lf.store.serialize(lf.state.data);
      const disk = r.saved.get(lf.SAVE_KEY);
      r.storage.fail = lf[stage]; r.storage.silent = silent;
      const result = r.commit(w => {
        w.wallet.clover += 10;
        lf.rng.next();
        return {ok: true};
      }, {opId: 'reward'});
      assert.equal(result.ok, false);
      assert.equal(result.persisted, false);
      assert.equal(lf.store.serialize(lf.state.data), before);
      assert.equal(r.saved.get(lf.SAVE_KEY), disk);
      r.storage.fail = null;
      assert.equal(r.commit(w => {w.wallet.clover += 10; return {ok:true};}, {opId:'reward'}).ok,true);
      assert.equal(lf.state.data.wallet.clover,10);
    });
  }
}

test('random stream commits with state and failed operations do not advance it', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.rng.seed = 42;
  let first;
  r.commit(w => { first = lf.rng.next(); return {ok:false}; });
  assert.equal(lf.state.data.rng.counter,0);
  r.commit(w => { assert.equal(lf.rng.next(),first); return {ok:true}; });
  assert.equal(lf.state.data.rng.counter,1);
  r.reload(); assert.equal(lf.state.data.rng.counter,1);
  r.commit(w => { assert.notEqual(lf.rng.next(),first); return {ok:true}; });
  assert.equal(lf.state.data.rng.counter,2);
});

test('future save version is rejected without overwriting the file', () => {
  const r = runtime(); const {lf} = r;
  const data = lf.store.snapshot(); data.header.formatVersion = 999;
  const text = JSON.stringify(data); r.saved.set(lf.SAVE_KEY,text);
  assert.equal(lf.store.load().ok,false);
  assert.equal(r.saved.get(lf.SAVE_KEY),text);
  assert.equal(lf.store.save('autosave'),false);
  assert.equal(r.saved.get(lf.SAVE_KEY),text);
});

test('failed import and reset preserve memory and primary save', () => {
  const r=runtime(); const {lf}=r;
  lf.store.save('seed');
  const before=JSON.stringify(lf.state.data);
  const candidate=lf.store.snapshot(); candidate.wallet.clover=123;
  r.storage.fail=lf.SAVE_KEY;
  assert.equal(lf.diagImportSave(JSON.stringify(candidate)).ok,false);
  assert.equal(JSON.stringify(lf.state.data),before);
  lf.config.ready=()=>false;
  assert.equal(lf.diagReset({confirm:true}).ok,false);
  assert.equal(JSON.stringify(lf.state.data),before);
  assert.equal(r.saved.get(lf.SAVE_KEY),before);
});

test('failed time advance rolls back clock and rewards together', () => {
  const r=runtime(); const {lf}=r;
  lf.store.save('seed'); const before=JSON.stringify(lf.state.data);
  r.storage.fail=lf.SAVE_KEY;
  assert.equal(lf.diagTimeTravel(3600).ok,false);
  assert.equal(lf.state.data.clock.timeTravelSeconds,0);
  assert.equal(lf.state.data.wallet.clover,0);
  assert.equal(lf.diagTimeTravel(-1).ok,false);
  assert.equal(r.saved.get(lf.SAVE_KEY),before);
});

test('malformed nested save sections are repaired with original values retained', () => {
  const {lf}=runtime(); const work=lf.store.snapshot();
  work.furniture.shop=12; work.compost.box_list='broken'; work.scheduler.history={invalid:true};
  const result=lf.state.validate(work);
  assert.equal(result.data.furniture.shop.start_time,0);
  assert.equal(result.data.compost.box_list.length,6);
  assert.equal(result.data.header.invalidFields['furniture.shop'],12);
  assert.equal(result.data.header.invalidFields['compost.box_list'],'broken');
});

test('bag type and away state, locked bench and unavailable compost reject edits', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.items.house={1001:1,2001:1,5001:1};
  assert.equal(r.commit(w=>lf.rules.container.putIn(w,'bag',1,2001,{})).ok,false);
  lf.state.data.role.frogStatus=1;
  assert.equal(r.commit(w=>lf.rules.container.putIn(w,'bag',1,1001,{})).ok,false);
  lf.state.data.furniture.bench[0]=2001;lf.state.data.furniture.bench_lock=true;
  assert.equal(r.commit(w=>lf.rules.bench.takeOut(w,1,{})).ok,false);
  assert.equal(r.commit(w=>lf.rules.compost.putIn(w,1,2001,{})).ok,false);
  lf.state.data.compost.show_index=0;
  assert.equal(r.commit(w=>lf.rules.compost.putIn(w,1,5001,{})).ok,false);
});

test('last compost input copy survives restart and returns to inventory', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.items.house[5001]=1;
  assert.equal(r.commit(w=>lf.rules.compost.putIn(w,1,5001,{})).ok,true);
  r.reload(); assert.equal(lf.state.data.compost.box_list[0],5001);
  assert.equal(lf.state.data.items.house[5001],undefined);
  assert.equal(r.commit(w=>lf.rules.compost.takeOut(w,1,{})).ok,true);
  assert.equal(lf.state.data.items.house[5001],1);
});

test('merchant only sells stocked items while present', () => {
  const r=runtime(); const {lf}=r;lf.state.data.wallet.clover=100;
  assert.equal(r.commit(w=>lf.rules.furniture.buyShop(w,11,{})).ok,false);
  lf.state.data.furniture.shop.shop_list=[{shop_id:11,item_id:9001,num:1}];
  assert.equal(r.commit(w=>lf.rules.furniture.buyShop(w,11,{})).ok,true);
  assert.equal(lf.state.data.wallet.clover,80);
  assert.equal(r.commit(w=>lf.rules.furniture.buyShop(w,11,{})).ok,false);
  lf.state.data.furniture.shop.shop_list[0].num=1;
  lf.state.data.furniture.shop.leave_time=1;
  assert.equal(r.commit(w=>lf.rules.furniture.buyShop(w,11,{})).ok,false);
  assert.equal(lf.rules.bench.isOpen(lf.state.data),true);
});

test('invalid facility change uses -1 failure code and never changes selection', () => {
  const r=runtime(); const {lf,c}=r;
  c.ProtocolList={protocolList:{furniture_replace_compost:[['index'],true]}};
  let reply; lf.server.respond=(q,d)=>reply=d;lf.server.emitEffects=()=>{};
  lf.server.dispatch({cmd:'furniture.replace_compost',session:1,data:{index:999}});
  assert.equal(reply.code,-1);assert.equal(lf.state.data.compost.show_index,1);
});

test('failed boot never signals successful login or permits autosave', () => {
  const {lf}=runtime(); let callbacks=0;
  const control={syncComplete:true,loginCallback(){callbacks++;},dispatchEvent(){callbacks++;}};
  lf.boot.fail(control,new Error('storage unavailable'));
  assert.equal(callbacks,0);assert.equal(control.syncComplete,false);
  assert.equal(lf.boot.ensureStarted(),false);assert.equal(lf.store.save('autosave'),false);
});

test('scheduler computes real next deadline and handles merchant departure once', () => {
  const r=runtime();const {lf}=r;const now=lf.clock.now();
  lf.state.data.clover.slots=[{clover_id:1,last_harvest:now,rebirth_span:600,element:0,sprite:1}];
  lf.state.data.weather.nextAt=now+1000;lf.state.data.furniture.shop.leave_time=now-1;
  r.commit(w=>({ok:true,changed:lf.scheduler.catchUp(w,{})}));
  assert.equal(lf.state.data.scheduler.nextDueAt,now+600);
  const second=r.commit(w=>({ok:true,changed:lf.scheduler.catchUp(w,{})}));
  assert.equal(second.changed.ran.includes('shop.leave'),false);
});

test('scheduler rolls the calendar over after an offline natural-day boundary', () => {
  const r = runtime(); const {lf} = r; const now = lf.clock.now();
  const calendar = lf.state.data.activities.calendar;
  calendar.day_key = '2000-01-01';
  calendar.new_flag = [1]; calendar.lucky_days = [{day: 1}];
  calendar.st_days = [{day: 1}]; calendar.task_list = [{id: 7, progress: 1}];
  lf.state.data.weather.nextAt = now + 100000;
  const result = r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w, {})}));
  assert.equal(result.ok, true);
  assert.equal(result.changed.ran.includes('calendar.rollover'), true);
  const after = lf.state.data.activities.calendar;
  assert.equal(after.day_key, lf.rules.calendar.dayKey(now));
  assert.equal(after.new_flag.length, 0);
  assert.equal(after.lucky_days.length, 0);
  assert.equal(after.st_days.length, 0);
  assert.equal(after.task_list.length, 0);
  assert.equal(lf.state.data.scheduler.nextDueAt > now, true);
  r.reload();
  assert.equal(lf.state.data.activities.calendar.day_key, lf.rules.calendar.dayKey(now));
});

test('read errors never create a replacement save', () => {
  const r=runtime(); const before=JSON.stringify(r.lf.state.data);
  r.storage.getItem=()=>{throw Error('read denied');};
  assert.equal(r.lf.store.load().ok,false);
  assert.equal(JSON.stringify(r.lf.state.data),before);
  assert.equal(r.lf.store.save('autosave'),false);
});

test('clock continues forward after system clock is turned back', () => {
  const {lf,c}=runtime();
  vm.runInContext('Date.now=function(){return 2000000;}',c);
  lf.state.data.clock=lf.clock.defaults();
  assert.equal(lf.clock.now(),2000);
  vm.runInContext('Date.now=function(){return 1000000;}',c);
  assert.equal(lf.clock.now(),2000);
  vm.runInContext('Date.now=function(){return 1001000;}',c);
  assert.equal(lf.clock.now(),2001);
});

test('unclaimed raffle result cannot be overwritten by a new draw', () => {
  const r=runtime();const {lf}=r;
  lf.state.data.wallet.ticket=20;
  lf.state.data.items.gacha.pending={rank:1,prizes:[2],settled:false};
  assert.equal(r.commit(w=>lf.rules.gacha.roll(w,{})).ok,false);
  assert.equal(lf.state.data.wallet.ticket,20);
  assert.equal(lf.state.data.items.gacha.pending.rank,1);
});

test('starter kit preloaded items are transferred, not duplicated', () => {
  const {lf}=runtime(); const previous=lf.state.data;
  lf.config.ids=(name)=>({ItemDB:[1001,1002,2001,2002,3001,3002,3003],FurnitureShopDB:[11],
    CompostData:[1],TumblerData:[21],pocketData:[31]}[name] || []);
  const fresh=lf.state.newSave();
  assert.equal(lf.state.data,previous);
  for(const id of [2001,2002,3001,3002,3003]) {
    assert.equal(lf.rules.items.ownedCount(fresh,id),fresh.header.starterKit.items[id]);
  }
});

test('backup recovery never replaces good backup with corrupt primary', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.wallet.clover=55; lf.store.save('seed'); lf.store.save('backup');
  const backup = r.saved.get(lf.SAVE_BACKUP_KEY);
  r.saved.set(lf.SAVE_KEY,'broken'); r.reload();
  assert.equal(lf.state.data.wallet.clover,55);
  assert.equal(lf.store.save('recover'),true);
  assert.equal(r.saved.get(lf.SAVE_BACKUP_KEY),backup);
});

test('same request returns original result once; restarted session can buy again', () => {
  const r=runtime(); const {lf,c}=r;
  const replies=[];
  c.ProtocolList={protocolList:{test_buy:[[],true]}};
  lf.server.respond=(req,data)=>replies.push(data);
  lf.server.emitEffects=()=>{};
  lf.server.handlers.test_buy={idempotent:true,apply(w){w.wallet.clover++;return {ok:true,response:{code:0,value:w.wallet.clover}};}};
  const req={cmd:'test.buy',session:1,data:{}};
  lf.server.dispatch(req); lf.server.dispatch(req);
  assert.equal(lf.state.data.wallet.clover,1);
  assert.deepEqual(JSON.parse(JSON.stringify(replies)),[{code:0,value:1},{code:0,value:1}]);
  const second=runtime(r.saved); second.reload();
  second.c.ProtocolList=c.ProtocolList;
  second.lf.server.respond=()=>{}; second.lf.server.emitEffects=()=>{};
  second.lf.server.handlers.test_buy=lf.server.handlers.test_buy;
  second.lf.server.dispatch(req);
  assert.equal(second.lf.state.data.wallet.clover,2);
});

test('protocol failure neither emits success effects nor returns success', () => {
  const r=runtime(); const {lf,c}=r;
  lf.store.save('seed'); r.storage.fail=lf.SAVE_KEY;
  c.ProtocolList={protocolList:{test_buy:[[],true]}};
  let response, pushes=0;
  lf.server.respond=(req,data)=>response=data;
  lf.server.emitEffects=()=>pushes++;
  lf.server.handlers.test_buy={apply(w,p,e){w.wallet.clover++;e.wallet=true;return {ok:true};}};
  lf.server.dispatch({cmd:'test.buy',session:1,data:{}});
  assert.notEqual(response.code,0); assert.equal(pushes,0); assert.equal(lf.state.data.wallet.clover,0);
});

test('error trap survives repeated wrapping and calls client handler once', () => {
  const {lf,c}=runtime(); let calls=0;
  c.onerror=()=>{calls++;return true;};
  lf.boot.installErrorTrap();
  lf.boot.wrapClientErrorHandler(); lf.boot.wrapClientErrorHandler();
  assert.equal(c.onerror('test','file',1,1,new Error('test')),true);
  assert.equal(calls,1);
  assert.equal(lf.boot.errorLog.length,1);
});

test('more than 200 queued commands all drain without another incoming command', () => {
  const r=runtime(); let count=0;
  r.lf.server.dispatch=()=>count++;
  for(let i=0;i<205;i++)r.lf.server.receive('{}');
  while(r.timers.length)r.timers.shift()();
  assert.equal(count,205);
});


test('travel loop persists, catches up offline, and settles once', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.items.bag = [1001, -1, -1, -1];
  lf.state.data.items.bagCompleted = true;
  let effects = {};
  let out = r.commit(w => lf.rules.travel.prepareAndStart(w, {destinationId: 7, duration: 60}, effects));
  assert.equal(out.ok, true);
  assert.equal(lf.state.data.travel.status, 'traveling');
  assert.equal(lf.state.data.items.bag[0], -1);
  r.commit(w => { w.clock.timeTravelSeconds += 120; return {ok: true, changed: lf.rules.travel.advance(w, effects)}; });
  assert.equal(lf.state.data.travel.status, 'result');
  assert.equal(lf.state.data.events.pending.length, 2);
  const eventId = lf.state.data.events.pending[1].id;
  const before = lf.state.data.wallet.clover;
  out = r.commit(w => lf.rules.travel.confirmEvent(w, eventId, effects));
  assert.equal(out.ok, true);
  assert.equal(lf.state.data.travel.status, 'home');
  assert.equal(lf.state.data.wallet.clover, before + 12);
  assert.equal(lf.state.data.mail.pictures.length, 1);
  assert.equal(r.commit(w => lf.rules.travel.claim(w, {}, {})).ok, false);
  r.reload();
  assert.equal(lf.state.data.travel.status, 'home');
  assert.equal(lf.state.data.wallet.clover, before + 12);
});

test('completed bag starts a trip through the protocol handler', () => {
  const r = runtime(); const {lf, c} = r;
  c.ProtocolList = {protocolList: {item_set_bag_completed: [['completed'], false]}};
  lf.server.respond = () => {}; lf.server.emitEffects = () => {};
  lf.state.data.items.bag = [1001, -1, -1, -1];
  lf.server.dispatch({cmd: 'item.set_bag_completed', data: {completed: true}});
  assert.equal(lf.state.data.travel.status, 'traveling');
  assert.equal(lf.state.data.items.bagCompleted, false);
});

test('album stores, pages, deletes, recovers, and saves new pictures', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  lf.state.data.album.newPictures = [{id:'new-1', layers:[]}];
  assert.equal(r.commit(w => lf.rules.album.saveNew(w, 'new-1', effects)).ok, true);
  assert.equal(lf.rules.album.load(lf.state.data, 1, 1).total, 1);
  assert.equal(r.commit(w => lf.rules.album.remove(w, 'new-1', effects)).ok, true);
  assert.equal(lf.state.data.album.pictures.length, 0);
  assert.equal(r.commit(w => lf.rules.album.recover(w, 'new-1', effects)).ok, true);
  assert.equal(lf.state.data.album.pictures.length, 1);
  r.reload(); assert.equal(lf.state.data.album.pictures[0].id, 'new-1');
});

test('album starts at 30 pages and expansion consumes clovers', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  assert.equal(lf.rules.album.snapshot(lf.state.data).capacity, 30);
  for (let i = 0; i < 180; i++) {
    lf.state.data.album.newPictures.push({id: `p-${i}`, layers: []});
    assert.equal(r.commit(w => lf.rules.album.saveNew(w, `p-${i}`, effects)).ok, true);
  }
  lf.state.data.album.newPictures.push({id: 'p-180', layers: []});
  assert.equal(r.commit(w => lf.rules.album.saveNew(w, 'p-180', effects)).code, 75);
  lf.state.data.wallet.clover = 1000;
  assert.equal(r.commit(w => lf.rules.album.expand(w, {pages: 1}, effects)).ok, true);
  assert.equal(lf.state.data.album.capacity, 31);
  assert.equal(lf.state.data.wallet.clover, 0);
  assert.equal(lf.state.data.album.deleted.length, 1);
  r.reload();
  assert.equal(lf.state.data.album.capacity, 31);
});

test('album expansion is triggered by the real shop item 9000', () => {
  const r=runtime(); const {lf}=r; lf.state.data.wallet.clover=1000;
  lf.config.get=(name,id)=> name==='ShopDataDB' && id===22 ? {id:22,itemId:9000,price:1000,limit:1} : (name==='ItemDB' && id===9000 ? {id:9000,type:11,own_num:99} : null);
  const out=r.commit(w=>lf.rules.shop.buy(w,22,{}));
  assert.equal(out.ok,true); assert.equal(lf.state.data.album.capacity,31); assert.equal(lf.state.data.wallet.clover,0);
});

test('flowerpot harvest returns mature reward and clears plant slot', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  lf.state.data.flowerpot.plant_list = [{state: 'done', reward_id: 1001, reward_count: 2}];
  assert.equal(r.commit(w => lf.rules.flowerpot.harvest(w, 1, effects)).ok, true);
  assert.equal(lf.rules.items.ownedCount(lf.state.data, 1001), 2);
  assert.equal(lf.state.data.flowerpot.plant_list[0], null);
});

test('flowerpot planting consumes seed, matures offline, and harvests once', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  lf.state.data.flowerpot.show_list = [{type: 1, id: 41}];
  lf.state.data.items.house[1001] = 1;
  const started = r.commit(w => lf.rules.flowerpot.plant(w, {
    type: 1, index: 1, seed_id: 1001, reward_id: 1002, reward_count: 2, duration: 60
  }, effects));
  assert.equal(started.ok, true);
  assert.equal(lf.state.data.items.house[1001], undefined);
  assert.equal(lf.state.data.flowerpot.plant_list[0].state, 'growing');
  lf.state.data.clock.timeTravelSeconds += 61;
  const caught = r.commit(w => ({ok: true, changed: lf.scheduler.catchUp(w, effects)}));
  assert.equal(caught.ok, true);
  assert.equal(lf.state.data.flowerpot.plant_list[0].state, 'done');
  assert.equal(r.commit(w => lf.rules.flowerpot.harvest(w, {type: 1, index: 1}, effects)).ok, true);
  assert.equal(lf.state.data.items.house[1002], 2);
  assert.equal(lf.state.data.flowerpot.plant_list.length, 1);
  assert.equal(lf.state.data.flowerpot.plant_list[0], null);
  assert.equal(r.commit(w => lf.rules.flowerpot.harvest(w, {type: 1, index: 1}, effects)).ok, false);
  r.reload(); assert.equal(lf.state.data.flowerpot.plant_list.length, 1);
});

test('compost processes filled slots and pays reward after deadline', () => {
  const r=runtime(); const {lf}=r; const effects={};
  lf.state.data.compost.show_index=1; lf.state.data.compost.compost_list=[1]; lf.state.data.compost.box_list[0]=5001;
  assert.equal(r.commit(w=>lf.rules.compost.start(w,effects)).ok,true);
  lf.state.data.clock.timeTravelSeconds += 3601;
  assert.equal(r.commit(w=>({ok:true,changed:lf.scheduler.catchUp(w,effects)})).ok,true);
  assert.equal(r.commit(w=>lf.rules.compost.collect(w,effects)).ok,true);
  assert.equal(lf.state.data.wallet.clover,10); assert.equal(lf.state.data.compost.box_list[0],-1);
});

test('workbench craft consumes materials, completes offline, and can be collected once', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  lf.state.data.items.house[3001] = 2;
  const started = r.commit(w => lf.rules.craft.start(w, {recipe_id: 7, output_id: 9001, output_count: 1, duration: 60, inputs: [{item_id: 3001, count: 2}]}, effects));
  assert.equal(started.ok, true); assert.equal(lf.state.data.items.house[3001], undefined);
  lf.state.data.clock.timeTravelSeconds += 61;
  assert.equal(r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w, effects)})).ok, true);
  assert.equal(lf.state.data.furniture.craft.state, 'ready');
  assert.equal(r.commit(w => lf.rules.craft.collect(w, effects)).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  assert.equal(r.commit(w => lf.rules.craft.collect(w, effects)).ok, false);
  r.reload(); assert.equal(lf.state.data.furniture.craft.state, 'idle');
});

test('tasks progress and reward persist locally', () => {
  const r=runtime(); const {lf}=r; const effects={};
  lf.state.data.tasks.list=[{id:7,progress:0,target:2,reward_clover:5,claimed:false}];
  assert.equal(r.commit(w=>lf.rules.tasks.update(w,7,2,effects)).ok,true);
  assert.equal(r.commit(w=>lf.rules.tasks.claim(w,7,effects)).ok,true);
  assert.equal(lf.state.data.wallet.clover,5); r.reload(); assert.equal(lf.state.data.tasks.list[0].claimed,true);
});

test('calendar task protocol reads and updates local task state', () => {
  const r=runtime(); const {lf,c}=r; c.ProtocolList={protocolList:{calendar_task_update:[['id','num'],true]}};
  lf.state.data.tasks.list=[{id:3,progress:0,target:1,claimed:false}]; lf.server.respond=()=>{}; lf.server.emitEffects=()=>{};
  lf.server.dispatch({cmd:'calendar_task_update',session:99,data:{id:3,num:1}});
  assert.equal(lf.state.data.tasks.list[0].progress,1);
});

test('calendar beginner reward is persisted and cannot be claimed twice', () => {
  const r=runtime(); const {lf}=r, effects={};
  assert.equal(r.commit(w=>lf.server.handlers.calendar_get_beginer_reward.apply(w,{day:1},effects)).ok,true);
  assert.equal(lf.state.data.wallet.clover,10);
  const again=r.commit(w=>lf.server.handlers.calendar_get_beginer_reward.apply(w,{day:1},effects));
  assert.equal(again.ok,false); assert.equal(again.reason,'already-claimed');
  r.reload(); assert.equal(lf.state.data.activities.calendar.new_flag[0],1);
});

test('calendar special-day reward consumes local item and records claim', () => {
  const r=runtime(); const {lf}=r, effects={};
  lf.state.data.activities.calendar.st_days=[{day:1,item_id:1001,count:2}];
  assert.equal(r.commit(w=>lf.server.handlers.calendar_get_st_reward.apply(w,{day:1},effects)).ok,true);
  assert.equal(lf.state.data.items.house[1001],2);
  assert.equal(lf.state.data.activities.calendar.st_days[0].claimed,true);
  assert.equal(r.commit(w=>lf.server.handlers.calendar_get_st_reward.apply(w,{day:1},effects)).ok,false);
});

test('claiming a task can unlock and persist an achievement', () => {
  const r=runtime(); const {lf}=r, effects={};
  lf.state.data.tasks.list=[{id:8,progress:1,target:1,claimed:false,achieve_id:42}];
  assert.equal(r.commit(w=>lf.rules.tasks.claim(w,8,effects)).ok,true);
  assert.deepEqual(Array.from(lf.state.data.role.achieveList),[42]); r.reload(); assert.deepEqual(Array.from(lf.state.data.role.achieveList),[42]);
});

test('annual, share, and encyclopedia reads derive from local state', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.items.house={1001:2}; lf.state.data.album.pictures=[{id:'p1',pic_id:77,layers:[]}];
  assert.equal(lf.server.handlers.annual_load.read(lf.state.data).picture_count,1);
  assert.equal(lf.server.handlers.share_load.read(lf.state.data).pic_list.length,1);
  assert.deepEqual(Array.from(lf.server.handlers.encyclopedia_load.read(lf.state.data).unlock_list),[1001]);
});

test('item gift opens once and persists cleared state', () => {
  const r=runtime(); const {lf}=r, effects={};
  lf.state.data.items.selectGift=[{item_id:1001,count:2}];
  assert.equal(r.commit(w=>lf.server.handlers.item_gift_open.apply(w,{},effects)).ok,true);
  assert.equal(lf.rules.items.ownedCount(lf.state.data,1001),2); assert.equal(lf.state.data.items.selectGift.length,0);
  assert.equal(r.commit(w=>lf.server.handlers.item_gift_open.apply(w,{},effects)).ok,false); r.reload(); assert.equal(lf.state.data.items.selectGift.length,0);
});

test('mail remains available during offline scheduler catch-up', () => {
  const r=runtime(); const {lf}=r, effects={};
  lf.state.data.mail.mails=[{id:1,expire_at:lf.clock.now()-1,opened:false},{id:2,expire_at:lf.clock.now()+999,opened:false}];
  r.commit(w=>({ok:true,changed:lf.scheduler.catchUp(w,effects)}));
  assert.equal(lf.state.data.mail.mails.length,2);
});

test('scheduler expires unopened mail using the expires_at field', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.mail.mails = [{id: 3, expires_at: lf.clock.now() - 1, opened: false, items: [{item_id: 1001, count: 1}]}];
  const result = r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w, {})}));
  assert.equal(result.changed.ran.includes('mail.expire'), true);
  assert.equal(lf.state.data.mail.mails[0].expired, true);
  assert.equal(lf.state.data.mail.mails[0].items.length, 0);
});

test('guest state survives validation and guest_load returns local visitor', () => {
  const r=runtime(); const {lf}=r; lf.state.data.guests.current={id:9,name:'local-guest'};
  const validated=lf.state.validate(lf.state.data).data; assert.equal(validated.guests.current.id,9);
  assert.equal(lf.server.handlers.guest_load.read(validated).guest_list[0].name,'local-guest');
});

test('guest confirm, serve, and finish are local atomic operations', () => {
  const r=runtime(); const {lf}=r, effects={}; lf.state.data.items.house[1001]=1;
  assert.equal(r.commit(w=>lf.server.handlers.guest_confirm.apply(w,{id:5},effects)).ok,true);
  assert.equal(r.commit(w=>lf.server.handlers.guest_serve.apply(w,{item_id:1001},effects)).ok,true);
  assert.equal(lf.rules.items.ownedCount(lf.state.data,1001),0);
  assert.equal(r.commit(w=>lf.server.handlers.guest_finish.apply(w,{},effects)).ok,true);
  assert.equal(lf.state.data.guests.current,null); assert.equal(lf.state.data.guests.history.length,1);
});

test('guest invitation drawing bag is local and expires offline', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.items.house[1001] = 1;
  assert.equal(r.commit(w => lf.server.handlers.guest_confirm.apply(w, {id: 8, expires_at: lf.clock.now()+30}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.guest_putin_bag.apply(w, {pos:1, id:1001}, {})).ok, true);
  assert.equal(lf.state.data.guests.drawing.bag[0], 1001);
  assert.equal(r.commit(w => lf.server.handlers.guest_lock_bag.apply(w, {}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.guest_putin_bag.apply(w, {pos:2, id:1001}, {})).ok, false);
  lf.state.data.clock.timeTravelSeconds += 31;
  r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w,{})}));
  assert.equal(lf.state.data.guests.current, null);
});

test('visitor and story protocols persist local lifecycle state', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.visit_open.apply(w, {id: 3, expire_at: lf.clock.now()+20}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.visit_set_carpet.apply(w, {id: 7}, {})).ok, true);
  assert.equal(lf.state.data.activities.visit.visitor.carpet_id, 7);
  lf.state.data.clock.timeTravelSeconds += 21;
  r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w,{})}));
  assert.equal(lf.state.data.activities.visit.visitor.status, 'expired');
  assert.equal(r.commit(w => lf.server.handlers.story_read_new_story.apply(w, {story_id: 5}, {})).ok, true);
  assert.equal(lf.state.data.activities.story.read_ids[0], 5);
  r.reload(); assert.equal(lf.state.data.activities.story.read_ids[0], 5);
});

test('activity containers persist local updates and loads', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  assert.equal(r.commit(w => lf.activities.merge(w, 'partycake', {cur_state: 2, layers: [{id: 1}]}, effects)).ok, true);
  const loaded = lf.activities.read(lf.state.data, 'partycake');
  assert.equal(loaded.cur_state, 2); assert.equal(loaded.layers[0].id, 1);
  r.reload(); assert.equal(lf.state.data.activities.partycake.cur_state, 2);
});

test('activity protocol handlers use persisted local containers', () => {
  const r = runtime(); const {lf} = r;
  const before = lf.server.handlers.story_load.read(lf.state.data);
  assert.deepEqual(Array.from(before.stories), []);
  const changed = r.commit(w => lf.server.handlers.story_read_new_story.apply(w, {story_id: 12, read: true}, {}));
  assert.equal(changed.ok, true);
  assert.equal(lf.server.handlers.story_load.read(lf.state.data).story_id, 12);
  r.reload(); assert.equal(lf.state.data.activities.story.story_id, 12);
});

test('pray composition consumes materials and confirms one local result', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  lf.state.data.items.house[3001] = 1;
  assert.equal(r.commit(w => lf.server.handlers.pray_compose.apply(w, {output_id: 9001, inputs: [{item_id: 3001, count: 1}], duration: 30}, effects)).ok, true);
  lf.state.data.clock.timeTravelSeconds += 31;
  assert.equal(r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w, effects)})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.pray_confirm_make_box.apply(w, {}, effects)).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  assert.equal(r.commit(w => lf.server.handlers.pray_confirm_make_box.apply(w, {}, effects)).ok, false);
});

test('cooking cycle consumes ingredients, completes offline, and rewards once', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.items.house[3001] = 1;
  assert.equal(r.commit(w => lf.server.handlers.cooking_start_cooking.apply(w, {output_id: 9001, inputs: [{item_id: 3001, count: 1}], duration: 20}, {})).ok, true);
  lf.state.data.clock.timeTravelSeconds += 21;
  r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w,{})}));
  assert.equal(r.commit(w => lf.server.handlers.cooking_complete_task.apply(w, {}, {})).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  assert.equal(r.commit(w => lf.server.handlers.cooking_complete_task.apply(w, {}, {})).ok, false);
});

test('capsule coin and twist are local and persist rewards', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.capsule_get_coin.apply(w, {count: 2}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.capsule_twist.apply(w, {output_id: 9001}, {})).ok, true);
  assert.equal(lf.state.data.activities.capsule.coin, 1);
  assert.equal(lf.state.data.items.house[9001], 1);
  r.reload(); assert.equal(lf.state.data.activities.capsule.reward_list.length, 1);
});

test('capsule protocol shape matches client callbacks without output parameters', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.activities.capsule.pre_coin = 1;
  assert.equal(r.commit(w => lf.server.handlers.capsule_get_coin.apply(w, {}, {})).ok, true);
  const result = r.commit(w => lf.server.handlers.capsule_twist.apply(w, {}, {}));
  assert.equal(result.ok, true); assert.equal(result.response, undefined);
  assert.equal(result.reward_id, 1001); assert.equal(lf.state.data.activities.capsule.reward_list[0], 1001);
});

test('wishing pool spends coin, grants configured item, and deduplicates request', () => {
  const r = runtime(); const {lf} = r;
  const pool = lf.state.data.activities.wishingpool;
  pool.end_time = lf.clock.now() + 3600; pool.coin = 2; pool.items = [{item_id: 9001, count: 1}];
  const first = r.commit(w => lf.server.handlers.wishingpool_wish.apply(w, {request_id: 'wish-1'}, {}));
  assert.equal(first.ok, true); assert.equal(first.item_list[0].item_id, 9001);
  assert.equal(lf.state.data.activities.wishingpool.coin, 1);
  const duplicate = r.commit(w => lf.server.handlers.wishingpool_wish.apply(w, {request_id: 'wish-1'}, {}));
  assert.equal(duplicate.ok, true); assert.equal(duplicate.coin, 1);
  assert.equal(lf.state.data.items.house[9001], 1);
  r.reload(); assert.equal(lf.state.data.activities.wishingpool.reward_list.length, 1);
});

test('wishing pool rejects expired event without spending coin', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.activities.wishingpool.end_time = lf.clock.now() - 1;
  lf.state.data.activities.wishingpool.coin = 1;
  const result = r.commit(w => lf.server.handlers.wishingpool_wish.apply(w, {output_id: 9001}, {}));
  assert.equal(result.ok, false); assert.equal(result.reason, 'wishingpool-closed');
  assert.equal(lf.state.data.activities.wishingpool.coin, 1);
});

test('touch events persist counts and grant an explicit reward once', () => {
  const r = runtime(); const {lf} = r;
  const first = r.commit(w => lf.server.handlers.other_req_touch.apply(w, {id: 12, reward_id: 9001}, {}));
  assert.equal(first.ok, true); assert.equal(first.count, 1); assert.equal(lf.state.data.items.house[9001], 1);
  const second = r.commit(w => lf.server.handlers.other_req_touch.apply(w, {id: 12, reward_id: 9001}, {}));
  assert.equal(second.count, 2); assert.equal(lf.state.data.items.house[9001], 1);
  r.reload(); assert.equal(lf.state.data.activities.touch.counts['12'], 2);
});

test('moment unlock is idempotent and survives restart', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.misc_moment_unlock.apply(w, {id: 5}, {})).already, false);
  assert.equal(r.commit(w => lf.server.handlers.misc_moment_unlock.apply(w, {id: 5}, {})).already, true);
  r.reload(); assert.equal(lf.state.data.activities.misc_moment.list.length, 1);
});

test('dynamic picture guide and item count persist through protocol load', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.animpicture_guide.apply(w, {}, {})).guide, 1);
  assert.equal(r.commit(w => lf.server.handlers.animpicture_get_item.apply(w, {count: 2}, {})).item_num, 2);
  const loaded = lf.server.handlers.animpicture_load.read(lf.state.data);
  assert.equal(loaded.guide, 1); assert.equal(loaded.item_num, 2); assert.ok(Array.isArray(loaded.pic_list));
  r.reload(); assert.equal(lf.state.data.activities.animpicture.guide, 1);
});

test('dynamic picture moves photos across making and album slots with 1-based indexes', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.mail.pictures = [{id: 'p1', pic_id: 1}, {id: 'p2', pic_id: 2}];
  const selected = r.commit(w => lf.server.handlers.animpicture_select_pic.apply(w, {pic_id: 'p1', phase: 1}, {}));
  assert.equal(selected.ok, true); assert.equal(lf.state.data.mail.pictures.length, 1);
  assert.equal(r.commit(w => lf.server.handlers.animpicture_open_album.apply(w, {index: 1}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.animpicture_album_add_pic.apply(w, {anim_index: 1, pic_index: 1, pic_id: 'p2'}, {})).ok, true);
  assert.equal(lf.state.data.mail.pictures.length, 0);
  assert.equal(r.commit(w => lf.server.handlers.animpicture_album_remove_pic.apply(w, {anim_index: 1, pic_index: 1}, {})).ok, true);
  assert.equal(lf.state.data.mail.pictures.length, 1);
  assert.equal(r.commit(w => lf.server.handlers.animpicture_get_item.apply(w, {}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.animpicture_use_item.apply(w, {index: 1, phase: 0}, {})).ok, true);
  assert.equal(lf.state.data.mail.pictures.length, 2);
  r.reload(); assert.equal(lf.state.data.activities.animpicture.pic_list.length, 1);
});

test('easter egg activation expires through offline scheduler and keeps history', () => {
  const r = runtime(); const {lf} = r;
  const started = r.commit(w => lf.server.handlers.easteregg_trigger.apply(w, {egg_id: 9, duration: 20}, {}));
  assert.equal(started.ok, true); assert.equal(started.active.id, 9);
  lf.state.data.clock.timeTravelSeconds += 21;
  r.commit(w => ({ok:true, changed:lf.scheduler.catchUp(w, {})}));
  const loaded = lf.server.handlers.easteregg_load.read(lf.state.data);
  assert.equal(loaded.active, null); assert.equal(loaded.egg_list.length, 1); assert.equal(loaded.egg_list[0], 9);
});

test('encyclopedia unlocks are persisted and travel entries derive from album', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.encyclopedia_unlock.apply(w, {id: 42}, {})).ok, true);
  lf.state.data.album.pictures.push({id: 'photo-a', pic_id: 77});
  const encyclopedia = lf.server.handlers.encyclopedia_load.read(lf.state.data);
  const travel = lf.server.handlers.encytravel_load.read(lf.state.data);
  assert.equal(encyclopedia.unlock_list.indexOf(42) >= 0, true);
  assert.equal(travel.unlock_list.indexOf(77) >= 0, true);
  r.reload(); assert.equal(lf.state.data.activities.encyclopedia.unlock_list.indexOf(42) >= 0, true);
});

test('museum exploration persists route, compass, refresh, and rewards locally', () => {
  const r = runtime(); const {lf} = r;
  const v = lf.state.data.activities.museumday; v.end_time = lf.clock.now() + 3600; v.left_num = 2; lf.state.data.wallet.clover = 500;
  assert.equal(r.commit(w => lf.server.handlers.museumday_start_advance.apply(w, {id: 3, cost: 10, compass: 2}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.museumday_dir_compass.apply(w, {dir: 2}, {})).ok, true);
  assert.equal(lf.state.data.activities.museumday.path.length, 1);
  assert.equal(r.commit(w => lf.server.handlers.museumday_refresh.apply(w, {}, {})).ok, true);
  lf.state.data.activities.museumday.items = [{item_id: 9001, num: 1}];
  assert.equal(r.commit(w => lf.server.handlers.museumday_get_items.apply(w, {}, {})).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  r.reload(); assert.equal(lf.state.data.activities.museumday.items.length, 0);
});

test('party cake restores materials and advances each stage exactly once', () => {
  const r = runtime(); const {lf} = r;
  const v = lf.state.data.activities.partycake; v.pre_cream = 2; v.pre_sugar = 2;
  assert.equal(r.commit(w => lf.server.handlers.partycake_get_mate.apply(w, {}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.partycake_make.apply(w, {layer:1, cream:1, sugar:1}, {})).state, 1);
  assert.equal(r.commit(w => lf.server.handlers.partycake_reward_make.apply(w, {}, {})).state, 2);
  assert.equal(r.commit(w => lf.server.handlers.partycake_answer.apply(w, {index:0}, {})).state, 3);
  assert.equal(r.commit(w => lf.server.handlers.partycake_reward_qa.apply(w, {}, {})).state, 4);
  assert.equal(r.commit(w => lf.server.handlers.partycake_light.apply(w, {}, {})).state, 5);
  assert.equal(r.commit(w => lf.server.handlers.partycake_reward_light.apply(w, {}, {})).state, 6);
  assert.equal(r.commit(w => lf.server.handlers.partycake_reward_light.apply(w, {}, {})).ok, false);
  r.reload(); assert.equal(lf.state.data.activities.partycake.cur_state, 6);
});

test('greeting card buy, compose, send, reward, and gift reply persist locally', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.greetcard_buy.apply(w, {id: 201}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.greetcard_change_bg.apply(w, {id: 201}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.greetcard_buy.apply(w, {id: 202}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.greetcard_put_tags.apply(w, {pos: 1, id: 202}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.greetcard_send.apply(w, {}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.greetcard_get_reward.apply(w, {item_id: 9001}, {})).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  lf.state.data.activities.greetcard.get_list = [{gift: 0}]; lf.state.data.items.house[9001] = 2;
  assert.equal(r.commit(w => lf.server.handlers.greetcard_send_gift.apply(w, {index: 1, gift: 9001}, {})).ok, true);
  r.reload(); assert.equal(lf.state.data.activities.greetcard.get_list[0].gift, 9001);
});

test('lottery selection survives restart until reward confirmation', () => {
  const r = runtime(); const {lf} = r;
  const opened = r.commit(w => lf.server.handlers.lottery_open.apply(w, {phase: 1, reward: [{item_id: 9001, count: 1}]}, {}));
  assert.equal(opened.state, 1);
  assert.equal(r.commit(w => lf.server.handlers.lottery_select.apply(w, {index: 2}, {})).state, 2);
  r.reload(); assert.equal(lf.state.data.activities.lottery.state, 2);
  assert.equal(r.commit(w => lf.server.handlers.lottery_confirm_reward.apply(w, {}, {})).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  assert.equal(r.commit(w => lf.server.handlers.lottery_confirm_reward.apply(w, {}, {})).ok, false);
});

test('spring card keeps its own inventory and sends rewards locally', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.springcard_buy.apply(w, {id: 301}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.springcard_change_bg.apply(w, {id: 301}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.springcard_send.apply(w, {}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.springcard_get_reward.apply(w, {item_id: 9001}, {})).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  r.reload(); assert.equal(lf.state.data.activities.springcard.send_list.length, 1);
});

test('activity protocol handlers keep their own activity namespace', () => {
  const r = runtime(); const {lf} = r;
  assert.equal(r.commit(w => lf.server.handlers.story_read_new_story.apply(w, {story_id: 7}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.visit_open.apply(w, {visitor_id: 3}, {})).ok, true);
  assert.equal(lf.state.data.activities.story.story_id, 7);
  assert.equal(lf.state.data.activities.visit.visitor_id, 3);
  assert.equal(lf.state.data.activities.pray.story_id, undefined);
});

test('recharge entitlements persist and local water exchange is atomic', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.wallet.clover = 10;
  assert.equal(r.commit(w => lf.server.handlers.recharge_update_num.apply(w, {water:2, change:3, field:[1], sack:[2]}, {})).ok, true);
  assert.equal(r.commit(w => lf.server.handlers.recharge_change.apply(w, {amount:4, cost:5}, {})).ok, true);
  assert.equal(lf.state.data.activities.recharge.change, 7);
  assert.equal(lf.state.data.wallet.clover, 5);
  assert.equal(r.commit(w => lf.server.handlers.recharge_water.apply(w, {amount:2, change:3}, {})).ok, true);
  assert.equal(lf.state.data.activities.recharge.water, 4);
  assert.equal(lf.state.data.activities.recharge.change, 4);
  assert.equal(r.commit(w => lf.server.handlers.recharge_water.apply(w, {amount:1, change:99}, {})).ok, false);
  assert.equal(lf.state.data.activities.recharge.change, 4);
  r.reload();
  assert.equal(lf.server.handlers.recharge_load.read(lf.state.data).water, 4);
});

test('tutorial, task aliases, and hall reconnect are handled locally', () => {
  const r=runtime(); const {lf}=r;
  assert.equal(lf.server.handlers.hall_hello.read(lf.state.data).code, 0);
  assert.equal(lf.server.handlers.hall_reconnect.read(lf.state.data, {account:'local'}).code, 0);
  assert.equal(r.commit(w=>lf.server.handlers.tutorial_step_open_door.apply(w,{},{})).ok,true);
  assert.equal(lf.state.data.settings.client.tutorial_completed.indexOf('open_door')>=0,true);
  lf.state.data.tasks.list=[{id:12,progress:0,target:1,claimed:false,reward_clover:3}];
  assert.equal(r.commit(w=>lf.server.handlers.task_client_pro.apply(w,{param:{id:12}},{})).ok,true);
  assert.equal(r.commit(w=>lf.server.handlers.task_get_reward.apply(w,{id:12},{})).ok,true);
  assert.equal(lf.state.data.wallet.clover,3);
});

test('bag items can move to gift box and selected gifts are granted once', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.items.house[1001]=2;
  assert.equal(r.commit(w=>lf.server.handlers.travel_bag_to_gift.apply(w,{item_id:1001,count:2},{})).ok,true);
  assert.equal(lf.state.data.items.house[1001],undefined);
  assert.equal(lf.state.data.mail.specialtys[0].count,2);
  assert.equal(r.commit(w=>lf.server.handlers.travel_gift_to_bag.apply(w,{item_id:1001},{})).ok,true);
  assert.equal(lf.state.data.mail.specialtys[0].count,1);
  lf.state.data.items.selectGift=[{num:1,items:[{item_id:1001,count:1},{item_id:1002,count:1}]}];
  assert.equal(r.commit(w=>lf.server.handlers.item_select_gift.apply(w,{index_list:[1]},{})).ok,true);
  assert.equal(lf.state.data.items.house[1002],1);
  assert.equal(lf.state.data.items.selectGift.length,0);
});

test('activity load handlers return client-shaped local state', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.activities.visit.visitor={id:7,status:'open',expires_at:lf.clock.now()+100};
  lf.state.data.activities.visit.acquire=[{item_id:1001}];
  assert.equal(lf.server.handlers.visit_load.read(lf.state.data).visitor.id,7);
  lf.state.data.activities.story.stories=[{id:3}];
  assert.equal(lf.server.handlers.story_load.read(lf.state.data).stories.length,1);
  lf.state.data.activities.cooking.month=9; lf.state.data.activities.cooking.task_list=[{id:1}];
  assert.equal(lf.server.handlers.cooking_load_cooking.read(lf.state.data).month,9);
  lf.state.data.activities.museumday.museum_list=[4];
  assert.equal(lf.server.handlers.museum_load.read(lf.state.data).museum_list[0],4);
});

test('expired unopened mail is removed during scheduler catch-up', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.mail.mails=[{id:1,expires_at:lf.clock.now()-1,opened:false,items:[{item_id:1001,count:1}]}];
  assert.equal(r.commit(w=>lf.rules.mail.expire(w,{})).removed,1);
  assert.equal(lf.state.data.mail.mails[0].expired,true);
});

test('weather rolls season and daypart from the local clock', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.clock.timeTravelSeconds = 0;
  lf.state.data.weather.nextAt = lf.clock.now();
  assert.equal(r.commit(w=>lf.rules.weather.roll(w,{})).ok,true);
  assert.equal([1,2,3,4].indexOf(lf.state.data.weather.season)>=0,true);
  assert.equal([1,2,3,4].indexOf(lf.state.data.weather.hours_type)>=0,true);
  assert.equal(lf.state.data.weather.nextAt > lf.clock.now(), true);
});

test('calendar rolls over during offline scheduler catch-up', () => {
  const r=runtime(); const {lf}=r;
  const old=lf.clock.now();
  lf.state.data.activities.calendar.day_key='2000-01-01';
  lf.state.data.activities.calendar.new_flag=[1];
  lf.state.data.clock.timeTravelSeconds += 86400;
  const now=lf.clock.now();
  assert.equal(r.commit(w=>({ok:true,changed:lf.scheduler.catchUp(w,{},now)})).ok,true);
  assert.equal(lf.state.data.activities.calendar.day_key, lf.rules.calendar.dayKey(now));
  assert.equal(lf.state.data.activities.calendar.new_flag.length,0);
  assert.equal(old < now,true);
});

test('travel applies configured specialties and lucky clover fills the first missing special photo', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.mail.pictures = [{id:'old', pic_id:'sp-a'}];
  const effects = {};
  assert.equal(r.commit(w => lf.rules.travel.prepareAndStart(w, {
    destinationId: 9, duration: 60, lucky_clover: true,
    special_picture_ids: ['sp-a', 'sp-b'],
    specialtys: [{item_id: 9101, category: 'rare', count: 2}],
    destination_items: [{item_id: 9001, count: 1}]
  }, effects)).ok, true);
  lf.state.data.clock.timeTravelSeconds += 61;
  assert.equal(r.commit(w => ({ok:true, changed:lf.rules.travel.advance(w, effects)})).ok, true);
  assert.equal(lf.state.data.travel.result.picture.pic_id, 'sp-b');
  assert.equal(r.commit(w => lf.rules.travel.claim(w, {}, effects)).ok, true);
  assert.equal(lf.state.data.items.house[9001], 1);
  assert.equal(lf.state.data.items.specialtys.length, 1);
  assert.equal(lf.state.data.items.specialty_counts.rare, 2);
  r.reload(); assert.equal(lf.state.data.items.specialty_counts.rare, 2);
});

test('travel reward settlement rejects unknown destination items atomically', () => {
  const r = runtime(); const {lf} = r; const effects = {};
  assert.equal(r.commit(w => lf.rules.travel.prepareAndStart(w, {
    destinationId: 3, duration: 60, destination_items: [{item_id: 999999, count: 1}]
  }, effects)).ok, true);
  lf.state.data.clock.timeTravelSeconds += 61;
  assert.equal(r.commit(w => ({ok:true, changed:lf.rules.travel.advance(w, effects)})).ok, true);
  const before = lf.state.data.wallet.clover;
  const failed = r.commit(w => lf.rules.travel.claim(w, {}, effects));
  assert.equal(failed.ok, false);
  assert.equal(lf.state.data.travel.status, 'result');
  assert.equal(lf.state.data.wallet.clover, before);
});

test('flowerpot mature harvest can return a seed and records cumulative produce', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.flowerpot.plant_list = [{state:'done', reward_id:1001, reward_count:2, seed_drop_id:1002, category:'vegetable'}];
  assert.equal(r.commit(w => lf.rules.flowerpot.harvest(w, 1, {})).ok, true);
  assert.equal(lf.state.data.items.house[1001], 2);
  assert.equal(lf.state.data.items.house[1002], 1);
  assert.equal(lf.state.data.flowerpot.harvest_count, 1);
  assert.equal(lf.state.data.flowerpot.harvested.vegetable, 2);
  r.reload(); assert.equal(lf.state.data.flowerpot.harvest_count, 1);
});

test('compost fertility shortens configured processing duration', () => {
  const r=runtime(); const {lf}=r;
  lf.state.data.compost.show_index=1; lf.state.data.compost.compost_list=[77]; lf.state.data.compost.box_list[0]=5001;
  lf.config.get=(name,id)=> name==='CompostData' && id===77 ? {id:77, star:3} : null;
  const result=r.commit(w=>lf.rules.compost.start(w, {}, {fertility:3}));
  assert.equal(result.ok,true); assert.equal(result.duration,2400);
});

test('museum day callback and info use client-shaped payloads', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.activities.museumday.compass = 3;
  lf.state.data.activities.museumday.task_num = 2;
  const info = lf.server.handlers.museumday_info.read(lf.state.data);
  assert.equal(info.compass, 3); assert.equal(info.task_num, 2);
  assert.equal(r.commit(w => lf.server.handlers.museumday_arrive.apply(w, {desc_id: 8, pic_id: 9}, {})).ok, true);
  assert.equal(lf.state.data.activities.museumday.frog, 1);
  assert.equal(lf.state.data.activities.museumday.pic_id, 9);
});

test('spring card share tags has local code lifecycle and task item alias', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.activities.springcard.task_item = [301];
  const pending = lf.server.handlers.springcard_get_task_item.read(lf.state.data);
  assert.equal(pending.task_item[0], 301); assert.equal(pending.list[0], 301);
  const made = r.commit(w => lf.server.handlers.springcard_share_tags.apply(w, {tags_id: 301}, {}));
  assert.equal(made.ok, true); assert.equal(typeof made.share_code, 'string');
  assert.equal(r.commit(w => lf.server.handlers.springcard_get_share_tags.apply(w, {share_code: made.share_code}, {})).ok, true);
  assert.equal(lf.state.data.activities.springcard.share_get, 1);
  assert.equal(lf.state.data.activities.springcard.items.some(x => x.item_id === 301), true);
  assert.equal(r.commit(w => lf.server.handlers.springcard_get_share_tags.apply(w, {share_code: made.share_code}, {})).ok, false);
});

test('greeting card feedback gift grants incoming item only once', () => {
  const r = runtime(); const {lf} = r;
  lf.state.data.activities.greetcard.get_list = [{gift: 9001}];
  const before = lf.state.data.items.house[9001] || 0;
  assert.equal(r.commit(w => lf.server.handlers.greetcard_feedback_gift.apply(w, {id: 1}, {})).ok, true);
  assert.equal(lf.state.data.items.house[9001], before + 1);
  assert.equal(r.commit(w => lf.server.handlers.greetcard_feedback_gift.apply(w, {id: 1}, {})).ok, false);
});

test('cooking share is handled locally and survives reload', () => {
  const r = runtime(); const {lf} = r;
  const first = r.commit(w => lf.server.handlers.cooking_share.apply(w, {}, {}));
  assert.equal(first.ok, true); assert.equal(first.share_count, 1);
  r.reload(); assert.equal(lf.state.data.activities.cooking.share_count, 1);
});

test('calendar reward handlers select first pending entry when client omits parameters', () => {
  const r = runtime(); const {lf} = r, effects={};
  assert.equal(r.commit(w => lf.server.handlers.calendar_get_beginer_reward.apply(w, {}, effects)).ok, true);
  lf.state.data.activities.calendar.lucky_days = [1001];
  assert.equal(r.commit(w => lf.server.handlers.calendar_get_luck_reward.apply(w, {}, effects)).ok, true);
  assert.equal(lf.state.data.activities.calendar.lucky_days[0], null);
  lf.state.data.activities.calendar.st_days = [1002];
  assert.equal(r.commit(w => lf.server.handlers.calendar_get_st_reward.apply(w, {}, effects)).ok, true);
  assert.equal(lf.state.data.activities.calendar.st_days[0], null);
});

test('cooking task callbacks return task field expected by client model', () => {
  const r = runtime(); const {lf} = r;
  const refreshed = r.commit(w => lf.server.handlers.cooking_refresh_task.apply(w, {id: 4}, {}));
  assert.equal(refreshed.ok, true); assert.equal(refreshed.task.id, 4);
  const updated = r.commit(w => lf.server.handlers.cooking_task_update.apply(w, {task: {id: 4, progress: 1, target: 1}}, {}));
  assert.equal(updated.ok, true); assert.equal(updated.task.progress, 1);
});
