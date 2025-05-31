# 文件路径：.github/scripts/convert_hub_local.py

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_hub_local.py

功能：
  • 从根目录下的 script-hub-list.json 读取每条 {name, url, (可选)headers}；
  • 调用本地 Script-Hub 后端（http://127.0.0.1:9100）进行 Serverless 转换；
  • 生成 Surge (.sgmodule) / Loon (.plugin) / Shadowrocket (.shimodule) / Stash (.stoverride) / Plain (.txt) 五种目标文件；
  • 保存到 SCRIPT-HUB-OUTPUT/<平台>/ 目录下；
  • 自动增量执行 git add/commit (sync 或 remove) → 最后统一 git push。

使用前提：
  1. 确保在同一个 Job 里、在运行本脚本之前，已经以后台方式启动了 Script-Hub 后端，监听在 127.0.0.1:9100。
  2. 仓库根目录需有 script-hub-list.json，格式如下：
     [
       {
         "name": "foo-rule",
         "url":  "https://raw.githubusercontent.com/you/your-repo/main/scripts/foo-rule.js"
       },
       {
         "name": "bar-plugin",
         "url":  "https://raw.githubusercontent.com/other/another-repo/master/bar.plugin",
         "headers": {
           "User-Agent": "MyAgent/1.0"
         }
       }
       // …可继续添加
     ]
  3. 如果 JSON 中写的是相对路径（非 http/https 开头），请在 Workflow 中通过环境变量 GITHUB_RAW_BASE 提供前缀。
"""

import os
import sys
import json
import hashlib
import requests
import subprocess
from urllib.parse import quote_plus
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
#                                 配置区域
# ─────────────────────────────────────────────────────────────────────────────

# JSON 配置文件名（相对于仓库根目录）
JSON_CONFIG = "script-hub-list.json"

# 转换后输出目录
OUTPUT_DIR = "SCRIPT-HUB-OUTPUT"

# 本地 Script-Hub 服务地址 (刚才在 CI 中已启动)
# 默认为 http://127.0.0.1:9100
SCRIPT_HUB_API_BASE = os.getenv("SCRIPT_HUB_API_BASE", "http://127.0.0.1:9100")

# 目标平台及对应输出后缀
TARGET_PLATFORMS = {
    "Surge":        ".sgmodule",
    "Loon":         ".plugin",
    "Shadowrocket": ".shimodule",
    "Stash":        ".stoverride",
    "Plain":        ".txt"
}

# 排除列表：如果源 URL 后缀在此集合中，则跳过整个条目
EXCLUDE_EXTS = {".md", ".txt", ".conf", ".ini", ".yaml", ".yml"}

# 是否启用“清理模式”：True 时会删除 OUTPUT_DIR 下不在 JSON 列表里的旧输出文件
CLEAN_MODE = os.getenv("CLEAN_MODE", "false").lower() == "true"

# （可选）GitHub Raw 前缀，用于拼接“相对路径”脚本
# 例如："https://raw.githubusercontent.com/你的用户名/你的仓库/main/"
GITHUB_RAW_BASE = os.getenv("GITHUB_RAW_BASE", "")

# ─────────────────────────────────────────────────────────────────────────────
#                                工具函数
# ─────────────────────────────────────────────────────────────────────────────

def log(msg: str):
    """控制台输出日志，方便在 CI 日志中查看"""
    print(f"[convert_hub_local] {msg}")

def ensure_dir(path: str):
    """如果目录不存在则创建（递归创建父目录）"""
    os.makedirs(path, exist_ok=True)

def compute_sha1(path: str) -> str:
    """计算文件内容的 SHA1，用于与旧文件对比是否需要更新"""
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

def fetch_and_save(api_url: str, out_file: str, headers: dict = None) -> bool:
    """
    向本地 Script-Hub 后端发送请求，将返回结果写入 out_file。
    返回 True 表示成功写入，False 表示失败（并删除残余文件）。
    """
    headers = headers or {}
    try:
        resp = requests.get(api_url, headers=headers, timeout=20)
        resp.raise_for_status()
        with open(out_file, "wb") as f:
            f.write(resp.content)
        return True
    except Exception as e:
        log(f"❌ 转换失败: {api_url} | {e}")
        if os.path.exists(out_file):
            try: os.remove(out_file)
            except: pass
        return False

# ─────────────────────────────────────────────────────────────────────────────
#                              主流程函数
# ─────────────────────────────────────────────────────────────────────────────

def main():
    # 1. 检查 JSON 配置
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
        log("❌ JSON 顶层必须是一个数组，内部每项形如 {\"name\":..., \"url\":..., (可选)\"headers\":{...}}")
        sys.exit(1)

    # 2. 确保输出根目录存在
    ensure_dir(OUTPUT_DIR)

    # 3. 准备“应当保留”的输出文件集合，以及变更（更新/删除）记录
    should_keep = set()
    updated_files = []
    deleted_files = []

    # 4. 遍历 JSON 列表，依次执行转换
    for entry in items:
        name = entry.get("name")
        url = entry.get("url")
        headers = entry.get("headers", {}) or {}

        if not name or not url:
            log(f"⚠️ 跳过无效条目: {entry}")
            continue

        # 如果 URL 不是以 http:// 或 https:// 开头，且 GITHUB_RAW_BASE 非空，则拼接前缀
        if not (url.startswith("http://") or url.startswith("https://")) and GITHUB_RAW_BASE:
            url = GITHUB_RAW_BASE.rstrip("/") + "/" + url.lstrip("/")

        # 提取后缀（不含查询字符串）
        ext = os.path.splitext(url.split("?", 1)[0])[1].lower()

        # 如果后缀在排除列表中，则跳过
        if ext in EXCLUDE_EXTS:
            log(f"⏭️ 跳过排除后缀 ({ext}): {url}")
            continue

        # 对每一个目标平台依次拼接接口并保存
        for platform, suffix in TARGET_PLATFORMS.items():
            out_subdir = os.path.join(OUTPUT_DIR, platform)
            ensure_dir(out_subdir)

            # 拼接本地 Script-Hub 转换接口：
            # 形式为：http://127.0.0.1:9100/file/<Platform>/<URL_ENCODE(raw_url)>
            api_url = f"{SCRIPT_HUB_API_BASE}/file/{platform}/{quote_plus(url)}"
            out_fname = f"{name}{suffix}"
            out_path = os.path.join(out_subdir, out_fname)
            should_keep.add(os.path.normpath(out_path))

            if os.path.exists(out_path):
                # 已存在：先计算本地 SHA1，再写临时文件比较
                old_sha1 = compute_sha1(out_path)
                temp_path = out_path + ".tmp"

                # 请求并写入 tmp 文件
                success = fetch_and_save(api_url, temp_path, headers=headers)
                if success:
                    new_sha1 = compute_sha1(temp_path)
                    if new_sha1 != old_sha1:
                        os.replace(temp_path, out_path)
                        updated_files.append((out_path, platform))
                        log(f"🔄 更新 ({platform}): {out_path}")
                    else:
                        os.remove(temp_path)
                        log(f"⏭️ 跳过无变化 ({platform}): {out_path}")
                else:
                    # 转换失败，删除临时文件
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                    # 不计入 updated_files
            else:
                # 不存在：直接下载并写入
                success = fetch_and_save(api_url, out_path, headers=headers)
                if success:
                    updated_files.append((out_path, platform))
                    log(f"➕ 新增 ({platform}): {out_path}")
                else:
                    if os.path.exists(out_path):
                        os.remove(out_path)

    # 5. 若启用 CLEAN_MODE，删除 OUTPUT_DIR 下不在 should_keep 的文件
    if CLEAN_MODE:
        for root, _, files in os.walk(OUTPUT_DIR):
            for fn in files:
                fullpath = os.path.join(root, fn)
                # 如果不在 should_keep，就删除
                if os.path.normpath(fullpath) not in should_keep:
                    os.remove(fullpath)
                    platform_name = os.path.basename(os.path.dirname(fullpath))
                    deleted_files.append((fullpath, platform_name))
                    log(f"🗑️ 删除过期输出: {fullpath}")

    # 6. 逐条对 updated_files 执行 git add + commit （commit 信息： sync(<平台>): <文件名>）
    for fp, platform in updated_files:
        fn = os.path.basename(fp)
        try:
            subprocess.run(["git", "add", fp], check=True)
            subprocess.run(["git", "commit", "-m", f"sync({platform}): {fn}"], check=True)
        except subprocess.CalledProcessError as e:
            log(f"❌ Git 提交失败 (sync {platform}): {fp} | {e}")

    # 7. 逐条对 deleted_files 执行 git rm + commit （commit 信息： remove(<平台>): <文件名>）
    for fp, platform in deleted_files:
        fn = os.path.basename(fp)
        try:
            subprocess.run(["git", "rm", fp], check=True)
            subprocess.run(["git", "commit", "-m", f"remove({platform}): {fn}"], check=True)
        except subprocess.CalledProcessError as e:
            log(f"❌ Git 提交失败 (remove {platform}): {fp} | {e}")

    # 8. 如果有任何文件变更，执行一次 git push
    if updated_files or deleted_files:
        try:
            subprocess.run(["git", "push"], check=True)
            log("✅ 所有变更已推送到远程仓库")
        except subprocess.CalledProcessError as e:
            log(f"❌ Git Push 失败: {e}")
    else:
        log("ℹ️ 未检测到任何输出文件变更，无需推送")

# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    main()
