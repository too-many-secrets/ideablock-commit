# ideablock-commit — Python

> **Reference implementation — not a supported client.**
>
> This port documents that Ideablock's hashing and anchoring format can be
> reproduced in any language, which is the point of a record meant to be
> independently verifiable. It is not built, released, or guaranteed to stay in
> step with the supported clients, and it authenticates with a session token
> that expires after fifteen minutes — unsuitable for a hook that runs on every
> commit, unattended.
>
> The supported clients are the **Node CLI** (`npm install -g ideablock-commit`)
> and the **Go binary** ([releases](https://github.com/too-many-secrets/ideablock-commit/releases)).

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
export IDEABLOCK_API_URL=https://app.ideablock.com # Ideablock backend
```

---

## Package with PyInstaller (optional — single binary, no Python needed)

```bash
pip install pyinstaller
pyinstaller --onefile ideablock_commit.py --name ideablock-commit
# Binary at: dist/ideablock-commit
```
