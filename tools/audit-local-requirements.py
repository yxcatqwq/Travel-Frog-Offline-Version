"""Inventory the bundled client's server dependencies without running the game.

Python 3.7+, standard library only. This is a static inventory, not a response
schema decoder or an implementation of the original server.
"""
import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
GROUPS = {
    "client": ("基础状态/设置/事件", "P0"),
    "hall": ("本地会话与启动", "P0"),
    "clover": ("三叶草与生长", "P1"),
    "item": ("库存/行囊/桌子/商店/抽奖", "P1"),
    "guest": ("来客/绘本邀请", "P2"),
    "album": ("照片与相册", "P1"),
    "mail": ("邮件与附件", "P1"),
    "story": ("朋友故事", "P2"),
    "tutorial": ("新手初始化", "P0"),
    "visit": ("来访与接待", "P2"),
    "rank": ("排行榜/他人资料", "P3"),
    "travel": ("礼品盒/旅行手账", "P2"),
    "pray": ("祈福/手作/合成", "P2"),
    "cooking": ("料理", "P2"),
    "museum": ("博物馆", "P2"),
    "furniture": ("家具/工作台/庭院设施", "P1"),
    "annual": ("年度回顾", "P3"),
    "museumday": ("博物馆主题探索", "P2"),
    "koto": ("koto 兼容接口（未见直接调用）", "P3"),
    "recharge": ("付费权益/水与兑换", "P3"),
    "task": ("任务与里程碑", "P1"),
    "greetcard": ("贺卡", "P2"),
    "capsule": ("扭蛋活动", "P2"),
    "share": ("分享奖励", "P3"),
    "partycake": ("庆典蛋糕", "P2"),
    "springcard": ("新春贺卡", "P2"),
    "adsmgr": ("广告与奖励", "P3"),
    "encyclopedia": ("百科图鉴", "P2"),
    "encytravel": ("旅行图鉴", "P2"),
    "lottery": ("选取式抽奖", "P2"),
    "calendar": ("日历与签到", "P2"),
    "misc": ("瞬间收藏", "P2"),
    "animpicture": ("动态照片", "P2"),
    "wishingpool": ("许愿池", "P2"),
    "other": ("其他点击触发内容", "P2"),
    "weather": ("天气与时段", "P1"),
    "easteregg": ("彩蛋", "P2"),
    "notify": ("推送/事件/系统通知", "P0"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path,
                        default=ROOT / "offline_build/travel_frog_local_native.apk")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/audit")
    args = parser.parse_args()
    with ZipFile(args.apk) as archive:
        raw = archive.read("assets/game/js/main.min.js")
        source = raw.decode("utf-8")
        resource_manifest = json.loads(archive.read("assets/game/resource/China/default.res.json"))
        manifest = json.loads(archive.read("assets/game/manifest.json"))

    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    begin = source.index("var ProtocolList=")
    end = source.index("__reflect(ProtocolList.prototype", begin)
    protocol_source = source[begin:end]
    matches = list(re.finditer(r'(\w+):\[\[([^\]]*)\],!([01])\]', protocol_source))
    assert len(matches) == len(re.findall(r'\w+:\[\[', protocol_source)), "Unparsed protocol definition"
    definitions = {
        m[1]: {"parameters": re.findall(r'"([^"\n]+)"', m[2]),
               "tracks_response_session": m[3] == "0",
               "definition_character_offset": begin + m.start()}
        for m in matches
    }
    assert len(definitions) == len(matches), "Duplicate protocol names"

    classes = []
    for m in re.finditer(r'var (\w+)=function', source):
        tail = source.find("__reflect(" + m[1] + ".prototype", m.end())
        if tail < 0:
            continue
        body = source[m.start():tail]
        methods = list(re.finditer(r'\w\.prototype\.(\w+)=function', body))
        classes.append({"name": m[1], "start": m.start(), "end": tail,
                        "source": body,
                        "methods": [{"name": mm[1], "start": m.start() + mm.start(),
                                     "source": body[mm.start():methods[i+1].start() if i+1 < len(methods) else len(body)]}
                                    for i, mm in enumerate(methods)]})

    def location(offset):
        candidates = [c for c in classes if c["start"] <= offset < c["end"]]
        if not candidates:
            return {"symbol": "namespace/engine", "character_offset": offset}
        c = min(candidates, key=lambda c: c["end"] - c["start"])
        previous = [m for m in c["methods"] if m["start"] <= offset]
        return {"symbol": c["name"] + ("." + previous[-1]["name"] if previous else " (constructor)"),
                "character_offset": offset}

    sends = {}
    for m in re.finditer(r'\.send\(\s*"([\w_]+)"', source):
        sends.setdefault(m[1], []).append(location(m.start()))
    callbacks = {}
    for m in re.finditer(r'addProtocolCallback\(([^)]*)\)', source):
        for name in re.findall(r'"([\w_]+)"', m[1]):
            callbacks.setdefault(name, []).append(location(m.start()))

    model_list = re.search(r'modelClassList=\[([^\]]+)\]', source)
    registered = model_list[1].split(",")
    models = []
    excerpts = ["Static source excerpts from assets/game/js/main.min.js",
                "SHA256: " + hashlib.sha256(raw).hexdigest(),
                "Offsets are Unicode character offsets, not byte offsets.", ""]
    extra_classes = {"SettingsInfo", "MainOutView", "CompostView", "FurnitureBenchView", "NetworkControl"}
    for c in classes:
        if c["name"] not in registered and c["name"] not in extra_classes:
            continue
        line = len(excerpts) + 1
        excerpts += ["=== " + c["name"] + " ===", "offset=" + str(c["start"]),
                     c["source"][:c["methods"][0]["start"] - c["start"]] if c["methods"] else c["source"]]
        for method in c["methods"]:
            excerpts += [c["name"] + "." + method["name"] + " offset=" + str(method["start"]), method["source"]]
        excerpts.append("")
        if c["name"] not in registered:
            continue
        cb = sorted(name for name, sites in callbacks.items()
                    if any(site["symbol"].startswith(c["name"] + ".") or
                           site["symbol"] == c["name"] + " (constructor)" for site in sites))
        models.append({"name": c["name"], "methods": [m["name"] for m in c["methods"]],
                       "callbacks": cb,
                       "properties_observed": sorted(set(re.findall(r'\bthis\.(\w+)', c["source"])) -
                                                     {m["name"] for m in c["methods"]}),
                       "excerpt_line": line, "character_offset": c["start"]})
    assert set(registered) == {m["name"] for m in models}, "Missing registered models"

    timer_begin = source.index("var TimerEvent;")
    timer_end = source.index("var Tabikaeru;", timer_begin)
    timer_source = source[timer_begin:timer_end]
    timer_types = [{"name": m[1], "id": int(m[2])}
                   for m in re.finditer(r'e\[e\.(\w+)=(\d+)\]', timer_source)]
    excerpts += ["=== TimerEvent.Type ===", timer_source]
    for label, marker, width in [
        ("core.SocketManage", 'e.SocketManage=t,__reflect', 8500),
        ("core.Time", 'e.Time=t,__reflect', 4500),
        ("Result event consumer", 'var Result;', 0),
        ("Tabikaeru.DataManager", 'this.ItemDB=', 2200),
    ]:
        offset = source.index(marker)
        if label == "Result event consumer":
            text = source[offset:source.index("}(Result||(Result={}));", offset) + len("}(Result||(Result={}));")]
        elif label == "Tabikaeru.DataManager":
            text = source[offset:offset+width]
        else:
            text = source[max(0, offset-width):offset+100]
        excerpts += ["=== " + label + " ===", text]

    inventory = []
    for name in sorted(set(definitions) | set(sends) | set(callbacks)):
        group, priority = GROUPS[name.split("_")[0]]
        disposition = "实现本地状态/规则及兼容响应"
        if name.startswith(("rank_", "adsmgr_", "share_")) or name in {
            "client_taobao_import", "client_draw_taobao", "client_set_wx_open_id",
            "client_add_push_id", "client_get_push_reward", "client_get_my_wx_reward",
            "mail_ejoy_active_code", "item_use_gift_code", "recharge_ready_pay", "recharge_cancel_pay",
            "springcard_share_tags", "springcard_get_share_tags", "client_share_publicity",
        }:
            disposition = "需单机替代策略/离线停用；保留已有权益与记录"
        if name.startswith("koto_"):
            disposition = "定义存在，未见直接发送/注册；确认版本用途后兼容"
        if name in {"client_gm", "client_set_client_envinfo", "client_user_action", "hall_report_remote_addr",
                    "client_set_ads", "client_set_channel", "client_set_channel_id",
                    "notify_kick", "notify_reload", "notify_marquee"}:
            disposition = "本地诊断/设置或明确停用；不复制远端运营机制"
        inventory.append({"name": name, "group": group, "priority": priority,
                          "defined": name in definitions, **definitions.get(name, {}),
                          "send_sites": sends.get(name, []), "callback_sites": callbacks.get(name, []),
                          "disposition": disposition,
                          "status": "未实现本地服务；已有客户端消费/界面逻辑不能等同本地权威状态"})
    metadata = {"apk": args.apk.name, "manifest": manifest,
                "main_js_sha256": hashlib.sha256(raw).hexdigest(),
                "method": "Static literal protocol definitions, send calls and callback registrations in bundled main.min.js",
                "limitations": "No live-account capture; request argument names only, no complete response schemas. Dynamic names and native SDK endpoints need separate verification.",
                "defined_protocol_count": len(definitions), "registered_callback_count": len(callbacks),
                "extra_callback_count": len(set(callbacks)-set(definitions)),
                "literal_send_protocol_count": len(sends), "union_count": len(inventory),
                "registered_model_count": len(models), "timer_event_type_count": len(timer_types),
                "protocol_group_counts": dict(Counter(n.split("_")[0] for n in definitions))}
    payload = {"metadata": metadata, "protocols": inventory, "models": models, "timer_events": timer_types}
    (out / "inventory.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "source-excerpts.txt").write_text("\n".join(excerpts) + "\n", encoding="utf-8")
    with (out / "protocols.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["协议", "功能域", "优先级", "在协议表", "请求参数", "跟踪响应session", "直接调用处", "注册回调处", "处理方式"])
        for row in inventory:
            writer.writerow([row["name"], row["group"], row["priority"], row["defined"],
                             ", ".join(row.get("parameters", [])), row.get("tracks_response_session", ""),
                             "; ".join(s["symbol"] for s in row["send_sites"]),
                             "; ".join(s["symbol"] for s in row["callback_sites"]), row["disposition"]])
    md = ["# 客户端协议逐项清单", "", "由 `tools/audit-local-requirements.py` 从当前 APK 生成。", "",
          "这里记录请求参数名，不代表完整响应结构。`session` 表示协议表的响应跟踪标记，不能仅据此判定请求/推送方向。",
          "缺少直接调用不代表可删除：启动批量同步、服务器推送和其他客户端版本可能使用它。优先级按功能域初分，具体实施顺序以主清单为准。", "",
          "所有条目都尚未建立对应的本地权威服务；部分模型已有内存变更或结果消费逻辑可复用。", "",
          "| 协议 | 参数 | 表内/session | 发送/回调符号 | 处理 |", "|---|---|---|---|---|"]
    for row in inventory:
        symbols = sorted(set(s["symbol"] for s in row["send_sites"] + row["callback_sites"]))
        md.append("| `{}` | {} | {} | {} | {}：{} |".format(
            row["name"], ", ".join(row.get("parameters", [])) or "—",
            ("是/" + str(row["tracks_response_session"])) if row["defined"] else "回调额外发现",
            "、".join("`" + name + "`" for name in symbols) or "未见直接调用/注册",
            row["priority"], row["disposition"]))
    md += ["", "# 定时事件类型", "", "包括 NONE 占位符；这些是客户端消费的事件类型，不是已实现的本地调度任务。", "",
           "| 数值 | 类型 |", "|---|---|"]
    md += ["| {} | `{}` |".format(e["id"], e["name"]) for e in timer_types]
    (out / "protocols.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    md = ["# 注册模型与存档审计索引", "",
          "成员名是静态观察结果，包含缓存、UI/计时器引用及继承方法；不能直接全部序列化。确切持久化字段须依据加载回调与业务规则筛选。", ""]
    for model in models:
        md += ["## " + model["name"], "", "源码节选：`source-excerpts.txt` 第 {} 行；原文件字符偏移 {}。".format(model["excerpt_line"], model["character_offset"]), "",
               "注册回调：" + ("、".join("`"+n+"`" for n in model["callbacks"]) or "无"), "",
               "观察到的成员：" + "、".join("`"+n+"`" for n in model["properties_observed"]), "",
               "方法：" + "、".join("`"+n+"`" for n in model["methods"]), ""]
    (out / "models.md").write_text("\n".join(md), encoding="utf-8")
    static = [r for r in resource_manifest["resources"] if r.get("url") == "config_eab"]
    (out / "config-resources.json").write_text(json.dumps(static, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
