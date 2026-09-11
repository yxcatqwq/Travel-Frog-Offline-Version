    /* ------------------------------------------------------------------
     * 99 启动：脚本加载即安装本地服务
     * ------------------------------------------------------------------ */
    if (typeof core !== "undefined" && core.SocketManage) {
        boot.autoInstall();
    } else {
        /* main.min.js 尚未执行完（理论上不会发生）：等 DOMContentLoaded 后重试 */
        if (global.document && global.document.addEventListener) {
            global.document.addEventListener("DOMContentLoaded", function () {
                boot.autoInstall();
            });
        } else {
            boot.autoInstall();
        }
    }

    /* 对外暴露诊断/验收入口（只读 + 显式确认的破坏性操作） */
    LF.status = LF.diagStatus;
    LF.save = LF.diagSaveText;
    LF.import = LF.diagImportSave;
    LF.timeTravel = LF.diagTimeTravel;
    LF.unsupported = LF.diagUnsupported;
    LF.logs = LF.diagLogs;
    LF.reset = LF.diagReset;
    LF.checkNewSave = function () {
        return template.checkNewSave();
    };
    LF.connectDiagnostics = function (endpoint) {
        remote.start(endpoint);
    };

    LF.info("本地服务脚本已加载 v" + LF.VERSION);
})(typeof window !== "undefined" ? window : this);

/* 验收构建：启用远程诊断桥 */
(function () { if (window.LocalFrog) { window.LocalFrog.connectDiagnostics("http://10.0.2.2:8799"); } })();

/* 验收构建：启用设备文件状态快照 */
(function () { if (window.LocalFrog) { window.LocalFrog.flags.diagFile = true; } })();
