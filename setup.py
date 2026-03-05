"""
Setup Script
------------
What this does (in plain English):
  Run this ONCE when you first set up the tool. It:
  1. Installs all required Python packages.
  2. Tries to install Whisper (for podcast transcription).
  3. Creates the Windows .bat file on your Desktop so you can double-click to run.
  4. Tells you what API keys you still need to set up.

How to run:
  python setup.py
"""

import subprocess
import sys
import os


def install_requirements():
    """Install all Python packages from requirements.txt."""
    print("[1/3] Installing Python packages...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    req_file = os.path.join(script_dir, "requirements.txt")

    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", req_file],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0:
        print("  [OK] All packages installed successfully.")
    else:
        print("  [WARNING] Some packages may have failed to install.")
        print(f"  Details: {result.stderr[-500:]}")

    return result.returncode == 0


def check_whisper():
    """Check if Whisper is installed and working."""
    print("\n[2/3] Checking Whisper installation...")
    try:
        import whisper
        print("  [OK] Whisper is installed and ready.")
        return True
    except ImportError:
        print("  [INFO] Whisper could not be imported.")
        print("  This might be because:")
        print("    - ffmpeg is not installed (Whisper needs it)")
        print("    - The installation had an error")
        print("")
        print("  To install ffmpeg:")
        print("    Windows: Download from https://ffmpeg.org/download.html")
        print("             or run: winget install ffmpeg")
        print("    Mac:     brew install ffmpeg")
        print("    Linux:   sudo apt install ffmpeg")
        print("")
        print("  The tool will still work without Whisper — it will just use")
        print("  show notes instead of audio transcription for podcasts.")
        return False


def create_bat_file():
    """Create a double-clickable .bat file on the Windows Desktop."""
    print("\n[3/3] Creating Windows .bat launcher...")

    # Find the Desktop path
    desktop = None
    if sys.platform == "win32":
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    else:
        # On Linux/Mac, create it in the project directory instead
        desktop = os.path.dirname(os.path.abspath(__file__))
        print("  [INFO] Not running Windows. Creating .bat file in project folder.")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    main_script = os.path.join(script_dir, "freight_summary.py")
    bat_path = os.path.join(desktop, "Run Freight Summary.bat")

    bat_content = f"""@echo off
echo ============================================================
echo   Weekly Freight Market Summary Tool
echo ============================================================
echo.
cd /d "{script_dir}"
python "{main_script}"
echo.
echo ============================================================
echo   Press any key to close this window.
echo ============================================================
pause >nul
"""

    with open(bat_path, "w") as f:
        f.write(bat_content)

    print(f"  [OK] Bat file created: {bat_path}")
    if sys.platform == "win32":
        print("  Double-click it on your Desktop to run the freight summary tool!")

    return bat_path


def print_api_key_instructions():
    """Print instructions for getting API keys."""
    print("\n" + "=" * 60)
    print("  API KEY SETUP INSTRUCTIONS")
    print("=" * 60)
    print("""
You need TWO API keys. Here's where to get them:

1. ANTHROPIC (Claude) API KEY  [REQUIRED]
   - Go to: https://console.anthropic.com/
   - Sign up or log in
   - Go to "API Keys" in the left sidebar
   - Click "Create Key"
   - Copy the key and paste it into config.yaml under:
     api_keys:
       anthropic_api_key: "sk-ant-..."
   - Cost: Pay-as-you-go. Each weekly report costs roughly $0.02-0.10.

2. SENDGRID API KEY  [OPTIONAL - for email delivery]
   - Go to: https://signup.sendgrid.com/
   - Sign up for the FREE tier (100 emails/day)
   - Go to: Settings > API Keys
   - Click "Create API Key"
   - Give it "Full Access" or at minimum "Mail Send" access
   - Copy the key and paste it into config.yaml under:
     api_keys:
       sendgrid_api_key: "SG...."
   - ALSO: You must verify a "Sender Identity" in SendGrid:
     Go to Settings > Sender Authentication
     and verify the email address you put in config.yaml's
     email > from_email field.

After adding your keys, edit config.yaml to also set:
  - email > from_email: your verified SendGrid sender email
  - email > to_email: where you want the report sent
""")
    print("=" * 60)


def main():
    print("=" * 60)
    print("  FREIGHT MARKET SUMMARY TOOL - SETUP")
    print("=" * 60)
    print()

    install_requirements()
    check_whisper()
    create_bat_file()
    print_api_key_instructions()

    print("\n  Setup complete!")
    print("  Next steps:")
    print("    1. Add your API keys to config.yaml")
    print("    2. Edit the YouTube channels and podcast feeds in config.yaml")
    print("    3. Run: python freight_summary.py")
    print("=" * 60)


if __name__ == "__main__":
    main()
