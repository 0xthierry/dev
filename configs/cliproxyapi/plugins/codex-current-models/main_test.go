package main

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func installDiscoveryFakes(t *testing.T, files []hostAuthFile, models map[string]map[string]bool, failures map[string]error) {
	t.Helper()
	oldListAuthFiles := listAuthFiles
	oldLookupAuthModels := lookupAuthModels
	listAuthFiles = func() ([]hostAuthFile, error) {
		return append([]hostAuthFile(nil), files...), nil
	}
	lookupAuthModels = func(authID, authIndex string) (map[string]bool, error) {
		if err := failures[authID]; err != nil {
			return nil, err
		}
		return cloneModelSet(models[authID]), nil
	}
	t.Cleanup(func() {
		listAuthFiles = oldListAuthFiles
		lookupAuthModels = oldLookupAuthModels
		roundRobinCounter.Store(0)
	})
}

func decodeSchedulerResponse(t *testing.T, raw []byte) schedulerPickResponse {
	t.Helper()
	var wrapped envelope
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if !wrapped.OK {
		t.Fatalf("scheduler returned error envelope: %s", raw)
	}
	var response schedulerPickResponse
	if err := json.Unmarshal(wrapped.Result, &response); err != nil {
		t.Fatalf("decode scheduler response: %v", err)
	}
	return response
}

func TestDiscoverRegisteredModelsUsesUnionOfLiveAccountCatalogs(t *testing.T) {
	// Arrange
	installDiscoveryFakes(t,
		[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}, {ID: "auth-b", AuthIndex: "index-b"}},
		map[string]map[string]bool{
			"auth-a": {"gpt-6-sol": true, "gpt-6-luna": true, "gpt-daybreak-blue-latest": true},
			"auth-b": {"gpt-6-sol": true, "gpt-6-luna": true},
		},
		nil,
	)

	// Act
	models, err := discoverRegisteredModels()

	// Assert
	if err != nil {
		t.Fatalf("discoverRegisteredModels() error = %v", err)
	}
	ids := make([]string, 0, len(models))
	for _, model := range models {
		ids = append(ids, model.ID)
	}
	want := []string{"gpt-6-luna", "gpt-6-sol", "gpt-daybreak-blue-latest"}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("model IDs = %v, want %v", ids, want)
	}
}

func TestSchedulerPinsPartiallyAvailableModelToEligibleAccount(t *testing.T) {
	// Arrange
	installDiscoveryFakes(t,
		[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}, {ID: "auth-b", AuthIndex: "index-b"}},
		map[string]map[string]bool{
			"auth-a": {"gpt-daybreak-blue-latest": true},
			"auth-b": {},
		},
		nil,
	)
	req := schedulerPickRequest{
		Provider: "codex",
		Model:    "gpt-daybreak-blue-latest",
		Candidates: []schedulerCandidate{
			{ID: "auth-a", Provider: "codex"},
			{ID: "auth-b", Provider: "codex"},
		},
	}

	// Act
	raw, err := handleSchedulerPick(req)

	// Assert
	if err != nil {
		t.Fatalf("handleSchedulerPick() error = %v", err)
	}
	response := decodeSchedulerResponse(t, raw)
	if !response.Handled || response.AuthID != "auth-a" {
		t.Fatalf("scheduler response = %#v, want eligible auth-a", response)
	}
}

func TestSchedulerDelegatesWhenEveryCandidateSupportsModel(t *testing.T) {
	// Arrange
	installDiscoveryFakes(t,
		[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}, {ID: "auth-b", AuthIndex: "index-b"}},
		map[string]map[string]bool{
			"auth-a": {"gpt-6-sol": true},
			"auth-b": {"gpt-6-sol": true},
		},
		nil,
	)
	req := schedulerPickRequest{
		Provider: "codex",
		Model:    "gpt-6-sol",
		Candidates: []schedulerCandidate{
			{ID: "auth-a", Provider: "codex"},
			{ID: "auth-b", Provider: "codex"},
		},
	}

	// Act
	raw, err := handleSchedulerPick(req)

	// Assert
	if err != nil {
		t.Fatalf("handleSchedulerPick() error = %v", err)
	}
	response := decodeSchedulerResponse(t, raw)
	if response.Handled || response.AuthID != "" {
		t.Fatalf("scheduler response = %#v, want built-in delegation", response)
	}
}

func TestSchedulerRejectsModelWhenNoCandidateCanBeVerified(t *testing.T) {
	// Arrange
	installDiscoveryFakes(t,
		[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}},
		nil,
		map[string]error{"auth-a": errors.New("catalog unavailable")},
	)
	req := schedulerPickRequest{
		Provider:   "codex",
		Model:      "gpt-daybreak-blue-latest",
		Candidates: []schedulerCandidate{{ID: "auth-a", Provider: "codex"}},
	}

	// Act
	_, err := handleSchedulerPick(req)

	// Assert
	if err == nil {
		t.Fatal("handleSchedulerPick() error = nil, want verification failure")
	}
}
