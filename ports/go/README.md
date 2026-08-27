# ideablock-commit — Go

> **Supported client.**
>
> Along with the Node CLI, this is one of two clients Ideablock builds,
> releases and keeps current. Binaries for macOS, Linux and Windows are
> attached to every
> [release](https://github.com/too-many-secrets/ideablock-commit/releases) with
> the production API baked in — no Node, no toolchain, nothing to configure.
>
> Build from source only if you want to; the released binary is the same code.

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- Go 1.22+
- `git` in your PATH

---

## Build

```bash
cd ports/go
go mod tidy
go build -o ideablock-commit .
```

## Install globally

```bash
go install .
```

This puts `ideablock-commit` in `$GOPATH/bin` (usually `~/go/bin`). Make sure that's in your `$PATH`:

```bash
echo 'export PATH="$PATH:$(go env GOPATH)/bin"' >> ~/.zshrc
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
export IDEABLOCK_API_URL=https://app.ideablock.com # Ideablock backend
```

---

## Run tests

```bash
go test ./...
```

---

## Cross-compile for other platforms

```bash
# Linux (from macOS)
GOOS=linux GOARCH=amd64 go build -o ideablock-commit-linux .

# Windows
GOOS=windows GOARCH=amd64 go build -o ideablock-commit.exe .

# Apple Silicon
GOOS=darwin GOARCH=arm64 go build -o ideablock-commit-arm64 .
```
