#≈
# ideablock-commit — Setup & Development Guide

Automatically tethers every `git commit` to the Bitcoin blockchain via the
Ideablock [timeglue](https://github.com/too-many-secrets/timeglue) service.

---

## Prerequisites

- Node.js 16+ and npm
- git
- [timeglue](https://github.com/too-many-secrets/timeglue) running locally or
  accessible at a known URL
- An Ideablock account (for auth)

---

## Install globally

```bash
# From this repo root
npm install
npm install -g .
```

Verify:

```bash
ideablock-commit --help
```

---

## Initialize in a git repo

From the root of any git repository:

```bash
ideablock-commit init
```

This will:
1. Prompt for your Ideablock email and password (first time only)
2. Cache your auth token at `~/.ideablock/auth.json`
3. Install a `post-commit` git hook that fires `ideablock-commit run` on every commit
4. Create a `.ideablock/` config directory in the repo

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TIMEGLUE_URL` | `http://localhost:2312` | Base URL for the timeglue Bitcoin stamping service |
| `IDEABLOCK_API_URL` | `http://localhost:3000` | Base URL for the Ideablock backend API |

Set them in your shell or a `.env` file in the repo root.

---

## Running timeglue locally (for testing)

```bash
cd /path/to/timeglue

# Mock mode — no real BTC spent, fake txids returned
MOCK_MODE=true ./timeglue
```

timeglue must be running before you make a commit, or the hook will log a
warning and exit gracefully without blocking your commit.

---

## How it works

On every `git commit`, the hook automatically:

1. Reads your auth token from `~/.ideablock/auth.json`
2. Gets the git short hash of the new commit (e.g. `f99a94c`)
3. Gets the commit message
4. Archives the repo via `git archive` → `~/.ideablock/commits/{repo}/{hash}/Commit-{hash}.zip`
5. SHA-256s the archive → **Repository Hash**
6. Generates a random **Parity Digit** (0–9)
7. Constructs the **Blockchain-Tethered Hash**: `shortHash + repoHash + parityDigit`
8. POSTs the Repository Hash to timeglue → receives a Bitcoin transaction ID
9. Saves a `commitData.json` record locally at `~/.ideablock/commits/{repo}/{hash}/`
10. Best-effort syncs the record to the Ideablock backend for webapp display
11. Prints the commit information table to your terminal

---

## Local data

All commit records are stored at:

```
~/.ideablock/commits/{repoName}/{gitShortHash}/
  Commit-{shortHash}.zip   ← snapshot of the repo at commit time
  commitData.json          ← all hash and blockchain data
```

**Do not delete this directory.** It is your local proof-of-existence archive.

`commitData.json` structure:

```json
{
  "repoName": "my-project",
  "shortHash": "f99a94c",
  "commitMessage": "fix: update auth flow",
  "repoHash": "c9c3ad5b...",
  "parityDigit": 5,
  "blockchainTetheredHash": "f99a94cc9c3ad5b...5",
  "btcTxID": "a9369cd8...",
  "committedAt": "2026-05-18T12:00:00.000Z"
}
```

---

## Commands

```bash
ideablock-commit init      # Initialize in a git repo (installs hook, prompts login)
ideablock-commit on        # Resume tethering in this repo
ideablock-commit off       # Pause tethering in this repo
ideablock-commit status    # Check whether tethering is on or off
ideablock-commit remove    # Remove hook and .ideablock config from this repo
```

---

## Verify a stamp on-chain

After a commit, look up the Bitcoin transaction ID on
[mempool.space](https://mempool.space):

```
https://mempool.space/tx/{btcTxID}
```

The OP_RETURN output will contain the Ideablock prefix followed by the
Repository Hash — permanent, public proof that your code existed at that
block height.

---

## Troubleshooting

**"Failed to tether commit to Bitcoin blockchain"**
timeglue isn't running. Start it first: `MOCK_MODE=true ./timeglue`

**"Not authenticated. Run ideablock-commit init"**
Your `~/.ideablock/auth.json` is missing. Run `ideablock-commit init` in any
git repo to re-authenticate.

**"⚠️ Could not sync commit record to Ideablock"**
The Ideablock backend is unreachable. Your commit and local record are still
saved — the sync will not retry automatically. Check that the backend is running.

