#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert-from-json.py

Serverless 版“从 JSON 配置读取链接并自动交给 script.hub 转换”脚本：
  • 读取根目录下的 script-hub-list.json，列表项格式为：
      [
        { "name": "...", "url": "...", ("headers": { ... }) },
        …
      ]
  • 对每个条目，直接调用 script.hub 的在线转换接口：
      https://script.hub/file/<Platform>/<URL_ENCODED原始链接>
  • 生成 Surge(.sgmodule)、Loon(.loonmodule)、Shadowrocket(.shimodule) 三种文件
  • 保存到本地仓库：SCRIPT-HUB-OUTPUT/Surge/<name>.sgmodule、
                      SCRIPT-HUB-OUTPUT/Loon/<name>.loonmodule、
                      SCRIPT-HUB-OUTPUT/Shadowrocket/<name>.shimodule
  • 对“新增/更新”文件逐条 git add + git commit，按格式 “sync(<平台>): <文件名>”
  • 对“已删除”文件逐条 git rm + git commit，按格式 “remove(<平台>): <文件名>”
  • 最后如果有任何变更，执行 git push
"""

import os
import sys
import json
import hashlib
import requests
import subprocess
from urllib.parse import quote_plus
from datetime import datetime

# ━━━━━━━━ 配置区域 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 1. JSON 配置文件路径（相对于仓库根目录）
JSON_CONFIG = "script-hub-list.json"

# 2. 输出目录（如果不存在则自动创建）
#    最终会在仓库里看到：
#      SCRIPT-HUB-OUTPUT/
#        ├── Surge/
#        ├── Loon/
#        └── Shadowrocket/
OUTPUT_DIR = "SCRIPT-HUB-OUTPUT"

# 3. script.hub Serverless 公共接口前缀（直接调用无需本地服务）
#    官方一般是 https://script.hub 或 http://script.hub
SCRIPT_HUB_API_BASE = "https://script.hub"

# 4. 要支持的目标平台和对应后缀
TARGET_PLATFORMS = {
    "Surge": ".sgmodule",
    "Loon": ".plugin",
    "Shadowrocket": ".sgmodule"
}

# 5. 若你想排除某些后缀不转换，可在此集合里填写，譬如 .conf/.md/.txt 等
EXCLUDE_EXTS = {".md", ".txt", ".conf", ".ini", ".yaml", ".yml"}

# 6. 是否自动删除不在 JSON 列表中的旧输出文件
#    如设为 “true”，脚本会把 OUTPUT_DIR 下“多余”的旧文件清掉
CLEAN_MODE = os.getenv("CLEAN_MODE", "false").lower() == "true"

# 7. （可选）GitHub Raw 前缀，用于“原始链接”不是 GitHub Raw 时，可自己拼接
#    但通常 JSON 里就直接写明了“GitHub Raw URL”，不需要再拼。可不填。
GITHUB_RAW_BASE = os.getenv("GITHUB_RAW_BASE", "")

# ━━━━━━━━ 工具函数 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def log(msg: str):
    """简单日志"""
    print(f"[convert-from-json] {msg}")

def ensure_dir(path: str):
    """如果目录不存在就创建"""
    os.makedirs(path, exist_ok=True)

def compute_sha1(path: str) -> str:
    """计算文件内容 SHA1，用于判断是否需要覆盖"""
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

def fetch_and_save(api_url: str, out_file: str) -> bool:
    """
    调用 script.hub 公共接口，下载转换结果并写出到 out_file。
    返回 True 表示成功，False 表示失败（并删除残留文件）。
    """
    try:
        resp = requests.get(api_url, timeout=20)
        resp.raise_for_status()
        with open(out_file, "wb") as f:
            f.write(resp.content)
        return True
    except Exception as e:
        log(f"❌ 转换失败: {api_url} | {e}")
        if os.path.exists(out_file):
            os.remove(out_file)
        return False

# ━━━━━━━━ 主流程 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main():
    # 1. 读取并解析 JSON 配置
    if not os.path.exists(JSON_CONFIG):
        log(f"❌ 找不到配置文件: {JSON_CONFIG}")
        sys.exit(1)

    try:
        with open(JSON_CONFIG, "r", encoding="utf-8") as f:
            items = json.load(f)
    except Exception as e:
        log(f"❌ 无法解析 {JSON_CONFIG}: {e}")
        sys.exit(1)

    if not isinstance(items, list):
        log("❌ JSON 内容必须是一个列表，每项包含 {\"name\":..., \"url\":..., (可选)\"headers\":{…}}")
        sys.exit(1)

    # 2. 确保输出根目录存在
    ensure_dir(OUTPUT_DIR)

    # 3. 准备记录“应当保留”的输出文件集合，以及新增/更新/删除列表
    should_keep = set()
    updated_files = []  # 存放 (outfile_path, "Platform")
    deleted_files = []  # 存放 (outfile_path, "Platform")

    # 4. 遍历 JSON 列表，分别进行 Serverless 转换
    for entry in items:
        name = entry.get("name")
        url = entry.get("url")
        headers = entry.get("headers", {}) or {}

        if not name or not url:
            log(f"⚠️ 跳过无效配置项: {entry}")
            continue

        # 如果只写了非 Raw 链接且提供了 GITHUB_RAW_BASE，可帮忙拼一下
        if not url.startswith("http") and GITHUB_RAW_BASE:
            url = GITHUB_RAW_BASE.rstrip("/") + "/" + url.lstrip("/")

        # 提取后缀: 例如 foo.js → ".js"
        ext = os.path.splitext(url.split("?", 1)[0])[1].lower()
        # 如果在排除后缀里就跳过
        if ext in EXCLUDE_EXTS:
            log(f"⏭️ 跳过不需要转换的后缀: {url}")
            continue

        # 对每个目标平台生成对应的转换输出
        for platform, suffix in TARGET_PLATFORMS.items():
            # 准备输出目录： e.g. SCRIPT-HUB-OUTPUT/Surge/
            out_subdir = os.path.join(OUTPUT_DIR, platform)
            ensure_dir(out_subdir)

            # 拼 Script-Hub 服务接口
            # 如: https://script.hub/file/Surge/<URL_ENCODE(raw_url)>
            api_url = f"{SCRIPT_HUB_API_BASE}/file/{platform}/{quote_plus(url)}"

            # 输出文件名： e.g. foo-rule.sgmodule
            out_fname = f"{name}{suffix}"
            out_path = os.path.join(out_subdir, out_fname)
            should_keep.add(os.path.normpath(out_path))

            # 如果输出已存在，先比对 SHA1 决定是否覆盖
            if os.path.exists(out_path):
                old_sha1 = compute_sha1(out_path)
                tmp_path = out_path + ".tmp"
                # 由于需要传递自定义 headers，使用 requests.get(url, headers=headers)
                try:
                    # 获取转换结果流
                    resp = requests.get(api_url, headers=headers, timeout=20)
                    resp.raise_for_status()
                    with open(tmp_path, "wb") as tf:
                        tf.write(resp.content)
                except Exception as e:
                    log(f"❌ 转换失败 ({platform}): {url} | {e}")
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                    continue

                new_sha1 = compute_sha1(tmp_path)
                if new_sha1 != old_sha1:
                    os.replace(tmp_path, out_path)
                    updated_files.append((out_path, platform))
                    log(f"🔄 [更新] {platform} → {out_path}")
                else:
                    os.remove(tmp_path)
                    log(f"⏭️ [跳过] {platform} ({name}) 无变化")
            else:
                # 文件不存在时，直接请求并写入
                try:
                    resp = requests.get(api_url, headers=headers, timeout=20)
                    resp.raise_for_status()
                    with open(out_path, "wb") as f:
                        f.write(resp.content)
                    updated_files.append((out_path, platform))
                    log(f"➕ [新增] {platform} → {out_path}")
                except Exception as e:
                    log(f"❌ 转换失败 ({platform}): {url} | {e}")
                    if os.path.exists(out_path):
                        os.remove(out_path)
                    continue

    # 5. 如果启用了 CLEAN_MODE，需要删除多余的旧输出
    if CLEAN_MODE:
        for root, _, files in os.walk(OUTPUT_DIR):
            for fn in files:
                fullpath = os.path.join(root, fn)
                if os.path.normpath(fullpath) not in should_keep:
                    os.remove(fullpath)
                    # sub = “Surge” 或 “Loon” 或 “Shadowrocket”
                    sub = os.path.basename(os.path.dirname(fullpath))
                    deleted_files.append((fullpath, sub))
                    log(f"🗑️ [删除] 过期输出: {fullpath}")

    # 6. 逐条对 updated_files 做 git add + commit
    for fp, platform in updated_files:
        fn = os.path.basename(fp)
        # git add <fp>
        subprocess.run(["git", "add", fp], check=True)
        # commit 信息格式： sync(<平台>): <文件名>
        subprocess.run(
            ["git", "commit", "-m", f"sync({platform}): {fn}"],
            check=True
        )

    # 7. 逐条对 deleted_files 做 git rm + commit
    for fp, platform in deleted_files:
        fn = os.path.basename(fp)
        subprocess.run(["git", "rm", fp], check=True)
        subprocess.run(
            ["git", "commit", "-m", f"remove({platform}): {fn}"],
            check=True
        )

    # 8. 如果里头有提交操作，就统一做 git push
    if updated_files or deleted_files:
        subprocess.run(["git", "push"], check=True)

    log("✅ Serverless JSON→Script-Hub 转换完成")


if __name__ == "__main__":
    main()
