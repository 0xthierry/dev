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
			"auth-a": {"gpt-6.1-sol": true, "gpt-6-luna": true, "gpt-daybreak-blue-latest": true},
			"auth-b": {"gpt-6.1-sol": true, "gpt-6-luna": true},
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
	want := []string{"gpt-6-luna", "gpt-6.1-sol", "gpt-daybreak-blue-latest"}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("model IDs = %v, want %v", ids, want)
	}
}

func TestDiscoverRegisteredGPT62ModelsUsesLiveCatalogAndTargetMetadata(t *testing.T) {
	for _, tc := range []struct {
		id            string
		displayName   string
		contextLength int
	}{
		{"gpt-6.2-sol", "GPT-6.2 Sol", 500000},
		{"gpt-6.2-astra", "GPT-6.2 Astra", 272000},
	} {
		t.Run(tc.id, func(t *testing.T) {
			// Arrange: only one account advertises this model; other targets must not leak in.
			installDiscoveryFakes(t,
				[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}, {ID: "auth-b", AuthIndex: "index-b"}},
				map[string]map[string]bool{
					"auth-a": {"gpt-6.1-sol": true},
					"auth-b": {tc.id: true, "untracked-model": true},
				}, nil,
			)

			// Act
			models, err := discoverRegisteredModels()

			// Assert
			if err != nil {
				t.Fatalf("discoverRegisteredModels() error = %v", err)
			}
			if len(models) != 2 || models[0].ID != "gpt-6.1-sol" {
				t.Fatalf("registered models = %#v, want only gpt-6.1-sol and %s", models, tc.id)
			}
			want := modelInfo{
				ID: tc.id, Object: "model", OwnedBy: "openai", DisplayName: tc.displayName,
				SupportedGenerationMethods: []string{"chat"}, ContextLength: tc.contextLength,
				MaxCompletionTokens: 32768, SupportedInputModalities: []string{"text", "image"},
				Thinking:    &thinkingInfo{Levels: []string{"low", "medium", "high", "xhigh", "max", "ultra"}},
				UserDefined: true,
			}
			if !reflect.DeepEqual(models[1], want) {
				t.Fatalf("registered model = %#v, want %#v", models[1], want)
			}
		})
	}
}

func TestSchedulerGPT62ModelEligibility(t *testing.T) {
	for _, model := range []string{"gpt-6.2-sol", "gpt-6.2-astra"} {
		t.Run(model, func(t *testing.T) {
			for _, tc := range []struct {
				name     string
				models   map[string]map[string]bool
				failures map[string]error
				want     schedulerPickResponse
				wantErr  string
			}{
				{
					name: "partial rollout selects only eligible account",
					models: map[string]map[string]bool{
						"auth-a": {model: true}, "auth-b": {},
					},
					want: schedulerPickResponse{Handled: true, AuthID: "auth-a"},
				},
				{
					name: "no account advertises model",
					models: map[string]map[string]bool{
						"auth-a": {}, "auth-b": {},
					},
					wantErr: "no pooled Codex credential advertises " + model,
				},
				{
					name: "no account catalog can be verified",
					failures: map[string]error{
						"auth-a": errors.New("catalog unavailable"), "auth-b": errors.New("catalog unavailable"),
					},
					wantErr: "could not verify any Codex credential for " + model,
				},
				{
					name: "fully eligible delegates to built-in scheduler",
					models: map[string]map[string]bool{
						"auth-a": {model: true}, "auth-b": {model: true},
					},
					want: schedulerPickResponse{Handled: false},
				},
			} {
				t.Run(tc.name, func(t *testing.T) {
					// Arrange: the unsupported account has higher priority during partial rollout.
					installDiscoveryFakes(t,
						[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}, {ID: "auth-b", AuthIndex: "index-b"}},
						tc.models, tc.failures,
					)
					req := schedulerPickRequest{
						Provider: "codex", Model: model,
						Candidates: []schedulerCandidate{
							{ID: "auth-a", Provider: "codex", Priority: 0},
							{ID: "auth-b", Provider: "codex", Priority: 100},
						},
					}

					// Act
					raw, err := handleSchedulerPick(req)

					// Assert
					if tc.wantErr != "" {
						if err == nil || err.Error() != tc.wantErr {
							t.Fatalf("handleSchedulerPick() error = %v, want %q", err, tc.wantErr)
						}
						return
					}
					if err != nil {
						t.Fatalf("handleSchedulerPick() error = %v", err)
					}
					if response := decodeSchedulerResponse(t, raw); response != tc.want {
						t.Fatalf("scheduler response = %#v, want %#v", response, tc.want)
					}
				})
			}
		})
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

func TestSchedulerHonorsPriorityAfterFilteringModelEligibility(t *testing.T) {
	for _, tc := range []struct {
		name       string
		candidates []schedulerCandidate
		want       []string
	}{
		{"prefer eligible high priority", []schedulerCandidate{{ID: "low", Priority: 0}, {ID: "high", Priority: 100}, {ID: "unsupported", Priority: 200}}, []string{"high", "high", "high"}},
		{"fallback when preferred unavailable", []schedulerCandidate{{ID: "low", Priority: 0}, {ID: "unsupported", Priority: 200}}, []string{"low", "low", "low"}},
		{"round robin equal priorities", []schedulerCandidate{{ID: "low", Priority: 100}, {ID: "high", Priority: 100}, {ID: "unsupported", Priority: 200}}, []string{"low", "high", "low"}},
		{"negative priorities", []schedulerCandidate{{ID: "low", Priority: -20}, {ID: "high", Priority: -10}, {ID: "unsupported", Priority: 0}}, []string{"high", "high", "high"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Arrange
			installDiscoveryFakes(t,
				[]hostAuthFile{{ID: "low", AuthIndex: "index-low"}, {ID: "high", AuthIndex: "index-high"}, {ID: "unsupported", AuthIndex: "index-unsupported"}},
				map[string]map[string]bool{
					"low": {"gpt-6.1-sol": true}, "high": {"gpt-6.1-sol": true}, "unsupported": {},
				}, nil,
			)
			request := schedulerPickRequest{Provider: "codex", Model: "gpt-6.1-sol", Candidates: tc.candidates}

			// Act
			var got []string
			for range tc.want {
				raw, err := handleSchedulerPick(request)
				if err != nil {
					t.Fatalf("handleSchedulerPick() error = %v", err)
				}
				got = append(got, decodeSchedulerResponse(t, raw).AuthID)
			}

			// Assert
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("selected accounts = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSchedulerDelegatesWhenEveryCandidateSupportsModel(t *testing.T) {
	// Arrange
	installDiscoveryFakes(t,
		[]hostAuthFile{{ID: "auth-a", AuthIndex: "index-a"}, {ID: "auth-b", AuthIndex: "index-b"}},
		map[string]map[string]bool{
			"auth-a": {"gpt-6.1-sol": true},
			"auth-b": {"gpt-6.1-sol": true},
		},
		nil,
	)
	req := schedulerPickRequest{
		Provider: "codex",
		Model:    "gpt-6.1-sol",
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
