# Create Image

Pi extension that registers `/create-image` to generate images from a prompt and save them to the current project.

## What it registers

| Command | Purpose |
| --- | --- |
| `/create-image` | Generate image files from a text prompt. |

No LLM tools, shortcuts, flags, or custom UI components are registered.

## Providers

The default provider is `nano-banana`, implemented through Gemini Web image generation using browser cookies from a local Brave, Chromium, or Chrome profile.

A `chatgpt-web` provider is also available. It drives the logged-in ChatGPT web UI through `agent-browser`, waits for the generated image asset in the conversation, and downloads the resulting PNG through ChatGPT's authenticated file endpoint.

## Usage

```text
/create-image generate an image of a minimal red fox app icon on a white background
/create-image --out assets --name fox-icon generate an image of a minimal red fox app icon
/create-image --provider nano-banana --profile Default generate an image of a watercolor robot holding coffee
/create-image --provider chatgpt-web generate a square image of a tiny robot holding coffee
```

Options:

Argument autocomplete suggests the common options, provider/profile values, output/name examples, and prompt starters such as `generate an image of`.

- `--provider, -p <id>`: image provider. Default: `nano-banana`.
- `--out, -o <dir>`: output directory relative to the current project. Default: `generated-images`.
- `--name <file>`: base filename. The extension chooses the file extension from image bytes.
- `--profile <name>`: browser profile to read provider cookies from, when supported.
- `--help, -h`: show usage.

If no prompt is supplied in interactive mode, Pi opens an editor prompt prefilled with `generate an image of `. In non-interactive contexts, a prompt is required in the command arguments.

## Requirements

For the `nano-banana` provider:

- You must be signed into `https://gemini.google.com` in Brave, Chromium, or Chrome.
- Gemini image generation must be available for the account and region.
- The extension uses `impit` for Chrome-impersonated image downloads. This avoids the `403` responses returned by normal Node/Bun `fetch` for Gemini-generated `googleusercontent.com` images.

For the `chatgpt-web` provider:

- `agent-browser` must be installed and able to control a browser session signed into `https://chatgpt.com`.
- ChatGPT image generation must be available for the account and region.
- The provider opens a temporary ChatGPT tab, submits the prompt, polls the authenticated conversation for an `image_asset_pointer`, downloads the generated image bytes in the browser context, then closes the temporary tab.

Cookie values are read locally or used in the controlled browser session only for provider authentication and image download requests. They are not printed, written to generated files, or stored in Pi session details.

## Output

Images are saved to `generated-images/` by default. Filenames include a UTC timestamp, provider id, and prompt/name slug, for example:

```text
generated-images/20260501-173004-nano-banana-fox-icon.jpg
```

The command publishes a visible Pi custom message with the saved path(s).

## Development and validation

From the repository root:

```bash
bun run test:pi-extensions create-image
bun run typecheck:pi-extensions
bun run lint:pi-extensions
```

E2E command validation exercises `/create-image` through Pi RPC. Live Nano Banana validation is gated because it uses a real Gemini Web account and may consume image generation quota:

```bash
bun run test:pi-extensions:e2e create-image
PI_CREATE_IMAGE_LIVE_SPEC=1 bun test configs/agents/pi/extensions/create-image/index.spec.ts
PI_CREATE_IMAGE_LIVE_SPEC=1 bun test configs/agents/pi/extensions/create-image/lib/providers/gemini/nano-banana.spec.ts
PI_CREATE_IMAGE_CHATGPT_LIVE_SPEC=1 bun test configs/agents/pi/extensions/create-image/lib/providers/chatgpt/agent-browser.spec.ts
```
