# 旅行青蛙单机版

这是一个将《旅行青蛙》客户端改造成离线可玩的本地服务版本的工程。服务层拦截原客户端协议，在本地完成状态读取、结算、调度和持久化，并为在线账号快照导入预留版本化格式。

## 当前内容

- 本地存档：事务提交、校验、备份恢复、版本迁移和失败回滚。
- 基础玩法：草田、钱包、背包、桌面、家具商人、工作台、堆肥箱、花盆、天气和调度器。
- 旅行闭环：准备行李、出发、离线到达、事件确认、奖励、照片礼物盒。
- 相册：初始 30 页，每页 6 张；商店逐页扩容，最多额外 56 页；回收站 6 格。
- 邮件、任务、日历任务、成就和本地访客状态。
- 存档导出、SHA-256 校验、提取及通过诊断桥导入。

## 构建和测试

在 Windows PowerShell 中运行：

```powershell
node --test tools/test-local-service.cjs
python tools/build-local-service.py --diag-endpoint http://10.0.2.2:8799 --diag-file
```

构建脚本需要一个原始客户端 APK 作为输入，默认路径为 `offline_build/travel_frog_local_native.apk`。原始 APK 和解包资源不纳入 Git；可通过项目约定的本地资源目录提供，或使用已有最终 APK 进行验收。

启动诊断桥：

```powershell
python tools/diag-server.py --port 8799
```

安装最终包：

```powershell
$adb=(Resolve-Path tools/android-sdk/platform-tools/adb.exe).Path
& $adb install -r offline_build/travel_frog_local_service.apk
```

## 存档迁移

```powershell
python tools/save-transfer.py export account-export.json
python tools/save-transfer.py verify account-export.json
python tools/save-transfer.py import account-export.json
```

机制依据和仍待确认的规则记录在 [docs/M2待确认游戏机制.md](docs/M2待确认游戏机制.md)，实现进度记录在 [docs/当前实现状态.md](docs/当前实现状态.md)。
