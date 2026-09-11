from pathlib import Path
import json
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


root = Path(__file__).resolve().parents[1]
source = root / "offline_build" / "travel_frog_local_update.apk"
output = root / "offline_build" / "travel_frog_local_sync_unsigned.apk"

login_start = b"t.prototype.login=function(e){this.serverListIndex=0"
login_end = b"t.prototype.reloading=function"
login_replacement = (
    b"t.prototype.login=function(e){this.serverListIndex=0,"
    b"this.loginCallback=e,this.syncComplete=!0,e&&e()},"
)
season_old = b't.prototype.getSeasonKey=function(){return this.data.season+""+this.data.hours_type}'
season_new = b't.prototype.getSeasonKey=function(){return"31"}'
guide_old = b'this.guideStep=GuideStep.New'
guide_new = b'this.guideStep=GuideStep.Complete'
load_branch_old = b':(core.Log.print("start loadResource"),this.loadResource())'
load_branch_new = (
    b':(core.Log.print("start loadResource"),this.loginEnd=!0,this.loadResource().then(function(){'
    b't&&t.fade(function(){})}))'
)
finish_start = b't.prototype.checkFinish=function(){var e=this;if(this.loginEnd&&this.preloadComplete){'
finish_end = b'},t.prototype.loadZip=function'
finish_replacement = (
    b't.prototype.checkFinish=function(){var e=this;if(this.loginEnd&&this.preloadComplete){'
    b'this.view.hideStuckTip(),NetworkControl.getInstance().login(function(){'
    b'e.loadComplete=!0,GameConfig.loadComplete=!0,e.enterGame()})}'
)
enter_old = (
    b't.prototype.enterGame=function(){this.loadComplete&&NetworkControl.getInstance().isSyncComplete()'
    b'&&GameConfig.activate&&('
)
enter_new = (
    b't.prototype.enterGame=function(){this.loadComplete=!0,GameConfig.activate=!0,'
    b'this.loadComplete&&GameConfig.activate&&('
)
web_class_start = b'var WebLoadingController='
web_load_start = b't.prototype.loadResource=function(){'
web_login_start = b'NetworkControl.getInstance().sdk_login(function(){'
web_login_end = b',[2]}})})}'
web_login_replacement = (
    b'(function(){n.loadSeasonGroups().then(function(){ResourceLoader.instance().loadResource(),n.loadComplete=!0,'
    b'GameConfig.loadComplete=!0,GameConfig.activate=!0,core.PageManage.getInstance().removeControl(WebLoadingController,'
    b'core.ViewLayerType.NoticeLayer),core.PageManage.getInstance().addViewControl(MainOutController,core.ViewLayerType.SceneLayer,'
    b'core.RemoveViewType.RemoveBefore)})})()'
)
network_reflect = b'__reflect(NetworkControl.prototype,"NetworkControl");'
network_shim = network_reflect
mainout_scroll_old = (
    b't.prototype.scroll=function(e){e||(this.scroller.viewport.scrollH=this.background.width-this.scroller.width-80),'
    b'this.update_fg()}'
)
mainout_scroll_new = (
    b't.prototype.scroll=function(e){e||(this.scroller.viewport.scrollH=500),'
    b'this.update_fg()}'
)
mainout_ready_old = b'this.reset(!1),this.onSyncComplete();var n=this.userModel.getClientSettings().guideStep'
mainout_ready_new = (
    b'this.reset(!1),this.userModel.setClientSettings("guideAnnualReview",!0),this.userModel.setClientSettings("guideFurnitureNotice",!0),'
    b'this.onSyncComplete(),this.disabledOrEnableUI(!0),this.houseBtn.x=GameConfig.designSizeWidth-94,'
    b'this.houseBtn.y=1018,this.shopBtn.x=GameConfig.designSizeWidth-94,this.shopBtn.y=923,this.scroll();'
    b'var n=this.userModel.getClientSettings().guideStep'
)
theme_mainout_start = b"generateEUI.paths['resource/China/skins/MainOut/MainOut.exml']"
theme_mainout_end = b"})(eui.Skin);generateEUI.paths['resource/China/skins/MainOut/Notification.exml']"
theme_scene_old = (
    b't.height = 1420;\n\t\tt.scaleX = 1;\n\t\tt.scaleY = 1;\n\t\tt.verticalCenter = 0;\n\t\tt.width = 1152;\n\t\tt.x = 0;\n\t\tt.elementsContent = [this.groupDown_i(),this.groupCoverDown_i(),this.groupMid_i(),this.groupCoverMid_i(),this.groupTips_i()];'
)
theme_scene_new = theme_scene_old
theme_house_old = (
    b'_proto.houseBtn_i = function () {\n\t\tvar t = new Button();\n\t\tthis.houseBtn = t;\n\t\tt.bottom = 30;\n\t\tt.label = "";\n\t\tt.right = 10;\n\t\tt.skinName = $exmlClass315$Skin341;\n\t\treturn t;\n\t};'
)
theme_house_new = (
    b'_proto.houseBtn_i = function () {\n\t\tvar t = new eui.Image();\n\t\tthis.houseBtn = t;\n\t\tt.x = 546;\n\t\tt.y = 1018;\n\t\tt.width = 84;\n\t\tt.height = 88;\n\t\tt.source = "offline_house_png";\n\t\treturn t;\n\t};'
)
theme_shop_old = (
    b'_proto.shopBtn_i = function () {\n\t\tvar t = new Button();\n\t\tthis.shopBtn = t;\n\t\tt.bottom = 125;\n\t\tt.label = "";\n\t\tt.right = 10;\n\t\tt.skinName = $exmlClass315$Skin342;\n\t\treturn t;\n\t};'
)
theme_shop_new = (
    b'_proto.shopBtn_i = function () {\n\t\tvar t = new eui.Image();\n\t\tthis.shopBtn = t;\n\t\tt.x = 546;\n\t\tt.y = 923;\n\t\tt.width = 84;\n\t\tt.height = 88;\n\t\tt.source = "offline_shop_png";\n\t\treturn t;\n\t};'
)
theme_group_top_old = b't.elementsContent = [this.moneyPanel_i(),this.menu_i(),this.payBtn_i(),this.activityGroup_i()];'
theme_group_top_new = theme_group_top_old
theme_offline_methods = b''
resource_entries = {
    "offline_house_png": {"url": "offline_house.png", "type": "image", "name": "offline_house_png"},
    "offline_shop_png": {"url": "offline_shop.png", "type": "image", "name": "offline_shop_png"},
}


def copy_entry(out_zip, info, payload):
    # Keep resources.arsc uncompressed so zipalign can satisfy Android's table alignment.
    cloned = ZipInfo(info.filename, info.date_time)
    cloned.comment = info.comment
    cloned.extra = info.extra
    cloned.create_system = info.create_system
    cloned.external_attr = info.external_attr
    cloned.internal_attr = info.internal_attr
    cloned.compress_type = ZIP_STORED if info.filename == "resources.arsc" else ZIP_DEFLATED
    out_zip.writestr(cloned, payload)


with ZipFile(source, "r") as source_zip, ZipFile(output, "w") as output_zip:
    login_hits = 0
    season_hits = 0
    splash_hits = 0
    finish_hits = 0
    enter_hits = 0
    web_hits = 0
    network_shim_hits = 0
    guide_hits = 0
    mainout_scroll_hits = 0
    mainout_ready_hits = 0
    theme_scene_hits = 0
    theme_house_hits = 0
    theme_shop_hits = 0
    resource_manifest_hits = 0
    for info in source_zip.infolist():
        if info.filename.startswith("META-INF/"):
            continue
        payload = source_zip.read(info)
        if info.filename == "assets/game/js/main.min.js":
            start = payload.find(login_start)
            if start < 0:
                raise RuntimeError("NetworkControl.login anchor not found")
            end = payload.find(login_end, start)
            if end < 0:
                raise RuntimeError("NetworkControl.reloading anchor not found")
            payload = payload[:start] + login_replacement + payload[end:]
            login_hits += 1
            season_count = payload.count(season_old)
            if season_count != 1:
                raise RuntimeError(f"WeatherModel.getSeasonKey expected once, found {season_count}")
            payload = payload.replace(season_old, season_new)
            season_hits += season_count
            guide_count = payload.count(guide_old)
            if guide_count != 1:
                raise RuntimeError(f"SettingsInfo guideStep expected once, found {guide_count}")
            payload = payload.replace(guide_old, guide_new)
            guide_hits += guide_count
            mainout_scroll_count = payload.count(mainout_scroll_old)
            if mainout_scroll_count != 1:
                raise RuntimeError(f"MainOutView.scroll expected once, found {mainout_scroll_count}")
            payload = payload.replace(mainout_scroll_old, mainout_scroll_new)
            mainout_scroll_hits += mainout_scroll_count
            mainout_ready_count = payload.count(mainout_ready_old)
            if mainout_ready_count != 1:
                raise RuntimeError(f"MainOutView.onComplete expected once, found {mainout_ready_count}")
            payload = payload.replace(mainout_ready_old, mainout_ready_new)
            mainout_ready_hits += mainout_ready_count
            splash_count = payload.count(load_branch_old)
            if splash_count != 1:
                raise RuntimeError(f"LoadingController local branch expected once, found {splash_count}")
            payload = payload.replace(load_branch_old, load_branch_new)
            splash_hits += splash_count
            start = payload.find(finish_start)
            if start < 0:
                raise RuntimeError("LoadingController.checkFinish anchor not found")
            end = payload.find(finish_end, start)
            if end < 0:
                raise RuntimeError("LoadingController.loadZip anchor not found")
            payload = payload[:start] + finish_replacement + payload[end:]
            finish_hits += 1
            enter_count = payload.count(enter_old)
            if enter_count < 1:
                raise RuntimeError(f"LoadingController.enterGame expected, found {enter_count}")
            payload = payload.replace(enter_old, enter_new)
            enter_hits += enter_count
            web_start = payload.find(web_class_start)
            if web_start < 0:
                raise RuntimeError("WebLoadingController anchor not found")
            web_func = payload.find(web_load_start, web_start)
            if web_func < 0:
                raise RuntimeError("WebLoadingController.loadResource anchor not found")
            web_login = payload.find(web_login_start, web_func)
            if web_login < 0:
                raise RuntimeError("WebLoadingController.sdk_login anchor not found")
            web_end = payload.find(web_login_end, web_login)
            if web_end < 0:
                raise RuntimeError("WebLoadingController loadResource end anchor not found")
            payload = payload[:web_login] + web_login_replacement + payload[web_end:]
            web_hits += 1
            network_count = payload.count(network_reflect)
            if network_count != 1:
                raise RuntimeError(f"NetworkControl reflect anchor expected once, found {network_count}")
            payload = payload.replace(network_reflect, network_shim, 1)
            network_shim_hits += network_count
        if info.filename == "assets/game/js/default.thm.js":
            theme_start = payload.find(theme_mainout_start)
            if theme_start < 0:
                raise RuntimeError("MainOut theme anchor not found")
            theme_end = payload.find(theme_mainout_end, theme_start)
            if theme_end < 0:
                raise RuntimeError("MainOut theme end anchor not found")
            theme_block = payload[theme_start:theme_end]
            theme_scene_count = theme_block.count(theme_scene_old)
            if theme_scene_count != 1:
                raise RuntimeError(f"MainOut theme scene expected once, found {theme_scene_count}")
            theme_block = theme_block.replace(theme_scene_old, theme_scene_new, 1)
            payload = payload[:theme_start] + theme_block + payload[theme_end:]
            theme_scene_hits += theme_scene_count
            theme_block = payload[theme_start:theme_end]
            group_top_count = theme_block.count(theme_group_top_old)
            if group_top_count != 1:
                raise RuntimeError(f"MainOut groupTop expected once, found {group_top_count}")
            theme_block = theme_block.replace(theme_group_top_old, theme_group_top_new, 1)
            method_anchor = b'_proto.groupTop_i = function'
            if theme_block.count(method_anchor) != 1:
                raise RuntimeError("MainOut groupTop method anchor expected once")
            theme_block = theme_block.replace(method_anchor, theme_offline_methods + method_anchor, 1)
            theme_house_count = theme_block.count(theme_house_old)
            theme_shop_count = theme_block.count(theme_shop_old)
            if theme_house_count != 1 or theme_shop_count != 1:
                raise RuntimeError(f"MainOut theme buttons expected once, found house={theme_house_count}, shop={theme_shop_count}")
            theme_block = theme_block.replace(theme_house_old, theme_house_new, 1).replace(theme_shop_old, theme_shop_new, 1)
            payload = payload[:theme_start] + theme_block + payload[theme_end:]
            theme_house_hits += theme_house_count
            theme_shop_hits += theme_shop_count
        if info.filename == "assets/game/resource/China/default.res.json":
            manifest = json.loads(payload.decode("utf-8"))
            resources = manifest.setdefault("resources", [])
            for name, entry in resource_entries.items():
                resources[:] = [item for item in resources if item.get("name") != name]
                resources.append(entry)
            sheet = next(group for group in manifest["groups"] if group.get("name") == "sheet")
            keys = [key for key in sheet.get("keys", "").split(",") if key]
            for name in resource_entries:
                if name not in keys:
                    keys.append(name)
            sheet["keys"] = ",".join(keys)
            payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            resource_manifest_hits += 1
        copy_entry(output_zip, info, payload)

    for filename, source_path in (("assets/game/resource/China/offline_house.png", root / "offline_build" / "offline_house.png"), ("assets/game/resource/China/offline_shop.png", root / "offline_build" / "offline_shop.png")):
        if not source_path.is_file():
            raise RuntimeError(f"Generated offline icon missing: {source_path}")
        generated = ZipInfo(filename)
        generated.compress_type = ZIP_DEFLATED
        output_zip.writestr(generated, source_path.read_bytes())

if login_hits != 1 or season_hits != 1 or splash_hits != 1 or finish_hits != 1 or enter_hits < 1 or web_hits != 1 or network_shim_hits != 1 or guide_hits != 1 or mainout_scroll_hits != 1 or mainout_ready_hits != 1 or theme_scene_hits != 1 or theme_house_hits != 1 or theme_shop_hits != 1 or resource_manifest_hits != 1:
    raise RuntimeError(
        f"Unexpected patch counts: login={login_hits}, season={season_hits}, splash={splash_hits}, finish={finish_hits}, enter={enter_hits}, web={web_hits}, guide={guide_hits}, mainout_scroll={mainout_scroll_hits}, mainout_ready={mainout_ready_hits}, theme_scene={theme_scene_hits}, theme_house={theme_house_hits}, theme_shop={theme_shop_hits}, resource_manifest={resource_manifest_hits}"
    )
print(f"Created {output}")
