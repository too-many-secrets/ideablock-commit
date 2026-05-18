#!/usr/bin/env python3
"""
ideablock-commit — Python port

Tethers every git commit to the Bitcoin blockchain via Ideablock's
timeglue service.

Requirements:
    pip install requests

Usage:
    python ideablock_commit.py <init|on|off|status|remove|run|logout>

Install as CLI:
    chmod +x ideablock_commit.py
    ln -s $(pwd)/ideablock_commit.py /usr/local/bin/ideablock-commit
"""

import hashlib
import json
import os
import random
import shutil
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# ── Config ────────────────────────────────────────────────────────────────────

TIMEGLUE_URL = os.environ.get("TIMEGLUE_URL", "http://localhost:2312")
IDEABLOCK_API = os.environ.get("IDEABLOCK_API_URL", "http://localhost:3000")

HOME = Path.home()
AUTH_FILE = HOME / ".ideablock" / "auth.json"
CONF_FILE = Path(".ideablock/ideablock.json")
HOOK_SCRIPT = Path(".ideablock/post-commit")
GIT_HOOK = Path(".git/hooks/post-commit")

HOOK_CONTENT = "#!/bin/bash\nideablock-commit run\n"

# ── Helpers ───────────────────────────────────────────────────────────────────

def is_git_repo() -> bool:
    return Path(".git").exists()

def read_conf() -> dict:
    if CONF_FILE.exists():
        return json.loads(CONF_FILE.read_text())
    return {}

def write_conf(on: bool):
    CONF_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONF_FILE.write_text(json.dumps({"on": on}))

def is_on() -> bool:
    return read_conf().get("on", False)

def read_auth() -> dict:
    if AUTH_FILE.exists():
        return json.loads(AUTH_FILE.read_text())
    return {}

def write_auth(data: dict):
    AUTH_FILE.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    AUTH_FILE.write_text(json.dumps(data, indent=2))
    AUTH_FILE.chmod(0o600)

def write_hook(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(HOOK_CONTENT)
    path.chmod(0o744)

def git_output(*args) -> str:
    result = subprocess.run(["git"] + list(args), capture_output=True, text=True)
    return result.stdout.strip()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def repo_name() -> str:
    return Path.cwd().name

# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_init():
    if not is_git_repo():
        print("\n\t❗ Not a git repository.")
        return

    auth = read_auth()
    now = int(time.time())
    if auth.get("token") and auth.get("token_expires", 0) > now:
        print(f"\n\t✅ Already logged in as {auth['user']['email']}")
        cmd_on()
        return

    print("\n  Please log in with your Ideablock credentials.")
    email = input("Email: ").strip()
    password = input("Password: ").strip()

    try:
        resp = requests.post(f"{IDEABLOCK_API}/api/login",
                             json={"email": email, "password": password},
                             timeout=10)
    except requests.RequestException as e:
        print(f"\n\t❌ Could not reach Ideablock API: {e}")
        return

    if resp.status_code != 200:
        print("\n\t❌ Invalid credentials.")
        return

    data = resp.json()
    auth_data = {
        "token": data["token"],
        "token_expires": data["token_expires"],
        "user": {
            "id": data["user"]["id"],
            "email": data["user"]["email"],
            "first_name": data["user"]["first_name"],
            "last_name": data["user"]["last_name"],
        },
        "cached_at": now,
    }
    write_auth(auth_data)
    print(f"\n\t✅ Logged in as {auth_data['user']['email']}")

    Path(".ideablock").mkdir(exist_ok=True)
    write_conf(True)
    write_hook(HOOK_SCRIPT)
    write_hook(GIT_HOOK)
    print("\t✅ Ideablock Commit initialized in this repository.")


def cmd_on():
    if not is_git_repo():
        print("\n\t❗ Not a git repository.")
        return
    if not CONF_FILE.exists():
        print('\n\t❗ Not initialized. Run "ideablock-commit init" first.')
        return
    if is_on():
        print("\n\t✅ Ideablock Commit is already ON.")
        return
    write_conf(True)
    write_hook(GIT_HOOK)
    print("\n\t✅ Ideablock Commit set to ON.")


def cmd_off():
    if not is_git_repo():
        print("\n\t❗ Not a git repository.")
        return
    if not CONF_FILE.exists():
        print('\n\t❗ Not initialized. Run "ideablock-commit init" first.')
        return
    if not is_on():
        print("\n\t❌ Ideablock Commit is already OFF.")
        return
    write_conf(False)
    GIT_HOOK.unlink(missing_ok=True)
    print("\n\t❌ Ideablock Commit set to OFF.")


def cmd_status():
    if not CONF_FILE.exists():
        print('\n\t❗ UNINITIALIZED — run "ideablock-commit init".')
        return
    if not is_git_repo():
        print("\n\t❗ Not a git repository.")
        return
    state = "ON" if is_on() else "OFF"
    print(f"\n\tIdeablock Commit is INITIALIZED and {state}.")


def cmd_remove():
    if not is_git_repo():
        print("\n\t❗ Not a git repository.")
        return
    shutil.rmtree(".ideablock", ignore_errors=True)
    GIT_HOOK.unlink(missing_ok=True)
    print("\n\t🗑️  Ideablock Commit removed from this repository.")


def cmd_logout():
    if not AUTH_FILE.exists():
        print("\n\t⚠️  Not logged in.")
        return
    AUTH_FILE.unlink()
    print('\n\t✅ Logged out. Run "ideablock-commit init" to log in again.')


def cmd_run():
    if not is_on():
        print('\n\t❗ Ideablock Commit is OFF. Run "ideablock-commit on" to enable.')
        return

    # 1. Auth
    auth = read_auth()
    if not auth.get("token"):
        print('\n\t❌ Not authenticated. Run "ideablock-commit init".')
        return
    if auth.get("token_expires", 0) <= int(time.time()):
        AUTH_FILE.unlink(missing_ok=True)
        print('\n\t❌ Session expired. Run "ideablock-commit init" to log in again.')
        return

    token = auth["token"]
    user_id = auth.get("user", {}).get("id", "unknown")

    # 2. Short hash
    short_hash = git_output("log", "-1", "--pretty=format:%h")[:7]
    if not short_hash:
        print("\n\t❌ Could not get git commit hash.")
        return

    # 3. Commit message
    commit_msg = git_output("log", "-1", "--pretty=format:%s")

    # 4. Archive
    name = repo_name()
    commit_dir = HOME / ".ideablock" / "commits" / name / short_hash
    commit_dir.mkdir(parents=True, exist_ok=True)
    zip_path = commit_dir / f"Commit-{short_hash}.zip"
    subprocess.run(["git", "archive", "-o", str(zip_path), "HEAD"], check=True)

    # 5. SHA-256
    repo_hash = sha256_file(zip_path)

    # 6. Parity + tethered hash
    parity = random.randint(0, 9)
    tethered_hash = f"{short_hash}{repo_hash}{parity}"
    committed_at = datetime.now(timezone.utc).isoformat()

    # 7. Timeglue
    print("\n\tTethering commit to Bitcoin blockchain", end="", flush=True)
    try:
        glue_resp = requests.post(
            f"{TIMEGLUE_URL}/glue",
            json={"userID": user_id, "hash": repo_hash},
            timeout=30,
        )
        glue_resp.raise_for_status()
        btc_tx_id = glue_resp.json().get("btcTx", "")
        print(" ✅")
    except requests.RequestException as e:
        print(f"\n\t❌ Failed to reach timeglue: {e}")
        print("\t   Is timeglue running? Start it with: MOCK_MODE=true ./timeglue")
        return

    # 8. Save commitData.json
    commit_data = {
        "repoName": name,
        "shortHash": short_hash,
        "commitMessage": commit_msg,
        "repoHash": repo_hash,
        "parityDigit": parity,
        "blockchainTetheredHash": tethered_hash,
        "btcTxID": btc_tx_id,
        "committedAt": committed_at,
    }
    (commit_dir / "commitData.json").write_text(json.dumps(commit_data, indent=2))

    # 9. Print table
    print(f"\n\t✅ Congratulations! Your commit has been tethered using Ideablock!\n")
    rows = [
        ("Bitcoin Hash:", btc_tx_id),
        ("Commit Short Hash:", short_hash),
        ("Repository Hash:", repo_hash),
        ("Parity Digit:", str(parity)),
        ("Blockchain-Tethered Hash:", tethered_hash),
        ("Commit Record Location:", str(commit_dir)),
    ]
    for label, value in rows:
        print(f"\t{label:<30} {value}")
    print()

    # 10. Best-effort sync
    try:
        requests.post(
            f"{IDEABLOCK_API}/api/commit-ideas",
            json=commit_data,
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
    except Exception:
        print("\t⚠️  Could not sync to Ideablock (backend unreachable). Local record saved.")


# ── Main ──────────────────────────────────────────────────────────────────────

COMMANDS = {
    "init": cmd_init, "i": cmd_init,
    "on": cmd_on, "resume": cmd_on,
    "off": cmd_off, "pause": cmd_off,
    "status": cmd_status, "ping": cmd_status,
    "remove": cmd_remove, "uninstall": cmd_remove,
    "run": cmd_run,
    "logout": cmd_logout,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("Usage: ideablock-commit <init|on|off|status|remove|run|logout>")
        sys.exit(1)
    COMMANDS[sys.argv[1]]()
