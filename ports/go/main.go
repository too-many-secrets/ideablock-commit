// ideablock-commit — Go port
//
// Tethers every git commit to the Bitcoin blockchain via Ideablock's
// timeglue service. Identical functionality to the Node.js original.
//
// Build:
//   go mod init ideablock-commit && go mod tidy && go build -o ideablock-commit .
//
// Install:
//   go install .
//
// Usage:
//   ideablock-commit init|on|off|status|remove|run|logout
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ── Config ────────────────────────────────────────────────────────────────────

var (
	timeglueURL    = getEnv("TIMEGLUE_URL", "http://localhost:2312")
	ideablockAPI   = getEnv("IDEABLOCK_API_URL", "http://localhost:3000")
	homeDir, _     = os.UserHomeDir()
	authFilePath   = filepath.Join(homeDir, ".ideablock", "auth.json")
	confFileName   = ".ideablock/ideablock.json"
	hookScriptName = ".ideablock/post-commit"
	gitHookPath    = ".git/hooks/post-commit"
)

// ── Models ────────────────────────────────────────────────────────────────────

type AuthFile struct {
	Token       string  `json:"token"`
	TokenExpires int64  `json:"token_expires"`
	User        struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	} `json:"user"`
	CachedAt int64 `json:"cached_at"`
}

type IdeablockConf struct {
	On bool `json:"on"`
}

type CommitData struct {
	RepoName               string `json:"repoName"`
	ShortHash              string `json:"shortHash"`
	CommitMessage          string `json:"commitMessage"`
	RepoHash               string `json:"repoHash"`
	ParityDigit            int    `json:"parityDigit"`
	BlockchainTetheredHash string `json:"blockchainTetheredHash"`
	BtcTxID                string `json:"btcTxID"`
	CommittedAt            string `json:"committedAt"`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isGitRepo() bool { return exists(".git") }

func readConf() (*IdeablockConf, error) {
	data, err := os.ReadFile(confFileName)
	if err != nil {
		return nil, err
	}
	var conf IdeablockConf
	return &conf, json.Unmarshal(data, &conf)
}

func writeConf(on bool) error {
	data, _ := json.Marshal(IdeablockConf{On: on})
	return os.WriteFile(confFileName, data, 0644)
}

func isOn() bool {
	conf, err := readConf()
	return err == nil && conf.On
}

func readAuth() (*AuthFile, error) {
	data, err := os.ReadFile(authFilePath)
	if err != nil {
		return nil, err
	}
	var auth AuthFile
	return &auth, json.Unmarshal(data, &auth)
}

func gitOutput(args ...string) (string, error) {
	out, err := exec.Command("git", args...).Output()
	return strings.TrimSpace(string(out)), err
}

func repoName() string {
	cwd, _ := os.Getwd()
	return filepath.Base(cwd)
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

func postJSON(url string, body any, token string) (*http.Response, error) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return http.DefaultClient.Do(req)
}

func writeHook(hookPath string) error {
	script := "#!/bin/bash\nideablock-commit run\n"
	if err := os.MkdirAll(filepath.Dir(hookPath), 0755); err != nil {
		return err
	}
	if err := os.WriteFile(hookPath, []byte(script), 0744); err != nil {
		return err
	}
	return os.Chmod(hookPath, 0744)
}

// ── Commands ──────────────────────────────────────────────────────────────────

func cmdInit() {
	if !isGitRepo() {
		fmt.Println("\n\t❗ The current directory is not a git repository.")
		return
	}

	auth, err := readAuth()
	if err == nil && auth.Token != "" && auth.TokenExpires > time.Now().Unix() {
		fmt.Printf("\n\t✅ Already logged in as %s\n", auth.User.Email)
		cmdOn()
		return
	}

	// Prompt for credentials
	fmt.Print("\nEmail: ")
	var email string
	fmt.Scanln(&email)
	fmt.Print("Password: ")
	var password string
	fmt.Scanln(&password)

	resp, err := postJSON(ideablockAPI+"/api/login", map[string]string{
		"email":    email,
		"password": password,
	}, "")
	if err != nil {
		fmt.Printf("\n\t❌ Could not reach Ideablock API: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Println("\n\t❌ Invalid credentials. Please check your email and password.")
		return
	}

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)

	newAuth := AuthFile{
		Token:        result["token"].(string),
		TokenExpires: int64(result["token_expires"].(float64)),
		CachedAt:     time.Now().Unix(),
	}
	if u, ok := result["user"].(map[string]any); ok {
		newAuth.User.ID = fmt.Sprint(u["id"])
		newAuth.User.Email = fmt.Sprint(u["email"])
		newAuth.User.FirstName = fmt.Sprint(u["first_name"])
		newAuth.User.LastName = fmt.Sprint(u["last_name"])
	}

	os.MkdirAll(filepath.Dir(authFilePath), 0700)
	data, _ := json.Marshal(newAuth)
	os.WriteFile(authFilePath, data, 0600)
	fmt.Printf("\n\t✅ Logged in as %s\n", newAuth.User.Email)

	// Install hook
	os.MkdirAll(".ideablock", 0755)
	writeConf(true)
	writeHook(hookScriptName)
	writeHook(gitHookPath)
	fmt.Println("\t✅ Ideablock Commit initialized in this repository.")
}

func cmdOn() {
	if !isGitRepo() {
		fmt.Println("\n\t❗ Not a git repository.")
		return
	}
	if !exists(confFileName) {
		fmt.Println("\n\t❗ Not initialized. Run \"ideablock-commit init\" first.")
		return
	}
	if isOn() {
		fmt.Println("\n\t✅ Ideablock Commit is already ON.")
		return
	}
	writeConf(true)
	writeHook(gitHookPath)
	fmt.Println("\n\t✅ Ideablock Commit set to ON.")
}

func cmdOff() {
	if !isGitRepo() {
		fmt.Println("\n\t❗ Not a git repository.")
		return
	}
	if !exists(confFileName) {
		fmt.Println("\n\t❗ Not initialized. Run \"ideablock-commit init\" first.")
		return
	}
	if !isOn() {
		fmt.Println("\n\t❌ Ideablock Commit is already OFF.")
		return
	}
	writeConf(false)
	os.Remove(gitHookPath)
	fmt.Println("\n\t❌ Ideablock Commit set to OFF.")
}

func cmdStatus() {
	if !exists(confFileName) {
		fmt.Println("\n\t❗ UNINITIALIZED — run \"ideablock-commit init\" in this directory.")
		return
	}
	if !isGitRepo() {
		fmt.Println("\n\t❗ Not a git repository.")
		return
	}
	if isOn() {
		fmt.Println("\n\tIdeablock Commit is INITIALIZED and ON.")
	} else {
		fmt.Println("\n\tIdeablock Commit is INITIALIZED and OFF.")
	}
}

func cmdRemove() {
	if !isGitRepo() {
		fmt.Println("\n\t❗ Not a git repository.")
		return
	}
	os.RemoveAll(".ideablock")
	os.Remove(gitHookPath)
	fmt.Println("\n\t🗑️  Ideablock Commit removed from this repository.")
}

func cmdLogout() {
	if !exists(authFilePath) {
		fmt.Println("\n\t⚠️  Not logged in.")
		return
	}
	os.Remove(authFilePath)
	fmt.Println("\n\t✅ Logged out. Run \"ideablock-commit init\" to log in again.")
}

func cmdRun() {
	if !isOn() {
		fmt.Println("\n\t❗ Ideablock Commit is OFF in this repository. Run \"ideablock-commit on\" to enable.")
		return
	}

	// 1. Auth
	auth, err := readAuth()
	if err != nil {
		fmt.Println("\n\t❌ Not authenticated. Run \"ideablock-commit init\" to log in.")
		return
	}
	if auth.TokenExpires > 0 && auth.TokenExpires <= time.Now().Unix() {
		os.Remove(authFilePath)
		fmt.Println("\n\t❌ Your Ideablock session has expired. Run \"ideablock-commit init\" to log in again.")
		return
	}
	token := auth.Token
	userID := auth.User.ID

	// 2. Short hash
	shortHash, err := gitOutput("log", "-1", "--pretty=format:%h")
	if err != nil || shortHash == "" {
		fmt.Println("\n\t❌ Could not get git commit hash.")
		return
	}
	if len(shortHash) > 7 {
		shortHash = shortHash[:7]
	}

	// 3. Commit message
	commitMsg, _ := gitOutput("log", "-1", "--pretty=format:%s")

	// 4. Archive
	name := repoName()
	commitDir := filepath.Join(homeDir, ".ideablock", "commits", name, shortHash)
	os.MkdirAll(commitDir, 0775)
	zipPath := filepath.Join(commitDir, "Commit-"+shortHash+".zip")
	if err := exec.Command("git", "archive", "-o", zipPath, "HEAD").Run(); err != nil {
		fmt.Printf("\n\t❌ git archive failed: %v\n", err)
		return
	}

	// 5. SHA-256
	repoHash, err := sha256File(zipPath)
	if err != nil {
		fmt.Printf("\n\t❌ SHA-256 failed: %v\n", err)
		return
	}

	// 6. Parity + tethered hash
	parity := rand.Intn(10)
	tetheredHash := fmt.Sprintf("%s%s%d", shortHash, repoHash, parity)
	committedAt := time.Now().UTC().Format(time.RFC3339)

	// 7. Timeglue
	fmt.Print("\n\tTethering commit to Bitcoin blockchain")
	glueResp, err := postJSON(timeglueURL+"/glue", map[string]string{
		"userID": userID,
		"hash":   repoHash,
	}, "")
	if err != nil {
		fmt.Printf("\n\t❌ Failed to reach timeglue: %v\n", err)
		fmt.Println("\t   Is timeglue running? Start it with: MOCK_MODE=true ./timeglue")
		return
	}
	defer glueResp.Body.Close()
	var glueResult map[string]string
	json.NewDecoder(glueResp.Body).Decode(&glueResult)
	btcTxID := glueResult["btcTx"]
	fmt.Println(" ✅")

	// 8. Save commitData.json
	commitData := CommitData{
		RepoName:               name,
		ShortHash:              shortHash,
		CommitMessage:          commitMsg,
		RepoHash:               repoHash,
		ParityDigit:            parity,
		BlockchainTetheredHash: tetheredHash,
		BtcTxID:                btcTxID,
		CommittedAt:            committedAt,
	}
	commitJSON, _ := json.MarshalIndent(commitData, "", "  ")
	os.WriteFile(filepath.Join(commitDir, "commitData.json"), commitJSON, 0644)

	// 9. Print table
	fmt.Printf("\n\t✅ Congratulations! Your commit has been successfully tethered using Ideablock!\n\n")
	fmt.Printf("\t%-30s %s\n", "Bitcoin Hash:", btcTxID)
	fmt.Printf("\t%-30s %s\n", "Commit Short Hash:", shortHash)
	fmt.Printf("\t%-30s %s\n", "Repository Hash:", repoHash)
	fmt.Printf("\t%-30s %d\n", "Parity Digit:", parity)
	fmt.Printf("\t%-30s %s\n", "Blockchain-Tethered Hash:", tetheredHash)
	fmt.Printf("\t%-30s %s\n\n", "Commit Record Location:", commitDir)

	// 10. Best-effort sync
	go func() {
		postJSON(ideablockAPI+"/api/commit-ideas", commitData, token)
	}()
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: ideablock-commit <init|on|off|status|remove|run|logout>")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "init", "i":
		cmdInit()
	case "on", "resume":
		cmdOn()
	case "off", "pause":
		cmdOff()
	case "status", "ping":
		cmdStatus()
	case "remove", "uninstall":
		cmdRemove()
	case "run":
		cmdRun()
	case "logout":
		cmdLogout()
	default:
		fmt.Printf("Unknown command: %s\n", os.Args[1])
		fmt.Println("Usage: ideablock-commit <init|on|off|status|remove|run|logout>")
		os.Exit(1)
	}
}
