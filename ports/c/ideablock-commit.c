/*
 * ideablock-commit — C port
 *
 * Tethers every git commit to the Bitcoin blockchain via Ideablock's
 * timeglue service.
 *
 * Dependencies: libcurl, openssl (for SHA-256)
 *
 * Compile (macOS):
 *   clang -o ideablock-commit ideablock-commit.c \
 *     $(curl-config --libs) -lssl -lcrypto
 *
 * Compile (Linux):
 *   gcc -o ideablock-commit ideablock-commit.c \
 *     -lcurl -lssl -lcrypto
 *
 * Usage:
 *   ./ideablock-commit <init|on|off|status|remove|run|logout>
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>
#include <errno.h>
#include <openssl/sha.h>
#include <curl/curl.h>

/* ── Config ──────────────────────────────────────────────────────────────── */

#define TIMEGLUE_URL_DEFAULT  "http://localhost:2312"
#define IDEABLOCK_API_DEFAULT "http://localhost:3000"
#define HOOK_CONTENT          "#!/bin/bash\nideablock-commit run\n"
#define CONF_FILE             ".ideablock/ideablock.json"
#define HOOK_SCRIPT           ".ideablock/post-commit"
#define GIT_HOOK              ".git/hooks/post-commit"
#define BUF_SIZE              4096
#define HASH_BUF              65

/* ── HTTP response buffer ─────────────────────────────────────────────────── */

typedef struct { char *data; size_t size; } ResponseBuf;

static size_t write_cb(void *ptr, size_t size, size_t nmemb, ResponseBuf *buf) {
    size_t total = size * nmemb;
    buf->data = realloc(buf->data, buf->size + total + 1);
    if (!buf->data) return 0;
    memcpy(buf->data + buf->size, ptr, total);
    buf->size += total;
    buf->data[buf->size] = '\0';
    return total;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

static const char *timeglue_url(void) {
    const char *e = getenv("TIMEGLUE_URL");
    return e ? e : TIMEGLUE_URL_DEFAULT;
}

static const char *ideablock_api(void) {
    const char *e = getenv("IDEABLOCK_API_URL");
    return e ? e : IDEABLOCK_API_DEFAULT;
}

static const char *home_dir(void) {
    const char *h = getenv("HOME");
    return h ? h : "/tmp";
}

static int file_exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0;
}

static int is_git_repo(void) { return file_exists(".git"); }

static int is_on(void) {
    FILE *f = fopen(CONF_FILE, "r");
    if (!f) return 0;
    char buf[256]; fread(buf, 1, sizeof(buf)-1, f); fclose(f);
    return strstr(buf, "\"on\":true") != NULL || strstr(buf, "\"on\": true") != NULL;
}

static void write_conf(int on) {
    mkdir(".ideablock", 0755);
    FILE *f = fopen(CONF_FILE, "w");
    if (!f) return;
    fprintf(f, "{\"on\":%s}", on ? "true" : "false");
    fclose(f);
}

static void write_hook(const char *path) {
    /* ensure parent dir exists */
    char dir[BUF_SIZE];
    strncpy(dir, path, sizeof(dir)-1);
    char *slash = strrchr(dir, '/');
    if (slash) { *slash = '\0'; mkdir(dir, 0755); }
    FILE *f = fopen(path, "w");
    if (!f) return;
    fputs(HOOK_CONTENT, f);
    fclose(f);
    chmod(path, 0744);
}

static char *git_output(const char *args) {
    char cmd[BUF_SIZE];
    snprintf(cmd, sizeof(cmd), "git %s 2>/dev/null", args);
    FILE *p = popen(cmd, "r");
    if (!p) return strdup("");
    static char buf[BUF_SIZE];
    size_t n = fread(buf, 1, sizeof(buf)-1, p);
    pclose(p);
    buf[n] = '\0';
    /* trim trailing whitespace */
    while (n > 0 && (buf[n-1] == '\n' || buf[n-1] == '\r' || buf[n-1] == ' '))
        buf[--n] = '\0';
    return buf;
}

static char auth_file_path[BUF_SIZE];

static const char *auth_file(void) {
    snprintf(auth_file_path, sizeof(auth_file_path), "%s/.ideablock/auth.json", home_dir());
    return auth_file_path;
}

/* Extract a quoted JSON string value — minimal, single-level only */
static int json_get_str(const char *json, const char *key, char *out, size_t outlen) {
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *p = strstr(json, search);
    if (!p) return 0;
    p += strlen(search);
    while (*p == ' ' || *p == ':' || *p == ' ') p++;
    if (*p != '"') return 0;
    p++;
    size_t i = 0;
    while (*p && *p != '"' && i < outlen-1) out[i++] = *p++;
    out[i] = '\0';
    return 1;
}

static long json_get_long(const char *json, const char *key) {
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *p = strstr(json, search);
    if (!p) return 0;
    p += strlen(search);
    while (*p == ' ' || *p == ':' || *p == ' ') p++;
    return atol(p);
}

static int sha256_file(const char *path, char out[HASH_BUF]) {
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    SHA256_CTX ctx; SHA256_Init(&ctx);
    unsigned char buf[65536]; size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0)
        SHA256_Update(&ctx, buf, n);
    fclose(f);
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256_Final(hash, &ctx);
    for (int i = 0; i < SHA256_DIGEST_LENGTH; i++)
        sprintf(out + i*2, "%02x", hash[i]);
    out[64] = '\0';
    return 1;
}

/* POST JSON via libcurl; returns malloc'd response body or NULL */
static char *post_json(const char *url, const char *body, const char *token) {
    CURL *curl = curl_easy_init();
    if (!curl) return NULL;
    ResponseBuf resp = {malloc(1), 0};
    struct curl_slist *hdrs = NULL;
    hdrs = curl_slist_append(hdrs, "Content-Type: application/json");
    if (token) {
        char auth_hdr[1024];
        snprintf(auth_hdr, sizeof(auth_hdr), "Authorization: Bearer %s", token);
        hdrs = curl_slist_append(hdrs, auth_hdr);
    }
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
    CURLcode rc = curl_easy_perform(curl);
    curl_slist_free_all(hdrs);
    curl_easy_cleanup(curl);
    if (rc != CURLE_OK) { free(resp.data); return NULL; }
    return resp.data; /* caller must free */
}

static void remove_dir_all(const char *path) {
    char cmd[BUF_SIZE];
    snprintf(cmd, sizeof(cmd), "rm -rf %s", path);
    system(cmd);
}

static char *repo_name_buf(void) {
    static char buf[256];
    char cwd[4096];
    if (!getcwd(cwd, sizeof(cwd))) return "unknown";
    char *last = strrchr(cwd, '/');
    strncpy(buf, last ? last+1 : cwd, sizeof(buf)-1);
    return buf;
}

/* ── Commands ─────────────────────────────────────────────────────────────── */

static void cmd_init(void) {
    if (!is_git_repo()) { puts("\n\t❗ Not a git repository."); return; }

    /* Check for valid cached token */
    if (file_exists(auth_file())) {
        FILE *af = fopen(auth_file(), "r");
        if (af) {
            char abuf[4096] = {0}; fread(abuf, 1, sizeof(abuf)-1, af); fclose(af);
            long expires = json_get_long(abuf, "token_expires");
            char tok[512] = {0};
            json_get_str(abuf, "token", tok, sizeof(tok));
            if (tok[0] && expires > (long)time(NULL)) {
                char email[256] = {0};
                json_get_str(abuf, "email", email, sizeof(email));
                printf("\n\t✅ Already logged in as %s\n", email);
                /* fall through to setup */
                goto setup;
            }
        }
    }

    {
        char email[256], password[256];
        printf("\nEmail: "); fflush(stdout); fgets(email, sizeof(email), stdin);
        email[strcspn(email, "\n")] = '\0';
        printf("Password: "); fflush(stdout); fgets(password, sizeof(password), stdin);
        password[strcspn(password, "\n")] = '\0';

        char body[1024];
        snprintf(body, sizeof(body),
            "{\"email\":\"%s\",\"password\":\"%s\"}", email, password);

        char url[512];
        snprintf(url, sizeof(url), "%s/api/login", ideablock_api());
        char *resp = post_json(url, body, NULL);
        if (!resp) { puts("\n\t❌ Could not reach Ideablock API."); return; }

        char token[512] = {0};
        json_get_str(resp, "token", token, sizeof(token));
        if (!token[0]) { puts("\n\t❌ Invalid credentials."); free(resp); return; }

        long tok_expires = json_get_long(resp, "token_expires");
        char uid[128]={0}, uemail[256]={0}, fname[128]={0}, lname[128]={0};
        json_get_str(resp, "id", uid, sizeof(uid));
        json_get_str(resp, "email", uemail, sizeof(uemail));
        json_get_str(resp, "first_name", fname, sizeof(fname));
        json_get_str(resp, "last_name", lname, sizeof(lname));
        free(resp);

        char authdir[BUF_SIZE];
        snprintf(authdir, sizeof(authdir), "%s/.ideablock", home_dir());
        mkdir(authdir, 0700);

        FILE *af = fopen(auth_file(), "w");
        if (af) {
            fprintf(af,
                "{\"token\":\"%s\",\"token_expires\":%ld,"
                "\"user\":{\"id\":\"%s\",\"email\":\"%s\","
                "\"first_name\":\"%s\",\"last_name\":\"%s\"},"
                "\"cached_at\":%ld}",
                token, tok_expires, uid, uemail, fname, lname, (long)time(NULL));
            fclose(af);
            chmod(auth_file(), 0600);
        }
        printf("\n\t✅ Logged in as %s\n", uemail);
    }

setup:
    mkdir(".ideablock", 0755);
    write_conf(1);
    write_hook(HOOK_SCRIPT);
    write_hook(GIT_HOOK);
    puts("\t✅ Ideablock Commit initialized in this repository.");
}

static void cmd_on(void) {
    if (!is_git_repo()) { puts("\n\t❗ Not a git repository."); return; }
    if (!file_exists(CONF_FILE)) { puts("\n\t❗ Not initialized. Run \"ideablock-commit init\"."); return; }
    if (is_on()) { puts("\n\t✅ Ideablock Commit is already ON."); return; }
    write_conf(1); write_hook(GIT_HOOK);
    puts("\n\t✅ Ideablock Commit set to ON.");
}

static void cmd_off(void) {
    if (!is_git_repo()) { puts("\n\t❗ Not a git repository."); return; }
    if (!file_exists(CONF_FILE)) { puts("\n\t❗ Not initialized. Run \"ideablock-commit init\"."); return; }
    if (!is_on()) { puts("\n\t❌ Already OFF."); return; }
    write_conf(0); remove(GIT_HOOK);
    puts("\n\t❌ Ideablock Commit set to OFF.");
}

static void cmd_status(void) {
    if (!file_exists(CONF_FILE)) { puts("\n\t❗ UNINITIALIZED — run \"ideablock-commit init\"."); return; }
    if (!is_git_repo()) { puts("\n\t❗ Not a git repository."); return; }
    printf("\n\tIdeablock Commit is INITIALIZED and %s.\n", is_on() ? "ON" : "OFF");
}

static void cmd_remove(void) {
    if (!is_git_repo()) { puts("\n\t❗ Not a git repository."); return; }
    remove_dir_all(".ideablock"); remove(GIT_HOOK);
    puts("\n\t Ideablock Commit removed from this repository.");
}

static void cmd_logout(void) {
    if (!file_exists(auth_file())) { puts("\n\t⚠️  Not logged in."); return; }
    remove(auth_file());
    puts("\n\t✅ Logged out. Run \"ideablock-commit init\" to log in again.");
}

static void cmd_run(void) {
    if (!is_on()) {
        puts("\n\t❗ Ideablock Commit is OFF. Run \"ideablock-commit on\" to enable.");
        return;
    }

    /* 1. Auth */
    if (!file_exists(auth_file())) {
        puts("\n\t❌ Not authenticated. Run \"ideablock-commit init\"."); return;
    }
    char authbuf[4096] = {0};
    { FILE *af = fopen(auth_file(), "r"); fread(authbuf, 1, sizeof(authbuf)-1, af); fclose(af); }
    char token[512]={0}, user_id[128]={0};
    json_get_str(authbuf, "token", token, sizeof(token));
    long tok_expires = json_get_long(authbuf, "token_expires");
    if (tok_expires > 0 && tok_expires <= (long)time(NULL)) {
        remove(auth_file());
        puts("\n\t❌ Session expired. Run \"ideablock-commit init\" to log in again."); return;
    }
    json_get_str(authbuf, "id", user_id, sizeof(user_id));

    /* 2. Short hash */
    char *short_hash = git_output("log -1 --pretty=format:%h");
    if (!short_hash || !short_hash[0]) { puts("\n\t❌ Could not get git commit hash."); return; }
    short_hash[7] = '\0'; /* truncate to 7 */

    /* 3. Commit message */
    char *commit_msg = git_output("log -1 --pretty=format:%s");

    /* 4. Archive */
    char *name = repo_name_buf();
    char commit_dir[BUF_SIZE];
    snprintf(commit_dir, sizeof(commit_dir),
        "%s/.ideablock/commits/%s/%s", home_dir(), name, short_hash);
    { char cmd[BUF_SIZE]; snprintf(cmd, sizeof(cmd), "mkdir -p %s", commit_dir); system(cmd); }
    char zip_path[BUF_SIZE];
    snprintf(zip_path, sizeof(zip_path), "%s/Commit-%s.zip", commit_dir, short_hash);
    { char cmd[BUF_SIZE]; snprintf(cmd, sizeof(cmd), "git archive -o %s HEAD", zip_path); system(cmd); }

    /* 5. SHA-256 */
    char repo_hash[HASH_BUF];
    if (!sha256_file(zip_path, repo_hash)) { puts("\n\t❌ SHA-256 failed."); return; }

    /* 6. Parity + tethered hash */
    int parity = rand() % 10;
    char tethered_hash[BUF_SIZE];
    snprintf(tethered_hash, sizeof(tethered_hash), "%s%s%d", short_hash, repo_hash, parity);
    time_t now = time(NULL);
    char committed_at[64];
    strftime(committed_at, sizeof(committed_at), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

    /* 7. Timeglue */
    printf("\n\tTethering commit to Bitcoin blockchain"); fflush(stdout);
    char glue_body[BUF_SIZE];
    snprintf(glue_body, sizeof(glue_body),
        "{\"userID\":\"%s\",\"hash\":\"%s\"}", user_id, repo_hash);
    char glue_url[BUF_SIZE];
    snprintf(glue_url, sizeof(glue_url), "%s/glue", timeglue_url());
    char *glue_resp = post_json(glue_url, glue_body, NULL);
    if (!glue_resp) {
        puts("\n\t❌ Failed to reach timeglue. Is it running?"); return;
    }
    char btc_tx_id[256] = {0};
    json_get_str(glue_resp, "btcTx", btc_tx_id, sizeof(btc_tx_id));
    free(glue_resp);
    puts(" ✅");

    /* 8. Save commitData.json */
    char data_path[BUF_SIZE];
    snprintf(data_path, sizeof(data_path), "%s/commitData.json", commit_dir);
    FILE *df = fopen(data_path, "w");
    if (df) {
        fprintf(df,
            "{\"repoName\":\"%s\",\"shortHash\":\"%s\","
            "\"commitMessage\":\"%s\",\"repoHash\":\"%s\","
            "\"parityDigit\":%d,\"blockchainTetheredHash\":\"%s\","
            "\"btcTxID\":\"%s\",\"committedAt\":\"%s\"}",
            name, short_hash, commit_msg, repo_hash,
            parity, tethered_hash, btc_tx_id, committed_at);
        fclose(df);
    }

    /* 9. Print table */
    puts("\n\t✅ Congratulations! Your commit has been tethered using Ideablock!\n");
    printf("\t%-30s %s\n", "Bitcoin Hash:", btc_tx_id);
    printf("\t%-30s %s\n", "Commit Short Hash:", short_hash);
    printf("\t%-30s %s\n", "Repository Hash:", repo_hash);
    printf("\t%-30s %d\n", "Parity Digit:", parity);
    printf("\t%-30s %s\n", "Blockchain-Tethered Hash:", tethered_hash);
    printf("\t%-30s %s\n\n", "Commit Record Location:", commit_dir);

    /* 10. Best-effort sync (fire and forget via fork) */
    if (fork() == 0) {
        char sync_body[BUF_SIZE*2];
        snprintf(sync_body, sizeof(sync_body),
            "{\"repoName\":\"%s\",\"shortHash\":\"%s\","
            "\"commitMessage\":\"%s\",\"repoHash\":\"%s\","
            "\"parityDigit\":%d,\"blockchainTetheredHash\":\"%s\","
            "\"btcTxID\":\"%s\",\"committedAt\":\"%s\"}",
            name, short_hash, commit_msg, repo_hash,
            parity, tethered_hash, btc_tx_id, committed_at);
        char sync_url[BUF_SIZE];
        snprintf(sync_url, sizeof(sync_url), "%s/api/commit-ideas", ideablock_api());
        char *r = post_json(sync_url, sync_body, token);
        if (r) free(r);
        exit(0);
    }
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    srand((unsigned)time(NULL));
    if (argc < 2) {
        fprintf(stderr, "Usage: ideablock-commit <init|on|off|status|remove|run|logout>\n");
        return 1;
    }
    const char *cmd = argv[1];
    if (!strcmp(cmd,"init") || !strcmp(cmd,"i"))           cmd_init();
    else if (!strcmp(cmd,"on") || !strcmp(cmd,"resume"))   cmd_on();
    else if (!strcmp(cmd,"off") || !strcmp(cmd,"pause"))   cmd_off();
    else if (!strcmp(cmd,"status") || !strcmp(cmd,"ping")) cmd_status();
    else if (!strcmp(cmd,"remove") || !strcmp(cmd,"uninstall")) cmd_remove();
    else if (!strcmp(cmd,"run"))                            cmd_run();
    else if (!strcmp(cmd,"logout"))                         cmd_logout();
    else { fprintf(stderr, "Unknown command: %s\n", cmd); return 1; }
    return 0;
}
