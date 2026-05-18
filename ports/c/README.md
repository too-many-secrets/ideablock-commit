# ideablock-commit — C

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- C compiler: `gcc` or `clang`
- `libcurl` — HTTP requests
- `openssl` — SHA-256 hashing
- `git` in your PATH

---

## Install dependencies

### macOS

```bash
brew install curl openssl
```

### Ubuntu / Debian

```bash
sudo apt install gcc libcurl4-openssl-dev libssl-dev
```

### CentOS / RHEL / Fedora

```bash
sudo dnf install gcc libcurl-devel openssl-devel
```

---

## Compile

### macOS

```bash
cd ports/c
clang -o ideablock-commit ideablock-commit.c \
  $(curl-config --libs) \
  -I$(brew --prefix openssl)/include \
  -L$(brew --prefix openssl)/lib \
  -lssl -lcrypto
```

### Linux

```bash
cd ports/c
gcc -o ideablock-commit ideablock-commit.c -lcurl -lssl -lcrypto
```

---

## Install globally

```bash
sudo cp ideablock-commit /usr/local/bin/
sudo chmod +x /usr/local/bin/ideablock-commit
```

Or user-local:

```bash
mkdir -p ~/.local/bin
cp ideablock-commit ~/.local/bin/
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc
source ~/.zshrc
```

---

## Initialize in a git repo

```bash
cd /path/to/your/repo
ideablock-commit init
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

## Strip and optimize the binary (optional)

```bash
# Strip debug symbols (smaller binary)
strip ideablock-commit

# Optimize for size
gcc -Os -o ideablock-commit ideablock-commit.c -lcurl -lssl -lcrypto
strip ideablock-commit
```

---

## Static binary (Linux only — no runtime dependencies)

```bash
gcc -static -o ideablock-commit ideablock-commit.c \
  -lcurl -lssl -lcrypto -lz -lpthread -ldl
```

Note: static builds on macOS are not supported by Apple.
