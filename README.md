<p align="center">
  <img src="https://i.ibb.co/gLBZHSgr/IB-commit.png"/>
</p>

# Ideablock Commit — Setup & Development Guide

Automatically tethers every `git commit` to the Bitcoin blockchain using [Ideablock](https://ideablock.com) services.

---

## Clients

Two supported clients, and both anchor an identical value:

| Client | Install | Needs |
|---|---|---|
| **Node CLI** | `npm install -g ideablock-commit` | Node 18+ |
| **Go binary** | [download a release](https://github.com/too-many-secrets/ideablock-commit/releases) | nothing — single static binary |

The Go binary exists for people who would rather not install Node. Either
produces the same on-chain record for the same commit.

`ports/` holds implementations in seven further languages — Rust, Python, PHP,
Java, C, C++, and plain Node. **They are reference implementations, not
supported clients.** They document that the hashing and anchoring format can be
reproduced anywhere, which matters for a record meant to be independently
verifiable. They are not built, released, or kept in step release-to-release,
and they authenticate with a session token that expires after fifteen minutes,
which makes them unsuitable for a hook that runs unattended. Read them; do not
depend on them.

## Prerequisites

- An [Ideablock](https://app.ideablock.com) account (for authentication)
- `git` on your `PATH` — the tool shells out to `git archive` and `git log`.
  On Windows that means [Git for Windows](https://git-scm.com/download/win),
  which also provides the shell that runs the commit hook.
- Node 18 or later, for the Node CLI

## Install globally

```bash
npm install -g ideablock-commit
```

Or from a clone:

```bash
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

## How it works

On every `git commit`, the hook automatically:

1. Reads your auth token from `~/.ideablock/auth.json`
2. Gets the git short hash of the new commit (e.g. `f99a94c`)
3. Gets the commit message
4. Archives the repo via `git archive` → `~/.ideablock/commits/{repo}/{hash}/Commit-{hash}.zip`
5. SHA-256s the archive → **Repository Hash**
6. Derives the **Parity Digit**: the hex digits of `shortHash + repoHash`, summed, mod 10
7. Constructs the **Bitcoin-Tethered Hash**: `shortHash + repoHash + parityDigit`
8. POSTs the Bitcoin-Tethered Hash to Ideablock, which anchors it → receives a Bitcoin transaction ID
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

The OP_RETURN output contains the Ideablock prefix (`**IDEA**`) followed by the
**Bitcoin-Tethered Hash** — permanent, public proof that your code existed at
that block height.

### Verifying a stamp yourself

Every character of the anchored value is reproducible from the archive alone.
Given `Commit-{hash}.zip`:

```bash
shortHash=$(git log -1 --pretty=format:%h)
repoHash=$(shasum -a 256 "Commit-${shortHash}.zip" | cut -d' ' -f1)

combined="${shortHash}${repoHash}"
sum=0
for (( i=0; i<${#combined}; i++ )); do
  sum=$(( sum + 16#${combined:i:1} ))
done

echo "${combined}$(( sum % 10 ))"
```

(Requires bash, not sh — it uses bash arithmetic and substring syntax.)

That value should match the OP_RETURN payload after the `**IDEA**` prefix.

### Anchor formats

Three formats exist on chain. Which one a given stamp uses is recorded against
the commit in Ideablock, so verification never has to guess:

| Format | Payload | Length | Written by |
|---|---|---|---|
| 1 | `sha256(archive)` | 64 | npm ≤ 2.1.0, and all language ports before this release |
| 2 | `shortHash + repoHash + random digit` | 72 | the composite window, between 2.1.0 and this release |
| 3 | `shortHash + repoHash + derived digit` | 72 | current — fully recomputable, as above |

Formats 2 and 3 are the same shape and cannot be told apart from the payload
alone. **A format-2 stamp will not reproduce the derived parity digit**, and
that mismatch means the format, not a tampered record. Verify format 2 by
checking the first 71 characters and disregarding the last.

---

## Troubleshooting


**"Not authenticated. Run ideablock-commit init"**
Your `~/.ideablock/auth.json` is missing. Run `ideablock-commit init` in any
git repo to re-authenticate.  If you do not have a registered account, obtain one by [registering](https://app.ideablock.com/register)
