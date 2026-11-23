# Cua Driver as the cross-platform computer-use layer

Status: historical research baseline, reviewed on 2026-11-23. **The original scope below was superseded by the owner's approval: Omarchy gets Claude Code, Pi, Codex and Antigravity; MacBook gets Pi only.** See `INSTALL.md` and `configs/cua-driver/skill/` for the implemented policy and `docs/cua-driver-verification.md` for acceptance gates.

Implementation follow-up: 0.59.4 is installed on the Omarchy host; both managed Cua endpoints were restarted and verified against the new executable, with telemetry/update checks disabled. The four native clients now register the persistent proxy; other client options and Claude Desktop stayed unchanged. MCP initialization, 65-tool discovery and read-only guide retrieval passed; Pi loaded exactly one matching Cua skill without collisions. A disposable GTK/Wayland fixture was launched once: exact-window AT-SPI observation passed, but foreground identity changed before input, so the checker stopped without sending `set_value`. The fixture exited and its exact PID/window were independently verified absent. This does not qualify background input. Native Mac execution and browser/profile acceptance remain separate checks, not claims made by this plan. No Hyprland plugin or personal-browser grant was enabled.

The original requested outcome was Cua Driver as the computer-use solution on both `omarchy` and `macbook`, available to Claude Code, Pi, Codex, and Antigravity. Preserve native application capabilities, authenticated browser workflows, existing user data, and background operation where the selected platform actually supports it. Installing a binary is not equivalent to satisfying those outcomes.

## Findings

### Current repository and host

- `install/cua-driver.sh` pins **0.28.3**, accepts Linux x86_64/arm64 only, verifies archive SHA-256 and members, and deploys a deliberately Linux-only skill. Readiness explicitly rejects `MACOS.md` and requires Wayland/Omarchy files. Its GNU `mv -Tf` replacement is not a portable macOS implementation.
- `install/hosts/macbook.sh` does not select `cua-driver`. `install/hosts/omarchy.sh` does and manages two graphical-session user services: native Wayland and an isolated X11 endpoint. Both were active/enabled during this assessment; `~/.local/bin/cua-driver --version` reported 0.28.3. No pacman-owned Cua package was installed.
- Live desktop: Omarchy **4.5.0-3**, Hyprland **0.56.2** (package 0.56.2-4), GCC/GCC libraries **16.2.1**. This assessment did not restart any of them.
- `configs/cua-driver/skill/{SKILL.md,OMARCHY.md,BROWSER.md}` contains valuable exact-target, fresh-snapshot, consent, and postcondition safeguards, but also release-specific limitations that must be revalidated on upgrade.
- No native Cua MCP registration exists in `configs/mcp/catalog.json`. The dedicated installer links its skill into `.agents`, `.claude`, `.codex`, and `.pi/agent`, not the Antigravity-specific global roots. A daemon plus shell skill does not supply a persistent MCP connection to each harness.
- Shared browser policy currently selects Playwriter for existing logged-in browsers, Chrome DevTools for diagnostics/authorized capability fallback, and `browser_use` only on explicit request. Cua's browser reference independently prefers its own typed page tools. This is a policy overlap to resolve, not evidence that either browser workflow has already been migrated.

### Upstream capability, as documented today

1. **Current stable component: 0.59.4.** GitHub labels it pre-release only to avoid replacing the monorepo's repository-wide Latest pointer; the release explicitly identifies plain component SemVer as stable. Do not select the newer-looking nightly or depend on GitHub's generic latest endpoint. Pin the selected component and its asset checksums/signature provenance.
2. **macOS 14+ is supported**, including native accessibility, per-window capture and background input with documented exceptions. Deploy the proper `CuaDriver.app` bundle with stable `com.trycua.driver` identity, not only a loose executable. Accessibility and Screen Recording require the owner; additional direct-capture consent applies on macOS 26, and profile access on macOS 27 can require an additional grant. Verify the actual Mac version rather than requesting unnecessary permissions.
3. **Linux support varies by compositor and toolkit.** X11 is supported with toolkit limits; Wayland is not one interchangeable backend. Hyprland/Omarchy remains **experimental**. Raw background input into arbitrary occluded native windows is not a supported general promise. GTK/AT-SPI semantic actions, XWayland routes, and explicitly authorized foreground input have distinct coverage.
4. **The optional Hyprland plugin is not an incidental prerequisite to enable.** The 0.59.4 release build kit was downloaded and SHA-256 checked for this review. It declares `native_certified:false` and requires Hyprland 0.56.2-1, GCC 16.1.1 20260728, and matching shared runtime bytes. The current host does not meet that package/toolchain contract. Its source revision is not the compositor revision. Do not downgrade the host, replace runtime libraries, bypass the verifier, or hot-load a module. Plugin qualification needs a separate approved workstream and disposable environment, then a scheduled fresh-session procedure.
5. **Browser support is narrower than a universal Playwriter replacement.** Chrome has the strongest documented coverage; Brave, Vivaldi, Opera and Arc are detected but not release-accepted. Our existing browser choice must not be silently changed. Linux trusted browser pointer actions can refuse rather than activate the window; `dom_event` is not equivalent to trusted input. Safari/Firefox are native UI routes rather than the typed Chromium route. Existing-profile attachment needs its own launch grant/manifest/host approval; Playwriter approval does not transfer to it.
6. **One runtime, persistent connections, explicit sessions.** Current Linux `cua-driver mcp` owns a runtime unless pointed at a daemon socket; macOS normally proxies to the permission-owning app daemon. With several harnesses, use the documented daemon + `mcp --socket` model where appropriate rather than accidentally spawning independent controllers. Keep the X11 endpoint separate while needed. A named session is not a security boundary; sessions still share a physical desktop.
7. **Upgrade contracts matter.** Newer actions use only `element_token`, reject unknown parameters, and require screenshot context in the same session for window pixels. The 0.35 default window result became leaner (`tree_format: elements` or `both` when required). macOS key-based `type_text` treats newlines/tabs as Return/Tab, potentially submitting forms. Update skills, helpers, fixtures and callers before changing the pin.
8. **Security and privacy are separate from tool registration.** `standard` permits broad desktop input and recording; it is not an app allowlist. `bounded` uses a reviewed capability manifest. Do not enable unrestricted mode, blanket MCP auto-approval, existing-profile grants, recording, or the optional perception extension as a hidden setup side effect. Upstream telemetry is enabled by default; make the choice explicit (recommended: disabled for this managed deployment). Keep recording opt-in and sensitive artifacts private. Computer History is deprecated; do not adopt it as a new dependency. The optional perception extension includes AGPL components and is not required for the baseline.

Upstream's client guide still describes Pi as lacking MCP. That does **not** match this repository's installed Pi 1.2.0 native MCP capability. Use our tested native renderer, not that outdated preset assumption.

## Skill audit coverage

Every one of the **29 tracked `SKILL.md` definitions** was read, together with the relevant browser, Roblox and Omarchy references and routing surfaces. Four additional visible non-repository skills were also inspected. Not every skill needs a controller change.

| Group | Skills reviewed | Proposed treatment |
|---|---|---|
| Direct computer/browser routing | `cua-driver`, `control-browser`, `playwriter`, `chrome-devtools`, `browser-diagnostics`, `web-performance-investigation` | Cross-platform Cua guidance; resolve browser precedence; retain explicit-only browser_use and specialized diagnostics. |
| GUI/domain/approval boundaries | `roblox-classic-clothing`, `roblox-open-cloud-api`, `omarchy`, `agent-slack`, `writing-pr`, `use-agent`, `plannotator`, `plannotator-annotate`, `plannotator-last`, `plannotator-review` | Preserve domain APIs, user approvals and complete workflow outcomes; update only applicable GUI-routing references. |
| No controller rewrite | `linear`, `notion-cli`, `codex-image`, `engineering-principles`, `writing-skill`, `human-writing`, `bro`, `ai-memory-durable-pages`, `ai-memory-handoff`, `ai-memory-learning-maintenance`, `ai-memory-messaging`, `ai-memory-retrieval`, `ai-memory-routing-install` | Keep existing semantic CLI/API workflows. Cua does not replace them simply because their services have a UI. |
| Additional visible skills, outside this checkout | `diagnose-crash`, `omarchy-app`, `superwhisper`, `ux-writting` | Diagnostic CLI, Qt/offscreen-or-real-UI testing, dictation CLI, and input/accessibility validation respectively. Do not patch vendor/deployed files; route future changes through their proper source owner. |

Paths: shared skills live under `configs/agents/skills/`; Plannotator under `configs/agents/plannotator/skills/`; the Pi control-browser skill under `configs/agents/pi/extensions/browser-use/skills/`; Cua under `configs/cua-driver/skill/`. The Claude-only skills directory currently contains only `.gitkeep`.

### Routing and workflow issues to address

- A verified stale statement in `web-performance-investigation/SKILL.md` says Codex has no native DevTools MCP. The shared catalog and installed config do register it. Correct this independently of any Cua precedence decision.
- Routing also appears in `configs/agents/AGENTS.md`, root `AGENTS.md`, Pi browser-use `lib/{definitions.ts,tool.ts,skill.test.ts}` and README, `configs/browser-automation/client-instructions.md`, `configs/creative-mcp/chatgpt-setup.md`, and `configs/mcp/README.md`. Changing only the Cua skill would leave contradictory instructions. ChatGPT/Desktop do not automatically inherit local skills or local MCP registration.
- The Roblox clothing/heads workflow explicitly uses the signed-in Tripo browser through Playwriter. It spends credits, temporarily changes/restores an account setting, retrieves the resulting GLB via a signed download URL, and cleans only agent-owned artifacts. A Cua rewrite must preserve the full result, account restoration, authentication, cost confirmation and download, not merely demonstrate a click. Do not assume typed Cua tools replace network-response observation.
- Preserve Studio MCP and Open Cloud for their semantic tasks. A timed-out Studio action may still be running: do not duplicate it through UI. Keep Slack sending intent, Herdr/AMQ orchestration, and Plannotator human approval boundaries intact.
- Keep exact `(pid, window_id)`/tab binding, fresh tokens and same-frame pixel evidence. Do not mix the Cua desktop frame, `grim` output coordinates, native Wayland IDs and X11 XIDs. Verify results before retrying a potentially completed action.
- OS permissions and password dialogs remain for the owner. Current Omarchy policy forbids inspecting/capturing its authentication dialog; a broader upstream observation capability does not override that policy.

## Proposed sequence and acceptance gates

### 1. Confirm browser scope and freeze the baseline

Proposed target: **Cua-first qualification for both native desktop and the user's browser UI workflows on both hosts**, with verified specialized fallbacks. Browser qualification is part of the proposed migration, not a test to skip while declaring a unified solution complete. Retain Playwriter/DevTools until the corresponding workflows pass; Cua need not replace their specialized diagnostics.

The current Playwriter-primary policy conflicts with making Cua primary for web pages. Confirm that precedence change with the owner before implementing it. A native-only rollout can be an intermediate milestone, but narrowing the final goal to native-only would require an explicit scope decision. Keep explicit tool choices authoritative. Record current app/browser versions and relevant helper tests, without collecting unrelated private windows.

**Gate:** written routing matrix and non-sensitive acceptance fixtures for the intended workflows; no requested behavior removed as a shortcut.

### 2. Pin and package both operating systems

Extend `install/cua-driver.sh` with platform-specific asset selection, readiness, safe extraction and portable atomic replacement. Evaluate 0.59.4 as the candidate, verify artifacts, keep rollback state, and synchronize the skill contract with that pin.

On Mac, preserve the vendor app's code-signing identity and bundle layout, validate signature/architecture/minimum OS, add a user LaunchAgent through the repo, and provide a manual permissions checklist. Do not re-sign or script TCC database changes. Add the Mac host target without Linux-only dependencies/services.

On Omarchy, retain working capture and the separate X11 route during qualification. Revalidate what the new runtime can actually do; remove a helper only after its replacement proves the same outcome. Do not change the live desktop or enable the plugin in this phase.

**Gate:** isolated installation tests for both hosts, idempotency, wrong platform/architecture, corrupt archives, foreign symlinks, partial installs, permission-not-granted and rollback; no downloads at tool invocation.

### 3. Expose a consistent persistent MCP surface

Add a repository-managed Cua launcher and registration for Claude Code, Pi, Codex and Antigravity, bound to the intended runtime/socket and permission owner. The current shared renderer sends local catalog entries to Claude Desktop too: introduce an explicit per-service client allowlist (or an equivalent tested exclusion) before adding Cua, so these four harnesses receive it and Claude Desktop does not silently gain desktop-input tools. `desktop_opt_in` currently applies to remote-service bridges and is not a general client selector. ChatGPT/tunnels and other clients remain outside this scope unless separately requested. Preserve per-client user settings and approvals. Do not blindly run upstream `connect`, which can also discover retired clients such as Droid.

Distribute the matching skill to each actual harness root, including `~/.gemini/antigravity-cli/skills` (and the shared App/IDE root only where the declared installer contract applies). Verify discovery rather than assuming `.agents` is universally loaded. Avoid `.bak` skill collisions and duplicate MCP registrations.

**Gate:** real stdio initialization + tools/list + a non-sensitive read-only status call from each integration; persistent session/token behavior and clean disconnect. Assert that unrequested clients have no new Cua registration. This is discovery proof, not GUI success.

### 4. Update skills and policy together

Refactor the Cua skill into shared invariants plus macOS and Linux/Omarchy references. Update token-only targeting, screenshot/session lifetime, lean snapshots, newline/tab semantics and refusal handling. Stage the chosen browser routing consistently across the files listed above; activate a new default only after its stage-5 host acceptance passes, not merely after the instructions are written. Correct the stale Codex diagnostic claim.

Keep API/CLI-first domain operations, one controller per target, exact existing-profile consent, no unapproved focus takeover, no automatic recording and no secret handling. Do not reduce the Tripo flow or remove diagnostic tooling to make the migration appear complete.

**Gate:** one loaded Cua skill per harness, no contradictory defaults, no lost domain outcomes, and fixture tests for refusal/no-op/partial-result recovery.

### 5. Perform authorized host acceptance, then decide retirement

- **macOS:** owner grants required permissions; run a disposable native-app task with another window focused. Prove exact read/action/readback, unchanged foreground when background is claimed, scale and multi-monitor behavior, and clean reconnect after login/reboot.
- **Omarchy:** prove native capture and advertised semantic input; prove the isolated Alacritty/X11 route where needed. Test quotes, accents/dead keys, Enter, distinct window identities, mixed scaling and secondary outputs. Treat an explicit unsupported-input refusal as a documented limitation, not full task support.
- **Browser, required for the proposed unified target:** use the selected real browser/profile with consent. Prove background navigation, typing, trusted-vs-synthetic behavior, tabs/popups, uploads/downloads, file dialogs, login retention, and the complete Tripo artifact flow. No browser/profile substitution to pass the tests.
- **Failure and privacy:** denied permissions, stale tokens, dropped connections, partial delivery and parallel-agent contention must stop safely without duplicate submissions or crossing into a sibling window. Recording is opt-in; evidence must exclude private unrelated content.

**Gate:** application-owned postconditions, not merely a successful tool response. Keep fallbacks for any unproven cell. Consider the Hyprland plugin only as a separate qualified, explicitly approved phase; do not make a working desktop depend on an unaccepted toolchain change.

## What has and has not been validated

Verified: repository/setup/skill audit; current local versions and service state; official platform/runtime/permission/browser documentation; published 0.59.4 release and checked plugin build-kit provenance. Antigravity MCP configuration is a separate implemented change.

Not verified: a 0.59.4 installation on either host, actual Mac permissions or GUI behavior, Brave compatibility under Cua, new-runtime native input on this Omarchy, plugin qualification, or replacement of Playwriter/DevTools. Those are explicit future gates, not completed work.

## Sources

- [Cua Driver platform support](https://cua.ai/docs/cua-driver/concepts/platform-support.md)
- [Runtime ownership, sessions and action semantics](https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works.md)
- [Operation, upgrade changes, telemetry and release channels](https://cua.ai/docs/cua-driver/guides/operate.md)
- [Permission modes, policy and capability manifests](https://cua.ai/docs/cua-driver/guides/permissions.md)
- [Browser support and existing-profile attachment](https://cua.ai/docs/cua-driver/guides/browsers.md)
- [Agent connections and skill roots](https://cua.ai/docs/cua-driver/guides/connect-your-agent.md)
- [Stable component release 0.59.4 and immutable assets](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.59.4)
- [Google/Cua Antigravity walkthrough](https://aistudio.google.com/learn/partner-cua-computer-use-gemini)

The Google walkthrough demonstrates the integration, but its blanket tool allow rule is not adopted here. The detailed platform and permission contracts above qualify marketing statements about universal background operation.
