# ideablock-commit — C++

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- C++17 compiler: `clang++` or `g++`
- `libcurl` — HTTP requests
- `openssl` — SHA-256 hashing
- `nlohmann/json` — JSON parsing (header-only, optional but recommended)
- `git` in your PATH

---

## Install dependencies

### macOS

```bash
brew install curl openssl nlohmann-json
```

### Ubuntu / Debian

```bash
sudo apt install clang libcurl4-openssl-dev libssl-dev nlohmann-json3-dev
```

### CentOS / RHEL / Fedora

```bash
sudo dnf install clang libcurl-devel openssl-devel
# nlohmann-json: download manually (header-only)
curl -L https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp \
  -o ports/cpp/json.hpp
```

---

## Compile

### macOS (clang++)

```bash
cd ports/cpp
clang++ -std=c++17 -o ideablock-commit ideablock-commit.cpp \
  $(curl-config --libs) \
  -I$(brew --prefix openssl)/include \
  -I$(brew --prefix nlohmann-json)/include \
  -L$(brew --prefix openssl)/lib \
  -lssl -lcrypto
```

### Linux (g++)

```bash
cd ports/cpp
g++ -std=c++17 -o ideablock-commit ideablock-commit.cpp \
  -lcurl -lssl -lcrypto
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

## Optimize the binary (optional)

```bash
# Release build with optimizations
clang++ -std=c++17 -O2 -o ideablock-commit ideablock-commit.cpp \
  $(curl-config --libs) -lssl -lcrypto

# Strip debug symbols
strip ideablock-commit
```

---

## nlohmann/json (optional)

The source file detects `json.hpp` at compile time via `__has_include`. If the header is present, it uses the full nlohmann JSON parser. If not, it falls back to minimal regex-based JSON extraction. For production use, install nlohmann/json.
