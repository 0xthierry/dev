package main

/*
#include <stdint.h>
#include <stdlib.h>

typedef struct {
  void* ptr;
  size_t len;
} cliproxy_buffer;

typedef int (*cliproxy_host_call_fn)(void*, const char*, const uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_host_free_fn)(void*, size_t);

typedef struct {
  uint32_t abi_version;
  void* host_ctx;
  cliproxy_host_call_fn call;
  cliproxy_host_free_fn free_buffer;
} cliproxy_host_api;

typedef int (*cliproxy_plugin_call_fn)(char*, uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_plugin_free_fn)(void*, size_t);
typedef void (*cliproxy_plugin_shutdown_fn)(void);

typedef struct {
  uint32_t abi_version;
  cliproxy_plugin_call_fn call;
  cliproxy_plugin_free_fn free_buffer;
  cliproxy_plugin_shutdown_fn shutdown;
} cliproxy_plugin_api;

extern int cliproxyPluginCall(char*, uint8_t*, size_t, cliproxy_buffer*);
extern void cliproxyPluginFree(void*, size_t);
extern void cliproxyPluginShutdown(void);

static const cliproxy_host_api* stored_host;

static void store_host_api(const cliproxy_host_api* host) {
  stored_host = host;
}

static int call_host_api(const char* method, const uint8_t* request, size_t request_len, cliproxy_buffer* response) {
  if (stored_host == NULL || stored_host->call == NULL) {
    return 1;
  }
  return stored_host->call(stored_host->host_ctx, method, request, request_len, response);
}

static void free_host_buffer(void* ptr, size_t len) {
  if (stored_host != NULL && stored_host->free_buffer != NULL && ptr != NULL) {
    stored_host->free_buffer(ptr, len);
  }
}
*/
import "C"

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

const (
	abiVersion       = 1
	cacheTTL         = 5 * time.Minute
	clientVersion    = "0.155.1"
	modelsEndpoint   = "https://chatgpt.com/backend-api/codex/models"
	maxModelsPayload = 16 << 20
)

var targetModels = map[string]modelInfo{
	"gpt-6-sol": {
		ID: "gpt-6-sol", Object: "model", OwnedBy: "openai", DisplayName: "GPT-6 Sol",
		SupportedGenerationMethods: []string{"chat"}, ContextLength: 272000, MaxCompletionTokens: 32768,
		SupportedInputModalities: []string{"text", "image"}, Thinking: &thinkingInfo{Levels: []string{"low", "medium", "high", "xhigh", "max", "ultra"}}, UserDefined: true,
	},
	"gpt-6-luna": {
		ID: "gpt-6-luna", Object: "model", OwnedBy: "openai", DisplayName: "GPT-6 Luna",
		SupportedGenerationMethods: []string{"chat"}, ContextLength: 272000, MaxCompletionTokens: 32768,
		SupportedInputModalities: []string{"text", "image"}, Thinking: &thinkingInfo{Levels: []string{"low", "medium", "high", "xhigh", "max"}}, UserDefined: true,
	},
	"gpt-daybreak-blue-latest": {
		ID: "gpt-daybreak-blue-latest", Object: "model", OwnedBy: "openai", DisplayName: "Daybreak Blue",
		SupportedGenerationMethods: []string{"chat"}, ContextLength: 272000, MaxCompletionTokens: 32768,
		SupportedInputModalities: []string{"text", "image"}, Thinking: &thinkingInfo{Levels: []string{"low", "medium", "high", "xhigh", "max", "ultra"}}, UserDefined: true,
	},
}

var availability = struct {
	sync.Mutex
	byAuthID map[string]availabilityEntry
}{byAuthID: make(map[string]availabilityEntry)}

var roundRobinCounter atomic.Uint64

var (
	listAuthFiles    = listCodexAuths
	lookupAuthModels = modelsForAuth
)

type availabilityEntry struct {
	models  map[string]bool
	expires time.Time
}

type envelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *envelopeError  `json:"error,omitempty"`
}

type envelopeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type registration struct {
	SchemaVersion uint32                   `json:"schema_version"`
	Metadata      metadata                 `json:"metadata"`
	Capabilities  registrationCapabilities `json:"capabilities"`
}

type metadata struct {
	Name             string        `json:"Name"`
	Version          string        `json:"Version"`
	Author           string        `json:"Author"`
	GitHubRepository string        `json:"GitHubRepository"`
	ConfigFields     []interface{} `json:"ConfigFields"`
}

type registrationCapabilities struct {
	ModelRegistrar bool `json:"model_registrar"`
	Scheduler      bool `json:"scheduler"`
}

type modelRegistrationResponse struct {
	Provider string
	Models   []modelInfo
}

type modelInfo struct {
	ID                         string
	Object                     string
	OwnedBy                    string
	DisplayName                string
	SupportedGenerationMethods []string
	ContextLength              int
	MaxCompletionTokens        int
	SupportedInputModalities   []string
	Thinking                   *thinkingInfo
	UserDefined                bool
}

type thinkingInfo struct {
	Levels []string
}

type schedulerPickRequest struct {
	Provider   string
	Providers  []string
	Model      string
	Stream     bool
	Options    schedulerOptions
	Candidates []schedulerCandidate
}

type schedulerOptions struct {
	Headers  map[string][]string
	Metadata map[string]interface{}
}

type schedulerCandidate struct {
	ID         string
	Provider   string
	Priority   int
	Status     string
	Attributes map[string]string
}

type schedulerPickResponse struct {
	AuthID          string
	DelegateBuiltin string
	Handled         bool
}

type hostAuthListResponse struct {
	Files []hostAuthFile `json:"files"`
}

type hostAuthFile struct {
	ID        string `json:"id"`
	AuthIndex string `json:"auth_index"`
	Provider  string `json:"provider"`
	Type      string `json:"type"`
	Disabled  bool   `json:"disabled"`
}

type hostAuthGetResponse struct {
	JSON json.RawMessage `json:"json"`
}

type storedAuth struct {
	AccessToken string `json:"access_token"`
	AccountID   string `json:"account_id"`
}

type upstreamModels struct {
	Models []struct {
		Slug string `json:"slug"`
	} `json:"models"`
}

func main() {}

//export cliproxy_plugin_init
func cliproxy_plugin_init(host *C.cliproxy_host_api, plugin *C.cliproxy_plugin_api) C.int {
	if plugin == nil {
		return 1
	}
	C.store_host_api(host)
	plugin.abi_version = C.uint32_t(abiVersion)
	plugin.call = C.cliproxy_plugin_call_fn(C.cliproxyPluginCall)
	plugin.free_buffer = C.cliproxy_plugin_free_fn(C.cliproxyPluginFree)
	plugin.shutdown = C.cliproxy_plugin_shutdown_fn(C.cliproxyPluginShutdown)
	return 0
}

//export cliproxyPluginCall
func cliproxyPluginCall(method *C.char, request *C.uint8_t, requestLen C.size_t, response *C.cliproxy_buffer) C.int {
	if response != nil {
		response.ptr = nil
		response.len = 0
	}
	if method == nil {
		writeResponse(response, errorEnvelope("invalid_method", "method is required"))
		return 1
	}
	var requestBytes []byte
	if request != nil && requestLen > 0 {
		requestBytes = C.GoBytes(unsafe.Pointer(request), C.int(requestLen))
	}
	raw, err := handleMethod(C.GoString(method), requestBytes)
	if err != nil {
		writeResponse(response, errorEnvelope("plugin_error", err.Error()))
		return 1
	}
	writeResponse(response, raw)
	return 0
}

//export cliproxyPluginFree
func cliproxyPluginFree(ptr unsafe.Pointer, length C.size_t) {
	if ptr != nil {
		C.free(ptr)
	}
	_ = length
}

//export cliproxyPluginShutdown
func cliproxyPluginShutdown() {}

func handleMethod(method string, request []byte) ([]byte, error) {
	switch method {
	case "plugin.register", "plugin.reconfigure":
		return okEnvelope(registration{
			SchemaVersion: abiVersion,
			Metadata: metadata{
				Name: "codex-current-models", Version: "2.0.0", Author: "dev-setup",
				GitHubRepository: "https://github.com/0xthierry/dev", ConfigFields: []interface{}{},
			},
			Capabilities: registrationCapabilities{ModelRegistrar: true, Scheduler: true},
		})
	case "model.register":
		models, err := discoverRegisteredModels()
		if err != nil {
			return nil, err
		}
		return okEnvelope(modelRegistrationResponse{Provider: "codex", Models: models})
	case "scheduler.pick":
		var req schedulerPickRequest
		if err := json.Unmarshal(request, &req); err != nil {
			return nil, fmt.Errorf("decode scheduler request: %w", err)
		}
		return handleSchedulerPick(req)
	default:
		return errorEnvelope("unknown_method", "unsupported method: "+method), nil
	}
}

func discoverRegisteredModels() ([]modelInfo, error) {
	files, err := listAuthFiles()
	if err != nil {
		return nil, err
	}
	logHost("debug", "discovering current Codex models", map[string]interface{}{"credentials": len(files)})
	available := make(map[string]bool)
	var successful int
	for _, file := range files {
		authID := file.ID
		if authID == "" {
			authID = file.AuthIndex
		}
		models, err := lookupAuthModels(authID, file.AuthIndex)
		if err != nil {
			continue
		}
		successful++
		for model := range models {
			available[model] = true
		}
	}
	if len(files) > 0 && successful == 0 {
		return nil, errors.New("could not verify models for any Codex credential")
	}
	ids := make([]string, 0, len(available))
	for id := range available {
		if _, tracked := targetModels[id]; tracked {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	models := make([]modelInfo, 0, len(ids))
	for _, id := range ids {
		models = append(models, targetModels[id])
	}
	logHost("info", "registered current Codex models", map[string]interface{}{"models": ids})
	return models, nil
}

func handleSchedulerPick(req schedulerPickRequest) ([]byte, error) {
	model := strings.TrimSpace(req.Model)
	if !isCodexRequest(req) {
		return okEnvelope(schedulerPickResponse{Handled: false})
	}
	if _, tracked := targetModels[model]; !tracked {
		return okEnvelope(schedulerPickResponse{Handled: false})
	}
	if len(req.Candidates) == 0 {
		return nil, fmt.Errorf("no Codex credentials are eligible for %s", model)
	}

	files, err := listAuthFiles()
	if err != nil {
		return nil, err
	}
	indexByID := make(map[string]string, len(files))
	for _, file := range files {
		indexByID[file.ID] = file.AuthIndex
	}
	eligible := make([]schedulerCandidate, 0, len(req.Candidates))
	var verified int
	for _, candidate := range req.Candidates {
		authIndex := indexByID[candidate.ID]
		if authIndex == "" {
			continue
		}
		models, err := lookupAuthModels(candidate.ID, authIndex)
		if err != nil {
			continue
		}
		verified++
		if models[model] {
			eligible = append(eligible, candidate)
		}
	}
	if len(eligible) == len(req.Candidates) {
		return okEnvelope(schedulerPickResponse{Handled: false})
	}
	if len(eligible) == 0 {
		if verified == 0 {
			return nil, fmt.Errorf("could not verify any Codex credential for %s", model)
		}
		return nil, fmt.Errorf("no pooled Codex credential advertises %s", model)
	}
	selected := eligible[int(roundRobinCounter.Add(1)-1)%len(eligible)]
	return okEnvelope(schedulerPickResponse{AuthID: selected.ID, Handled: true})
}

func isCodexRequest(req schedulerPickRequest) bool {
	if strings.EqualFold(strings.TrimSpace(req.Provider), "codex") {
		return true
	}
	for _, provider := range req.Providers {
		if strings.EqualFold(strings.TrimSpace(provider), "codex") {
			return true
		}
	}
	return false
}

func listCodexAuths() ([]hostAuthFile, error) {
	result, err := callHost("host.auth.list", map[string]interface{}{})
	if err != nil {
		return nil, fmt.Errorf("list Codex credentials: %w", err)
	}
	var response hostAuthListResponse
	if err := json.Unmarshal(result, &response); err != nil {
		return nil, fmt.Errorf("decode Codex credential list: %w", err)
	}
	files := make([]hostAuthFile, 0, len(response.Files))
	for _, file := range response.Files {
		provider := strings.TrimSpace(file.Provider)
		if provider == "" {
			provider = strings.TrimSpace(file.Type)
		}
		if strings.EqualFold(provider, "codex") && !file.Disabled && file.AuthIndex != "" {
			files = append(files, file)
		}
	}
	return files, nil
}

func modelsForAuth(authID, authIndex string) (map[string]bool, error) {
	now := time.Now()
	availability.Lock()
	if cached, ok := availability.byAuthID[authID]; ok && now.Before(cached.expires) {
		models := cloneModelSet(cached.models)
		availability.Unlock()
		return models, nil
	}
	availability.Unlock()

	result, err := callHost("host.auth.get", map[string]string{"auth_index": authIndex})
	if err != nil {
		return nil, fmt.Errorf("read Codex credential: %w", err)
	}
	var response hostAuthGetResponse
	if err := json.Unmarshal(result, &response); err != nil {
		return nil, fmt.Errorf("decode Codex credential response: %w", err)
	}
	var auth storedAuth
	if err := json.Unmarshal(response.JSON, &auth); err != nil {
		return nil, fmt.Errorf("decode Codex credential: %w", err)
	}
	if strings.TrimSpace(auth.AccessToken) == "" {
		return nil, errors.New("Codex credential has no access token")
	}

	models, err := fetchUpstreamModels(auth)
	if err != nil {
		return nil, err
	}
	availability.Lock()
	availability.byAuthID[authID] = availabilityEntry{models: cloneModelSet(models), expires: now.Add(cacheTTL)}
	availability.Unlock()
	return models, nil
}

func fetchUpstreamModels(auth storedAuth) (map[string]bool, error) {
	u, err := url.Parse(modelsEndpoint)
	if err != nil {
		return nil, err
	}
	query := u.Query()
	query.Set("client_version", clientVersion)
	u.RawQuery = query.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+auth.AccessToken)
	req.Header.Set("Originator", "codex_cli_rs")
	req.Header.Set("User-Agent", "codex_cli_rs/"+clientVersion+" (CLIProxyAPI model discovery)")
	if accountID := strings.TrimSpace(auth.AccountID); accountID != "" {
		req.Header.Set("Chatgpt-Account-Id", accountID)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch Codex model catalog: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxModelsPayload+1))
	if err != nil {
		return nil, fmt.Errorf("read Codex model catalog: %w", err)
	}
	if len(body) > maxModelsPayload {
		return nil, errors.New("Codex model catalog exceeded size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("Codex model catalog returned HTTP %d", response.StatusCode)
	}
	var payload upstreamModels
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode Codex model catalog: %w", err)
	}
	models := make(map[string]bool, len(payload.Models))
	for _, model := range payload.Models {
		if slug := strings.TrimSpace(model.Slug); slug != "" {
			models[slug] = true
		}
	}
	return models, nil
}

func cloneModelSet(source map[string]bool) map[string]bool {
	clone := make(map[string]bool, len(source))
	for model, supported := range source {
		clone[model] = supported
	}
	return clone
}

func logHost(level, message string, fields map[string]interface{}) {
	_, _ = callHost("host.log", map[string]interface{}{"level": level, "message": message, "fields": fields})
}

func callHost(method string, payload interface{}) (json.RawMessage, error) {
	request, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	cMethod := C.CString(method)
	defer C.free(unsafe.Pointer(cMethod))
	var response C.cliproxy_buffer
	var requestPtr *C.uint8_t
	if len(request) > 0 {
		requestPtr = (*C.uint8_t)(unsafe.Pointer(&request[0]))
	}
	if status := C.call_host_api(cMethod, requestPtr, C.size_t(len(request)), &response); status != 0 {
		return nil, fmt.Errorf("host callback %s failed", method)
	}
	if response.ptr == nil || response.len == 0 {
		return nil, fmt.Errorf("host callback %s returned an empty response", method)
	}
	raw := C.GoBytes(response.ptr, C.int(response.len))
	C.free_host_buffer(response.ptr, response.len)
	var rpcResponse envelope
	if err := json.Unmarshal(raw, &rpcResponse); err != nil {
		return nil, fmt.Errorf("decode host callback %s: %w", method, err)
	}
	if !rpcResponse.OK {
		if rpcResponse.Error != nil {
			return nil, fmt.Errorf("%s: %s", rpcResponse.Error.Code, rpcResponse.Error.Message)
		}
		return nil, fmt.Errorf("host callback %s failed", method)
	}
	return rpcResponse.Result, nil
}

func okEnvelope(result interface{}) ([]byte, error) {
	rawResult, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{OK: true, Result: rawResult})
}

func errorEnvelope(code, message string) []byte {
	raw, _ := json.Marshal(envelope{OK: false, Error: &envelopeError{Code: code, Message: message}})
	return raw
}

func writeResponse(response *C.cliproxy_buffer, raw []byte) {
	if response == nil || len(raw) == 0 {
		return
	}
	ptr := C.CBytes(raw)
	if ptr == nil {
		return
	}
	response.ptr = ptr
	response.len = C.size_t(len(raw))
}
