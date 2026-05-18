/*
 * ideablock-commit — C++ port
 *
 * Tethers every git commit to the Bitcoin blockchain via Ideablock's
 * timeglue service.
 *
 * Dependencies: libcurl, openssl (SHA-256), nlohmann/json (header-only)
 *
 * Compile (macOS):
 *   clang++ -std=c++17 -o ideablock-commit ideablock-commit.cpp \
 *     $(curl-config --libs) -lssl -lcrypto
 *
 * Compile (Linux):
 *   g++ -std=c++17 -o ideablock-commit ideablock-commit.cpp \
 *     -lcurl -lssl -lcrypto
 *
 * nlohmann/json: download json.hpp from https://github.com/nlohmann/json/releases
 * and place it alongside this file, or install via: brew install nlohmann-json
 *
 * Usage:
 *   ./ideablock-commit <init|on|off|status|remove|run|logout>
 */

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <filesystem>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <random>
#include <sys/stat.h>
#include <unistd.h>
#include <iomanip>
#include <openssl/sha.h>
#include <curl/curl.h>

// Use nlohmann/json if available, otherwise fall back to manual JSON
#if __has_include("json.hpp")
#  include "json.hpp"
   using json = nlohmann::json;
#  define HAVE_JSON 1
#else
#  define HAVE_JSON 0
#endif

namespace fs = std::filesystem;

// ── Config ────────────────────────────────────────────────────────────────────

static std::string getenv_or(const char* key, const char* fallback) {
    const char* v = std::getenv(key);
    return v ? v : fallback;
}

static std::string TIMEGLUE_URL() { return getenv_or("TIMEGLUE_URL", "http://localhost:2312"); }
static std::string IDEABLOCK_API() { return getenv_or("IDEABLOCK_API_URL", "http://localhost:3000"); }
static fs::path home_dir() { return std::getenv("HOME") ? std::getenv("HOME") : "/tmp"; }
static fs::path auth_file() { return home_dir() / ".ideablock" / "auth.json"; }

static const char* CONF_FILE   = ".ideablock/ideablock.json";
static const char* HOOK_SCRIPT = ".ideablock/post-commit";
static const char* GIT_HOOK    = ".git/hooks/post-commit";
static const char* HOOK_CONTENT = "#!/bin/bash\nideablock-commit run\n";

// ── HTTP ──────────────────────────────────────────────────────────────────────

struct ResponseBuf { std::string data; };

static size_t write_cb(void* ptr, size_t size, size_t nmemb, ResponseBuf* buf) {
    buf->data.append(static_cast<char*>(ptr), size * nmemb);
    return size * nmemb;
}

static std::string post_json(const std::string& url, const std::string& body,
                              const std::string& token = "") {
    CURL* curl = curl_easy_init();
    if (!curl) return "";
    ResponseBuf resp;
    struct curl_slist* hdrs = nullptr;
    hdrs = curl_slist_append(hdrs, "Content-Type: application/json");
    if (!token.empty())
        hdrs = curl_slist_append(hdrs, ("Authorization: Bearer " + token).c_str());
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
    CURLcode rc = curl_easy_perform(curl);
    curl_slist_free_all(hdrs);
    curl_easy_cleanup(curl);
    return rc == CURLE_OK ? resp.data : "";
}

// ── Tiny JSON helpers (when nlohmann unavailable) ─────────────────────────────

static std::string json_get(const std::string& json_str, const std::string& key) {
    std::string needle = "\"" + key + "\"";
    size_t pos = json_str.find(needle);
    if (pos == std::string::npos) return "";
    pos = json_str.find(':', pos) + 1;
    while (json_str[pos] == ' ') pos++;
    if (json_str[pos] != '"') return "";
    pos++;
    std::string val;
    while (json_str[pos] && json_str[pos] != '"') val += json_str[pos++];
    return val;
}

static long json_get_long(const std::string& json_str, const std::string& key) {
    std::string needle = "\"" + key + "\"";
    size_t pos = json_str.find(needle);
    if (pos == std::string::npos) return 0;
    pos = json_str.find(':', pos) + 1;
    while (json_str[pos] == ' ') pos++;
    return atol(json_str.c_str() + pos);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

static bool is_git_repo() { return fs::is_directory(".git"); }

static std::string read_file(const fs::path& p) {
    std::ifstream f(p);
    return f ? std::string(std::istreambuf_iterator<char>(f), {}) : "";
}

static void write_file(const fs::path& p, const std::string& content, mode_t mode = 0644) {
    fs::create_directories(p.parent_path());
    std::ofstream f(p);
    f << content;
    chmod(p.c_str(), mode);
}

static bool is_on() {
    std::string c = read_file(CONF_FILE);
    return c.find("\"on\":true") != std::string::npos ||
           c.find("\"on\": true") != std::string::npos;
}

static void write_conf(bool on) {
    fs::create_directories(".ideablock");
    write_file(CONF_FILE, std::string("{\"on\":") + (on ? "true" : "false") + "}");
}

static void write_hook(const std::string& path) {
    write_file(path, HOOK_CONTENT, 0744);
}

static std::string git_output(const std::string& args) {
    std::string cmd = "git " + args + " 2>/dev/null";
    FILE* p = popen(cmd.c_str(), "r");
    if (!p) return "";
    std::string out;
    char buf[4096]; size_t n;
    while ((n = fread(buf, 1, sizeof(buf), p)) > 0) out.append(buf, n);
    pclose(p);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
    return out;
}

static std::string sha256_file(const fs::path& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return "";
    SHA256_CTX ctx; SHA256_Init(&ctx);
    char buf[65536];
    while (f.read(buf, sizeof(buf)) || f.gcount())
        SHA256_Update(&ctx, buf, f.gcount());
    unsigned char hash[SHA256_DIGEST_LENGTH]; SHA256_Final(hash, &ctx);
    std::ostringstream ss;
    for (auto b : hash) ss << std::hex << std::setw(2) << std::setfill('0') << (int)b;
    return ss.str();
}

static std::string repo_name() {
    return fs::current_path().filename().string();
}

// ── Commands ──────────────────────────────────────────────────────────────────

static void cmd_init() {
    if (!is_git_repo()) { std::cout << "\n\t❗ Not a git repository.\n"; return; }

    std::string auth_str = read_file(auth_file());
    long now = (long)time(nullptr);
    if (!auth_str.empty()) {
        std::string tok = json_get(auth_str, "token");
        long expires = json_get_long(auth_str, "token_expires");
        if (!tok.empty() && expires > now) {
            std::cout << "\n\t✅ Already logged in as " << json_get(auth_str, "email") << "\n";
            goto setup;
        }
    }

    {
        std::string email, password;
        std::cout << "\nEmail: "; std::getline(std::cin, email);
        std::cout << "Password: "; std::getline(std::cin, password);

        std::string body = "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
        std::string resp = post_json(IDEABLOCK_API() + "/api/login", body);
        if (resp.empty()) { std::cout << "\n\t❌ Could not reach Ideablock API.\n"; return; }

        std::string token = json_get(resp, "token");
        if (token.empty()) { std::cout << "\n\t❌ Invalid credentials.\n"; return; }

        std::string uemail = json_get(resp, "email");
        long expires = json_get_long(resp, "token_expires");

        fs::create_directories(auth_file().parent_path());
        std::string auth_json =
            "{\"token\":\"" + token + "\",\"token_expires\":" + std::to_string(expires) +
            ",\"user\":{\"email\":\"" + uemail + "\"},"
            "\"cached_at\":" + std::to_string(now) + "}";
        write_file(auth_file(), auth_json, 0600);
        std::cout << "\n\t✅ Logged in as " << uemail << "\n";
    }

setup:
    fs::create_directories(".ideablock");
    write_conf(true);
    write_hook(HOOK_SCRIPT);
    write_hook(GIT_HOOK);
    std::cout << "\t✅ Ideablock Commit initialized in this repository.\n";
}

static void cmd_on() {
    if (!is_git_repo()) { std::cout << "\n\t❗ Not a git repository.\n"; return; }
    if (!fs::exists(CONF_FILE)) { std::cout << "\n\t❗ Not initialized.\n"; return; }
    if (is_on()) { std::cout << "\n\t✅ Already ON.\n"; return; }
    write_conf(true); write_hook(GIT_HOOK);
    std::cout << "\n\t✅ Ideablock Commit set to ON.\n";
}

static void cmd_off() {
    if (!is_git_repo()) { std::cout << "\n\t❗ Not a git repository.\n"; return; }
    if (!fs::exists(CONF_FILE)) { std::cout << "\n\t❗ Not initialized.\n"; return; }
    if (!is_on()) { std::cout << "\n\t❌ Already OFF.\n"; return; }
    write_conf(false); fs::remove(GIT_HOOK);
    std::cout << "\n\t❌ Ideablock Commit set to OFF.\n";
}

static void cmd_status() {
    if (!fs::exists(CONF_FILE)) { std::cout << "\n\t❗ UNINITIALIZED.\n"; return; }
    if (!is_git_repo()) { std::cout << "\n\t❗ Not a git repository.\n"; return; }
    std::cout << "\n\tIdeablock Commit is INITIALIZED and " << (is_on() ? "ON" : "OFF") << ".\n";
}

static void cmd_remove() {
    if (!is_git_repo()) { std::cout << "\n\t❗ Not a git repository.\n"; return; }
    fs::remove_all(".ideablock"); fs::remove(GIT_HOOK);
    std::cout << "\n\t🗑️  Ideablock Commit removed from this repository.\n";
}

static void cmd_logout() {
    if (!fs::exists(auth_file())) { std::cout << "\n\t⚠️  Not logged in.\n"; return; }
    fs::remove(auth_file());
    std::cout << "\n\t✅ Logged out. Run \"ideablock-commit init\" to log in again.\n";
}

static void cmd_run() {
    if (!is_on()) {
        std::cout << "\n\t❗ Ideablock Commit is OFF.\n"; return;
    }

    std::string auth_str = read_file(auth_file());
    if (auth_str.empty()) { std::cout << "\n\t❌ Not authenticated.\n"; return; }

    std::string token = json_get(auth_str, "token");
    long expires = json_get_long(auth_str, "token_expires");
    if (expires > 0 && expires <= (long)time(nullptr)) {
        fs::remove(auth_file());
        std::cout << "\n\t❌ Session expired. Run \"ideablock-commit init\".\n"; return;
    }
    std::string user_id = json_get(auth_str, "id");

    std::string short_hash = git_output("log -1 --pretty=format:%h").substr(0, 7);
    if (short_hash.empty()) { std::cout << "\n\t❌ Could not get git commit hash.\n"; return; }

    std::string commit_msg = git_output("log -1 --pretty=format:%s");

    std::string name = repo_name();
    fs::path commit_dir = home_dir() / ".ideablock" / "commits" / name / short_hash;
    fs::create_directories(commit_dir);
    fs::path zip_path = commit_dir / ("Commit-" + short_hash + ".zip");
    system(("git archive -o " + zip_path.string() + " HEAD").c_str());

    std::string repo_hash = sha256_file(zip_path);

    std::mt19937 rng(std::random_device{}());
    int parity = std::uniform_int_distribution<>(0, 9)(rng);
    std::string tethered_hash = short_hash + repo_hash + std::to_string(parity);

    time_t now = time(nullptr);
    char ts[64]; strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

    std::cout << "\n\tTethering commit to Bitcoin blockchain" << std::flush;
    std::string glue_body = "{\"userID\":\"" + user_id + "\",\"hash\":\"" + repo_hash + "\"}";
    std::string glue_resp = post_json(TIMEGLUE_URL() + "/glue", glue_body);
    if (glue_resp.empty()) { std::cout << "\n\t❌ Failed to reach timeglue.\n"; return; }
    std::string btc_tx_id = json_get(glue_resp, "btcTx");
    std::cout << " ✅\n";

    std::string commit_data =
        "{\"repoName\":\"" + name + "\",\"shortHash\":\"" + short_hash +
        "\",\"commitMessage\":\"" + commit_msg + "\",\"repoHash\":\"" + repo_hash +
        "\",\"parityDigit\":" + std::to_string(parity) +
        ",\"blockchainTetheredHash\":\"" + tethered_hash +
        "\",\"btcTxID\":\"" + btc_tx_id + "\",\"committedAt\":\"" + ts + "\"}";
    write_file(commit_dir / "commitData.json", commit_data);

    std::cout << "\n\t✅ Congratulations! Your commit has been tethered using Ideablock!\n\n";
    auto row = [](const std::string& l, const std::string& v) {
        std::cout << "\t" << std::left << std::setw(30) << l << " " << v << "\n";
    };
    row("Bitcoin Hash:", btc_tx_id);
    row("Commit Short Hash:", short_hash);
    row("Repository Hash:", repo_hash);
    row("Parity Digit:", std::to_string(parity));
    row("Blockchain-Tethered Hash:", tethered_hash);
    row("Commit Record Location:", commit_dir.string());
    std::cout << "\n";

    if (fork() == 0) {
        post_json(IDEABLOCK_API() + "/api/commit-ideas", commit_data, token);
        exit(0);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: ideablock-commit <init|on|off|status|remove|run|logout>\n";
        return 1;
    }
    std::string cmd = argv[1];
    if (cmd=="init"||cmd=="i")             cmd_init();
    else if (cmd=="on"||cmd=="resume")     cmd_on();
    else if (cmd=="off"||cmd=="pause")     cmd_off();
    else if (cmd=="status"||cmd=="ping")   cmd_status();
    else if (cmd=="remove"||cmd=="uninstall") cmd_remove();
    else if (cmd=="run")                   cmd_run();
    else if (cmd=="logout")                cmd_logout();
    else { std::cerr << "Unknown command: " << cmd << "\n"; return 1; }
    return 0;
}
