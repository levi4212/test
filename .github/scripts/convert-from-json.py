#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert-from-json.py

功能：从根目录下的 script-hub-list.json 读取每条「name + URL (+ 可选 headers)」
并通过 Script-Hub 官方在线转换接口（Serverless 模式）生成各平台可导入的模块文件，
包括 Surge (.sgmodule)、Loon (.plugin/.loonmodule)、Shadowrocket (.shimodule)、Stash (.stoverride) 等，
将结果保存到 SCRIPT-HUB-OUTPUT/<平台>/ 目录下，并自动执行增量的 Git 提交与推送。

使用方式：
  1. 将本脚本放置在仓库的 .github/scripts/convert-from-json.py 路径下
  2. 在仓库根目录创建 script-hub-list.json，内容格式如下：
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
       // … 可继续添加多条记录
     ]
  3. （可选）如果 JSON 中写的是相对路径，请在 GitHub Actions Workflow 中设置环境变量：
       GITHUB_RAW_BASE=https://raw.githubusercontent.com/你的用户名/你的仓库/main/
  4. 在 GitHub Actions Workflow 中运行：
       python .github/scripts/convert-from-json.py
  5. 脚本会自动对新增/更新/删除的输出文件执行 git add/commit/push，无需手动操作。
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

# JSON 配置文件（脚本列表），必须放在仓库根目录
JSON_CONFIG = "script-hub-list.json"

# 转换后模块的输出根目录
OUTPUT_DIR = "SCRIPT-HUB-OUTPUT"

# Script-Hub 官方公共接口前缀（无需本地服务），使用 HTTPS 以避免跨域
SCRIPT_HUB_API_BASE = "https://script.hub"

# 目标平台及对应输出后缀映射，key = 平台名称，value = 目标文件后缀
TARGET_PLATFORMS = {
    "Surge":      ".sgmodule",
    "Loon":       ".plugin",      # 也可以改成 ".loonmodule"
    "Shadowrocket": ".shimodule",
    "Stash":      ".stoverride",
    "Plain":      ".txt"          # 如果需要保留原始纯文本，可添加此项
}

# 排除不想转换的源文件后缀（例如 .md/.txt/.conf 等纯文档格式）
EXCLUDE_EXTS = {".md", ".txt", ".conf", ".ini", ".yaml", ".yml"}

# 是否启用“清理模式”，如果为 True，则会删除 OUTPUT_DIR 下那些不在 JSON 列表里的旧输出文件
CLEAN_MODE = os.getenv("CLEAN_MODE", "false").lower() == "true"

# （可选）GitHub Raw 前缀，用于拼接“非 http 开头”的相对路径
# 例如： "https://raw.githubusercontent.com/你的用户名/你的仓库/main/"
GITHUB_RAW_BASE = os.getenv("GITHUB_RAW_BASE", "")

# ─────────────────────────────────────────────────────────────────────────────
#                                辅助函数
# ─────────────────────────────────────────────────────────────────────────────

def log(msg: str):
    """
    控制台打印日志，方便在 GitHub Actions 中查看
    """
    print(f"[convert-from-json] {msg}")

def ensure_dir(path: str):
    """
    如果目录不存在，则创建（包括所有父目录）
    """
    os.makedirs(path, exist_ok=True)

def compute_sha1(path: str) -> str:
    """
    计算文件内容的 SHA1 值，用于判断本地文件是否与最新内容相同
    """
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
    向 Script-Hub 官方接口发起 GET 请求，把返回的内容写入 out_file。
    - api_url: 完整的转换接口 URL，例如：
        https://script.hub/file/Surge/<URL_ENCODE(raw_url)>
    - out_file: 本地输出路径
    - headers: 可选字典，传递给 requests.get 的自定义请求头
    返回 True 表示成功写入，False 表示失败（同时删除残留的 str 文件）。
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
            try:
                os.remove(out_file)
            except:
                pass
        return False

# ─────────────────────────────────────────────────────────────────────────────
#                                 主流程函数
# ─────────────────────────────────────────────────────────────────────────────

def main():
    # 1. 检查 JSON 配置文件是否存在
    if not os.path.exists(JSON_CONFIG):
        log(f"❌ 找不到配置文件: {JSON_CONFIG}")
        sys.exit(1)

    # 2. 读取并解析 JSON
    try:
        with open(JSON_CONFIG, "r", encoding="utf-8") as f:
            items = json.load(f)
    except Exception as e:
        log(f"❌ 无法解析 {JSON_CONFIG}: {e}")
        sys.exit(1)

    if not isinstance(items, list):
        log("❌ JSON 文件顶层必须是一个数组，内部每项为 {\"name\":..., \"url\":..., (可选)\"headers\":{...}}")
        sys.exit(1)

    # 3. 确保输出目录存在
    ensure_dir(OUTPUT_DIR)

    # 4. 准备记录“本次执行需要保留”的所有输出文件路径
    should_keep = set()

    # 5. 准备记录“新增/更新”和“删除”操作，用于后续的 Git 提交
    updated_files = []  # [(filepath, platform), ...]
    deleted_files = []  # [(filepath, platform), ...]

    # 6. 遍历 JSON 列表，每条记录做转换
    for entry in items:
        name = entry.get("name")
        url = entry.get("url")
        headers = entry.get("headers", {}) or {}

        if not name or not url:
            log(f"⚠️ 跳过无效 JSON 条目: {entry}")
            continue

        # 如果 url 不是以 http/https 开头，且设置了 GITHUB_RAW_BASE，则拼接
        if not (url.startswith("http://") or url.startswith("https://")) and GITHUB_RAW_BASE:
            url = GITHUB_RAW_BASE.rstrip("/") + "/" + url.lstrip("/")

        # 提取 URL 中的文件后缀（不含查询参数），如 ".js"、".plugin"
        ext = os.path.splitext(url.split('?', 1)[0])[1].lower()

        # 如果在排除后缀列表里，就跳过
        if ext in EXCLUDE_EXTS:
            log(f"⏭️ 跳过排除后缀 ({ext}): {url}")
            continue

        # 对各个目标平台进行转换
        for platform, suffix in TARGET_PLATFORMS.items():
            # 准备对应的输出子目录： e.g. SCRIPT-HUB-OUTPUT/Surge/
            out_subdir = os.path.join(OUTPUT_DIR, platform)
            ensure_dir(out_subdir)

            # 构造 Script-Hub 转换 API URL
            # 形如：https://script.hub/file/Surge/<URL_ENCODE(raw_url)>
            api_url = f"{SCRIPT_HUB_API_BASE}/file/{platform}/{quote_plus(url)}"

            # 输出文件名： e.g. foo-rule.sgmodule
            out_fname = f"{name}{suffix}"
            out_path = os.path.join(out_subdir, out_fname)
            should_keep.add(os.path.normpath(out_path))

            # 如果目标文件已存在，需要先比较 SHA1 判断是否需要更新
            if os.path.exists(out_path):
                old_sha1 = compute_sha1(out_path)
                temp_path = out_path + ".tmp"

                # 先把新结果写到临时文件，再和旧文件比较
                success = fetch_and_save(api_url, temp_path, headers=headers)
                if success:
                    new_sha1 = compute_sha1(temp_path)
                    if new_sha1 != old_sha1:
                        os.replace(temp_path, out_path)
                        updated_files.append((out_path, platform))
                        log(f"🔄 更新 ({platform}): {out_path}")
                    else:
                        # 内容相同，跳过并删除临时文件
                        os.remove(temp_path)
                        log(f"⏭️ 跳过无变化 ({platform}): {out_path}")
                else:
                    # 转换失败时，删除临时残留并继续
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                    # 不添加到 updated_files
            else:
                # 文件不存在时，直接写入
                success = fetch_and_save(api_url, out_path, headers=headers)
                if success:
                    updated_files.append((out_path, platform))
                    log(f"➕ 新增 ({platform}): {out_path}")
                else:
                    # 转换失败，不要留下空文件
                    if os.path.exists(out_path):
                        os.remove(out_path)
                    # 不添加到 updated_files

    # 7. 如果启用了 CLEAN_MODE，删除 OUTPUT_DIR 下不在 should_keep 的旧文件
    if CLEAN_MODE:
        for root, _, files in os.walk(OUTPUT_DIR):
            for fn in files:
                fullpath = os.path.join(root, fn)
                # 只保留 should_keep 里的路径
                if os.path.normpath(fullpath) not in should_keep:
                    os.remove(fullpath)
                    # 子目录名即平台名称，例如 "Surge"、"Loon" 等
                    platform_name = os.path.basename(os.path.dirname(fullpath))
                    deleted_files.append((fullpath, platform_name))
                    log(f"🗑️ 删除过期输出: {fullpath}")

    # 8. 对新增/更新的文件逐条执行 git add + commit
    for fp, platform in updated_files:
        fn = os.path.basename(fp)
        try:
            subprocess.run(["git", "add", fp], check=True)
            subprocess.run(
                ["git", "commit", "-m", f"sync({platform}): {fn}"],
                check=True
            )
        except subprocess.CalledProcessError as e:
            log(f"❌ Git 提交失败 (sync {platform}): {fp} | {e}")

    # 9. 对已删除的文件逐条执行 git rm + commit
    for fp, platform in deleted_files:
        fn = os.path.basename(fp)
        try:
            subprocess.run(["git", "rm", fp], check=True)
            subprocess.run(
                ["git", "commit", "-m", f"remove({platform}): {fn}"],
                check=True
            )
        except subprocess.CalledProcessError as e:
            log(f"❌ Git 提交失败 (remove {platform}): {fp} | {e}")

    # 10. 如果有任何新增/更新/删除操作，统一执行一次 git push
    if updated_files or deleted_files:
        try:
            subprocess.run(["git", "push"], check=True)
            log("✅ 所有变更已推送到远程仓库")
        except subprocess.CalledProcessError as e:
            log(f"❌ Git Push 失败: {e}")
    else:
        log("ℹ️ 本次没有检测到任何输出文件变更，无需推送")

# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    main()
