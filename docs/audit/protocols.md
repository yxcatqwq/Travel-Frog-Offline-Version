# 客户端协议逐项清单

由 `tools/audit-local-requirements.py` 从当前 APK 生成。

这里记录请求参数名，不代表完整响应结构。`session` 表示协议表的响应跟踪标记，不能仅据此判定请求/推送方向。
缺少直接调用不代表可删除：启动批量同步、服务器推送和其他客户端版本可能使用它。优先级按功能域初分，具体实施顺序以主清单为准。

所有条目都尚未建立对应的本地权威服务；部分模型已有内存变更或结果消费逻辑可复用。

| 协议 | 参数 | 表内/session | 发送/回调符号 | 处理 |
|---|---|---|---|---|
| `adsmgr_ads_notify` | — | 回调额外发现 | `AdsModel.initModel` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `adsmgr_load` | — | 是/True | `AdsModel.initModel` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `adsmgr_refuse` | — | 是/True | `AdsModel.req_refuse` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `adsmgr_share` | ads_type | 是/True | `AdsModel.req_share` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `adsmgr_share_ads` | ads_id | 是/False | `AdsModel.share_ads` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `adsmgr_shop_free` | — | 是/True | `AdsModel.req_shop_free` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `album_delete` | id | 是/True | `TravelModel.deletePictureInfo` | P1：实现本地状态/规则及兼容响应 |
| `album_delete_new` | id | 是/True | `TravelModel.deleteAllAdsPicture`、`TravelModel.deleteNewPictureInfo` | P1：实现本地状态/规则及兼容响应 |
| `album_load` | start, count | 是/True | `TravelModel.checkPictureInfoPage`、`TravelModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `album_load_all` | — | 是/True | `TravelModel.initModel`、`TravelModel.requestAlbum` | P1：实现本地状态/规则及兼容响应 |
| `album_load_by_id_list` | id_list | 是/True | `TravelModel.checkPictureByIds`、`TravelModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `album_load_new` | — | 是/True | `TravelModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `album_load_recover` | — | 是/True | `AlbumView.on_RecoverBtn`、`PictureRecover.onComplete`、`TravelModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `album_recover` | id | 是/True | `TravelModel.recoverPictureInfo` | P1：实现本地状态/规则及兼容响应 |
| `album_save_new` | id | 是/True | `TravelModel.saveNewPictureInfo` | P1：实现本地状态/规则及兼容响应 |
| `animpicture_add_pic` | anim_index, ids | 是/True | `AnimPictureModel.req_add_pic` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_album_add_pic` | anim_index, pic_index, pic_uid | 是/True | `AnimPictureModel.req_album_add_pic` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_album_remove_pic` | anim_index, pic_index, is_delete | 是/True | `AnimPictureModel.req_album_remove_pic` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_get_item` | — | 是/True | `AnimPictureModel.req_get_item` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_guide` | — | 是/True | `AnimPictureModel.req_guide` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_load` | — | 是/True | `AnimPictureModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_open_album` | index | 是/True | `AnimPictureModel.req_open_album` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_remove_pic` | anim_index, pic_index, is_delete | 是/True | `AnimPictureModel.req_remove_pic` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_select_pic` | id | 是/True | `AnimPictureModel.req_select_pic` | P2：实现本地状态/规则及兼容响应 |
| `animpicture_use_item` | anim_index, item_id | 是/True | `AnimPictureModel.req_use_item` | P2：实现本地状态/规则及兼容响应 |
| `annual_load` | — | 是/True | `AnnualReviewModel.request` | P3：实现本地状态/规则及兼容响应 |
| `annual_share` | — | 是/True | `o.showShare` | P3：实现本地状态/规则及兼容响应 |
| `calendar_get_beginer_reward` | — | 是/True | `CalendarModel.req_beginer_reward` | P2：实现本地状态/规则及兼容响应 |
| `calendar_get_code_reward` | day | 是/True | `CalendarModel.req_code_reward` | P2：实现本地状态/规则及兼容响应 |
| `calendar_get_luck_reward` | — | 是/True | `CalendarModel.req_luck_reward` | P2：实现本地状态/规则及兼容响应 |
| `calendar_get_st_reward` | — | 是/True | `CalendarModel.req_st_reward` | P2：实现本地状态/规则及兼容响应 |
| `calendar_load` | — | 是/True | `CalendarModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `calendar_load_note` | — | 是/True | `CalendarModel.initModel`、`CalendarView.childrenCreated` | P2：实现本地状态/规则及兼容响应 |
| `calendar_task_update` | — | 是/True | `CalendarModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `capsule_fast_task` | index | 是/True | `CapsuleModel.req_fast_task` | P2：实现本地状态/规则及兼容响应 |
| `capsule_get_coin` | — | 是/True | `CapsuleModel.req_get_coin` | P2：实现本地状态/规则及兼容响应 |
| `capsule_load` | — | 是/True | `CapsuleModel.initModel`、`CapsuleModel.req_load` | P2：实现本地状态/规则及兼容响应 |
| `capsule_load_coin` | — | 是/True | `CapsuleModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `capsule_load_task` | — | 是/True | `CapsuleModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `capsule_patch` | — | 是/True | `CapsuleModel.req_patch` | P2：实现本地状态/规则及兼容响应 |
| `capsule_twist` | — | 是/True | `CapsuleModel.req_twist` | P2：实现本地状态/规则及兼容响应 |
| `client_add_push_id` | push_id | 是/False | `WXgameChannel.pushMessage` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_change_decorate` | id | 是/True | `RoleModel.changeDecoration` | P0：实现本地状态/规则及兼容响应 |
| `client_confirm_event` | id | 是/False | `TravelModel.readTraveEvents` | P0：实现本地状态/规则及兼容响应 |
| `client_draw_taobao` | draw | 是/True | `TaobaoImportView.drawTaobao` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_get_my_wx_reward` | — | 是/True | `GuideMiniView.onComplete`、`MainOutView.onComplete`、`UserModel.client_load_role` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_get_push_reward` | — | 是/True | `WXgameChannel.tryGetPushReward` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_gm` | cmd | 是/True | `GMView.commitProperties`、`GMView.execute`、`MessageModel (constructor)` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `client_hello` | — | 是/True | `NetworkControl.createPint`、`UserModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `client_load_all_info` | — | 是/True | `NetworkControl.totalEvents` | P0：实现本地状态/规则及兼容响应 |
| `client_load_decorate` | — | 是/True | `RoleModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `client_load_events` | — | 是/True | `TravelModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `client_load_publicity` | — | 回调额外发现 | `NoticeModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `client_load_role` | — | 是/True | `UserModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `client_notice` | — | 回调额外发现 | `RoleModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `client_rename_cost` | — | 是/True | `RoleModel.setName` | P0：实现本地状态/规则及兼容响应 |
| `client_set_achieve` | id | 是/False | `RoleModel.setUseAchieveID` | P0：实现本地状态/规则及兼容响应 |
| `client_set_ads` | support | 是/False | `NetworkControl.totalEvents` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `client_set_channel` | channel | 是/False | `NetworkControl.totalEvents` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `client_set_channel_id` | id | 是/False | `NetworkControl.totalEvents` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `client_set_client` | client | 是/False | `UserModel.setClientSettings` | P0：实现本地状态/规则及兼容响应 |
| `client_set_client_envinfo` | info | 是/False | `NetworkControl.totalEvents` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `client_set_icon` | id | 是/False | `RoleModel.setIconID` | P0：实现本地状态/规则及兼容响应 |
| `client_set_lang` | lang | 是/False | 未见直接调用/注册 | P0：实现本地状态/规则及兼容响应 |
| `client_set_name` | name | 是/True | `RoleModel.setName` | P0：实现本地状态/规则及兼容响应 |
| `client_set_pic_show` | id | 是/False | `RoleModel.setPictureID` | P0：实现本地状态/规则及兼容响应 |
| `client_set_wx_open_id` | open_id | 是/True | `NetworkControl.totalEvents` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_share_publicity` | id | 是/True | `NoticeModel.req_share_publicity` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_switch_push` | turnon | 是/True | `UserModel.setPushSwitch` | P0：实现本地状态/规则及兼容响应 |
| `client_switch_rank` | turnon | 是/True | `UserModel.setRankSwitch` | P0：实现本地状态/规则及兼容响应 |
| `client_taobao_import` | taobao_uid | 是/True | `GMView.commitProperties` | P0：需单机替代策略/离线停用；保留已有权益与记录 |
| `client_user_action` | name | 是/False | 未见直接调用/注册 | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `clover_harvest` | clover_id | 是/True | `RoleModel.harvestClover` | P1：实现本地状态/规则及兼容响应 |
| `clover_harvest_resend` | list | 是/True | `RoleModel.syncHarvestClover` | P1：实现本地状态/规则及兼容响应 |
| `clover_load_clovers` | — | 是/True | `RoleModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `clover_notice_get` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `clover_update` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `cooking_complete_task` | id | 是/True | `CookingModel.requestCookReward` | P2：实现本地状态/规则及兼容响应 |
| `cooking_load_cooking` | — | 是/True | `CookingModel.initModel`、`CookingModel.request` | P2：实现本地状态/规则及兼容响应 |
| `cooking_look_ad` | — | 是/True | 未见直接调用/注册 | P2：实现本地状态/规则及兼容响应 |
| `cooking_refresh_task` | id | 是/True | `CookingModel.requestCookRefresh` | P2：实现本地状态/规则及兼容响应 |
| `cooking_select` | index | 是/True | `CookingModel.selectTheme` | P2：实现本地状态/规则及兼容响应 |
| `cooking_share` | — | 是/True | `GMView.execute`、`ShareView.share_callback` | P2：实现本地状态/规则及兼容响应 |
| `cooking_start_cooking` | — | 是/True | `CookingModel.requestStartCooking` | P2：实现本地状态/规则及兼容响应 |
| `cooking_task_update` | — | 回调额外发现 | `CookingModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `easteregg_load` | — | 回调额外发现 | `EasterEggModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `encyclopedia_load` | — | 是/True | `EncyModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `encyclopedia_set_show_sub` | long_id | 是/False | `EncyModel.req_set_show_sub` | P2：实现本地状态/规则及兼容响应 |
| `encytravel_load` | — | 是/True | `EncyTravelModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `encytravel_set_show_sub` | long_id | 是/False | `EncyTravelModel.req_set_show_sub` | P2：实现本地状态/规则及兼容响应 |
| `furniture_buy_shop` | shop_id | 是/True | `FurnitureModel.initModel`、`FurnitureModel.requestBuy` | P1：实现本地状态/规则及兼容响应 |
| `furniture_flowerpot_harvest` | type, index | 是/True | `FurnitureModel.req_flowerpot_harvest` | P1：实现本地状态/规则及兼容响应 |
| `furniture_load_compost` | — | 是/True | `FurnitureModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `furniture_load_flowerpot` | — | 回调额外发现 | `FurnitureModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `furniture_load_furniture` | — | 是/True | `FurnitureModel.initModel`、`o.checkCameraMoment` | P1：实现本地状态/规则及兼容响应 |
| `furniture_load_pocket` | — | 是/True | `FurnitureModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `furniture_load_tumbler` | — | 是/True | `FurnitureModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `furniture_pocket_get` | — | 是/True | `FurnitureModel.request_pocket_get` | P1：实现本地状态/规则及兼容响应 |
| `furniture_putin_bench` | pos, id | 是/True | `FurnitureModel.initModel`、`FurnitureModel.setBenchItem`、`FurnitureModel.setBenchTool` | P1：实现本地状态/规则及兼容响应 |
| `furniture_putin_box` | pos, id | 是/True | `FurnitureModel.setCompostItem` | P1：实现本地状态/规则及兼容响应 |
| `furniture_replace_compost` | index | 是/True | `FurnitureModel.replaceFurniture` | P1：实现本地状态/规则及兼容响应 |
| `furniture_replace_fur` | id | 是/True | `FurnitureModel.replaceFurniture` | P1：实现本地状态/规则及兼容响应 |
| `furniture_replace_pocket` | index | 是/True | `FurnitureModel.replaceFurniture` | P1：实现本地状态/规则及兼容响应 |
| `furniture_replace_tumbler` | index | 是/True | `FurnitureModel.replaceFurniture` | P1：实现本地状态/规则及兼容响应 |
| `furniture_takeout_bench` | pos | 是/True | `FurnitureModel.initModel`、`FurnitureModel.setBenchItem`、`FurnitureModel.setBenchTool` | P1：实现本地状态/规则及兼容响应 |
| `furniture_takeout_box` | pos | 是/True | `FurnitureModel.setCompostItem` | P1：实现本地状态/规则及兼容响应 |
| `greetcard_buy` | id | 是/True | `GreetCardModel.req_buy` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_change_bg` | id | 是/True | `GreetCardModel.req_change_bg` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_change_bless` | id | 是/True | `GreetCardModel.req_change_bless` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_feedback_gift` | id | 是/False | `MailItemView.acceptTouchEvents` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_get_reward` | id | 是/True | `GreetCardModel.req_get_reward` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_get_task_item` | — | 是/True | `GreetCardModel.initModel`、`GreetCardModel.req_get_task_item` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_get_task_reward` | — | 是/True | `GreetCardModel.req_get_task_reward` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_load` | — | 是/True | `GreetCardModel.initModel`、`GreetCardModel.req_load` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_load_count` | — | 是/True | `GreetCardModel.req_load_count` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_put_tags` | pos, id | 是/True | `GreetCardModel.req_put_tags` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_read_new` | — | 是/False | `GreetCardModel.req_read_new` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_send` | — | 是/True | `GreetCardModel.req_send` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_send_gift` | index, gift | 是/False | `GreetCardModel.req_send_gift` | P2：实现本地状态/规则及兼容响应 |
| `greetcard_stock` | — | 是/True | `GreetCardModel.req_stock` | P2：实现本地状态/规则及兼容响应 |
| `guest_accept_invit` | is_accept | 是/True | `DrawingModel.initModel`、`DrawingModel.request_accept_invit`、`DrawingModel.request_reject_invit` | P2：实现本地状态/规则及兼容响应 |
| `guest_confirm` | id | 是/False | `TravelModel.sendGuestConfirmed` | P2：实现本地状态/规则及兼容响应 |
| `guest_finish` | — | 是/False | `MainOutView.checkGameplay` | P2：实现本地状态/规则及兼容响应 |
| `guest_load` | — | 是/True | `TravelModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `guest_load_drawing` | — | 是/True | `DrawingModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `guest_lock_bag` | — | 是/True | `DrawingModel.lockBag`、`DrawingModel.unlockBag` | P2：实现本地状态/规则及兼容响应 |
| `guest_putin_bag` | pos, id | 是/True | `DrawingModel.changeItem`、`DrawingModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `guest_serve` | id, item_id | 是/False | `TravelModel.sendGuestServed` | P2：实现本地状态/规则及兼容响应 |
| `guest_set_expire_time` | time | 是/False | `MainOutView.checkFriend` | P2：实现本地状态/规则及兼容响应 |
| `guest_takeout_bag` | pos | 是/True | `DrawingModel.changeItem`、`DrawingModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `hall_enter_game` | — | 是/True | `NetworkControl.totalEvents`、`UserModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `hall_gen_token` | account | 是/True | `NetworkControl.totalEvents`、`UserModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `hall_hello` | — | 是/True | 未见直接调用/注册 | P0：实现本地状态/规则及兼容响应 |
| `hall_leave_game` | — | 是/False | 未见直接调用/注册 | P0：实现本地状态/规则及兼容响应 |
| `hall_login` | token | 是/True | `NetworkControl.totalEvents`、`UserModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `hall_reconnect` | token, account | 是/True | `UserModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `hall_report_remote_addr` | remote_addr, local_addr | 是/False | 未见直接调用/注册 | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `item_buy` | shop_id | 是/True | `ItemModel.initModel`、`t.buyItem` | P1：实现本地状态/规则及兼容响应 |
| `item_gacha` | is_reward | 是/True | `ItemModel.initModel`、`RaffleView.nextReward`、`RaffleView.raffle`、`RaffleView.reward_raffle` | P1：实现本地状态/规则及兼容响应 |
| `item_gift_open` | — | 回调额外发现 | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_load_handbook` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_load_items` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_load_select_gift` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_load_shop_info` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_putin_bag` | pos, item_id | 是/True | `ItemModel.setBagData` | P1：实现本地状态/规则及兼容响应 |
| `item_putin_desk` | pos, item_id | 是/True | `ItemModel.setDeskData` | P1：实现本地状态/规则及兼容响应 |
| `item_redeem_prize` | prize_id | 是/False | `PrizeSelector.selectItem`、`RaffleView.updateGachaColorBall` | P1：实现本地状态/规则及兼容响应 |
| `item_select_gift` | index_list | 是/True | `ItemModel.req_select_gift` | P1：实现本地状态/规则及兼容响应 |
| `item_set_bag_completed` | completed | 是/False | `ItemModel.setBagLock` | P1：实现本地状态/规则及兼容响应 |
| `item_takeout_bag` | pos | 是/True | `ItemModel.setBagData` | P1：实现本地状态/规则及兼容响应 |
| `item_takeout_desk` | pos | 是/True | `ItemModel.setDeskData` | P1：实现本地状态/规则及兼容响应 |
| `item_update` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_update_ticket` | — | 是/True | `ItemModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `item_use_gift_code` | gift_code | 是/True | `CdkeyView.totalTouchEvent` | P1：需单机替代策略/离线停用；保留已有权益与记录 |
| `koto_arrive` | — | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_dir_compass` | dir | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_get_items` | — | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_info` | — | 是/False | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_load` | — | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_load_path` | — | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_random_compass` | — | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_refresh` | — | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `koto_start_advance` | id | 是/True | 未见直接调用/注册 | P3：定义存在，未见直接发送/注册；确认版本用途后兼容 |
| `lottery_confirm_reward` | — | 是/True | `LotteryModel.req_confirm_reward` | P2：实现本地状态/规则及兼容响应 |
| `lottery_load` | — | 是/True | `LotteryModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `lottery_open` | — | 是/True | `LotteryModel.req_open` | P2：实现本地状态/规则及兼容响应 |
| `lottery_select` | list | 是/True | `LotteryModel.req_select` | P2：实现本地状态/规则及兼容响应 |
| `mail_ejoy_active_code` | ticket | 是/True | `TravelModel.initModel` | P1：需单机替代策略/离线停用；保留已有权益与记录 |
| `mail_load` | — | 是/True | `TravelModel.initModel`、`TravelModel.requestMail` | P1：实现本地状态/规则及兼容响应 |
| `mail_load_mails` | start, count, is_clear | 是/True | `TravelModel.initModel`、`TravelModel.mail_load_mails` | P1：实现本地状态/规则及兼容响应 |
| `mail_open` | id | 是/False | `TravelModel.openMailInfo` | P1：实现本地状态/规则及兼容响应 |
| `mail_read` | id | 是/False | `TravelModel.readMailInfo` | P1：实现本地状态/规则及兼容响应 |
| `misc_moment_load` | — | 是/True | `MomentModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `misc_moment_unlock` | id | 是/True | `MomentModel.req_unlock` | P2：实现本地状态/规则及兼容响应 |
| `museum_load` | — | 是/True | `MuseumModel.initModel`、`MuseumModel.requestMuseum` | P2：实现本地状态/规则及兼容响应 |
| `museumday_arrive` | — | 是/True | `MuseumDayModel.arrive`、`MuseumDayModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `museumday_dir_compass` | dir | 是/True | `MuseumDayModel.dirCompass` | P2：实现本地状态/规则及兼容响应 |
| `museumday_get_items` | — | 是/True | `MuseumDayModel.getItems` | P2：实现本地状态/规则及兼容响应 |
| `museumday_info` | — | 是/False | `MuseumDayModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `museumday_inspire` | — | 是/True | `MuseumDayModel.req_inspire` | P2：实现本地状态/规则及兼容响应 |
| `museumday_load` | — | 是/True | `MuseumDayModel.initModel`、`MuseumDayModel.request` | P2：实现本地状态/规则及兼容响应 |
| `museumday_load_path` | — | 是/True | 未见直接调用/注册 | P2：实现本地状态/规则及兼容响应 |
| `museumday_random_compass` | — | 是/True | `MuseumDayModel.randomCompass` | P2：实现本地状态/规则及兼容响应 |
| `museumday_refresh` | — | 是/True | `MuseumDayModel.refresh` | P2：实现本地状态/规则及兼容响应 |
| `museumday_start_advance` | id | 是/True | `MuseumDayModel.request_start_advance` | P2：实现本地状态/规则及兼容响应 |
| `notify_kick` | — | 回调额外发现 | `MessageModel (constructor)` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `notify_marquee` | — | 回调额外发现 | `MessageModel (constructor)` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `notify_new_event` | — | 回调额外发现 | `TravelModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `notify_new_mail` | — | 回调额外发现 | `TravelModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `notify_redmsg` | — | 回调额外发现 | `TravelModel.initModel` | P0：实现本地状态/规则及兼容响应 |
| `notify_reload` | — | 回调额外发现 | `UserModel.initModel` | P0：本地诊断/设置或明确停用；不复制远端运营机制 |
| `notify_reward` | — | 回调额外发现 | `MessageModel (constructor)` | P0：实现本地状态/规则及兼容响应 |
| `other_load_touch` | — | 回调额外发现 | `OtherModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `other_req_touch` | id | 是/True | `OtherModel.req_touch` | P2：实现本地状态/规则及兼容响应 |
| `partycake_answer` | index | 是/True | `PartyCakeModel.req_answer` | P2：实现本地状态/规则及兼容响应 |
| `partycake_get_mate` | — | 是/True | `PartyCakeModel.req_get_mate` | P2：实现本地状态/规则及兼容响应 |
| `partycake_light` | — | 是/True | `PartyCakeModel.req_light` | P2：实现本地状态/规则及兼容响应 |
| `partycake_load` | — | 是/True | `PartyCakeModel.initModel`、`PartyCakeModel.req_load` | P2：实现本地状态/规则及兼容响应 |
| `partycake_load_mate` | — | 是/True | `PartyCakeModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `partycake_load_qa` | — | 是/True | `PartyCakeModel.initModel`、`PartyCakeModel.req_load_qa` | P2：实现本地状态/规则及兼容响应 |
| `partycake_load_task` | — | 是/True | `PartyCakeModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `partycake_make` | layer | 是/True | `PartyCakeModel.req_make` | P2：实现本地状态/规则及兼容响应 |
| `partycake_reward_light` | — | 是/True | `PartyCakeModel.req_reward_light` | P2：实现本地状态/规则及兼容响应 |
| `partycake_reward_make` | — | 是/True | `PartyCakeModel.req_make_reward` | P2：实现本地状态/规则及兼容响应 |
| `partycake_reward_qa` | — | 是/True | `PartyCakeModel.req_reward_qa` | P2：实现本地状态/规则及兼容响应 |
| `partycake_reward_share` | index | 是/True | `PartyCakeModel.req_reward_share` | P2：实现本地状态/规则及兼容响应 |
| `pray_compose` | id | 是/True | `HandCraftModel.req_compose` | P2：实现本地状态/规则及兼容响应 |
| `pray_confirm_make_box` | — | 是/False | `HandCraftModel.confirm_make_box` | P2：实现本地状态/规则及兼容响应 |
| `pray_load_grays` | — | 是/True | `HandCraftModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `rank_get_intro` | type, duration, uid | 是/True | `RankingModel.getOtherInfo`、`RankingModel.initModel` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `rank_like` | type, duration, uid | 是/False | `RankingModel.setLike` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `rank_load` | type, duration, start, count | 是/True | `RankingModel.checkRankListInfo`、`RankingModel.initModel` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `recharge_cancel_pay` | id | 是/False | `RechargeModel.cancelPay` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `recharge_change` | — | 是/True | `RechargeModel.request_change` | P3：实现本地状态/规则及兼容响应 |
| `recharge_load` | — | 是/True | `RechargeModel.initModel` | P3：实现本地状态/规则及兼容响应 |
| `recharge_load_gift` | — | 是/True | `RechargeModel.initModel` | P3：实现本地状态/规则及兼容响应 |
| `recharge_ready_pay` | id | 是/True | 未见直接调用/注册 | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `recharge_update_num` | — | 是/True | `RechargeModel.initModel` | P3：实现本地状态/规则及兼容响应 |
| `recharge_water` | — | 是/True | `RechargeModel.request_water` | P3：实现本地状态/规则及兼容响应 |
| `share_get_reward` | id, is_get | 是/True | `ShareModel.req_get_reward` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `share_load` | — | 是/True | `ShareModel.initModel` | P3：需单机替代策略/离线停用；保留已有权益与记录 |
| `springcard_buy` | — | 是/True | `SpringCardModel.req_buy` | P2：实现本地状态/规则及兼容响应 |
| `springcard_change_bg` | id | 是/True | `SpringCardModel.req_change_bg` | P2：实现本地状态/规则及兼容响应 |
| `springcard_change_bless` | id | 是/True | `SpringCardModel.req_change_bless` | P2：实现本地状态/规则及兼容响应 |
| `springcard_get_reward` | — | 是/True | `SpringCardModel.req_get_reward` | P2：实现本地状态/规则及兼容响应 |
| `springcard_get_share_tags` | share_code | 是/True | `SpringCardModel.req_get_share_tags` | P2：需单机替代策略/离线停用；保留已有权益与记录 |
| `springcard_get_task_item` | — | 是/True | 未见直接调用/注册 | P2：实现本地状态/规则及兼容响应 |
| `springcard_get_task_reward` | — | 是/True | `SpringCardModel.req_get_task_reward` | P2：实现本地状态/规则及兼容响应 |
| `springcard_load` | — | 是/True | `SpringCardModel.initModel`、`SpringCardModel.req_load` | P2：实现本地状态/规则及兼容响应 |
| `springcard_load_count` | — | 是/True | `SpringCardModel.req_load_count` | P2：实现本地状态/规则及兼容响应 |
| `springcard_load_task_item` | — | 回调额外发现 | `SpringCardModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `springcard_put_tags` | pos, id | 是/True | `SpringCardModel.req_put_tags` | P2：实现本地状态/规则及兼容响应 |
| `springcard_send` | — | 是/True | `SpringCardModel.req_send` | P2：实现本地状态/规则及兼容响应 |
| `springcard_share_tags` | tags_id | 是/True | `SpringCardModel.req_share_tags` | P2：需单机替代策略/离线停用；保留已有权益与记录 |
| `story_feedback_gift` | id | 是/False | `MailItemView.acceptTouchEvents` | P2：实现本地状态/规则及兼容响应 |
| `story_load` | — | 是/True | `StoryModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `story_read_new_story` | — | 是/False | `StoryModel.readNewStory` | P2：实现本地状态/规则及兼容响应 |
| `story_send_gift` | id, gift | 是/False | `StoryModel.sendGift` | P2：实现本地状态/规则及兼容响应 |
| `task_client_pro` | param | 是/False | `GuideTaskModel.req_client_pro` | P1：实现本地状态/规则及兼容响应 |
| `task_get_list_reward` | id | 是/True | `GuideTaskModel.req_list_reward` | P1：实现本地状态/规则及兼容响应 |
| `task_get_reward` | id | 是/True | `GuideTaskModel.request_reward` | P1：实现本地状态/规则及兼容响应 |
| `task_load` | — | 是/True | `GuideTaskModel.initModel`、`GuideTaskViewControl.open` | P1：实现本地状态/规则及兼容响应 |
| `task_load_list` | — | 是/True | `GuideTaskModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `travel_album_to_gift` | picture_id | 是/True | `TravelModel.putPicturesToGiftBox` | P2：实现本地状态/规则及兼容响应 |
| `travel_bag_to_gift` | item_id | 是/True | `ItemModel.moveItemToGiftBox` | P2：实现本地状态/规则及兼容响应 |
| `travel_gift_delete_album` | id | 是/True | `GiftBoxModel.delete_album` | P2：实现本地状态/规则及兼容响应 |
| `travel_gift_to_album` | picture_id | 是/True | `GiftBoxModel.gift_to_album` | P2：实现本地状态/规则及兼容响应 |
| `travel_gift_to_bag` | item_id | 是/True | `GiftBoxModel.gift_to_bag` | P2：实现本地状态/规则及兼容响应 |
| `travel_load_gift` | — | 是/True | `GiftBoxModel.initModel`、`GiftBoxModel.requestData` | P2：实现本地状态/规则及兼容响应 |
| `travel_load_note` | — | 是/True | `TravelNoteModel.initModel`、`TravelNoteModel.loadNote` | P2：实现本地状态/规则及兼容响应 |
| `travel_read_note` | id | 是/False | `TravelNoteModel.sendReadNote` | P2：实现本地状态/规则及兼容响应 |
| `tutorial_step_ask_award` | — | 是/False | `MainOutView.checkGuide` | P0：实现本地状态/规则及兼容响应 |
| `tutorial_step_ask_award_q` | — | 是/True | `MainOutView.checkGuide` | P0：实现本地状态/规则及兼容响应 |
| `tutorial_step_open_door` | — | 是/False | `MainOutView.checkGuide` | P0：实现本地状态/规则及兼容响应 |
| `tutorial_step_open_door_q` | — | 是/True | `MainOutView.checkGuide` | P0：实现本地状态/规则及兼容响应 |
| `visit_load` | — | 是/True | `VisitorModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `visit_open` | — | 是/False | `VisitorModel.open` | P2：实现本地状态/规则及兼容响应 |
| `visit_set_carpet` | id | 是/False | `VisitorModel.visit_load` | P2：实现本地状态/规则及兼容响应 |
| `visit_set_expire_time` | time | 是/False | `MainOutView.updateVisitor` | P2：实现本地状态/规则及兼容响应 |
| `weather_load` | — | 回调额外发现 | `WeatherModel.initModel` | P1：实现本地状态/规则及兼容响应 |
| `wishingpool_load` | — | 是/True | `WishingPoolModel.initModel` | P2：实现本地状态/规则及兼容响应 |
| `wishingpool_wish` | — | 是/True | `WishingPoolModel.req_wish` | P2：实现本地状态/规则及兼容响应 |

# 定时事件类型

包括 NONE 占位符；这些是客户端消费的事件类型，不是已实现的本地调度任务。

| 数值 | 类型 |
|---|---|
| 0 | `NONE` |
| 1 | `GoTravel` |
| 2 | `BackHome` |
| 3 | `Picture` |
| 4 | `Drift` |
| 5 | `Return` |
| 6 | `Guest` |
| 7 | `Gift` |
| 8 | `Story` |
| 9 | `StoryGift` |
| 10 | `StoryFeedback` |
| 11 | `Visitor` |
| 12 | `Recharge` |
| 13 | `Decoration` |
| 14 | `AntiAddition` |
| 15 | `NewNote` |
| 16 | `VisitFriend` |
| 17 | `DropReward` |
| 18 | `Consume` |
| 19 | `DriftBottle` |
| 20 | `MuseumMiss` |
| 21 | `FurnitureFinish` |
| 22 | `FurniturePut` |
| 23 | `PartyGo` |
| 24 | `PartyResult` |
| 25 | `CardGift` |
| 26 | `CardFeedback` |
| 27 | `CardNew` |
| 1022 | `FurnitureVersion` |
| 1023 | `AunnalReview` |
