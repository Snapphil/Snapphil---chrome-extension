# setup_reactnative_env.py
# Windows automation to prepare a React Native + Expo cross‑platform dev env rooted at D:\ReactNative
# - Creates folders under D:\ReactNative
# - Installs Node LTS & JDK 17 via winget (silent)
# - Installs Android command-line tools into D:\ReactNative\Android\Sdk and required SDK packages
# - Creates an Android AVD (Pixel_8_API_35)
# - Scaffolds an Expo app in D:\ReactNative\dev\apps\universal-app
#
# Run this from an elevated (Administrator) PowerShell or CMD.
# Recommended: execute `run_setup.bat` (it will create a venv and run this script automatically).

import os
import sys
import subprocess
import shutil
import zipfile
import tempfile
from pathlib import Path
from time import sleep

ROOT = Path(r"D:\ReactNative")
TOOLS = ROOT / "tools"
SDK_ROOT = ROOT / "Android" / "Sdk"
AVD_HOME = ROOT / "Android" / ".android" / "avd"
APPS = ROOT / "dev" / "apps"
LOG = ROOT / "setup_log.txt"

# Android packages to install (adjust as needed)
ANDROID_PACKAGES = [
    "platform-tools",
    "platforms;android-35",
    "emulator",
    "system-images;android-35;google_apis;x86_64",
    # You can add build-tools when needed, they're not required just to run the emulator
    # "build-tools;35.0.0",
]

# Multiple known URLs for commandline-tools "latest" — the script will try each until one works.
CMDLINE_TOOLS_CANDIDATES = [
    # Newer first (these move occasionally; we'll try several)
    "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip",
    "https://dl.google.com/android/repository/commandlinetools-win-10406996_latest.zip",
    "https://dl.google.com/android/repository/commandlinetools-win-9477386_latest.zip",
]

def log(msg):
    text = f"[setup] {msg}"
    print(text, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception:
        pass

def run(cmd, check=True, env=None, shell=False):
    log(f"$ {' '.join(cmd) if isinstance(cmd, (list, tuple)) else cmd}")
    completed = subprocess.run(cmd, check=False, capture_output=True, text=True, env=env, shell=shell)
    if completed.stdout:
        log(completed.stdout.strip())
    if completed.stderr:
        log(completed.stderr.strip())
    if check and completed.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {completed.returncode}: {cmd}")
    return completed

def ensure_admin():
    # Simple check: many winget installs require admin; warn if not elevated.
    try:
        import ctypes
        is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0
        if not is_admin:
            log("WARNING: Not running as Administrator. Some installs (winget, PATH edits) may fail.")
    except Exception:
        log("NOTE: Could not determine admin status. Proceeding...")

def ensure_dirs():
    for p in [ROOT, TOOLS, SDK_ROOT, AVD_HOME, APPS]:
        p.mkdir(parents=True, exist_ok=True)
    log(f"Folders ensured under {ROOT}")

def has_winget():
    try:
        run(["winget", "--version"], check=False)
        return True
    except Exception:
        return False

def winget_install(id_or_name, exact_id=True):
    # Uses winget to install silently. Returns True if success or already installed.
    if not has_winget():
        log("winget not found. Skipping winget install step.")
        return False
    args = ["winget", "install", "--silent", "--accept-package-agreements", "--accept-source-agreements"]
    if exact_id:
        args += ["-e", "--id", id_or_name]
    else:
        args += [id_or_name]
    try:
        c = run(args, check=False)
        # winget returns 0 on success, 0x0/0 also for already installed (often). We'll treat non-crashing as success.
        return c.returncode == 0
    except Exception as e:
        log(f"winget install failed for {id_or_name}: {e}")
        return False

def ensure_node():
    # Try Node via winget (LTS)
    log("Installing Node.js LTS via winget (if missing)...")
    ok = winget_install("OpenJS.NodeJS.LTS")
    # Check Node version
    try:
        out = run(["node", "-v"], check=False)
        ver = (out.stdout or "").strip()
        log(f"Detected Node version: {ver}")
        if not ver:
            raise RuntimeError("Node not found on PATH after installation.")
        # Basic major check
        major = int(ver.strip().lstrip('v').split('.')[0])
        if major < 18:
            raise RuntimeError(f"Node version {ver} is too old; need >= 18.")
    except Exception as e:
        log(f"Node check failed: {e}")
        raise

def ensure_java():
    # Install Microsoft OpenJDK 17 via winget
    log("Installing Microsoft OpenJDK 17 via winget (if missing)...")
    winget_install("Microsoft.OpenJDK.17")
    # Try to find JAVA_HOME
    java_home = None
    # Common default
    candidates = [
        Path("C:/Program Files/Microsoft/jdk-17"),
        Path("C:/Program Files (x86)/Microsoft/jdk-17"),
    ]
    for c in candidates:
        if c.exists():
            java_home = c
            break
    # Fallback: ask `where java`
    if java_home is None:
        try:
            out = run(["where", "java"], check=False, shell=True)
            for line in (out.stdout or "").splitlines():
                p = Path(line.strip()).resolve()
                if p.name.lower() == "java.exe":
                    # usually .../bin/java.exe -> strip /bin/java.exe
                    java_home = p.parent.parent
                    break
        except Exception:
            pass
    if java_home is None:
        log("WARNING: Could not locate JAVA_HOME automatically. Please install JDK 17 manually.")
    else:
        os.environ["JAVA_HOME"] = str(java_home)
        # Persist for future terminals
        run(["setx", "JAVA_HOME", str(java_home)], check=False, shell=True)
        log(f"Using JAVA_HOME={java_home}")

def download(url, dest):
    import urllib.request
    CHUNK=1024*256
    log(f"Downloading: {url}")
    with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        downloaded = 0
        while True:
            chunk = r.read(CHUNK)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = int(downloaded*100/total)
                print(f"\r... {pct}% ({downloaded//1024//1024} MB/{total//1024//1024} MB)", end="", flush=True)
    print()
    log(f"Saved to {dest}")

def ensure_cmdline_tools():
    # Install Android cmdline-tools into SDK_ROOT\cmdline-tools\latest
    target = SDK_ROOT / "cmdline-tools" / "latest"
    if (target / "bin" / "sdkmanager.bat").exists():
        log("Android command-line tools already present.")
        return target
    (SDK_ROOT / "cmdline-tools").mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        zip_path = Path(td) / "cmdline-tools.zip"
        # Try multiple URLs
        for url in CMDLINE_TOOLS_CANDIDATES:
            try:
                download(url, zip_path)
                with zipfile.ZipFile(zip_path, "r") as z:
                    z.extractall(td)
                # Google zips folder named "cmdline-tools"
                src = Path(td) / "cmdline-tools"
                if not src.exists():
                    # Sometimes content is at root — find folder with "bin"
                    for p in Path(td).iterdir():
                        if (p / "bin").exists():
                            src = p
                            break
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                shutil.move(str(src), str(target))
                log(f"Installed cmdline-tools to {target}")
                return target
            except Exception as e:
                log(f"Failed with URL {url}: {e}")
                continue
        raise RuntimeError("Could not download Android command-line tools from any known URL.")

def persist_env_vars():
    # Set ANDROID_HOME & ANDROID_AVD_HOME and augment PATH
    os.environ["ANDROID_HOME"] = str(SDK_ROOT)
    os.environ["ANDROID_AVD_HOME"] = str(AVD_HOME)
    run(["setx", "ANDROID_HOME", str(SDK_ROOT)], check=False, shell=True)
    run(["setx", "ANDROID_AVD_HOME", str(AVD_HOME)], check=False, shell=True)

    # Update PATH: add platform-tools, emulator, cmdline-tools/latest/bin
    paths_to_add = [
        str(SDK_ROOT / "platform-tools"),
        str(SDK_ROOT / "emulator"),
        str(SDK_ROOT / "cmdline-tools" / "latest" / "bin"),
    ]

    # Read current user PATH and append missing entries
    try:
        out = run(["reg", "query", r"HKCU\Environment", "/v", "Path"], check=False, shell=True)
        current = ""
        for line in (out.stdout or "").splitlines():
            if "REG_" in line and "Path" in line:
                current = line.split("Path",1)[1].split("REG_")[1].split(None,1)[1]
                break
    except Exception:
        current = os.environ.get("Path", "")

    parts = [p.strip() for p in current.split(";") if p.strip()]
    for p in paths_to_add:
        if p.lower() not in [q.lower() for q in parts]:
            parts.append(p)
    new_path = ";".join(parts)
    # Persist
    run(["setx", "Path", new_path], check=False, shell=True)
    log("Updated user PATH with Android SDK tools (new terminals will pick this up).")

def sdkmanager(cmdline_tools_path):
    bat = cmdline_tools_path / "bin" / "sdkmanager.bat"
    if not bat.exists():
        raise FileNotFoundError(f"sdkmanager not found at {bat}")
    return str(bat)

def avdmanager(cmdline_tools_path):
    bat = cmdline_tools_path / "bin" / "avdmanager.bat"
    if not bat.exists():
        raise FileNotFoundError(f"avdmanager not found at {bat}")
    return str(bat)

def ensure_android_packages(cmdline_tools_path):
    sdkmgr = sdkmanager(cmdline_tools_path)
    env = os.environ.copy()
    env["ANDROID_HOME"] = str(SDK_ROOT)
    env["ANDROID_SDK_ROOT"] = str(SDK_ROOT)

    # Accept licenses
    log("Accepting Android SDK licenses...")
    proc = subprocess.Popen([sdkmgr, "--licenses", f"--sdk_root={SDK_ROOT}"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    try:
        # Feed 'y' repeatedly
        for _ in range(50):
            try:
                proc.stdin.write("y\n")
                proc.stdin.flush()
            except Exception:
                break
            sleep(0.05)
        proc.communicate(timeout=300)
    except subprocess.TimeoutExpired:
        proc.kill()

    # Install required packages
    for pkg in ANDROID_PACKAGES:
        log(f"Installing Android package: {pkg}")
        run([sdkmgr, pkg, f"--sdk_root={SDK_ROOT}"], check=True, env=env)

def ensure_avd(cmdline_tools_path):
    avdmgr = avdmanager(cmdline_tools_path)
    env = os.environ.copy()
    env["ANDROID_HOME"] = str(SDK_ROOT)
    env["ANDROID_SDK_ROOT"] = str(SDK_ROOT)

    # List existing AVDs
    out = run([avdmgr, "list", "avd"], check=False, env=env)
    if "Pixel_8_API_35" in (out.stdout or ""):
        log("AVD 'Pixel_8_API_35' already exists.")
        return

    # Create one
    log("Creating AVD 'Pixel_8_API_35' (system image: android-35, google_apis, x86_64)...")
    # Device id might vary; we try with --device pixel_8, fallback to generic
    cmd = [avdmgr, "create", "avd", "-n", "Pixel_8_API_35", "-k", "system-images;android-35;google_apis;x86_64", "--device", "pixel_8"]
    c = run(cmd, check=False, env=env)
    if c.returncode != 0:
        log("Retrying AVD creation without --device...")
        run([avdmgr, "create", "avd", "-n", "Pixel_8_API_35", "-k", "system-images;android-35;google_apis;x86_64"], check=True, env=env)

def ensure_expo_app():
    APPS.mkdir(parents=True, exist_ok=True)
    project = APPS / "universal-app"
    if not project.exists():
        log("Scaffolding Expo app (create-expo-app)... this can take a few minutes.")
        # Use npx to fetch latest
        run(["npx", "create-expo-app@latest", "universal-app"], check=True, env=os.environ.copy(), shell=False,)
    else:
        log("Expo app already exists; skipping scaffold.")
    # Print next steps
    log(f"Project ready at: {project}")
    log(r"Start the dev server with:")
    log(fr"  cd {project}")
    log(r"  npx expo start")
    log(r"  (press 'a' for Android emulator, scan QR for iOS with Expo Go, or press 'w' for web)")

def main():
    ensure_admin()
    ensure_dirs()

    # 1) Node & JDK
    ensure_node()
    ensure_java()

    # 2) Android commandline tools + packages + AVD
    tools_path = ensure_cmdline_tools()
    persist_env_vars()
    ensure_android_packages(tools_path)
    ensure_avd(tools_path)

    # 3) Expo project
    ensure_expo_app()

    log("✅ All done! Open a NEW terminal so the updated PATH is picked up, then:")
    log(fr"   cd {APPS / 'universal-app'} && npx expo start")

if __name__ == "__main__":
    main()
