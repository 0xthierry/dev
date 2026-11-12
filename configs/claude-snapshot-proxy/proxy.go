// snapshot-proxy disables SDK prompt snapshots without modifying the vendor engine.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

// Set with go build -ldflags '-X main.enginePath=/absolute/path/to/original'.
var enginePath string

// Optional metadata-only audit path, set at build time. Never record payloads.
var auditPath string

type auditRecord struct {
	Event          string `json:"event"`
	Time           string `json:"time"`
	PID            int    `json:"pid"`
	PPID           int    `json:"ppid"`
	ChildPID       int    `json:"child_pid,omitempty"`
	SnapshotBefore *bool  `json:"snapshot_before,omitempty"`
	SnapshotAfter  *bool  `json:"snapshot_after,omitempty"`
}

func audit(event auditRecord) {
	if auditPath == "" {
		return
	}
	event.Time = time.Now().UTC().Format(time.RFC3339Nano)
	event.PID, event.PPID = os.Getpid(), os.Getppid()
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	file, err := os.OpenFile(auditPath, os.O_WRONLY|os.O_APPEND|os.O_CREATE|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err == nil {
		defer file.Close()
		info, statErr := file.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			err = errors.New("audit path is not a regular file")
		} else {
			_, err = file.Write(append(data, '\n'))
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "snapshot-proxy: metadata audit unavailable")
	}
}

func initializeEvent(frame []byte) *auditRecord {
	fields, err := objectFields(frame)
	if err != nil {
		return nil
	}
	kind, err := stringField(frame, fields, "type")
	if err != nil || kind != "control_request" {
		return nil
	}
	span, ok := fields["request"]
	if !ok {
		return nil
	}
	request := frame[span.start:span.end]
	fields, err = objectFields(request)
	if err != nil {
		return nil
	}
	subtype, err := stringField(request, fields, "subtype")
	if err != nil || subtype != "initialize" {
		return nil
	}
	after := false
	event := &auditRecord{Event: "initialize_forwarded", SnapshotAfter: &after}
	if span, ok := fields["systemPromptSnapshot"]; ok {
		raw := request[span.start:span.end]
		if bytes.Equal(raw, []byte("true")) || bytes.Equal(raw, []byte("false")) {
			before := bytes.Equal(raw, []byte("true"))
			event.SnapshotBefore = &before
		}
	}
	return event
}

var errInvalidFrame = errors.New("invalid protocol frame")

func main() {
	if enginePath == "" {
		fmt.Fprintln(os.Stderr, "snapshot-proxy: missing embedded engine path")
		os.Exit(126)
	}
	if !sdkMode(os.Args[1:]) {
		audit(auditRecord{Event: "cli_exec"})
		// Exec preserves argv[0], all arguments, cwd, environment, and terminal FDs.
		if err := syscall.Exec(enginePath, os.Args, os.Environ()); err != nil {
			fmt.Fprintln(os.Stderr, "snapshot-proxy: cannot execute engine")
			os.Exit(126)
		}
	}
	os.Exit(runSDK())
}

// Last explicit input-format wins; options following -- are not launcher flags.
func sdkMode(args []string) bool {
	format := ""
	for i := 0; i < len(args); i++ {
		if args[i] == "--" {
			break
		}
		if args[i] == "--input-format" {
			if i+1 < len(args) {
				i++
				format = args[i]
			}
		} else if bytes.HasPrefix([]byte(args[i]), []byte("--input-format=")) {
			format = args[i][len("--input-format="):]
		}
	}
	return format == "stream-json"
}

type valueSpan struct {
	start, end int
}

// objectFields indexes raw value spans without converting numbers or strings.
// Duplicate keys use the last occurrence, matching the engine's JSON.parse.
func objectFields(data []byte) (map[string]valueSpan, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return nil, errInvalidFrame
	}
	fields := make(map[string]valueSpan)
	for dec.More() {
		token, err = dec.Token()
		if err != nil {
			return nil, errInvalidFrame
		}
		key, ok := token.(string)
		if !ok {
			return nil, errInvalidFrame
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, errInvalidFrame
		}
		end := int(dec.InputOffset())
		fields[key] = valueSpan{end - len(raw), end}
	}
	if _, err := dec.Token(); err != nil {
		return nil, errInvalidFrame
	}
	return fields, nil
}

func stringField(data []byte, fields map[string]valueSpan, key string) (string, error) {
	span, ok := fields[key]
	if !ok {
		return "", errInvalidFrame
	}
	var value string
	if err := json.Unmarshal(data[span.start:span.end], &value); err != nil || bytes.Equal(data[span.start:span.end], []byte("null")) {
		return "", errInvalidFrame
	}
	return value, nil
}

// rewriteFrame replaces only the target value's bytes, or inserts that member.
// All other bytes (including escaped strings and large numeric IDs) survive.
func rewriteFrame(frame []byte) ([]byte, error) {
	if !json.Valid(frame) {
		return nil, errInvalidFrame
	}
	fields, err := objectFields(frame)
	if err != nil {
		return nil, err
	}
	kind, err := stringField(frame, fields, "type")
	if err != nil {
		return nil, err
	}
	if kind != "control_request" {
		return frame, nil
	}
	requestSpan, ok := fields["request"]
	if !ok {
		return nil, errInvalidFrame
	}
	request := frame[requestSpan.start:requestSpan.end]
	requestFields, err := objectFields(request)
	if err != nil {
		return nil, err
	}
	subtype, err := stringField(request, requestFields, "subtype")
	if err != nil {
		return nil, err
	}
	if subtype != "initialize" {
		return frame, nil
	}
	span, exists := requestFields["systemPromptSnapshot"]
	var start, end int
	replacement := []byte("false")
	if exists {
		start = requestSpan.start + span.start
		end = requestSpan.start + span.end
	} else {
		// The object contains at least subtype, so insertion needs a comma.
		start = requestSpan.end - 1
		end = start
		replacement = []byte(`,"systemPromptSnapshot":false`)
	}
	out := make([]byte, 0, len(frame)-(end-start)+len(replacement))
	out = append(out, frame[:start]...)
	out = append(out, replacement...)
	out = append(out, frame[end:]...)
	return out, nil
}

func forwardFrames(input io.Reader, output io.Writer) error {
	reader := bufio.NewReader(input)
	for {
		frame, readErr := reader.ReadBytes('\n')
		if len(frame) != 0 {
			rewritten, err := rewriteFrame(frame)
			if err != nil {
				return err
			}
			if _, err := io.Copy(output, bytes.NewReader(rewritten)); err != nil {
				return err
			}
			if auditPath != "" {
				if event := initializeEvent(frame); event != nil {
					audit(*event)
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return errInvalidFrame
		}
	}
}

func childExitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			return 128 + int(status.Signal())
		}
		return exitErr.ExitCode()
	}
	return 126
}

func runSDK() int {
	// Register before starting, so a signal cannot strand a newly started child.
	signals := make(chan os.Signal, 8)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(signals)

	input, output, err := os.Pipe()
	if err != nil {
		fmt.Fprintln(os.Stderr, "snapshot-proxy: cannot create engine input")
		return 126
	}
	defer input.Close()
	defer output.Close()
	cmd := &exec.Cmd{Path: enginePath, Args: os.Args, Env: os.Environ(), Stdin: input, Stdout: os.Stdout, Stderr: os.Stderr}
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "snapshot-proxy: cannot start engine")
		return 126
	}
	audit(auditRecord{Event: "sdk_child_started", ChildPID: cmd.Process.Pid})
	input.Close()
	waited := make(chan error, 1)
	go func() { waited <- cmd.Wait() }()
	forwarded := make(chan error, 1)
	go func() {
		err := forwardFrames(os.Stdin, output)
		forwarded <- err
		output.Close() // Publish the outcome before EOF can make the child exit.
	}()

	var timeout <-chan time.Time
	var timer *time.Timer
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	failedInput := false
	for {
		select {
		case err := <-waited:
			// A fast EOF-driven exit may race the already-published input result.
			select {
			case inputErr := <-forwarded:
				if errors.Is(inputErr, errInvalidFrame) {
					fmt.Fprintln(os.Stderr, "snapshot-proxy: invalid or unreadable input stream")
					failedInput = true
				}
			default:
			}
			if failedInput {
				return 65
			}
			return childExitCode(err)
		case err := <-forwarded:
			forwarded = nil
			if errors.Is(err, errInvalidFrame) {
				// Never include protocol content, credentials, or engine arguments.
				fmt.Fprintln(os.Stderr, "snapshot-proxy: invalid or unreadable input stream")
				failedInput = true
				_ = cmd.Process.Kill()
			}
		case sig := <-signals:
			_ = cmd.Process.Signal(sig)
			if timer == nil {
				// Bound direct-child cleanup if the engine ignores termination.
				timer = time.NewTimer(2 * time.Second)
				timeout = timer.C
			}
		case <-timeout:
			timeout = nil
			_ = cmd.Process.Kill()
		}
	}
}
