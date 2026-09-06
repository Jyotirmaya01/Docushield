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

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
DEBOUNCE_SECONDS = 3
POLL_INTERVAL = 2.0

def run_cmd(cmd, cwd=REPO_DIR):
    try:
        res = subprocess.run(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True
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

def auto_sync():
    print("=" * 65)
    print("🛡️  DocuShield GitHub Real-Time Auto-Sync Daemon Active")
    print(f"📁 Watching Directory: {REPO_DIR}")
    print("⚡ Any file save will automatically commit & push to GitHub")
    print("=" * 65)

    last_change_time = None
    pending_sync = False

    while True:
        try:
            status_lines = get_git_status()

            if status_lines:
                if not pending_sync:
                    pending_sync = True
                    last_change_time = time.time()
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 📝 Changes detected ({len(status_lines)} file(s)). Waiting for save to finish...")
                else:
                    last_change_time = time.time()

            if pending_sync and last_change_time:
                # Check if debounce period has passed
                if time.time() - last_change_time >= DEBOUNCE_SECONDS:
                    # Double check status before pushing
                    current_status = get_git_status()
                    if not current_status:
                        pending_sync = False
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

                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 📦 Staging changes...")
                    run_cmd("git add -A")

                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 💾 Committing: {commit_msg}")
                    code, c_out, c_err = run_cmd(f'git commit -m "{commit_msg}"')
                    if code != 0 and "nothing to commit" in c_out.lower():
                        pending_sync = False
                        continue

                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🚀 Pushing to GitHub (origin main)...")
                    p_code, p_out, p_err = run_cmd("git push origin main")

                    if p_code == 0:
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ Auto-sync complete! Live on GitHub.\n")
                    else:
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️ Push failed (retrying next cycle): {p_err or p_out}\n")

                    pending_sync = False
                    last_change_time = None

            time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            print("\n🛑 Auto-sync daemon stopped.")
            break
        except Exception as ex:
            print(f"⚠️ Watcher error: {ex}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    auto_sync()
