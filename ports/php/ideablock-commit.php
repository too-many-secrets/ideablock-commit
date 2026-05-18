#!/usr/bin/env php
<?php
/**
 * ideablock-commit — PHP port
 *
 * Tethers every git commit to the Bitcoin blockchain via Ideablock's
 * timeglue service.
 *
 * Requirements: PHP 8.0+, php-curl, php-json
 *
 * Usage:
 *   php ideablock-commit.php <init|on|off|status|remove|run|logout>
 *
 * Install as CLI:
 *   chmod +x ideablock-commit.php
 *   ln -s $(pwd)/ideablock-commit.php /usr/local/bin/ideablock-commit
 */

// ── Config ────────────────────────────────────────────────────────────────────

define('TIMEGLUE_URL', getenv('TIMEGLUE_URL') ?: 'http://localhost:2312');
define('IDEABLOCK_API', getenv('IDEABLOCK_API_URL') ?: 'http://localhost:3000');
define('HOME', getenv('HOME') ?: posix_getpwuid(posix_getuid())['dir']);
define('AUTH_FILE', HOME . '/.ideablock/auth.json');
define('CONF_FILE', '.ideablock/ideablock.json');
define('HOOK_SCRIPT', '.ideablock/post-commit');
define('GIT_HOOK', '.git/hooks/post-commit');
define('HOOK_CONTENT', "#!/bin/bash\nideablock-commit run\n");

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGitRepo(): bool {
    return is_dir('.git');
}

function readConf(): array {
    if (!file_exists(CONF_FILE)) return [];
    return json_decode(file_get_contents(CONF_FILE), true) ?? [];
}

function writeConf(bool $on): void {
    @mkdir('.ideablock', 0755, true);
    file_put_contents(CONF_FILE, json_encode(['on' => $on]));
}

function isOn(): bool {
    return readConf()['on'] ?? false;
}

function readAuth(): array {
    if (!file_exists(AUTH_FILE)) return [];
    return json_decode(file_get_contents(AUTH_FILE), true) ?? [];
}

function writeAuth(array $data): void {
    $dir = dirname(AUTH_FILE);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents(AUTH_FILE, json_encode($data, JSON_PRETTY_PRINT));
    chmod(AUTH_FILE, 0600);
}

function writeHook(string $path): void {
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    file_put_contents($path, HOOK_CONTENT);
    chmod($path, 0744);
}

function gitOutput(string ...$args): string {
    $cmd = implode(' ', array_map('escapeshellarg', array_merge(['git'], $args)));
    return trim(shell_exec($cmd) ?? '');
}

function sha256File(string $path): string {
    return hash_file('sha256', $path);
}

function repoName(): string {
    return basename(getcwd());
}

function postJSON(string $url, array $data, string $token = ''): ?array {
    $ch = curl_init($url);
    $headers = ['Content-Type: application/json'];
    if ($token) $headers[] = "Authorization: Bearer $token";
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($response === false || $code === 0) return null;
    return ['code' => $code, 'body' => json_decode($response, true)];
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdInit(): void {
    if (!isGitRepo()) {
        echo "\n\t❗ Not a git repository.\n";
        return;
    }

    $auth = readAuth();
    $now = time();
    if (!empty($auth['token']) && ($auth['token_expires'] ?? 0) > $now) {
        echo "\n\t✅ Already logged in as {$auth['user']['email']}\n";
        cmdOn();
        return;
    }

    echo "\n  Please log in with your Ideablock credentials.\n";
    echo "Email: ";
    $email = trim(fgets(STDIN));
    echo "Password: ";
    $password = trim(fgets(STDIN));

    $result = postJSON(IDEABLOCK_API . '/api/login', [
        'email' => $email,
        'password' => $password,
    ]);

    if (!$result || $result['code'] !== 200) {
        echo "\n\t❌ Invalid credentials.\n";
        return;
    }

    $data = $result['body'];
    $authData = [
        'token' => $data['token'],
        'token_expires' => $data['token_expires'],
        'user' => [
            'id' => $data['user']['id'],
            'email' => $data['user']['email'],
            'first_name' => $data['user']['first_name'],
            'last_name' => $data['user']['last_name'],
        ],
        'cached_at' => $now,
    ];
    writeAuth($authData);
    echo "\n\t✅ Logged in as {$authData['user']['email']}\n";

    @mkdir('.ideablock', 0755, true);
    writeConf(true);
    writeHook(HOOK_SCRIPT);
    writeHook(GIT_HOOK);
    echo "\t✅ Ideablock Commit initialized in this repository.\n";
}

function cmdOn(): void {
    if (!isGitRepo()) { echo "\n\t❗ Not a git repository.\n"; return; }
    if (!file_exists(CONF_FILE)) { echo "\n\t❗ Not initialized. Run \"ideablock-commit init\" first.\n"; return; }
    if (isOn()) { echo "\n\t✅ Ideablock Commit is already ON.\n"; return; }
    writeConf(true);
    writeHook(GIT_HOOK);
    echo "\n\t✅ Ideablock Commit set to ON.\n";
}

function cmdOff(): void {
    if (!isGitRepo()) { echo "\n\t❗ Not a git repository.\n"; return; }
    if (!file_exists(CONF_FILE)) { echo "\n\t❗ Not initialized. Run \"ideablock-commit init\" first.\n"; return; }
    if (!isOn()) { echo "\n\t❌ Ideablock Commit is already OFF.\n"; return; }
    writeConf(false);
    @unlink(GIT_HOOK);
    echo "\n\t❌ Ideablock Commit set to OFF.\n";
}

function cmdStatus(): void {
    if (!file_exists(CONF_FILE)) { echo "\n\t❗ UNINITIALIZED — run \"ideablock-commit init\".\n"; return; }
    if (!isGitRepo()) { echo "\n\t❗ Not a git repository.\n"; return; }
    $state = isOn() ? 'ON' : 'OFF';
    echo "\n\tIdeablock Commit is INITIALIZED and $state.\n";
}

function cmdRemove(): void {
    if (!isGitRepo()) { echo "\n\t❗ Not a git repository.\n"; return; }
    // Recursively remove .ideablock/
    if (is_dir('.ideablock')) {
        $it = new RecursiveDirectoryIterator('.ideablock', FilesystemIterator::SKIP_DOTS);
        $files = new RecursiveIteratorIterator($it, RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($files as $f) {
            $f->isDir() ? rmdir($f->getRealPath()) : unlink($f->getRealPath());
        }
        rmdir('.ideablock');
    }
    @unlink(GIT_HOOK);
    echo "\n\t🗑️  Ideablock Commit removed from this repository.\n";
}

function cmdLogout(): void {
    if (!file_exists(AUTH_FILE)) { echo "\n\t⚠️  Not logged in.\n"; return; }
    unlink(AUTH_FILE);
    echo "\n\t✅ Logged out. Run \"ideablock-commit init\" to log in again.\n";
}

function cmdRun(): void {
    if (!isOn()) {
        echo "\n\t❗ Ideablock Commit is OFF. Run \"ideablock-commit on\" to enable.\n";
        return;
    }

    // 1. Auth
    $auth = readAuth();
    if (empty($auth['token'])) {
        echo "\n\t❌ Not authenticated. Run \"ideablock-commit init\".\n";
        return;
    }
    if (($auth['token_expires'] ?? 0) <= time()) {
        @unlink(AUTH_FILE);
        echo "\n\t❌ Session expired. Run \"ideablock-commit init\" to log in again.\n";
        return;
    }

    $token = $auth['token'];
    $userID = $auth['user']['id'] ?? 'unknown';

    // 2. Short hash
    $shortHash = substr(gitOutput('log', '-1', '--pretty=format:%h'), 0, 7);
    if (!$shortHash) { echo "\n\t❌ Could not get git commit hash.\n"; return; }

    // 3. Commit message
    $commitMsg = gitOutput('log', '-1', '--pretty=format:%s');

    // 4. Archive
    $name = repoName();
    $commitDir = HOME . "/.ideablock/commits/$name/$shortHash";
    @mkdir($commitDir, 0775, true);
    $zipPath = "$commitDir/Commit-$shortHash.zip";
    shell_exec("git archive -o " . escapeshellarg($zipPath) . " HEAD");

    // 5. SHA-256
    $repoHash = sha256File($zipPath);

    // 6. Parity + tethered hash
    $parity = rand(0, 9);
    $tetheredHash = $shortHash . $repoHash . $parity;
    $committedAt = gmdate('c');

    // 7. Timeglue
    echo "\n\tTethering commit to Bitcoin blockchain";
    $glue = postJSON(TIMEGLUE_URL . '/glue', ['userID' => $userID, 'hash' => $repoHash]);
    if (!$glue) {
        echo "\n\t❌ Failed to reach timeglue. Is it running?\n";
        return;
    }
    $btcTxID = $glue['body']['btcTx'] ?? '';
    echo " ✅\n";

    // 8. Save commitData.json
    $commitData = [
        'repoName' => $name,
        'shortHash' => $shortHash,
        'commitMessage' => $commitMsg,
        'repoHash' => $repoHash,
        'parityDigit' => $parity,
        'blockchainTetheredHash' => $tetheredHash,
        'btcTxID' => $btcTxID,
        'committedAt' => $committedAt,
    ];
    file_put_contents("$commitDir/commitData.json", json_encode($commitData, JSON_PRETTY_PRINT));

    // 9. Print table
    echo "\n\t✅ Congratulations! Your commit has been tethered using Ideablock!\n\n";
    $rows = [
        ['Bitcoin Hash:', $btcTxID],
        ['Commit Short Hash:', $shortHash],
        ['Repository Hash:', $repoHash],
        ['Parity Digit:', (string)$parity],
        ['Blockchain-Tethered Hash:', $tetheredHash],
        ['Commit Record Location:', $commitDir],
    ];
    foreach ($rows as [$label, $value]) {
        printf("\t%-30s %s\n", $label, $value);
    }
    echo "\n";

    // 10. Best-effort sync
    postJSON(IDEABLOCK_API . '/api/commit-ideas', $commitData, $token);
}

// ── Main ──────────────────────────────────────────────────────────────────────

$commands = [
    'init' => 'cmdInit', 'i' => 'cmdInit',
    'on' => 'cmdOn', 'resume' => 'cmdOn',
    'off' => 'cmdOff', 'pause' => 'cmdOff',
    'status' => 'cmdStatus', 'ping' => 'cmdStatus',
    'remove' => 'cmdRemove', 'uninstall' => 'cmdRemove',
    'run' => 'cmdRun',
    'logout' => 'cmdLogout',
];

if ($argc < 2 || !isset($commands[$argv[1]])) {
    echo "Usage: ideablock-commit <init|on|off|status|remove|run|logout>\n";
    exit(1);
}

$commands[$argv[1]]();
