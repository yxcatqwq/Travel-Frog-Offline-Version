# 注册模型与存档审计索引

成员名是静态观察结果，包含缓存、UI/计时器引用及继承方法；不能直接全部序列化。确切持久化字段须依据加载回调与业务规则筛选。

## EncyModel

源码节选：`source-excerpts.txt` 第 5 行；原文件字符偏移 15364。

注册回调：`encyclopedia_load`

观察到的成员：`addProtocolCallback`、`data`

方法：`initModel`、`encyclopedia_load`、`req_set_show_sub`、`isOpen`、`isDescUnlock`

## NetworkModel

源码节选：`source-excerpts.txt` 第 19 行；原文件字符偏移 22726。

注册回调：无

观察到的成员：

方法：

## RankingModel

源码节选：`source-excerpts.txt` 第 23 行；原文件字符偏移 68928。

注册回调：`rank_get_intro`、`rank_load`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`loadRankCount`、`loadingRankDataCount`、`playerOtherInfoList`、`rankInfoList`

方法：`destroy`、`initModel`、`clearData`、`loadingRankDataComplete`、`getRankAllInfo`、`checkRankListInfo`、`getOtherInfo`、`getPlayerInfo`、`setLike`、`getStepDescribe`、`rank_load`、`rank_get_intro`

## ActivityModel

源码节选：`source-excerpts.txt` 第 51 行；原文件字符偏移 72096。

注册回调：无

观察到的成员：`activityMap`

方法：`addActivity`、`getActivity`

## AdsModel

源码节选：`source-excerpts.txt` 第 59 行；原文件字符偏移 72751。

注册回调：`adsmgr_ads_notify`、`adsmgr_load`

观察到的成员：`addProtocolCallback`、`adsPlaces`、`data`、`getModel`、`isFreshed`、`isFreshing`、`isFrogBack`、`is_try_to_play`

方法：`destroy`、`initModel`、`clearData`、`adsmgr_load`、`adsmgr_ads_notify`、`req_share`、`req_refuse`、`share_ads`、`req_shop_free`、`on_get_gift`、`can_get_gift`、`getGiftLeftTime`、`canPopAds`、`canBannerAds`、`FrogBack`、`isValidAds`、`getAdsPlace`、`takeAdsPlace`、`playAds`、`promptNewAds`、`doPlayAds`、`loadToPlay`、`refresh_status`、`loadAds`

## AnimPictureModel

源码节选：`source-excerpts.txt` 第 111 行；原文件字符偏移 79408。

注册回调：`animpicture_load`

观察到的成员：`addProtocolCallback`、`data`、`getModel`

方法：`initModel`、`animpicture_load`、`req_guide`、`req_get_item`、`req_select_pic`、`req_add_pic`、`req_remove_pic`、`req_open_album`、`req_album_add_pic`、`req_album_remove_pic`、`req_use_item`、`getShowPageIndex`、`getMaxShowPage`

## AnnualReviewModel

源码节选：`source-excerpts.txt` 第 141 行；原文件字符偏移 84094。

注册回调：无

观察到的成员：`cacheData`

方法：`request`、`updateRedot`

## CalendarModel

源码节选：`source-excerpts.txt` 第 149 行；原文件字符偏移 84623。

注册回调：`calendar_load`、`calendar_load_note`、`calendar_task_update`

观察到的成员：`addProtocolCallback`、`data`、`getModel`

方法：`initModel`、`calendar_load`、`calendar_load_note`、`calendar_task_update`、`req_beginer_reward`、`req_code_reward`、`req_st_reward`、`req_luck_reward`、`checkRedot`、`canShowMainOutBtn`、`canGetBeginnerReward`、`canGetStReward`、`canGetLuckyReward`、`getMonthFirstWeek`、`getMonthMaxDay`、`checkBeginnerCode`

## CapsuleModel

源码节选：`source-excerpts.txt` 第 185 行；原文件字符偏移 89273。

注册回调：`capsule_load`、`capsule_load_coin`、`capsule_load_task`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`timerActivity`

方法：`initModel`、`capsule_load`、`capsule_load_coin`、`capsule_load_task`、`req_load`、`req_twist`、`req_patch`、`req_fast_task`、`req_get_coin`、`checkRedot`、`getActivityTime`、`isOpen`、`closeActivity`

## CookingModel

源码节选：`source-excerpts.txt` 第 215 行；原文件字符偏移 92560。

注册回调：`cooking_load_cooking`、`cooking_task_update`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`flag_updateRedot`、`getModel`、`serverData`

方法：`initModel`、`request`、`getTaskList`、`getWeek`、`getMonth`、`getSelectMonth`、`getRefreshTime`、`getMonthProgress`、`getMonthComplete`、`getMonthTheme`、`getCookingActivity`、`updateRedot`、`requestCookRefresh`、`requestCookReward`、`requestStartCooking`、`cooking_load_cooking`、`cooking_task_update`、`selectTheme`、`invalidateRedot`

## DrawingModel

源码节选：`source-excerpts.txt` 第 257 行；原文件字符偏移 96183。

注册回调：`guest_accept_invit`、`guest_load_drawing`、`guest_putin_bag`、`guest_takeout_bag`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`getModel`

方法：`initModel`、`request_accept_invit`、`request_reject_invit`、`guest_load_drawing`、`guest_accept_invit`、`changeItem`、`lockBag`、`unlockBag`、`isOpen`、`guest_takeout_bag`、`guest_putin_bag`

## EasterEggModel

源码节选：`source-excerpts.txt` 第 283 行；原文件字符偏移 98712。

注册回调：`easteregg_load`

观察到的成员：`addProtocolCallback`、`data`

方法：`initModel`、`easteregg_load`、`hasEgg`、`hasFrogEgg`

## EncyTravelModel

源码节选：`source-excerpts.txt` 第 295 行；原文件字符偏移 102458。

注册回调：`encytravel_load`

观察到的成员：`addProtocolCallback`、`data`

方法：`initModel`、`encytravel_load`、`req_set_show_sub`、`isOpen`、`isDescUnlock`

## FurnitureModel

源码节选：`source-excerpts.txt` 第 309 行；原文件字符偏移 103566。

注册回调：`furniture_buy_shop`、`furniture_load_compost`、`furniture_load_flowerpot`、`furniture_load_furniture`、`furniture_load_pocket`、`furniture_load_tumbler`、`furniture_putin_bench`、`furniture_takeout_bench`

观察到的成员：`addProtocolCallback`、`compostData`、`dispatchEvent`、`flagloadFurnitureRes`、`flowerpotData`、`getModel`、`pocketData`、`replaceData`、`serverData`、`timerShopClose`、`tumblerData`

方法：`initModel`、`requestBuy`、`furniture_load_tumbler`、`furniture_load_compost`、`furniture_load_pocket`、`furniture_load_flowerpot`、`furniture_load_furniture`、`loadFurnitureRes`、`furniture_buy_shop`、`furniture_putin_bench`、`furniture_takeout_bench`、`getOwnedFurnitures`、`getHomeFurnitures`、`getHomeFurniture`、`hasPutHomeFurniture`、`getBenchTools`、`setBenchTool`、`getBenchItems`、`setBenchItem`、`resetReplaceData`、`replaceFurniture`、`updateRedot`、`updatePocketRedot`、`setCompostItem`、`request_pocket_get`、`req_flowerpot_harvest`、`getMateList`、`getShopData`、`isLockBench`、`isOpen`、`isOpenShop`、`getReplaced`

## GameplayModel

源码节选：`source-excerpts.txt` 第 377 行；原文件字符偏移 115416。

注册回调：无

观察到的成员：`getModel`

方法：`destroy`、`initModel`、`clearData`、`getGameplayInfo`、`getGameplayList`

## GiftBoxModel

源码节选：`source-excerpts.txt` 第 391 行；原文件字符偏移 116530。

注册回调：`travel_load_gift`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`getModel`、`isOpenCache`、`pictureList`、`specialityList`

方法：`destroy`、`initModel`、`requestData`、`delete_album`、`onMovePicture`、`onMoveItem`、`gift_to_bag`、`gift_to_album`、`getSpecialtyList`、`getPictureList`、`isOpen`、`travel_load_gift`

## GreetCardModel

源码节选：`source-excerpts.txt` 第 419 行；原文件字符偏移 120648。

注册回调：`greetcard_get_task_item`、`greetcard_load`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`timerActivity`

方法：`initModel`、`greetcard_load`、`greetcard_get_task_item`、`req_load`、`req_load_count`、`req_buy`、`req_change_bg`、`req_change_bless`、`req_put_tags`、`req_send`、`req_get_reward`、`req_get_task_item`、`req_get_task_reward`、`req_stock`、`req_read_new`、`req_send_gift`、`checkRedot`、`changeItems`、`getActivityTime`、`isOpen`、`isFirstBuyBg`、`isBuyBg`、`getCanStockNum`、`canStock`、`isSendBg`、`getItemNum`、`getTagsNum`、`canSendCardid`、`getNewCard`、`closeActivity`

## GuideTaskModel

源码节选：`source-excerpts.txt` 第 483 行；原文件字符偏移 127984。

注册回调：`task_load`、`task_load_list`

观察到的成员：`addProtocolCallback`、`data`、`dataList`、`dataReward`、`dispatchEvent`、`redotMap`

方法：`initModel`、`getNextListReward`、`getCompleteListNum`、`request_reward`、`task_load`、`task_load_list`、`req_list_reward`、`req_client_pro`、`updateRedot`

## HandCraftModel

源码节选：`source-excerpts.txt` 第 505 行；原文件字符偏移 130869。

注册回调：`pray_load_grays`

观察到的成员：`addProtocolCallback`、`boxCraftList`、`getModel`、`makingPrayCraftConfirmed`、`makingPraycraft`、`makingStampCraftConfirmed`、`makingStampcraft`、`prayCraftList`、`stampCraftList`

方法：`initModel`、`loadPrayCraftList`、`loadStampCraftList`、`onNewStampCraft`、`comfrimNewStampCraft`、`getMakingPrayCraft`、`getMakingStampCraft`、`getBoxCraft`、`onNewPrayCraft`、`comfrimNewPrayCraft`、`getPrayCraftList`、`getStampCraftList`、`updateRedot`、`updateComposeRedot`、`pray_load_grays`、`confirm_make_box`、`req_compose`

## ItemModel

源码节选：`source-excerpts.txt` 第 543 行；原文件字符偏移 134242。

注册回调：`clover_notice_get`、`clover_update`、`item_buy`、`item_gacha`、`item_gift_open`、`item_load_handbook`、`item_load_items`、`item_load_select_gift`、`item_load_shop_info`、`item_update`、`item_update_ticket`

观察到的成员：`addProtocolCallback`、`bagConflict`、`bagDataList`、`bagLock`、`collectionsList`、`deskConflict`、`deskDataList`、`dispatchEvent`、`gachaColorBall`、`getModel`、`itemDataAll`、`itemDataList`、`purchasedMap`、`selectGiftList`、`specialtysList`

方法：`destroy`、`initModel`、`clearData`、`getCollectionsList`、`getSpecialtysList`、`setBagData`、`getBagDataList`、`setDeskData`、`getDeskDataList`、`getGachaColorBall`、`cleanGachaColorBall`、`hasDeskItem`、`hasBagItem`、`getHouseItemCount`、`getHouseDataAll`、`getHouseList`、`getHouseTypeList`、`getHouseItemsByType`、`checkHouseItem`、`checkHaveItem`、`getHaveItem`、`getShopItemBuynums`、`isShopItemBuyLimit`、`addHouseItem`、`doAddHouseItem`、`consumeHouseItem`、`doConsumeHouseItem`、`moveItemToGiftBox`、`getItemInfo`、`getBagLock`、`setBagLock`、`getInventory`、`item_load_shop_info`、`item_update_ticket`、`clover_update`、`clover_notice_get`、`item_update`、`item_gift_open`、`item_load_select_gift`、`check_select_gift`、`req_select_gift`、`item_load_items`、`item_load_handbook`、`item_gacha`、`item_buy`、`decodeDropArr`

## LotteryModel

源码节选：`source-excerpts.txt` 第 639 行；原文件字符偏移 146552。

注册回调：`lottery_load`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`

方法：`initModel`、`lottery_load`、`req_open`、`req_select`、`req_confirm_reward`、`isRewardState`、`onGetExtraItem`、`getLeftTime`

## MessageModel

源码节选：`source-excerpts.txt` 第 659 行；原文件字符偏移 148972。

注册回调：`client_gm`、`notify_kick`、`notify_marquee`、`notify_reward`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`errorInfoList`、`massegeList`

方法：`destroy`、`initModel`、`clearData`、`getFirstMessageInfo`、`getErrorInfo`、`notify_marquee`、`notify_kick`、`client_gm`、`notify_reward`

## MomentModel

源码节选：`source-excerpts.txt` 第 681 行；原文件字符偏移 150361。

注册回调：`misc_moment_load`

观察到的成员：`addProtocolCallback`、`data`

方法：`initModel`、`misc_moment_load`、`req_unlock`、`hasMoment`

## MuseumDayModel

源码节选：`source-excerpts.txt` 第 693 行；原文件字符偏移 151016。

注册回调：`museumday_arrive`、`museumday_info`、`museumday_load`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`getModel`、`hasExploreEmail`、`timerActivity`

方法：`initModel`、`museumday_arrive`、`museumday_info`、`museumday_load`、`closeActivity`、`request`、`request_start_advance`、`getItems`、`refresh`、`arrive`、`setEmail`、`randomCompass`、`dirCompass`、`req_inspire`、`getActivityTime`、`isOpen`、`canInspire`、`checkRedot`

## MuseumModel

源码节选：`source-excerpts.txt` 第 733 行；原文件字符偏移 156308。

注册回调：`museum_load`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`museum_list`

方法：`initModel`、`requestMuseum`、`museum_load`

## NoticeModel

源码节选：`source-excerpts.txt` 第 743 行；原文件字符偏移 156951。

注册回调：`client_load_publicity`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`getModel`、`notices`、`publicityMaps`、`publicityReward`

方法：`initModel`、`addAnns`、`checkRedot`、`readNotice`、`isReadNotice`、`getNotices`、`checkPublicityRedot`、`addPublicityMaps`、`canPublicityPop`、`getPublicityMaps`、`getPublicityReward`、`canShowPublicityMap`、`client_load_publicity`、`req_share_publicity`

## OtherModel

源码节选：`source-excerpts.txt` 第 775 行；原文件字符偏移 160029。

注册回调：`other_load_touch`

观察到的成员：`addProtocolCallback`、`data`

方法：`initModel`、`other_load_touch`、`req_touch`

## PartyCakeModel

源码节选：`source-excerpts.txt` 第 785 行；原文件字符偏移 160773。

注册回调：`partycake_load`、`partycake_load_mate`、`partycake_load_qa`、`partycake_load_task`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`timerActivity`

方法：`initModel`、`partycake_load`、`partycake_load_mate`、`partycake_load_task`、`partycake_load_qa`、`req_load`、`req_load_qa`、`req_get_mate`、`req_make`、`req_make_reward`、`req_answer`、`req_reward_qa`、`req_light`、`req_reward_light`、`req_reward_share`、`checkMakePart`、`isMakeLayer`、`checkRedot`、`getActivityTime`、`isOpen`、`closeActivity`

## RechargeModel

源码节选：`source-excerpts.txt` 第 831 行；原文件字符偏移 166617。

注册回调：`recharge_load`、`recharge_load_gift`、`recharge_update_num`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`giftCache`、`giftData`、`merchData`、`readyPayId`

方法：`initModel`、`pay`、`cancelPay`、`request_water`、`request_change`、`recharge_load_gift`、`recharge_load`、`recharge_reset`、`recharge_update_num`、`hasGift`、`onBuy`、`setMerchData`

## RoleModel

源码节选：`source-excerpts.txt` 第 859 行；原文件字符偏移 169548。

注册回调：`client_load_decorate`、`client_notice`、`clover_load_clovers`

观察到的成员：`achieveList`、`achieveTime`、`addProtocolCallback`、`cloverGrowList`、`decorationList`、`decorationPutID`、`decorationStatus`、`dispatchEvent`、`frogMotion`、`frogStatus`、`getModel`、`harvestCloverList`、`iconID`、`name`、`pictureInfo`、`taobaoData`、`timerHarvestResend`、`todayStep`、`useAchieveID`、`wxMyReward`

方法：`destroy`、`initModel`、`clearData`、`client_notice`、`setName`、`getName`、`getNameEncode`、`setUseAchieveID`、`getUseAchieveID`、`getAchieveList`、`getAchieveTime`、`isAchieveExpire`、`getFrogStatus`、`getFrogMotion`、`isFrogSleep`、`canShowMini`、`getCloverGrowList`、`harvestClover`、`syncCookieHarvestClover`、`syncHarvestClover`、`getIconID`、`setIconID`、`getTodayStep`、`getPictureInfo`、`setPictureID`、`getAchieveInfo`、`getAchieveInfoList`、`getDecorationList`、`drawTaobaoData`、`getDecorationInfo`、`getCreateDay`、`client_load_role`、`client_load_decorate`、`clover_load_clovers`、`changeDecoration`

## ShareModel

源码节选：`source-excerpts.txt` 第 933 行；原文件字符偏移 177449。

注册回调：`share_load`

观察到的成员：`addProtocolCallback`、`isRefresh`、`rewardData`、`supportPlatforms`

方法：`destroy`、`initModel`、`share_load`、`req_get_reward`、`GetShareReward`、`clearData`、`refresh_support`、`isSupport`、`quickShare`、`getUnionShareStr`、`share`、`reportJF`、`reportBlog`

## SpringCardModel

源码节选：`source-excerpts.txt` 第 963 行；原文件字符偏移 182003。

注册回调：`springcard_load`、`springcard_load_task_item`

观察到的成员：`addProtocolCallback`、`data`、`dispatchEvent`、`timerActivity`

方法：`initModel`、`springcard_load`、`springcard_load_task_item`、`req_load`、`req_load_count`、`req_get_task_reward`、`req_buy`、`req_change_bg`、`req_change_bless`、`req_put_tags`、`req_send`、`req_get_reward`、`req_share_tags`、`req_get_share_tags`、`checkRedot`、`changeItems`、`getActivityTime`、`isOpen`、`getItemNum`、`getTagsNum`、`canSendCardid`、`closeActivity`

## StoryModel

源码节选：`source-excerpts.txt` 第 1011 行；原文件字符偏移 189947。

注册回调：`story_load`

观察到的成员：`addProtocolCallback`、`getModel`、`newStoryID`、`storyList`

方法：`destroy`、`initModel`、`clearData`、`readNewStory`、`getNewStoryID`、`getStoryData`、`getStoryList`、`getStoryInfo`、`sendGift`、`story_load`

## TravelModel

源码节选：`source-excerpts.txt` 第 1035 行；原文件字符偏移 192719。

注册回调：`album_load`、`album_load_all`、`album_load_by_id_list`、`album_load_new`、`album_load_recover`、`client_load_events`、`guest_load`、`mail_ejoy_active_code`、`mail_load`、`mail_load_mails`、`notify_new_event`、`notify_new_mail`、`notify_redmsg`

观察到的成员：`addProtocolCallback`、`deletePictureInfoList`、`dispatchEvent`、`eventUpdateNewAlbum`、`getModel`、`guestData`、`hasAds`、`isShare`、`mailInfoList`、`newAdsPictureInfoList`、`newPictureIDs`、`newPictureInfoList`、`pictureCount`、`pictureInfoList`、`redpointState`、`travelEventList`

方法：`destroy`、`initModel`、`clearData`、`getTravelEventList`、`getFirstTravelEvent`、`createTravelEvent`、`pushTravelEvent`、`pushNewPictureIDs`、`readTraveEvents`、`getGuestData`、`sendGuestConfirmed`、`sendGuestServed`、`requestAlbum`、`getPictureCount`、`setPictureCount`、`getPictureInfoList`、`getDeletePictureInfoList`、`getPictureByPicId`、`getPictureById`、`getFullPictures`、`checkPictureByIds`、`checkPictureLastes`、`checkPictureInfoPage`、`deletePictureInfo`、`putPicturesToGiftBox`、`handleAdsPicture`、`handleSharePicture`、`getFirstNewPictureInfo`、`getFirstVisitPictureInfo`、`getFirstNewAdsPictureInfo`、`deleteAllAdsPicture`、`getAllAdsPicture`、`saveNewPictureInfo`、`deleteNewPictureInfo`、`recoverPictureInfo`、`requestMail`、`getMailInfoList`、`getMailStage`、`openMailInfo`、`readMailInfo`、`checkMailItemType`、`getRedpointState`、`openActivityShop`、`filtrateEvent`、`client_load_events`、`guest_load`、`album_load`、`album_load_all`、`album_load_by_id_list`、`revice_mails`、`mail_load`、`mail_load_mails`、`mail_ejoy_active_code`、`album_load_new`、`album_load_recover`、`saveNewPictureNow`、`notify_new_event`、`notify_redmsg`、`notify_new_mail`

## TravelNoteModel

源码节选：`source-excerpts.txt` 第 1157 行；原文件字符偏移 207913。

注册回调：`travel_load_note`

观察到的成员：`addProtocolCallback`、`dispatchEvent`、`noteCountMax`、`travelNodeList`

方法：`destroy`、`initModel`、`loadNote`、`getNoteList`、`getNoteListByType`、`getNoteMaxByType`、`getNoteNumsByType`、`getAttachNote`、`getNoteById`、`getNoteConfig`、`sendReadNote`、`hasUnreadNote`、`updateRedot`、`isOpen`、`travel_load_note`

## UserModel

源码节选：`source-excerpts.txt` 第 1195 行；原文件字符偏移 211446。

注册回调：`client_hello`、`client_load_role`、`hall_enter_game`、`hall_gen_token`、`hall_login`、`hall_reconnect`、`notify_reload`

观察到的成员：`account`、`activateExitBtn`、`addProtocolCallback`、`ch`、`clientSettings`、`clover`、`dispatchEvent`、`ejoy_token`、`getModel`、`guideStepNameList`、`isBagayalu`、`moment_token`、`moment_token_signature`、`push_switch`、`rank_switch`、`showActiveShop`、`showGM`、`showPay`、`showShareBtn`、`subCh`、`sub_clover`、`syncSettingsIndex`、`ticket`、`token`、`tokenExpireTime`、`uid`、`userInfo`

方法：`destroy`、`initModel`、`clearData`、`setBagayalu`、`getNextGuideStep`、`getActivateExitBtn`、`getShowGM`、`getShowPay`、`getShowActiveShop`、`getShowShareBtn`、`getChannel`、`getSubChannel`、`getUserInfo`、`setUserInfo`、`getUName`、`getToken`、`getAccount`、`setToken`、`isTokenExpire`、`setMometToken`、`set_moment_token_signature`、`set_ejoytoken`、`get_ejoytoken`、`getMomentInfo`、`getMomentToken`、`getUID`、`getClover`、`addClover`、`setClover`、`checkClover`、`consumeClover`、`subClover`、`AddCloverTween`、`getTicket`、`addTicket`、`setTicket`、`consumeTicket`、`setClientSettings`、`getClientSettings`、`setPushSwitch`、`getPushSwitch`、`setRankSwitch`、`getRankSwitch`、`client_hello`、`hall_gen_token`、`hall_login`、`hall_reconnect`、`hall_enter_game`、`client_load_role`、`notify_reload`

## VisitorModel

源码节选：`source-excerpts.txt` 第 1299 行；原文件字符偏移 219728。

注册回调：`visit_load`

观察到的成员：`acquireList`、`addProtocolCallback`、`dispatchEvent`、`getModel`、`visitorData`

方法：`destroy`、`initModel`、`clearData`、`getVisitorData`、`getAcquireList`、`getVisitorInfoList`、`getVisitorInfo`、`getVisitorResInfo`、`open`、`visit_load`

## WeatherModel

源码节选：`source-excerpts.txt` 第 1323 行；原文件字符偏移 221789。

注册回调：`weather_load`

观察到的成员：`addProtocolCallback`、`data`、`getModel`

方法：`initModel`、`weather_load`、`getSeasonKey`、`getSeasonCover`、`getSeasonPartical`、`getSeasonSpine`

## WishingPoolModel

源码节选：`source-excerpts.txt` 第 1339 行；原文件字符偏移 223328。

注册回调：`wishingpool_load`

观察到的成员：`addProtocolCallback`、`data`

方法：`initModel`、`wishingpool_load`、`req_wish`、`isOpen`、`getLeftTime`
