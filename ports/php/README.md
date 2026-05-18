# ideablock-commit — PHP

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- PHP 8.0+
- Extensions: `php-curl`, `php-json`, `php-posix`
- `git` in your PATH

### Check your PHP version and extensions

```bash
php --version
php -m | grep -E "curl|json"
```

### Install extensions if missing

```bash
# macOS (Homebrew)
brew install php
# curl and json are included by default

# Ubuntu / Debian
sudo apt install php php-curl php-json

# CentOS / RHEL
sudo yum install php php-curl php-json
```

---

## Install as a CLI command

```bash
chmod +x ports/php/ideablock-commit.php

# System-wide
sudo ln -s $(pwd)/ports/php/ideablock-commit.php /usr/local/bin/ideablock-commit

# User-local (no sudo)
mkdir -p ~/.local/bin
ln -s $(pwd)/ports/php/ideablock-commit.php ~/.local/bin/ideablock-commit
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc
source ~/.zshrc
```

---

## Initialize in a git repo

```bash
cd /path/to/your/repo
ideablock-commit init
```

Or run directly without installing:

```bash
php /path/to/ports/php/ideablock-commit.php init
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

Or set them inline per-command:

```bash
TIMEGLUE_URL=http://myserver:2312 php ideablock-commit.php run
```

---

## Package as a Phar (optional — single-file executable)

```bash
# In php.ini, set: phar.readonly = Off
php -d phar.readonly=0 -r "
\$p = new Phar('ideablock-commit.phar');
\$p->addFile('ideablock-commit.php', 'index.php');
\$p->setStub('#!/usr/bin/env php' . PHP_EOL . Phar::createDefaultStub('index.php'));
"
chmod +x ideablock-commit.phar
```
