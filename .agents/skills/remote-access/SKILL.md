---
name: remote-access
description: >
  Remote access from anywhere over WebRTC: the signaling protocol, data channel frames, remote link and certificate
  fingerprint in packages/protocol, the NestJS signaling server in packages/p2p-server (host registration, sessions,
  STUN and TURN credentials, the hosted web app), the remote module of the server (instance identity, signaling
  client, node-datachannel peers, the transport of the web channel) and the coturn relay in deploy/. Use when working
  with remote access, signaling, WebRTC, TURN, coturn, the remote link or REMOTE_* and P2P_* variables.
---

# Remote access

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a signaling, trust, framing, relay or deployment rule
> changed → update; a refactor that preserves the described behavior → leave it alone.

Anyone who reaches the web channel of a host runs agents on it with full autonomy. The signaling server and the TURN
relay are not trusted with that: they introduce and relay, and every rule below keeps them unable to read the messages,
to stand in for a host or to learn the access token. They do serve the web app, though, so whoever operates them could
serve a page that reads the token: remote access is off unless `REMOTE_ENABLED=true`, a choice of trust in the operator
of `REMOTE_URL`, documented in the README and in `docs/remote-access.md`.

## Protocol (`packages/protocol`)

- `signaling.ts`: four zod unions, one per direction — `hostSignalSchema` (`host.register`, `host.accept`,
  `host.reject`, `host.answer`, `host.candidate`, `host.close`), `toHostSignalSchema` (`host.challenge`,
  `host.registered`, `session.request` with the browser's `source`, fingerprint and proof, `session.offer` with the ICE
  servers, `session.candidate`, `session.closed`), `clientSignalSchema` (`client.connect` with the instance, fingerprint
  and proof, `client.offer`, `client.candidate`) and `toClientSignalSchema` (`client.accepted` with the ICE servers and
  the host's protocol version, `client.unavailable`, `client.rejected`, `session.answer`, `session.candidate`,
  `session.closed`). Paths `/signal/host` and `/signal/client`, a 64 KiB payload limit, the data channel label `arc`,
  `MAX_CANDIDATES_PER_SESSION` (32), `registrationPayload(nonce)` and the close codes `4400` (invalid registration),
  `4403` (instance not allowed) and `4409` (replaced) live there too.
- `protocol-version.ts`: `PROTOCOL_VERSION` must be raised by any client command or server event change the other
  side cannot read. The hosted web app talks to hosts of any release and refuses a host whose version differs.
- `remote-link.ts`: `deriveInstanceId(fingerprint)` (the first 10 bytes of the certificate fingerprint, in hex),
  `isFingerprintOf(instanceId, fingerprint)`, `buildRemoteLink` and `instanceIdFromPath`. The link is `<REMOTE_URL>/i/<instance id>#fp=<fingerprint>&token=<access token>`; the
  fingerprint and the token must stay in the fragment, which the browser never sends to the page's server.
- `fingerprint.ts`: `encodeFingerprint` turns `AB:CD:…` into base64url (`FINGERPRINT_PATTERN`, 43 characters);
  `sdpFingerprint(sdp)` returns the SHA-256 fingerprint of an SDP only when every `a=fingerprint` line names that
  same SHA-256 fingerprint, and null otherwise: a DTLS stack may pin the handshake to any of the lines, whatever
  their algorithm (libdatachannel takes the first one).
- `session-proof.ts`: `sessionProof(token, instanceId, fingerprint)`, a base64url HMAC-SHA256 of
  `sessionProofMessage(instanceId, fingerprint)` under the access token. It binds the proof to the browser's
  certificate, so the signaling server, which relays it, can neither learn the token nor reuse the proof.
- `data-channel-frames.ts`: every data channel message, both ways, goes as frames `<index>/<count>\n<payload>` of at
  most 16 000 UTF-16 units (`toFrames`), never splitting a surrogate pair. `FrameAssembler(maxLength)` joins them and
  reports `invalid` for a missing header, a frame out of order or a message over the limit.

## Signaling server (`packages/p2p-server`)

- Module `signaling`: `ISignalingTransportPort` (`onHost`, `onClient`) bound to `WsSignalingTransportAdapter`, which
  upgrades `/signal/host` without an origin check and `/signal/client` only for the same origin or `P2P_ALLOWED_ORIGINS`,
  pings every 25 s and terminates a socket that missed the previous ping. Every socket gets an `error` listener: `ws`
  reports a frame it refuses that way, and without one the process ends. Limits: 2 000 sockets in all (`503`), 20 per
  address and 30 upgrades in a burst per address, back at one per 2 s (`429`), and a token bucket of messages per
  socket (host 256, 64/s; browser 64, 16/s) that closes with `1008`. The address is the socket's, or the entry
  `P2P_TRUSTED_PROXY_HOPS` from the end of `X-Forwarded-For` behind that many proxies; every signaling socket
  exposes it as `address`.
- `SignalingConnectionHandler` parses every message and closes with `1008` on an invalid signal, a signal out of order
  or no first signal within 5 s. A browser socket lives at most 60 s: once connected it needs no signaling.
- `RegisterHostUseCase.challenge` sends each host socket a random nonce (`host.challenge`). `execute` accepts the
  registration only when the DER certificate derives the instance id and its key signed `registrationPayload(nonce)`
  (`4400` otherwise), and when `P2P_ALLOWED_INSTANCES`, if set, lists the instance (`4403` otherwise). The host never
  sends anything that registers it again. A newer registration replaces the older one, closed with `4409`, and ends
  its sessions.
- `OpenClientSessionUseCase` answers `client.unavailable` when the host is offline or already negotiates 16 sessions.
  Otherwise it opens a session (`requested`) and hands the host `session.request` with the browser's fingerprint and
  proof, and a `source`: the first `SOURCE_BYTES` (16) of an HMAC-SHA256 of the socket's address under a key the
  server draws at startup, so the host tells addresses apart without learning them. The browser gets nothing yet.
- `RelayHostSignalUseCase`: `host.accept` makes the session `accepted` and sends the browser `client.accepted` with
  the ICE servers, so TURN credentials go only to browsers a host accepted; `host.reject` sends `client.rejected` and
  ends the session. It ignores signals about sessions of another instance.
- `RelayClientSignalUseCase` takes one offer, only for an `accepted` session and announcing the fingerprint of the
  proof, hands it to the host with the ICE servers, then at most 32 candidates. `CloseClientSessionUseCase` and
  `DisconnectHostUseCase` tell the other side with `session.closed`. The registry indexes hosts by socket and
  sessions by instance.
- `IceServersService`: `forHost()` gives STUN only, since a relay on the browser's side is enough, and
  `forBrowser(instanceId)` adds TURN. STUN comes from `P2P_STUN_URLS` (Google and Cloudflare by default); TURN when `P2P_TURN_URLS` and
  `P2P_TURN_SECRET` are set, with coturn REST credentials: username `<expiry>:<instance id>`, password base64
  HMAC-SHA1 of the username under the secret. Time runs in windows of `P2P_TURN_TTL_SECONDS` (default an hour) and a
  credential expires at the end of the window after its own, so every peer of an instance gets the same credential
  within a window and coturn's quota per user counts per instance.
- `WebAppModule` serves `P2P_WEB_DIR` (the `p2p` build of `packages/web`) with the index fallback; `/health`,
  `/signal/host` and `/signal/client` stay excluded. Every response goes through `helmet` with a CSP of `'self'` (plus
  the hashes of the inline scripts of the served `index.html`, inline styles, `data:`/`blob:` images and media),
  `frame-ancestors 'none'` and a `Permissions-Policy` that keeps only the microphone; `index.html` is `no-store`. HSTS
  belongs to the proxy that terminates TLS. State lives in memory only; `PORT` defaults to `3100`.

## Host (`packages/server/src/modules/remote`)

- `RemoteIdentityService`: `isEnabled()` (only `REMOTE_ENABLED=true`), `baseUrl()` (`REMOTE_URL`, with no default
  since choosing it is trusting its operator; null unless HTTPS, or HTTP to `localhost`, `127.0.0.1` or `[::1]`),
  `signalingUrl(baseUrl)`, `identity()`, created once in `<DATA_DIR>/remote`
  (`0o700`): a self-signed ECDSA P-256 `certificate.pem` and `key.pem`, both `0o600`, whose fingerprint derives the
  instance id, and `signChallenge(nonce)`. The link stays the same across restarts.
- `ISignalingClientPort` → `WsSignalingClientAdapter`: answers each `host.challenge` with the registration the
  `register` option builds, reconnects with backoff from 1 s to 60 s, warns once while unreachable, drops a socket
  quiet for 70 s and stops for good on `4400`, `4403` or `4409`. A failing registration or signal handler is logged,
  since a listener of the socket that throws ends the process.
- `IRemotePeerFactoryPort` → `NodeDataChannelPeerAdapter` (`node-datachannel`, an external SDK): every peer uses the
  identity's certificate files, so the answer carries the pinned fingerprint. TURN URLs become libdatachannel server
  objects, since a username holds a colon. A channel closes only after its buffered messages leave.
- `RemoteClientTransportAdapter` implements `IClientTransportPort`. On bootstrap it stays off when remote access is off,
  the access token holds fewer than 32 characters or `REMOTE_URL` is missing or untrusted (both logged as errors), and
  otherwise logs `Remote access link: …` from the console-only context `RemoteAccessLink`. On `session.request` it
  checks the proof with `timingSafeEqual` before spending anything: a valid one is `host.accept`, a wrong one
  `host.reject`, after which requests get `host.close` unchecked for 1 s, doubled per rejection in a row up to 30 s. The
  backoff counts per `source`, so whoever guesses never locks out other addresses; the host remembers the 1 024 sources
  rejected last. It refuses more than 16 negotiating sessions, answers only the offer announcing the proof's
  fingerprint, adds at most 32 candidates, gives up a session without a channel 30 s after accepting it, keeps only one
  channel labeled `arc` and hands it to the web channel as a `DataChannelClientConnection`, which frames events and
  refuses commands over 256 KiB. libdatachannel queues what it cannot send yet, so the connection sends every frame
  at once; the web channel keeps each event small by paging conversation histories. A signal that throws (a candidate or ICE server libdatachannel refuses) gives up its
  session only. The web channel authenticates the channel with the access token like any other connection.

## Browser (`packages/web`)

- The `p2p` mode of Vite (`build:p2p`, `dev:p2p`) builds `dist-p2p`, where `createAppConnection` reads the link:
  routes live under `/i/<instance id>`, the token and the fingerprint are kept per instance, a fingerprint that does
  not derive the instance id is ignored, and a page without them shows `RemoteLinkMissingPage`.
- `WebRtcServerConnection` negotiates through `/signal/client` of the page's origin with a fresh certificate per
  attempt and the proof of the token for it, treats `client.rejected` as `unauthorized`, refuses an answer whose
  fingerprint differs from the pinned one (`untrusted`) and a host of another protocol version (`incompatible`),
  none retried, and reports `turn` when the selected candidate pair has a relayed end. Every frame of a message still
  arriving reports progress, so a long message over a slow relay keeps the heartbeat of the connection alive. Attempts leave the TURN URLs
  out until one fails to connect (its peer connection fails, or no channel 8 s after its offer); from then on, for
  the life of the page, they take the relay. A TURN allocation holds a relay port for as long as its connection lives,
  even a direct one.

## Relay (`deploy/coturn`)

- coturn with `use-auth-secret` (secret `TURN_SECRET`, same as `P2P_TURN_SECRET`), relay ports 49160–49179, peers
  reached over UDP only, and denied: private, loopback, link-local, documentation, reserved and broadcast addresses,
  IPv4-mapped and NAT64 IPv6, and `TURN_EXTERNAL_IP` itself (required by the entrypoint), so the relay never reaches the
  network of its machine nor the services its firewall hides.
- The entrypoint relays from one address only, the IPv4 of the default route's interface read from `/proc/net/route`
  (`docker_gwbridge` under Swarm, where host-mode ports arrive), or `TURN_RELAY_IP`, and maps `TURN_EXTERNAL_IP` to it.
  coturn would otherwise also relay from the overlay address, unreachable from outside.
- Limits come from the entrypoint: `TURN_MAX_BPS` (256 KiB/s per session), `TURN_BPS_CAPACITY` (2 MiB/s in all),
  `TURN_USER_QUOTA` (8 allocations per credential, that is per instance) and `TURN_TOTAL_QUOTA` (20).
- CapRover reads `dockerfilePath` from the folder of the captain definition, so both definitions sit at the
  repository root, which every Dockerfile copies from: `captain-definition-p2p-server` (`Dockerfile.p2p`) and
  `captain-definition-coturn` (`deploy/coturn/Dockerfile`). coturn's ports go in host mode through a service
  override. [docs/remote-access.md](../../../docs/remote-access.md) holds the deployment steps.
- `.github/workflows/deploy-remote-access.yml` calls the CapRover build webhooks of both apps on every published
  release (pre-releases excepted) and on manual dispatch. The webhook URLs carry a token, so they live only in the
  secrets `CAPROVER_P2P_SERVER_WEBHOOK_URL` and `CAPROVER_COTURN_WEBHOOK_URL`. Deploys follow releases because the
  hosted web app must speak the `PROTOCOL_VERSION` of released hosts.

## Tests

- `p2p-server` specs replace the transport with `FakeSignalingTransport` and register hosts with `TEST_HOSTS`
  (fixed test certificates that sign challenges); the WebSocket adapter and `AppModule` run real sockets on port 0.
- Server specs replace the ports with `FakeSignalingClient` and `FakeRemotePeerFactory`; `node-datachannel` is mocked
  with `vi.mock` in the adapter spec only.
- Web specs stub `WebSocket` and `RTCPeerConnection` with `vi.stubGlobal`.
