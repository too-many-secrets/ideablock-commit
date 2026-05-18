/**
 * ideablock-commit — Java port
 *
 * Tethers every git commit to the Bitcoin blockchain via Ideablock's
 * timeglue service.
 *
 * Requirements: Java 11+
 *
 * Compile:
 *   javac IdeablockCommit.java
 *
 * Run:
 *   java IdeablockCommit <init|on|off|status|remove|run|logout>
 *
 * Build fat JAR:
 *   jar cfe ideablock-commit.jar IdeablockCommit IdeablockCommit.class
 *   java -jar ideablock-commit.jar run
 */

import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.net.http.HttpResponse.BodyHandlers;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.security.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

public class IdeablockCommit {

    // ── Config ────────────────────────────────────────────────────────────────

    static final String TIMEGLUE_URL =
        System.getenv().getOrDefault("TIMEGLUE_URL", "http://localhost:2312");
    static final String IDEABLOCK_API =
        System.getenv().getOrDefault("IDEABLOCK_API_URL", "http://localhost:3000");
    static final Path HOME = Path.of(System.getProperty("user.home"));
    static final Path AUTH_FILE = HOME.resolve(".ideablock/auth.json");
    static final Path CONF_FILE = Path.of(".ideablock/ideablock.json");
    static final Path HOOK_SCRIPT = Path.of(".ideablock/post-commit");
    static final Path GIT_HOOK = Path.of(".git/hooks/post-commit");
    static final String HOOK_CONTENT = "#!/bin/bash\nideablock-commit run\n";

    static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();

    // ── Tiny JSON helpers (no external deps) ──────────────────────────────────

    /** Extract a string value from a flat JSON object. */
    static String jsonGet(String json, String key) {
        Pattern p = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"([^\"]+)\"");
        Matcher m = p.matcher(json);
        return m.find() ? m.group(1) : "";
    }

    /** Extract a numeric value from a flat JSON object. */
    static long jsonGetLong(String json, String key) {
        Pattern p = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*(\\d+)");
        Matcher m = p.matcher(json);
        return m.find() ? Long.parseLong(m.group(1)) : 0L;
    }

    /** Build a simple flat JSON object from key-value pairs. */
    static String buildJSON(Object... pairs) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < pairs.length; i += 2) {
            if (i > 0) sb.append(",");
            sb.append("\"").append(pairs[i]).append("\":");
            Object v = pairs[i + 1];
            if (v instanceof Number) sb.append(v);
            else sb.append("\"").append(escapeJSON(v.toString())).append("\"");
        }
        return sb.append("}").toString();
    }

    static String escapeJSON(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    static boolean isGitRepo() { return Files.isDirectory(Path.of(".git")); }

    static boolean isOn() {
        try {
            if (!Files.exists(CONF_FILE)) return false;
            String json = Files.readString(CONF_FILE);
            return json.contains("\"on\":true") || json.contains("\"on\": true");
        } catch (IOException e) { return false; }
    }

    static void writeConf(boolean on) throws IOException {
        Files.createDirectories(CONF_FILE.getParent());
        Files.writeString(CONF_FILE, "{\"on\":" + on + "}");
    }

    static String readAuth() {
        try {
            if (!Files.exists(AUTH_FILE)) return "";
            return Files.readString(AUTH_FILE);
        } catch (IOException e) { return ""; }
    }

    static void writeAuth(String json) throws IOException {
        Files.createDirectories(AUTH_FILE.getParent());
        Files.writeString(AUTH_FILE, json);
        setPermissions(AUTH_FILE, Set.of(
            PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
    }

    static void writeHook(Path path) throws IOException {
        Files.createDirectories(path.getParent());
        Files.writeString(path, HOOK_CONTENT);
        setPermissions(path, Set.of(
            PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
            PosixFilePermission.OWNER_EXECUTE,
            PosixFilePermission.GROUP_READ, PosixFilePermission.GROUP_EXECUTE,
            PosixFilePermission.OTHERS_READ, PosixFilePermission.OTHERS_EXECUTE));
    }

    static void setPermissions(Path path, Set<PosixFilePermission> perms) {
        try { Files.setPosixFilePermissions(path, perms); } catch (Exception ignored) {}
    }

    static String gitOutput(String... args) throws IOException, InterruptedException {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        cmd.addAll(Arrays.asList(args));
        Process p = new ProcessBuilder(cmd).start();
        String out = new String(p.getInputStream().readAllBytes()).strip();
        p.waitFor();
        return out;
    }

    static String sha256File(Path path) throws IOException, NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream is = Files.newInputStream(path)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = is.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    static String repoName() { return Path.of("").toAbsolutePath().getFileName().toString(); }

    /** POST JSON, returns response body or null on error. */
    static String postJSON(String url, String json, String token) {
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .timeout(Duration.ofSeconds(30));
            if (token != null && !token.isEmpty())
                rb.header("Authorization", "Bearer " + token);
            HttpResponse<String> resp = HTTP.send(rb.build(), BodyHandlers.ofString());
            return resp.statusCode() + "|" + resp.body();
        } catch (Exception e) { return null; }
    }

    static void deleteRecursive(Path path) throws IOException {
        if (!Files.exists(path)) return;
        Files.walk(path).sorted(Comparator.reverseOrder()).forEach(p -> {
            try { Files.delete(p); } catch (IOException ignored) {}
        });
    }

    // ── Commands ──────────────────────────────────────────────────────────────

    static void cmdInit() throws Exception {
        if (!isGitRepo()) { System.out.println("\n\t❗ Not a git repository."); return; }

        String authJson = readAuth();
        long now = Instant.now().getEpochSecond();
        if (!authJson.isEmpty()) {
            long expires = jsonGetLong(authJson, "token_expires");
            String token = jsonGet(authJson, "token");
            if (!token.isEmpty() && expires > now) {
                System.out.println("\n\t✅ Already logged in as " + jsonGet(authJson, "email"));
                cmdOn();
                return;
            }
        }

        System.out.print("\nEmail: ");
        String email = new BufferedReader(new InputStreamReader(System.in)).readLine().strip();
        System.out.print("Password: ");
        String password = new BufferedReader(new InputStreamReader(System.in)).readLine().strip();

        String loginBody = buildJSON("email", email, "password", password);
        String resp = postJSON(IDEABLOCK_API + "/api/login", loginBody, null);
        if (resp == null || !resp.startsWith("200|")) {
            System.out.println("\n\t❌ Invalid credentials."); return;
        }

        String body = resp.substring(4);
        String newAuthJson = buildJSON(
            "token", jsonGet(body, "token"),
            "token_expires", jsonGetLong(body, "token_expires"),
            "cached_at", now
        );
        // Minimal user sub-object inline
        String email2 = jsonGet(body, "email");
        writeAuth(newAuthJson);
        System.out.println("\n\t✅ Logged in as " + email2);

        Files.createDirectories(Path.of(".ideablock"));
        writeConf(true);
        writeHook(HOOK_SCRIPT);
        writeHook(GIT_HOOK);
        System.out.println("\t✅ Ideablock Commit initialized in this repository.");
    }

    static void cmdOn() throws IOException {
        if (!isGitRepo()) { System.out.println("\n\t❗ Not a git repository."); return; }
        if (!Files.exists(CONF_FILE)) { System.out.println("\n\t❗ Not initialized. Run \"ideablock-commit init\"."); return; }
        if (isOn()) { System.out.println("\n\t✅ Ideablock Commit is already ON."); return; }
        writeConf(true);
        writeHook(GIT_HOOK);
        System.out.println("\n\t✅ Ideablock Commit set to ON.");
    }

    static void cmdOff() throws IOException {
        if (!isGitRepo()) { System.out.println("\n\t❗ Not a git repository."); return; }
        if (!Files.exists(CONF_FILE)) { System.out.println("\n\t❗ Not initialized. Run \"ideablock-commit init\"."); return; }
        if (!isOn()) { System.out.println("\n\t❌ Already OFF."); return; }
        writeConf(false);
        Files.deleteIfExists(GIT_HOOK);
        System.out.println("\n\t❌ Ideablock Commit set to OFF.");
    }

    static void cmdStatus() {
        if (!Files.exists(CONF_FILE)) { System.out.println("\n\t❗ UNINITIALIZED — run \"ideablock-commit init\"."); return; }
        if (!isGitRepo()) { System.out.println("\n\t❗ Not a git repository."); return; }
        System.out.println("\n\tIdeablock Commit is INITIALIZED and " + (isOn() ? "ON" : "OFF") + ".");
    }

    static void cmdRemove() throws IOException {
        if (!isGitRepo()) { System.out.println("\n\t❗ Not a git repository."); return; }
        deleteRecursive(Path.of(".ideablock"));
        Files.deleteIfExists(GIT_HOOK);
        System.out.println("\n\t🗑️  Ideablock Commit removed from this repository.");
    }

    static void cmdLogout() throws IOException {
        if (!Files.exists(AUTH_FILE)) { System.out.println("\n\t⚠️  Not logged in."); return; }
        Files.delete(AUTH_FILE);
        System.out.println("\n\t✅ Logged out. Run \"ideablock-commit init\" to log in again.");
    }

    static void cmdRun() throws Exception {
        if (!isOn()) {
            System.out.println("\n\t❗ Ideablock Commit is OFF. Run \"ideablock-commit on\" to enable.");
            return;
        }

        // 1. Auth
        String authJson = readAuth();
        if (authJson.isEmpty()) { System.out.println("\n\t❌ Not authenticated. Run \"ideablock-commit init\"."); return; }
        long expires = jsonGetLong(authJson, "token_expires");
        if (expires > 0 && expires <= Instant.now().getEpochSecond()) {
            Files.deleteIfExists(AUTH_FILE);
            System.out.println("\n\t❌ Session expired. Run \"ideablock-commit init\" to log in again.");
            return;
        }
        String token = jsonGet(authJson, "token");
        String userID = jsonGet(authJson, "id");

        // 2. Short hash
        String shortHash = gitOutput("log", "-1", "--pretty=format:%h");
        if (shortHash.length() > 7) shortHash = shortHash.substring(0, 7);
        if (shortHash.isEmpty()) { System.out.println("\n\t❌ Could not get git commit hash."); return; }

        // 3. Commit message
        String commitMsg = gitOutput("log", "-1", "--pretty=format:%s");

        // 4. Archive
        String name = repoName();
        Path commitDir = HOME.resolve(".ideablock/commits/" + name + "/" + shortHash);
        Files.createDirectories(commitDir);
        Path zipPath = commitDir.resolve("Commit-" + shortHash + ".zip");
        new ProcessBuilder("git", "archive", "-o", zipPath.toString(), "HEAD")
            .inheritIO().start().waitFor();

        // 5. SHA-256
        String repoHash = sha256File(zipPath);

        // 6. Parity + tethered hash
        int parity = new Random().nextInt(10);
        String tetheredHash = shortHash + repoHash + parity;
        String committedAt = Instant.now().toString();

        // 7. Timeglue
        System.out.print("\n\tTethering commit to Bitcoin blockchain");
        String glueBody = buildJSON("userID", userID, "hash", repoHash);
        String glueResp = postJSON(TIMEGLUE_URL + "/glue", glueBody, null);
        if (glueResp == null) {
            System.out.println("\n\t❌ Failed to reach timeglue. Is it running?");
            return;
        }
        String btcTxID = jsonGet(glueResp.substring(4), "btcTx");
        System.out.println(" ✅");

        // 8. Save commitData.json
        String commitData = buildJSON(
            "repoName", name, "shortHash", shortHash,
            "commitMessage", commitMsg, "repoHash", repoHash,
            "parityDigit", parity, "blockchainTetheredHash", tetheredHash,
            "btcTxID", btcTxID, "committedAt", committedAt
        );
        Files.writeString(commitDir.resolve("commitData.json"), commitData);

        // 9. Print table
        System.out.println("\n\t✅ Congratulations! Your commit has been tethered using Ideablock!\n");
        String[][] rows = {
            {"Bitcoin Hash:", btcTxID}, {"Commit Short Hash:", shortHash},
            {"Repository Hash:", repoHash}, {"Parity Digit:", String.valueOf(parity)},
            {"Blockchain-Tethered Hash:", tetheredHash},
            {"Commit Record Location:", commitDir.toString()}
        };
        for (String[] row : rows) System.out.printf("\t%-30s %s%n", row[0], row[1]);
        System.out.println();

        // 10. Best-effort sync (fire and forget)
        String finalToken = token;
        String finalData = commitData;
        CompletableFuture.runAsync(() -> postJSON(IDEABLOCK_API + "/api/commit-ideas", finalData, finalToken));
    }

    // ── Main ──────────────────────────────────────────────────────────────────

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.out.println("Usage: ideablock-commit <init|on|off|status|remove|run|logout>");
            System.exit(1);
        }

        switch (args[0]) {
            case "init", "i"          -> cmdInit();
            case "on", "resume"       -> cmdOn();
            case "off", "pause"       -> cmdOff();
            case "status", "ping"     -> cmdStatus();
            case "remove", "uninstall"-> cmdRemove();
            case "run"                -> cmdRun();
            case "logout"             -> cmdLogout();
            default -> {
                System.out.println("Unknown command: " + args[0]);
                System.exit(1);
            }
        }
    }
}
