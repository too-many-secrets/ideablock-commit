# ideablock-commit — JavaScript (Node.js, original)

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
export TIMEGLUE_URL=http://localhost:2312      # Bitcoin stamping service
export IDEABLOCK_API_URL=http://localhost:3000 # Ideablock backend
```

---

## Uninstall

```bash
npm uninstall -g ideablock-commit
```
