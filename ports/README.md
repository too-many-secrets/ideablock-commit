# ideablock-commit — Language Ports

All implementations do the same thing: on every `git commit`, archive the repo, SHA-256 the archive, stamp the hash on Bitcoin via timeglue, save a local `commitData.json`, and best-effort sync to the Ideablock backend.

---

## Ports

| Language | Directory | Entry point | How to build/run |
|---|---|---|---|
| JavaScript (original) | `js/` | `bin/ideablock.js` | `npm install && node bin/ideablock.js <cmd>` |
| Go | `go/` | `main.go` | `go build -o ideablock-commit . && ./ideablock-commit <cmd>` |
| Python | `python/` | `ideablock_commit.py` | `pip install requests && python ideablock_commit.py <cmd>` |
| PHP | `php/` | `ideablock-commit.php` | `php ideablock-commit.php <cmd>` |
| Java | `java/` | `IdeablockCommit.java` | `javac IdeablockCommit.java && java IdeablockCommit <cmd>` |
| Rust | `rust/` | `src/main.rs` | `cargo build --release && ./target/release/ideablock-commit <cmd>` |
| C | `c/` | `ideablock-commit.c` | See compile instructions in file header |
| C++ | `cpp/` | `ideablock-commit.cpp` | See compile instructions in file header |

---

## Commands (all ports)

```
init      Log in to Ideablock, install the git post-commit hook
on        Resume tethering in this repo
off       Pause tethering in this repo
status    Show whether tethering is on or off
remove    Fully uninstall from this repo
run       The hook itself (called automatically on git commit)
logout    Clear cached credentials
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TIMEGLUE_URL` | `http://localhost:2312` | Bitcoin stamping service |
| `IDEABLOCK_API_URL` | `http://localhost:3000` | Ideablock backend |

---

## Dependencies by language

**Go** — stdlib only (no external deps)

**Python** — `pip install requests`

**PHP** — php-curl, php-json (standard extensions)

**Java** — Java 11+ stdlib only (java.net.http)

**Rust** — `serde`, `serde_json`, `sha2`, `reqwest`, `dirs`, `rand`, `chrono` (see `Cargo.toml`)

**C** — libcurl, openssl
```
# macOS
brew install curl openssl
clang -o ideablock-commit c/ideablock-commit.c $(curl-config --libs) -lssl -lcrypto

# Linux
apt install libcurl4-openssl-dev libssl-dev
gcc -o ideablock-commit c/ideablock-commit.c -lcurl -lssl -lcrypto
```

**C++** — libcurl, openssl, optionally nlohmann/json (header-only, for cleaner JSON)
```
# macOS
brew install curl openssl nlohmann-json
clang++ -std=c++17 -o ideablock-commit cpp/ideablock-commit.cpp $(curl-config --libs) -lssl -lcrypto

# Linux
apt install libcurl4-openssl-dev libssl-dev nlohmann-json3-dev
g++ -std=c++17 -o ideablock-commit cpp/ideablock-commit.cpp -lcurl -lssl -lcrypto
```
