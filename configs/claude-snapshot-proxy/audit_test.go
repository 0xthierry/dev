package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuditContainsOnlyMetadataAfterInitializeWasWritten(t *testing.T) {
	previous := auditPath
	auditPath = filepath.Join(t.TempDir(), "events.jsonl")
	t.Cleanup(func() { auditPath = previous })
	input := `{"type":"control_request","request_id":"SECRET-ID","request":{"subtype":"initialize","systemPromptSnapshot":true,"token":"SECRET-TOKEN","systemPrompt":"SECRET-PROMPT"}}` + "\n" + `{"type":"user","text":"SECRET-MESSAGE"}` + "\n"
	var output bytes.Buffer
	err := forwardFrames(strings.NewReader(input), &output)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	var event map[string]any
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatal(err)
	}
	delete(event, "time")
	delete(event, "pid")
	delete(event, "ppid")
	want := `{"event":"initialize_forwarded","snapshot_after":false,"snapshot_before":true}`
	actual, err := json.Marshal(event)
	if err != nil || string(actual) != want {
		t.Fatalf("metadata = %s, %v; want %s", actual, err, want)
	}
	if bytes.Contains(raw, []byte("SECRET")) {
		t.Fatal("audit leaked protocol content")
	}
	info, err := os.Stat(auditPath)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("audit must be private: %v %v", info, err)
	}
}

type failedWriter struct{}

func (failedWriter) Write([]byte) (int, error) { return 0, errors.New("closed") }

func TestAuditDoesNotClaimFailedWriteWasForwarded(t *testing.T) {
	previous := auditPath
	auditPath = filepath.Join(t.TempDir(), "events.jsonl")
	t.Cleanup(func() { auditPath = previous })
	err := forwardFrames(strings.NewReader(`{"type":"control_request","request":{"subtype":"initialize"}}`), failedWriter{})
	if err == nil {
		t.Fatal("expected write failure")
	}
	if _, err := os.Stat(auditPath); !os.IsNotExist(err) {
		t.Fatalf("unexpected audit file: %v", err)
	}
}

func TestAuditDoesNotExposeNonBooleanSnapshot(t *testing.T) {
	event := initializeEvent([]byte(`{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":"SECRET"}}`))
	if event == nil || event.SnapshotBefore != nil || event.SnapshotAfter == nil || *event.SnapshotAfter {
		t.Fatalf("unsafe metadata: %+v", event)
	}
}

func TestAuditUsesLastDuplicateKeys(t *testing.T) {
	event := initializeEvent([]byte(`{"type":"control_request","request":{"subtype":"initialize","systemPromptSnapshot":false,"systemPromptSnapshot":true}}`))
	if event == nil || event.SnapshotBefore == nil || !*event.SnapshotBefore {
		t.Fatalf("wrong effective value: %+v", event)
	}
}

func TestAuditIgnoresNoninitializeFrames(t *testing.T) {
	event := initializeEvent([]byte(`{"type":"user","request":{"subtype":"initialize","systemPromptSnapshot":true}}`))
	if event != nil {
		t.Fatalf("unexpected metadata: %+v", event)
	}
}
