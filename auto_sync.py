"""
DocuShield Real-Time GitHub Auto-Sync Daemon
Monitors the DocuShield project repository and automatically commits & pushes
all changes to GitHub in real-time without requiring manual intervention.
"""

import subprocess
import time
import os
import sys
from datetime import datetime

# Configure UTF-8 for Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
DEBOUNCE_SECONDS = 3
POLL_INTERVAL = 1.5

def run_cmd(cmd, cwd=REPO_DIR):
    try:
        res = subprocess.run(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True,
            encoding="utf-8",
            errors="replace"
        )
        return res.returncode, res.stdout.strip(), res.stderr.strip()
    except Exception as e:
        return 1, "", str(e)

def get_git_status():
    code, stdout, _ = run_cmd("git status --porcelain")
    if code == 0 and stdout:
        lines = [line.strip() for line in stdout.splitlines() if line.strip()]
        return lines
    return []

def log(msg):
    print(msg, flush=True)

def auto_sync():
    log("=" * 65)
    log("[DOCUSHIELD] GitHub Real-Time Auto-Sync Daemon Active")
    log(f"Directory: {REPO_DIR}")
    log("Every file update will be automatically committed & pushed to GitHub.")
    log("=" * 65)

    last_change_time = None
    last_snapshot = []
    pending_sync = False

    while True:
        try:
            status_lines = get_git_status()

            if status_lines:
                if not pending_sync:
                    pending_sync = True
                    last_change_time = time.time()
                    last_snapshot = status_lines
                    log(f"[{datetime.now().strftime('%H:%M:%S')}] [DETECTED] Changes in {len(status_lines)} file(s). Settling {DEBOUNCE_SECONDS}s...")
                elif status_lines != last_snapshot:
                    # User is still actively modifying files
                    last_snapshot = status_lines
                    last_change_time = time.time()

            if pending_sync and last_change_time:
                # Check if debounce settling period has elapsed
                if (time.time() - last_change_time) >= DEBOUNCE_SECONDS:
                    current_status = get_git_status()
                    if not current_status:
                        pending_sync = False
                        last_change_time = None
                        continue

                    # Extract modified filenames for commit message
                    changed_files = []
                    for line in current_status[:5]:
                        parts = line.split(maxsplit=1)
                        if len(parts) > 1:
                            changed_files.append(os.path.basename(parts[1]))
                    
                    files_str = ", ".join(changed_files)
                    if len(current_status) > 5:
                        files_str += f" (+{len(current_status) - 5} more)"

                    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    commit_msg = f"sync: auto-update [{files_str}] ({timestamp})"

                    log(f"[{datetime.now().strftime('%H:%M:%S')}] [STAGE] Staging files...")
                    run_cmd("git add -A")

                    log(f"[{datetime.now().strftime('%H:%M:%S')}] [COMMIT] {commit_msg}")
                    code, c_out, c_err = run_cmd(f'git commit -m "{commit_msg}"')
                    if code != 0 and "nothing to commit" in c_out.lower():
                        pending_sync = False
                        last_change_time = None
                        continue

                    log(f"[{datetime.now().strftime('%H:%M:%S')}] [PUSH] Pushing to GitHub (origin main)...")
                    p_code, p_out, p_err = run_cmd("git push origin main")

                    if p_code == 0:
                        log(f"[{datetime.now().strftime('%H:%M:%S')}] [SUCCESS] Sync complete! Changes are live on GitHub.\n")
                    else:
                        log(f"[{datetime.now().strftime('%H:%M:%S')}] [WARN] Push failed (will retry): {p_err or p_out}\n")

                    pending_sync = False
                    last_change_time = None
                    last_snapshot = []

            time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            log("\n[STOPPED] Auto-sync daemon stopped.")
            break
        except Exception as ex:
            log(f"[ERROR] Watcher error: {ex}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    auto_sync()
