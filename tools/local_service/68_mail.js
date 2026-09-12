    /* M2.3 本地邮件与旅行礼品盒。 */
    var mail = LF.rules.mail = {};
    mail.ensure = function (work) {
        if (!util.isObject(work.mail)) { work.mail = {mails: [], nextId: 1, pictures: [], specialtys: [], notes: []}; }
        if (!Array.isArray(work.mail.mails)) { work.mail.mails = []; }
        if (!Array.isArray(work.mail.specialtys)) { work.mail.specialtys = []; }
        if (!Array.isArray(work.mail.pictures)) { work.mail.pictures = []; }
        if (!Array.isArray(work.mail.notes)) { work.mail.notes = []; }
        return work.mail;
    };
    mail.list = function (work, start, count) { var m=mail.ensure(work), s=Math.max(1,util.toInt(start,1)), c=Math.max(1,util.toInt(count,5)), rows=m.mails.slice(s-1,s-1+c); return {mails:util.clone(rows),start:s,count:rows.length,total:m.mails.length}; };
    mail.read = function (work,id,effects) { var m=mail.ensure(work); for(var i=0;i<m.mails.length;i++){if(util.toInt(m.mails[i].id,-1)===util.toInt(id,-1)){m.mails[i].read=true; rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK};}} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'mail-not-found'}; };
    mail.open = function (work,id,effects) { var m=mail.ensure(work); for(var i=0;i<m.mails.length;i++){var row=m.mails[i]; if(util.toInt(row.id,-1)!==util.toInt(id,-1))continue; if(row.opened)return {ok:true,code:LF.ERR.OK}; var grant=rules.wallet.grant(work,row.resource||{},effects); if(!grant.ok)return grant; util.toArray(row.items).forEach(function(item){rules.items.add(work,item.item_id,util.toInt(item.count,1),effects);}); row.opened=true; row.read=true; rules.effect(effects,'mail'); rules.effect(effects,'container'); return {ok:true,code:LF.ERR.OK}; } return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'mail-not-found'}; };
    mail.snapshot = function (work) { return mail.list(work,1,util.toInt(mail.ensure(work).mails.length,0)||1); };
    mail.expire = function (work, effects) { var m=mail.ensure(work), now=clock.now(), removed=0; for(var i=0;i<m.mails.length;i++){var row=m.mails[i], at=util.toInt(row.expires_at!==undefined?row.expires_at:(row.expire_at!==undefined?row.expire_at:0),0); if(at>0&&at<=now&&!row.opened&&!row.expired){row.expired=true;row.items=[];row.resource={};removed++;}} if(removed)rules.effect(effects,'mail'); return {ok:true,code:LF.ERR.OK,removed:removed}; };
    mail.giftToBag = function (work,id,effects) { var m=mail.ensure(work), key=util.toInt(id,-1); for(var i=0;i<m.specialtys.length;i++){var row=m.specialtys[i];if(util.toInt(row.item_id,-1)===key){var add=rules.items.add(work,key,1,effects);if(!add.ok)return add;var left=Math.max(0,util.toInt(row.count,1)-1);if(left)row.count=left;else m.specialtys.splice(i,1);rules.effect(effects,'mail');rules.effect(effects,'container');return {ok:true,code:LF.ERR.OK};}} return {ok:false,code:LF.ERR.NO_ITEM,reason:'gift-item-not-found'}; };
    mail.bagToGift = function (work, id, count, effects) {
        var m=mail.ensure(work), key=util.toInt(id,-1), amount=Math.max(1,util.toInt(count,1));
        var taken=rules.items.consume(work,key,amount,effects); if(!taken.ok)return taken;
        m.specialtys.push({item_id:key,count:amount,source:'bag'}); rules.effect(effects,'mail'); rules.effect(effects,'container');
        return {ok:true,code:LF.ERR.OK,item_id:key,count:amount};
    };
    mail.giftDeletePicture = function (work,id,effects) { var m=mail.ensure(work), key=String(id); for(var i=0;i<m.pictures.length;i++){if(String(m.pictures[i].id)===key){m.pictures.splice(i,1);rules.effect(effects,'mail');return {ok:true,code:LF.ERR.OK};}} return {ok:false,code:LF.ERR.ILLEGAL_OP,reason:'gift-picture-not-found'}; };
