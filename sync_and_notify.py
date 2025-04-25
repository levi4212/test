#!/usr/bin/env python3
import os, json, requests
from urllib.parse import quote

CONFIG_FILE = "script-gist.json"
BACKUP_DIR = "SCRIPTS-BACKUP"
os.makedirs(BACKUP_DIR, exist_ok=True)

added, updated, deleted = 0, 0, 0
updated_files = []
deleted_files = []

def log(msg): print(f"[GIST-BACKUP] {msg}")

def download_and_compare(name, url):
    global added, updated
    filename = f"{BACKUP_DIR}/{name}.js"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        content = resp.text
        if os.path.exists(filename):
            with open(filename, "r", encoding="utf-8") as f:
                if f.read() != content:
                    with open(filename, "w", encoding="utf-8") as wf:
                        wf.write(content)
                    updated_files.append(filename)
                    updated += 1
        else:
            with open(filename, "w", encoding="utf-8") as f:
                f.write(content)
            updated_files.append(filename)
            added += 1
    except Exception as e:
        log(f"❌ Failed to fetch {name}: {e}")

def cleanup_files(valid_files):
    global deleted, deleted_files
    for fname in os.listdir(BACKUP_DIR):
        full_path = os.path.join(BACKUP_DIR, fname)
        if full_path not in valid_files and fname.endswith(".js"):
            os.remove(full_path)
            deleted += 1
            deleted_files.append(fname)

def send_bark(title, content, url):
    try:
        requests.get(f"{url}/{quote(title)}/{quote(content)}", timeout=5)
        log("📲 Bark sent.")
    except Exception as e:
        log(f"❌ Bark failed: {e}")

def send_serverchan(title, content, key):
    try:
        requests.post(f"https://sctapi.ftqq.com/{key}.send",
                      data={"title": title, "desp": content}, timeout=5)
        log("📲 Server酱 sent.")
    except Exception as e:
        log(f"❌ Server酱 failed: {e}")

def send_wechat(title, content, webhook_url):
    try:
        requests.post(webhook_url,
                      json={"msgtype": "text", "text": {"content": f"{title}\n{content}"}},
                      headers={"Content-Type": "application/json"}, timeout=5)
        log("📲 企业微信 sent.")
    except Exception as e:
        log(f"❌ 企业微信 failed: {e}")

def send_telegram(title, content, token, user_id):
    try:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      data={"chat_id": user_id, "text": f"{title}\n{content}"}, timeout=5)
        log("📲 Telegram sent.")
    except Exception as e:
        log(f"❌ Telegram failed: {e}")

def main():
    if not os.path.exists(CONFIG_FILE):
        log("❌ No config file found.")
        return

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)

    valid_files = []

    for name, url in config.items():
        download_and_compare(name, url)
        valid_files.append(f"{BACKUP_DIR}/{name}.js")

    if os.getenv("CLEAN_MODE", "true") == "true":
        cleanup_files(valid_files)

    for f in updated_files:
        os.system(f'git add "{f}" && git commit -m "sync: {os.path.basename(f)}"')

    for f in deleted_files:
        os.system(f'git rm "{BACKUP_DIR}/{f}" && git commit -m "removed: {f}"')

    if updated_files or deleted_files:
        os.system("git push")

    notify = os.getenv("FORCE_NOTIFY", "true").lower() == "true" or added or updated or deleted
    if notify:
        lang = os.getenv("NOTIFY_LANG", "en-us")
        if lang == "zh-cn":
            title = "📦 远程脚本自动备份"
            content = f"✅远程脚本自动备份完成\n🆕 新增: {added} 个\n📝 修改: {updated} 个\n🗑️ 删除: {deleted} 个"
        else:
            title = "📦 Remote Script Backup"
            content = f"✅Remote Script Backup Completed\n🆕 Added: {added}\n📝 Updated: {updated}\n🗑️ Deleted: {deleted}"

        bark_url = os.getenv("BARK_PUSH_URL")
        if bark_url:
            send_bark(title, content, bark_url)

        server_key = os.getenv("SERVERCHAN_SEND_KEY")
        if server_key:
            send_serverchan(title, content, server_key)

        wechat_hook = os.getenv("WECHAT_WEBHOOK_URL")
        if wechat_hook:
            send_wechat(title, content, wechat_hook)

        tg_token = os.getenv("TG_BOT_TOKEN")
        tg_user = os.getenv("TG_USER_ID")
        if tg_token and tg_user:
            send_telegram(title, content, tg_token, tg_user)

if __name__ == "__main__":
    main()
