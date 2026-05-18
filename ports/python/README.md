# ideablock-commit — Python

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- Python 3.8+
- `git` in your PATH

---

## Install dependencies

```bash
pip install requests
```

Or with a virtual environment (recommended):

```bash
cd ports/python
python3 -m venv .venv
source .venv/bin/activate
pip install requests
```

---

## Install as a CLI command

```bash
chmod +x ideablock_commit.py
sudo ln -s $(pwd)/ideablock_commit.py /usr/local/bin/ideablock-commit
```

Or without sudo (user-local):

```bash
mkdir -p ~/.local/bin
ln -s $(pwd)/ideablock_commit.py ~/.local/bin/ideablock-commit
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc
source ~/.zshrc
```

---

## Initialize in a git repo

```bash
cd /path/to/your/repo
ideablock-commit init
```

Or run directly without installing:

```bash
python3 /path/to/ports/python/ideablock_commit.py init
```

---

## Commands

```bash
ideablock-commit init      # Log in and install the post-commit hook
ideablock-commit on        # Resume tethering
ideablock-commit off       # Pause tethering
ideablock-commit status    # Check whether tethering is on or off
ideablock-commit remove    # Uninstall from this repo
ideablock-commit logout    # Clear cached credentials
```

---

## Environment variables

```bash
export TIMEGLUE_URL=http://localhost:2312      # Bitcoin stamping service
export IDEABLOCK_API_URL=http://localhost:3000 # Ideablock backend
```

---

## Package with PyInstaller (optional — single binary, no Python needed)

```bash
pip install pyinstaller
pyinstaller --onefile ideablock_commit.py --name ideablock-commit
# Binary at: dist/ideablock-commit
```
