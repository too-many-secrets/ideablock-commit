# ideablock-commit — Language Ports

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
| `IDEABLOCK_API_URL` | `https://app.ideablock.com` | Ideablock backend |

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
