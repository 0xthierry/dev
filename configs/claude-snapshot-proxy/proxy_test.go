package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

var testProxy, testRoot string

// All child processes are this local helper; no engine, API, network, or tools.
func TestMain(m *testing.M) {
	if mode := os.Getenv("PROXY_TEST_CHILD"); mode != "" {
		runHelper(mode)
		os.Exit(0)
	}
	cwd, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	testRoot, err = os.MkdirTemp(cwd, ".proxy-tests-")
	if err != nil {
		panic(err)
	}
	helper, err := os.Executable()
	if err != nil {
		panic(err)
	}
	testProxy = filepath.Join(testRoot, "proxy")
	buildArgs := []string{"build"}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			if setting.Key == "-race" && setting.Value == "true" {
				buildArgs = append(buildArgs, "-race")
			}
		}
	}
	buildArgs = append(buildArgs, "-ldflags", "-X main.enginePath="+helper, "-o", testProxy, ".")
	build := exec.Command("go", buildArgs...)
	build.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local")
	if output, err := build.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "build helper proxy: %v\n%s", err, output)
		os.RemoveAll(testRoot)
		os.Exit(1)
	}
	code := m.Run()
	if err := os.RemoveAll(testRoot); err != nil {
		fmt.Fprintln(os.Stderr, "test cleanup failed:", err)
		code = 1
	}
	os.Exit(code)
}

type childFacts struct {
	Args []string
	Env  []string
	Cwd  string
	PID  int
}

func runHelper(mode string) {
	switch mode {
	case "echo":
		fmt.Fprint(os.Stderr, "child-stderr\x00✓\n")
		_, _ = io.Copy(os.Stdout, os.Stdin)
		code, _ := strconv.Atoi(os.Getenv("PROXY_TEST_EXIT"))
		os.Exit(code)
	case "inspect":
		cwd, _ := os.Getwd()
		_ = json.NewEncoder(os.Stdout).Encode(childFacts{os.Args, os.Environ(), cwd, os.Getpid()})
	case "signal":
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
		fmt.Fprintf(os.Stdout, "READY %d\n", os.Getpid())
		sig := <-signals
		if sig == syscall.SIGINT {
			fmt.Fprint(os.Stderr, "child received SIGINT\n")
			os.Exit(42)
		}
		fmt.Fprint(os.Stderr, "child received SIGTERM\n")
		os.Exit(41)
	case "ignore":
		signal.Ignore(syscall.SIGTERM, syscall.SIGINT)
		fmt.Fprintf(os.Stdout, "READY %d\n", os.Getpid())
		for {
			time.Sleep(time.Hour)
		}
	case "exit":
		fmt.Fprint(os.Stdout, "early exit\n")
		os.Exit(23)
	case "self-signal":
		_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
		select {}
	default:
		os.Exit(99)
	}
}

func TestInitializeChangesOnlySnapshotValueBytes(t *testing.T) {
	input := []byte(" { \"type\":\"control_request\", \"request_id\":900719925474099312345, \"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":true,\"unicode\":\"雪\\u2603 <>&\",\"nested\":{\"n\":1.2300e+50,\"systemPromptSnapshot\":true}} }\r\n")
	want := " { \"type\":\"control_request\", \"request_id\":900719925474099312345, \"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":false,\"unicode\":\"雪\\u2603 <>&\",\"nested\":{\"n\":1.2300e+50,\"systemPromptSnapshot\":true}} }\r\n"
	got, err := rewriteFrame(input)
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestInitializeWithoutSnapshotInsertsOnlyThatMember(t *testing.T) {
	got, err := rewriteFrame([]byte(`{"type":"control_request","request":{"subtype":"initialize"  },"id":123456789012345678901234567890}`))
	want := `{"type":"control_request","request":{"subtype":"initialize"  ,"systemPromptSnapshot":false},"id":123456789012345678901234567890}`
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestEscapedProtocolKeysAndSubtypeStillDisableSnapshot(t *testing.T) {
	got, err := rewriteFrame([]byte(`{"type":"control_request","request":{"sub\u0074ype":"initial\u0069ze","systemPrompt\u0053napshot":null}}`))
	want := `{"type":"control_request","request":{"sub\u0074ype":"initial\u0069ze","systemPrompt\u0053napshot":false}}`
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestNoninitializeFramesAreByteForByteUnchanged(t *testing.T) {
	input := " {\"type\":\"user\", \"message\":\"snow 雪\\n\\\"\", \"id\":900719925474099312345}\r\n" +
		"{\"type\":\"control_request\",\"request\":{\"subtype\":\"interrupt\",\"systemPromptSnapshot\":true}}\n"
	var output bytes.Buffer
	err := forwardFrames(strings.NewReader(input), &output)
	if err != nil || output.String() != input {
		t.Fatalf("forward = %q, %v; want original bytes %q", output.String(), err, input)
	}
}

func TestLargeFramesAndFinalUnterminatedLineSurviveSplitReads(t *testing.T) {
	padding := strings.Repeat("雪\\u2603", 20000)
	input := "{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":true}}\n" +
		"{\"type\":\"user\",\"text\":\"" + padding + "\"}"
	reader := &splitReader{data: []byte(input)}
	var output bytes.Buffer
	err := forwardFrames(reader, &output)
	want := "{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":false}}\n" +
		"{\"type\":\"user\",\"text\":\"" + padding + "\"}"
	if err != nil || output.String() != want {
		t.Fatalf("split/large forwarding mismatch: error=%v got bytes=%d want bytes=%d", err, output.Len(), len(want))
	}
}

type splitReader struct{ data []byte }

func (r *splitReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := min(len(p), 7, len(r.data))
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func TestDuplicateRootTypeUsesLastValue(t *testing.T) {
	input := []byte(`{"type":"user","type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":true}}`)
	want := `{"type":"user","type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":false}}`
	got, err := rewriteFrame(input)
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestDuplicateRootRequestRewritesOnlyLastRequest(t *testing.T) {
	input := []byte(`{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":true},"request":{"subtype":"initialize","systemPromptSnapshot":true}}`)
	want := `{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":true},"request":{"subtype":"initialize","systemPromptSnapshot":false}}`
	got, err := rewriteFrame(input)
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestDuplicateRequestSubtypeUsesLastValue(t *testing.T) {
	input := []byte(`{"type":"control_request","request":{"subtype":"interrupt","subtype":"initialize","systemPromptSnapshot":true}}`)
	want := `{"type":"control_request","request":{"subtype":"interrupt","subtype":"initialize","systemPromptSnapshot":false}}`
	got, err := rewriteFrame(input)
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestDuplicateSnapshotRewritesOnlyLastEffectiveValue(t *testing.T) {
	input := []byte(`{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":true,"systemPrompt\u0053napshot":{"ignored":900719925474099312345}}}`)
	want := `{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":true,"systemPrompt\u0053napshot":false}}`
	got, err := rewriteFrame(input)
	if err != nil || string(got) != want {
		t.Fatalf("rewrite = %q, %v; want %q", got, err, want)
	}
}

func TestNoninitializeDuplicateKeysRemainByteForByteUnchanged(t *testing.T) {
	input := "{\"type\":\"control_request\",\"type\":\"user\",\"request\":null,\"id\":1,\"id\":900719925474099312345}\r\n" +
		"{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":true},\"request\":{\"subtype\":\"interrupt\"}}\n" +
		"{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"subtype\":\"interrupt\",\"systemPromptSnapshot\":true,\"systemPromptSnapshot\":null}}"
	var output bytes.Buffer
	err := forwardFrames(strings.NewReader(input), &output)
	if err != nil || output.String() != input {
		t.Fatalf("duplicate noninitialize forwarding = %q, %v; want original bytes %q", output.String(), err, input)
	}
}

func TestSDKChildReceivesLastKeyWinsSnapshotRewrite(t *testing.T) {
	cmd := childCommand("echo", "--input-format=stream-json")
	cmd.Stdin = strings.NewReader(`{"type":"user","type":"control_request","request":null,"request":{"subtype":null,"subtype":"initialize","systemPromptSnapshot":true,"systemPromptSnapshot":true}}`)
	output, err := cmd.Output()
	want := `{"type":"user","type":"control_request","request":null,"request":{"subtype":null,"subtype":"initialize","systemPromptSnapshot":true,"systemPromptSnapshot":false}}`
	if childExitCode(err) != 17 || string(output) != want {
		t.Fatalf("duplicate SDK frame: code=%d output=%q; want %q", childExitCode(err), output, want)
	}
}

func TestInvalidFramesAreNotForwarded(t *testing.T) {
	cases := map[string]string{
		"invalid JSON":         `{"type":"user","private":"secret"`,
		"multiple JSON values": `{"type":"user"} {"type":"user"}`,
		"not object":           `[]`,
		"blank frame":          "\n",
		"missing type":         `{}`,
		"null type":            `{"type":null}`,
		"invalid request":      `{"type":"control_request","request":[]}`,
		"missing subtype":      `{"type":"control_request","request":{}}`,
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			var output bytes.Buffer
			err := forwardFrames(strings.NewReader(input), &output)
			if err != errInvalidFrame || output.String() != "" {
				t.Fatalf("invalid input: error=%v output=%q; want rejection and no bytes", err, output.String())
			}
		})
	}
}

func childCommand(mode string, args ...string) *exec.Cmd {
	cmd := exec.Command(testProxy, args...)
	cmd.Env = []string{"PROXY_TEST_CHILD=" + mode, "PROXY_TEST_EXIT=17", "PROXY_SENTINEL=雪=unmodified"}
	cmd.Dir = testRoot
	return cmd
}

func TestSDKChildSeesRewrittenFirstFrameAndInheritedOutputUntilEOF(t *testing.T) {
	cmd := childCommand("echo", "--input-format", "stream-json")
	cmd.Stdin = strings.NewReader("{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":true}}\n{\"type\":\"user\",\"id\":900719925474099312345}")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	want := "{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":false}}\n{\"type\":\"user\",\"id\":900719925474099312345}"
	if childExitCode(err) != 17 || stdout.String() != want || stderr.String() != "child-stderr\x00✓\n" {
		t.Fatalf("code=%d stdout=%q stderr=%q", childExitCode(err), stdout.String(), stderr.String())
	}
}

func TestFirstSDKFrameIsRewrittenBeforeParentClosesStdin(t *testing.T) {
	cmd := childCommand("echo", "--input-format=stream-json")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	if _, err := io.WriteString(stdin, `{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":tr`); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(stdin, "ue}}\n"); err != nil {
		t.Fatal(err)
	}
	received := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(stdout).ReadString('\n')
		received <- line
	}()
	select {
	case got := <-received:
		want := "{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":false}}\n"
		if got != want {
			t.Fatalf("first child frame=%q, want %q", got, want)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("first frame did not reach child while parent stdin remained open")
	}
	stdin.Close()
	err = waitBounded(t, cmd)
	if childExitCode(err) != 17 {
		t.Fatalf("child exit=%d, want 17", childExitCode(err))
	}
}

func TestSDKEqualsFlagPreservesOriginalArgvCwdAndEnvironment(t *testing.T) {
	cmd := childCommand("inspect", "--input-format=stream-json", "--arbitrary", "spaces and 雪")
	cmd.Args[0] = "original-sdk-argv0"
	output, err := cmd.Output()
	var got childFacts
	decodeErr := json.Unmarshal(output, &got)
	want := childFacts{Args: []string{"original-sdk-argv0", "--input-format=stream-json", "--arbitrary", "spaces and 雪"}, Env: cmd.Env, Cwd: testRoot, PID: got.PID}
	if err != nil || decodeErr != nil || !reflect.DeepEqual(got, want) || got.PID == cmd.Process.Pid {
		t.Fatalf("SDK child inherited state mismatch: processErr=%v decodeErr=%v got=%+v want=%+v proxyPID=%d", err, decodeErr, got, want, cmd.Process.Pid)
	}
}

func TestNonSDKExecPreservesPIDArgvCwdAndEnvironment(t *testing.T) {
	cmd := childCommand("inspect", "--version", "unchanged arg")
	cmd.Args[0] = "original-version-argv0"
	output, err := cmd.Output()
	var got childFacts
	decodeErr := json.Unmarshal(output, &got)
	want := childFacts{Args: []string{"original-version-argv0", "--version", "unchanged arg"}, Env: cmd.Env, Cwd: testRoot, PID: cmd.Process.Pid}
	if err != nil || decodeErr != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("exec inheritance mismatch: processErr=%v decodeErr=%v got=%+v want=%+v", err, decodeErr, got, want)
	}
}

func TestNonSDKExecDoesNotInspectOrRewriteStdin(t *testing.T) {
	cmd := childCommand("echo")
	input := "not JSON\x00\n{\"type\":\"control_request\",\"request\":{\"subtype\":\"initialize\",\"systemPromptSnapshot\":true}}\n"
	cmd.Stdin = strings.NewReader(input)
	output, err := cmd.Output()
	if childExitCode(err) != 17 || string(output) != input {
		t.Fatalf("non-SDK code=%d output=%q; want unchanged input", childExitCode(err), output)
	}
}

func TestOnlyExplicitSDKInputFormatEnablesProxy(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want bool
	}{
		{"split SDK", []string{"--input-format", "stream-json"}, true},
		{"equals SDK", []string{"--input-format=stream-json"}, true},
		{"version", []string{"--version"}, false},
		{"output format only", []string{"--output-format", "stream-json"}, false},
		{"after separator", []string{"--", "--input-format=stream-json"}, false},
		{"last format wins", []string{"--input-format=stream-json", "--input-format", "text"}, false},
		{"missing format", []string{"--input-format"}, false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := sdkMode(tt.args); got != tt.want {
				t.Fatalf("SDK classification = %t, want %t", got, tt.want)
			}
		})
	}
}

// launchWaitingChild establishes readiness through a real pipe, not a sleep.
func launchWaitingChild(t *testing.T, mode string) (*exec.Cmd, io.WriteCloser, *bytes.Buffer, int) {
	t.Helper()
	cmd := childCommand(mode, "--input-format=stream-json")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr := new(bytes.Buffer)
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	var childPID int
	t.Cleanup(func() {
		stdin.Close()
		_ = cmd.Process.Kill()
		if childPID != 0 {
			_ = syscall.Kill(childPID, syscall.SIGKILL)
		}
	})
	ready := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(stdout).ReadString('\n')
		ready <- line
	}()
	select {
	case line := <-ready:
		if _, err := fmt.Sscanf(line, "READY %d\n", &childPID); err != nil {
			t.Fatalf("child readiness: %q: %v", line, err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("child readiness timed out")
	}
	return cmd, stdin, stderr, childPID
}

func waitBounded(t *testing.T, cmd *exec.Cmd) error {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("proxy failed to exit within 10 seconds")
		return nil
	}
}

func TestSIGTERMReachesChildAndPreservesItsExitStatus(t *testing.T) {
	cmd, _, stderr, childPID := launchWaitingChild(t, "signal")
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	err := waitBounded(t, cmd)
	if childExitCode(err) != 41 || stderr.String() != "child received SIGTERM\n" || syscall.Kill(childPID, 0) != syscall.ESRCH {
		t.Fatalf("SIGTERM result: code=%d stderr=%q child still alive=%t", childExitCode(err), stderr.String(), syscall.Kill(childPID, 0) != syscall.ESRCH)
	}
}

func TestSIGINTReachesChildAndPreservesItsExitStatus(t *testing.T) {
	cmd, _, stderr, childPID := launchWaitingChild(t, "signal")
	if err := cmd.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatal(err)
	}
	err := waitBounded(t, cmd)
	if childExitCode(err) != 42 || stderr.String() != "child received SIGINT\n" || syscall.Kill(childPID, 0) != syscall.ESRCH {
		t.Fatalf("SIGINT result: code=%d stderr=%q child still alive=%t", childExitCode(err), stderr.String(), syscall.Kill(childPID, 0) != syscall.ESRCH)
	}
}

func TestIgnoringTerminationIsKilledAndReapedWithinBound(t *testing.T) {
	cmd, _, stderr, childPID := launchWaitingChild(t, "ignore")
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	err := waitBounded(t, cmd)
	if childExitCode(err) != 137 || stderr.String() != "" || syscall.Kill(childPID, 0) != syscall.ESRCH {
		t.Fatalf("bounded termination: code=%d stderr=%q child still alive=%t", childExitCode(err), stderr.String(), syscall.Kill(childPID, 0) != syscall.ESRCH)
	}
}

func TestInvalidStreamKillsAndReapsChildWithoutLoggingPrivateInput(t *testing.T) {
	cmd, stdin, stderr, childPID := launchWaitingChild(t, "ignore")
	if _, err := io.WriteString(stdin, "{private-prompt-or-credential\n"); err != nil {
		t.Fatal(err)
	}
	err := waitBounded(t, cmd)
	if childExitCode(err) != 65 || stderr.String() != "snapshot-proxy: invalid or unreadable input stream\n" || syscall.Kill(childPID, 0) != syscall.ESRCH {
		t.Fatalf("invalid-stream cleanup: code=%d stderr=%q child still alive=%t", childExitCode(err), stderr.String(), syscall.Kill(childPID, 0) != syscall.ESRCH)
	}
}

func TestChildExitDoesNotWaitForOpenParentStdin(t *testing.T) {
	cmd := childCommand("exit", "--input-format=stream-json")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	err = waitBounded(t, cmd)
	if childExitCode(err) != 23 || stdout.String() != "early exit\n" {
		t.Fatalf("early child exit: code=%d stdout=%q", childExitCode(err), stdout.String())
	}
}

func TestChildKilledBySignalReturnsConventionalSignalStatus(t *testing.T) {
	cmd := childCommand("self-signal", "--input-format=stream-json")
	err := cmd.Run()
	if childExitCode(err) != 137 {
		t.Fatalf("signal exit code=%d, want 137", childExitCode(err))
	}
}
