# ideablock-commit — JavaScript (Node.js, original)

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

- Node.js 16+
- npm
- `git` in your PATH

### Check your Node version

```bash
node --version
npm --version
```

---

## Install dependencies

```bash
cd ports/js
npm install
```

---

## Install globally

```bash
npm install -g .
```

Verify:

```bash
ideablock-commit --help
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

Or run without installing globally:

```bash
node bin/ideablock.js init
node bin/ideablock.js run
```

---

## Environment variables

```bash
export IDEABLOCK_API_URL=https://app.ideablock.com # Ideablock backend
```

---

## Uninstall

```bash
npm uninstall -g ideablock-commit
```
