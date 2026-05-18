# ideablock-commit — Rust

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- Rust 1.70+ (install via [rustup.rs](https://rustup.rs))
- `git` in your PATH

### Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustc --version
```

---

## Build

```bash
cd ports/rust
cargo build --release
```

Binary is at `target/release/ideablock-commit`.

---

## Install globally

```bash
cargo install --path .
```

This puts `ideablock-commit` in `~/.cargo/bin`, which Rust adds to your PATH automatically during installation.

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

## Run tests

```bash
cargo test
```

---

## Cross-compile

```bash
# Add a target
rustup target add x86_64-unknown-linux-musl

# Build a fully static Linux binary (no libc dependency)
cargo build --release --target x86_64-unknown-linux-musl

# macOS Apple Silicon → Intel
rustup target add x86_64-apple-darwin
cargo build --release --target x86_64-apple-darwin

# Windows
rustup target add x86_64-pc-windows-gnu
cargo build --release --target x86_64-pc-windows-gnu
```

---

## Dependencies (`Cargo.toml`)

| Crate | Purpose |
|---|---|
| `serde` + `serde_json` | JSON serialization |
| `sha2` | SHA-256 hashing |
| `reqwest` (blocking) | HTTP POST to timeglue and Ideablock API |
| `dirs` | Cross-platform home directory |
| `rand` | Parity digit generation |
| `chrono` | ISO 8601 timestamps |
