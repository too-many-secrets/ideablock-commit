//! ideablock-commit — Rust port
//!
//! Tethers every git commit to the Bitcoin blockchain via Ideablock's
//! timeglue service.
//!
//! Requirements: Rust 1.70+
//!
//! Build:
//!   cargo build --release
//!   # Binary at: target/release/ideablock-commit
//!
//! Usage:
//!   ideablock-commit <init|on|off|status|remove|run|logout>

use std::env;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, exit};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// ── Config ────────────────────────────────────────────────────────────────────

// Anchoring goes through Ideablock's authenticated proxy, never straight to
// timeglue: timeglue binds to 127.0.0.1 on the app VM and is unreachable from
// anywhere else. The direct endpoint also takes a userID and no token, so
// exposing it would let anyone stamp under any account.
//
// derive_parity mirrors deriveParity in lib/run.js and must stay identical
// across every port: the digit is part of the value that goes on chain, so a
// port computing it differently anchors a different record for the same commit.
fn derive_parity(short_hash: &str, repo_hash: &str) -> u8 {
    let sum: u32 = format!("{}{}", short_hash, repo_hash)
        .chars()
        .filter_map(|c| c.to_digit(16))
        .sum();
    (sum % 10) as u8
}

fn ideablock_api() -> String {
    env::var("IDEABLOCK_API_URL").unwrap_or_else(|_| "https://app.ideablock.com".into())
}

fn home_dir() -> PathBuf {
    dirs::home_dir().expect("cannot determine home directory")
}

fn auth_file() -> PathBuf {
    home_dir().join(".ideablock/auth.json")
}

const CONF_FILE: &str = ".ideablock/ideablock.json";
const HOOK_SCRIPT: &str = ".ideablock/post-commit";
const GIT_HOOK: &str = ".git/hooks/post-commit";
const HOOK_SHEBANG: &str = "#!/bin/sh";
const HOOK_COMMAND: &str = "ideablock-commit run";

// ── Models ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
struct AuthUser {
    id: String,
    email: String,
    first_name: String,
    last_name: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct AuthFile {
    token: String,
    token_expires: i64,
    user: AuthUser,
    cached_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct IdeablockConf {
    on: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitData {
    repo_name: String,
    short_hash: String,
    commit_message: String,
    repo_hash: String,
    parity_digit: u8,
    blockchain_tethered_hash: String,
    btc_tx_id: String,
    committed_at: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs() as i64
}

fn is_git_repo() -> bool {
    Path::new(".git").is_dir()
}

fn is_on() -> bool {
    fs::read_to_string(CONF_FILE)
        .ok()
        .and_then(|s| serde_json::from_str::<IdeablockConf>(&s).ok())
        .map(|c| c.on)
        .unwrap_or(false)
}

fn write_conf(on: bool) -> io::Result<()> {
    fs::create_dir_all(".ideablock")?;
    let json = serde_json::to_string(&IdeablockConf { on })?;
    fs::write(CONF_FILE, json)
}

fn read_auth() -> Option<AuthFile> {
    let data = fs::read_to_string(auth_file()).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_auth(auth: &AuthFile) -> io::Result<()> {
    let path = auth_file();
    fs::create_dir_all(path.parent().unwrap())?;
    let json = serde_json::to_string_pretty(auth)?;
    fs::write(&path, json)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
}

/// Install by appending, never by truncating -- see the note in main.go.
fn write_hook(path: &str) -> io::Result<()> {
    let p = Path::new(path);
    fs::create_dir_all(p.parent().unwrap())?;
    let existing = fs::read_to_string(p).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == HOOK_COMMAND) {
        return Ok(());
    }
    let body = if existing.trim().is_empty() {
        format!("{}\n{}\n", HOOK_SHEBANG, HOOK_COMMAND)
    } else {
        let gap = if existing.ends_with('\n') { "" } else { "\n" };
        format!("{}{}{}\n", existing, gap, HOOK_COMMAND)
    };
    fs::write(p, body)?;
    fs::set_permissions(p, fs::Permissions::from_mode(0o755))
}

fn git_output(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn repo_name() -> String {
    std::env::current_dir()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "unknown".into())
}

fn post_json(url: &str, body: &Value, token: Option<&str>) -> Option<Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .ok()?;
    let mut req = client.post(url).json(body);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    req.send().ok()?.json().ok()
}

fn prompt(label: &str) -> String {
    print!("{}", label);
    io::stdout().flush().unwrap();
    let stdin = io::stdin();
    stdin.lock().lines().next().unwrap().unwrap_or_default().trim().to_string()
}

fn remove_dir_all_ok(path: &str) {
    let _ = fs::remove_dir_all(path);
}

fn remove_file_ok(path: &str) {
    let _ = fs::remove_file(path);
}

// ── Commands ──────────────────────────────────────────────────────────────────

fn cmd_init() {
    if !is_git_repo() {
        println!("\n\t❗ Not a git repository.");
        return;
    }

    if let Some(auth) = read_auth() {
        if !auth.token.is_empty() && auth.token_expires > now_secs() {
            println!("\n\t✅ Already logged in as {}", auth.user.email);
            cmd_on();
            return;
        }
    }

    println!("\n  Please log in with your Ideablock credentials.");
    let email = prompt("Email: ");
    let password = prompt("Password: ");

    let body = json!({ "email": email, "password": password });
    match post_json(&format!("{}/api/login", ideablock_api()), &body, None) {
        None => { println!("\n\t❌ Could not reach Ideablock API."); return; }
        Some(data) => {
            let token = data["token"].as_str().unwrap_or("").to_string();
            if token.is_empty() {
                println!("\n\t❌ Invalid credentials.");
                return;
            }
            let auth = AuthFile {
                token,
                token_expires: data["token_expires"].as_i64().unwrap_or(0),
                user: AuthUser {
                    id: data["user"]["id"].as_str().unwrap_or("").to_string(),
                    email: data["user"]["email"].as_str().unwrap_or("").to_string(),
                    first_name: data["user"]["first_name"].as_str().unwrap_or("").to_string(),
                    last_name: data["user"]["last_name"].as_str().unwrap_or("").to_string(),
                },
                cached_at: now_secs(),
            };
            println!("\n\t✅ Logged in as {}", auth.user.email);
            write_auth(&auth).expect("failed to write auth file");

            fs::create_dir_all(".ideablock").unwrap();
            write_conf(true).unwrap();
            write_hook(HOOK_SCRIPT).unwrap();
            write_hook(GIT_HOOK).unwrap();
            println!("\t✅ Ideablock Commit initialized in this repository.");
        }
    }
}

fn cmd_on() {
    if !is_git_repo() { println!("\n\t❗ Not a git repository."); return; }
    if !Path::new(CONF_FILE).exists() { println!("\n\t❗ Not initialized. Run \"ideablock-commit init\"."); return; }
    if is_on() { println!("\n\t✅ Ideablock Commit is already ON."); return; }
    write_conf(true).unwrap();
    write_hook(GIT_HOOK).unwrap();
    println!("\n\t✅ Ideablock Commit set to ON.");
}

fn cmd_off() {
    if !is_git_repo() { println!("\n\t❗ Not a git repository."); return; }
    if !Path::new(CONF_FILE).exists() { println!("\n\t❗ Not initialized. Run \"ideablock-commit init\"."); return; }
    if !is_on() { println!("\n\t❌ Already OFF."); return; }
    write_conf(false).unwrap();
    remove_file_ok(GIT_HOOK);
    println!("\n\t❌ Ideablock Commit set to OFF.");
}

fn cmd_status() {
    if !Path::new(CONF_FILE).exists() { println!("\n\t❗ UNINITIALIZED — run \"ideablock-commit init\"."); return; }
    if !is_git_repo() { println!("\n\t❗ Not a git repository."); return; }
    println!("\n\tIdeablock Commit is INITIALIZED and {}.", if is_on() { "ON" } else { "OFF" });
}

fn cmd_remove() {
    if !is_git_repo() { println!("\n\t❗ Not a git repository."); return; }
    remove_dir_all_ok(".ideablock");
    remove_file_ok(GIT_HOOK);
    println!("\n\t🗑️  Ideablock Commit removed from this repository.");
}

fn cmd_logout() {
    let path = auth_file();
    if !path.exists() { println!("\n\t⚠️  Not logged in."); return; }
    fs::remove_file(&path).unwrap();
    println!("\n\t✅ Logged out. Run \"ideablock-commit init\" to log in again.");
}

fn cmd_run() {
    if !is_on() {
        println!("\n\t❗ Ideablock Commit is OFF. Run \"ideablock-commit on\" to enable.");
        return;
    }

    // 1. Auth
    let auth = match read_auth() {
        Some(a) if !a.token.is_empty() => a,
        _ => { println!("\n\t❌ Not authenticated. Run \"ideablock-commit init\"."); return; }
    };
    if auth.token_expires > 0 && auth.token_expires <= now_secs() {
        remove_file_ok(&auth_file().to_string_lossy());
        println!("\n\t❌ Session expired. Run \"ideablock-commit init\" to log in again.");
        return;
    }

    // 2. Short hash
    let short_hash = {
        let h = git_output(&["log", "-1", "--pretty=format:%h"]);
        if h.is_empty() { println!("\n\t❌ Could not get git commit hash."); return; }
        h.chars().take(7).collect::<String>()
    };

    // 3. Commit message
    let commit_msg = git_output(&["log", "-1", "--pretty=format:%s"]);

    // 4. Archive
    let name = repo_name();
    let commit_dir = home_dir()
        .join(".ideablock/commits")
        .join(&name)
        .join(&short_hash);
    fs::create_dir_all(&commit_dir).unwrap();
    let zip_path = commit_dir.join(format!("Commit-{}.zip", short_hash));
    Command::new("git")
        .args(["archive", "-o", zip_path.to_str().unwrap(), "HEAD"])
        .status()
        .expect("git archive failed");

    // 5. SHA-256
    let repo_hash = sha256_file(&zip_path).expect("sha256 failed");

    // 6. Parity + tethered hash
    let parity: u8 = derive_parity(&short_hash, &repo_hash);
    let tethered_hash = format!("{}{}{}", short_hash, repo_hash, parity);
    let committed_at = chrono::Utc::now().to_rfc3339();

    // 7. Anchor, through Ideablock's authenticated proxy
    print!("\n\tTethering commit to Bitcoin blockchain");
    io::stdout().flush().unwrap();
    // The composite is the committed value — see lib/run.js. No userID: the
    // server reads the caller from the token.
    let glue_body = json!({ "hash": tethered_hash });
    let glue_resp = post_json(
        &format!("{}/api/commit-ideas/glue", ideablock_api()),
        &glue_body,
        Some(auth.token.as_str()),
    );
    let btc_tx_id = match glue_resp {
        None => { println!("\n\t❌ Failed to reach Ideablock."); return; }
        Some(v) => v["btcTx"].as_str().unwrap_or("").to_string(),
    };
    println!(" ✅");

    // 8. Save commitData.json
    let commit_data = CommitData {
        repo_name: name.clone(),
        short_hash: short_hash.clone(),
        commit_message: commit_msg,
        repo_hash: repo_hash.clone(),
        parity_digit: parity,
        blockchain_tethered_hash: tethered_hash.clone(),
        btc_tx_id: btc_tx_id.clone(),
        committed_at: committed_at.clone(),
    };
    let json_str = serde_json::to_string_pretty(&commit_data).unwrap();
    fs::write(commit_dir.join("commitData.json"), &json_str).unwrap();

    // 9. Print table
    println!("\n\t✅ Congratulations! Your commit has been tethered using Ideablock!\n");
    let rows = [
        ("Bitcoin Hash:", btc_tx_id.as_str()),
        ("Commit Short Hash:", short_hash.as_str()),
        ("Repository Hash:", repo_hash.as_str()),
    ];
    for (label, value) in &rows {
        println!("\t{:<30} {}", label, value);
    }
    println!("\t{:<30} {}", "Parity Digit:", parity);
    println!("\t{:<30} {}", "Blockchain-Tethered Hash:", tethered_hash);
    println!("\t{:<30} {}", "Commit Record Location:", commit_dir.display());
    println!();

    // 10. Best-effort sync
    let token = auth.token.clone();
    let sync_body = serde_json::to_value(&commit_data).unwrap();
    std::thread::spawn(move || {
        post_json(&format!("{}/api/commit-ideas", ideablock_api()), &sync_body, Some(&token));
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: ideablock-commit <init|on|off|status|remove|run|logout>");
        exit(1);
    }

    match args[1].as_str() {
        "init" | "i"           => cmd_init(),
        "on" | "resume"        => cmd_on(),
        "off" | "pause"        => cmd_off(),
        "status" | "ping"      => cmd_status(),
        "remove" | "uninstall" => cmd_remove(),
        "run"                  => cmd_run(),
        "logout"               => cmd_logout(),
        cmd => {
            eprintln!("Unknown command: {}", cmd);
            exit(1);
        }
    }
}
