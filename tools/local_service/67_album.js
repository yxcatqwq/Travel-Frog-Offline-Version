    /* B07: the client AlbumView renders six pictures per page. Item 9000 is
     * a permanent extra page, also used by its expansion tooltip. */
    var album = LF.rules.album = {};
    album.BASE_PAGES = 30;
    album.MAX_EXTRA_PAGES = 56;
    album.PICTURES_PER_PAGE = 6;
    album.PAGE_ITEM = 9000;
    album.PRICES = [1000, 1250, 1500, 2000, 3000, 2000, 1500, 1250];

    album.ensure = function (work) {
        if (!util.isObject(work.album)) { work.album = {}; }
        var a = work.album;
        ["pictures", "newPictures", "deleted"].forEach(function (key) {
            if (!Array.isArray(a[key])) { a[key] = []; }
        });
        if (a.mechanismVersion !== 2) {
            // Old local builds stored pages in capacity but enforced a photo limit.
            // Preserve paid pages; the old expansionCount counted purchases, not pages.
            var extra = Math.max(0, util.toInt(a.capacity, 30) - 30,
                util.toInt(work.items.house[album.PAGE_ITEM], 0));
            extra = Math.min(album.MAX_EXTRA_PAGES, extra);
            a.capacity = album.BASE_PAGES + extra;
            a.expansionCount = extra;
            if (extra > 0) { work.items.house[album.PAGE_ITEM] = extra; }
            a.mechanismVersion = 2;
        }
        a.capacity = Math.min(86, Math.max(30, util.toInt(a.capacity, 30)));
        a.expansionCount = a.capacity - album.BASE_PAGES;
        return a;
    };
    album.limit = function (work) { return album.ensure(work).capacity * album.PICTURES_PER_PAGE; };
    album.snapshot = function (work) {
        var a = album.ensure(work);
        return {pictures: util.clone(a.pictures), new_pictures: util.clone(a.newPictures),
            deleted: util.clone(a.deleted), total: a.pictures.length, capacity: a.capacity,
            photo_capacity: album.limit(work), expansion_count: a.expansionCount};
    };
    album.nextPrice = function (work) {
        var a = album.ensure(work);
        return a.expansionCount >= album.MAX_EXTRA_PAGES ? null : album.PRICES[a.expansionCount % 8];
    };
    album.expand = function (work, params, effects) {
        var a = album.ensure(work), pages = params && params.pages;
        if (pages !== undefined && Number(pages) !== 1) {
            return {ok: false, code: LF.ERR.ILLEGAL_PARAM, reason: "album-one-page-per-purchase"};
        }
        var cost = album.nextPrice(work);
        if (cost === null) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "album-max"}; }
        var paid = rules.wallet.consume(work, {clover: cost}, effects);
        if (!paid.ok) { return paid; }
        a.capacity++;
        a.expansionCount++;
        work.items.house[album.PAGE_ITEM] = a.expansionCount;
        rules.effect(effects, "items", album.PAGE_ITEM);
        rules.effect(effects, "album");
        return {ok: true, code: LF.ERR.OK, changed: {capacity: a.capacity, cost: cost, pages: 1}};
    };
    album.indexOf = function (list, id) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === String(id)) { return i; }
        }
        return -1;
    };
    album.forget = function (list, id) {
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i] && String(list[i].id) === String(id)) { list.splice(i, 1); }
        }
    };
    album.trash = function (work, picture, effects) {
        var a = album.ensure(work);
        album.forget(a.deleted, picture.id);
        a.deleted.push(picture);
        while (a.deleted.length > 6) { a.deleted.shift(); }
        rules.effect(effects, "album");
    };
    album.load = function (work, start, count) {
        var a = album.ensure(work), s = Math.max(1, util.toInt(start, 1));
        var list = a.pictures.slice(s - 1, s - 1 + Math.max(1, util.toInt(count, 6)));
        return {pictures: util.clone(list), start: s, total: a.pictures.length, count: list.length};
    };
    album.loadIds = function (work, ids) {
        var wanted = util.toArray(ids).map(String);
        return {pic_list: util.clone(album.ensure(work).pictures.filter(function (p) {
            return p && wanted.indexOf(String(p.id)) >= 0;
        }))};
    };
    album.remove = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.pictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "picture-not-found"}; }
        album.trash(work, a.pictures.splice(index, 1)[0], effects);
        return {ok: true, code: LF.ERR.OK};
    };
    album.recover = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.deleted, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "picture-not-in-trash"}; }
        if (a.pictures.length >= album.limit(work)) {
            return {ok: false, code: 75, reason: "album-full"};
        }
        a.pictures.push(a.deleted.splice(index, 1)[0]);
        rules.effect(effects, "album");
        return {ok: true, code: LF.ERR.OK};
    };
    album.saveNew = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.newPictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "new-picture-not-found"}; }
        // A failed save leaves the photo pending. Only explicit rejection trashes it.
        if (a.pictures.length >= album.limit(work)) {
            album.trash(work, a.newPictures.splice(index, 1)[0], effects);
            return {ok: true, code: 75, response: {code: 75}, reason: "album-full"};
        }
        a.pictures.push(a.newPictures.splice(index, 1)[0]);
        rules.effect(effects, "album");
        if (rules.tasks) { rules.tasks.update(work, "album_save", 1, effects); }
        return {ok: true, code: LF.ERR.OK};
    };
    album.deleteNew = function (work, id, effects) {
        var a = album.ensure(work), index = album.indexOf(a.newPictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "new-picture-not-found"}; }
        album.trash(work, a.newPictures.splice(index, 1)[0], effects);
        return {ok: true, code: LF.ERR.OK};
    };
    album.toGift = function (work, id, effects) {
        var a = album.ensure(work), m = rules.mail.ensure(work), index = album.indexOf(a.pictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "picture-not-found"}; }
        var picture = a.pictures.splice(index, 1)[0];
        album.forget(m.pictures, id);
        album.forget(a.newPictures, id);
        album.forget(a.deleted, id);
        m.pictures.push(picture);
        rules.effect(effects, "album"); rules.effect(effects, "mail");
        return {ok: true, code: LF.ERR.OK};
    };
    album.fromGift = function (work, id, effects) {
        var a = album.ensure(work), m = rules.mail.ensure(work), index = album.indexOf(m.pictures, id);
        if (index < 0) { return {ok: false, code: LF.ERR.ILLEGAL_OP, reason: "gift-picture-not-found"}; }
        if (album.indexOf(a.pictures, id) < 0 && a.pictures.length >= album.limit(work)) {
            return {ok: false, code: 101, reason: "album-full"};
        }
        var picture = m.pictures.splice(index, 1)[0];
        album.forget(a.pictures, id);
        album.forget(a.newPictures, id);
        album.forget(a.deleted, id);
        a.pictures.push(picture);
        rules.effect(effects, "album"); rules.effect(effects, "mail");
        return {ok: true, code: LF.ERR.OK};
    };
