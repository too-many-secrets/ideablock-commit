# ideablock-commit — Java

Tethers every `git commit` to the Bitcoin blockchain via Ideablock's timeglue service.

---

## Requirements

- Java 11+ (uses `java.net.http` — no external HTTP libraries needed)
- `git` in your PATH

### Check your Java version

```bash
java --version
javac --version
```

---

## Compile

```bash
cd ports/java
javac IdeablockCommit.java
```

---

## Run directly

```bash
java IdeablockCommit init
java IdeablockCommit run
```

---

## Build a runnable JAR (recommended)

```bash
jar cfe ideablock-commit.jar IdeablockCommit IdeablockCommit.class
java -jar ideablock-commit.jar init
```

---

## Install as a CLI command (wrapper script)

Create a shell wrapper so you can call `ideablock-commit` directly:

```bash
cat > /usr/local/bin/ideablock-commit << 'EOF'
#!/bin/bash
exec java -jar /path/to/ports/java/ideablock-commit.jar "$@"
EOF
chmod +x /usr/local/bin/ideablock-commit
```

Replace `/path/to/ports/java/` with the actual absolute path.

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

Or pass them as JVM system properties:

```bash
java -DTIMEGLUE_URL=http://localhost:2312 -jar ideablock-commit.jar run
```

---

## Build with Maven (optional)

Create a `pom.xml` and run:

```bash
mvn package
java -jar target/ideablock-commit-2.0.0.jar run
```

## Build with Gradle (optional)

```bash
gradle jar
java -jar build/libs/ideablock-commit.jar run
```
