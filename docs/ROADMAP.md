# Roadmap

Agent Remote Control grows from a Discord bot for developers into a tool that people who do not program can use to build and run their own projects, in the spirit of app builders such as Lovable, with three differences:

- **Bring your own agent.** The user's own subscriptions (Claude Code, Codex, Copilot, Cursor, Antigravity) do the work, so there is no per-token billing.
- **The code stays with the user.** Projects live on the user's machine.
- **No central server.** Remote access is peer-to-peer. A server only introduces the two peers and, when a direct path is impossible, relays end-to-end encrypted traffic it cannot read.

Each stage ships something usable on its own and fits in a few focused work sessions.

| Stage | Delivers | Status |
|---|---|---|
| [1](#stage-1-monorepo-and-local-web-channel) | Monorepo and local web channel | Next |
| [2](#stage-2-simple-mode) | Simple mode: projects, live preview, versions | Planned |
| [3](#stage-3-peer-to-peer-remote-access) | Peer-to-peer remote access | Planned |
| [4](#stage-4-remote-preview-over-the-datachannel) | Remote preview over the DataChannel | Planned |
| [5](#stage-5-installer-for-non-developers) | Installer for non-developers | Future |
| [6](#stage-6-publish) | Publish to the web | Future |

## Stage 1: Monorepo and local web channel

Removes the hardest onboarding step for non-developers, creating a Discord bot, by adding a browser interface that talks to the service on `localhost`. The [Stage 1 delivery plans](plans/stage-1/README.md) break it into sessions delivered on the branch `feat/stage-1-web-channel`.

### 1a. Monorepo

The repository becomes a Yarn 4 workspaces monorepo. TypeScript, ESLint, Vitest, coverage and the conventions in `AGENTS.md` apply to every package, with shared base configs at the root.

```text
agent-remote-control/
├── packages/
│   ├── server/      # The current NestJS application (Discord, orchestrator, agents, workspace)
│   ├── web/         # Browser interface: React + Vite + React Router + shadcn/ui + Tailwind
│   └── protocol/    # Message contract shared by server and web (types and runtime validation)
├── tsconfig.base.json
├── eslint.config.js
├── vitest.config.ts   # Lists each package as a Vitest project
└── package.json     # Workspaces and root scripts (ts, lint, test, build) that run across packages
```

Moving the server is a pure relocation: no behavior change, every test still green. The Dockerfile, the publish workflow, `AGENTS.md`, the README and the skills that reference paths are updated in the same change.

### 1b. Web channel

- **`packages/protocol`** defines the messages exchanged between interface and service: client commands (send message, answer question, cancel, select agent/model/effort) and server events (turn started, activity, tool call, question, final answer, error).
- **`packages/server`** gains a `web` module: an inbound adapter beside `discord`, consuming the same channel-agnostic orchestrator.
- **`packages/web`** shows the conversation list, the chat, live progress and agent questions as buttons.

**Transport port.** The `web` module depends on `IClientTransportPort`, which accepts client connections and exchanges `protocol` messages with them. The first adapter is a WebSocket server (`ws`) on the existing NestJS HTTP port (`PORT`, default `3000`). Plain `ws` with JSON frames is chosen over Socket.IO because a WebRTC DataChannel carries the same frames, so the Stage 3 adapter implements the same port without touching the module.

**Serving the interface locally.** The server serves the web package's production build as static files on the same port, so the user opens the link with the access token that the server prints at startup (`http://localhost:3000/#token=...`). During development, the Vite dev server proxies the WebSocket to the server.

## Stage 2: Simple mode

The experience for people who do not program. Access is local: the browser on the same machine, while the Discord channel keeps working remotely for chat.

- **Projects.** The user creates a *project* from a template ("personal website", "online store", "landing page") instead of pointing at a repository.
- **Live preview.** A use case starts the project's dev server (`npm run dev`), detects its port and the interface shows it in an iframe beside the chat.
- **Versions.** Git runs underneath; the interface shows a timeline such as "Go back to yesterday's version".
- **Human-readable progress.** Activity reads as steps ("Creating the contact page…"). The raw reasoning and tool calls stay available inside a collapsible section for those who want them.
- **Validation.** Two or three people who do not program try this stage before the work on peer-to-peer access starts.

## Stage 3: Peer-to-peer remote access

The user reaches the service running on their machine from any device, with no server in the data path.

### How the connection works

WebRTC, the technology behind browser video calls, connects the two peers:

| Piece | Role | Server |
|---|---|---|
| Signaling | Both peers exchange their connection descriptions (SDP) to find each other | A tiny relay used for a few seconds per connection, such as a Cloudflare Worker on the free tier |
| STUN | Each peer discovers its public address behind the router | Free public servers (Google, Cloudflare) |
| TURN | Fallback relay when a direct path fails (corporate networks, mobile carrier NAT, roughly 10–20% of cases) | Relays DTLS-encrypted traffic it cannot read; Cloudflare offers TURN with a free quota |

After the handshake, browser and service talk over a **DataChannel**, encrypted end to end with DTLS.

### Pairing and trust

The service displays a QR code holding a URL to the hosted interface, for example:

```text
https://<owner>.github.io/agent-remote-control/#pair=<one-time-token>&fp=<service-fingerprint>&room=<id>
```

The data travels in the URL fragment (`#`), which the browser never sends to the hosting server. Scanning the code opens the hosted interface, which joins the signaling room, completes the handshake and stores the service fingerprint. Every later connection checks that fingerprint, so neither the signaling server nor anyone else can impersonate the service, which matters because the service executes commands on the user's machine.

### Steps

- **3a. Proof of concept.** Exchange the SDP by pasting text or scanning QR codes, with no server at all.
- **3b. Signaling and pairing.** A signaling Worker plus QR pairing with the pinned fingerprint.
- **3c. Hosted interface.** The same `packages/web` build is also published as a static PWA on GitHub Pages and picks the transport at runtime: WebSocket when served locally by the service, WebRTC DataChannel when opened from the hosted URL. The local interface from Stage 1 keeps working unchanged.

On the server, the DataChannel adapter is a second implementation of `IClientTransportPort` (candidates: `node-datachannel`, `werift`).

## Stage 4: Remote preview over the DataChannel

Shows the project preview of Stage 2 on a remote device.

### What a DataChannel can carry

A DataChannel behaves like a peer-to-peer WebSocket: bidirectional messages, reliable and ordered by default. Differences that shape the design:

- Large messages must be split into chunks (16–64 KB) and reassembled.
- The sender must respect backpressure (`bufferedAmount`) or memory grows unbounded.
- Several logical streams share one channel, so each frame carries a stream id.

### Tunneling the dev server

Serving an `npm run dev` application through the channel is HTTP tunneling:

1. The preview iframe loads from the PWA origin.
2. A Service Worker intercepts every request coming from that iframe (routing by `clientId`, since dev servers request absolute paths such as `/@vite/client`) and forwards it as a frame: method, path, headers, body.
3. The service replays the request against the local dev server and streams the response back in chunks.

### Open problems

- **Hot reload.** Service Workers do not intercept WebSocket connections. A script injected into the preview HTML replaces `window.WebSocket` with a shim that tunnels through the parent page and the DataChannel.
- **Latency.** A Vite dev page issues hundreds of module requests on first load. A remote preview mode that serves a bundled build (`vite build --watch`) cuts that to a handful, trading instant hot reload for a fast first paint.
- **Interim option.** Screenshots of the local preview sent over the channel.

## Stage 5: Installer for non-developers

Future; not detailed yet.

- A desktop tray app (Tauri or Electron) that embeds the Node service.
- A first-run wizard that detects the installed agent CLIs, helps with login and shows the pairing QR code.
- Sandbox by default: agents confined to the project folder at minimum, ideally inside a container.

## Stage 6: Publish

Future; not detailed yet.

- A "Publish my site" button that deploys to Netlify, Vercel or Cloudflare Pages using the user's own account.
