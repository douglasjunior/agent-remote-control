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
relay are not trusted with that: they introduce and relay, and every rule below keeps them unable to read the messages
or to stand in for a host.

## Protocol (`packages/protocol`)

- `signaling.ts`: four zod unions, one per direction — `hostSignalSchema` (`host.register`, `host.answer`,
  `host.candidate`, `host.close`), `toHostSignalSchema` (`host.registered`, `session.offer` with the ICE servers,
  `session.candidate`, `session.closed`), `clientSignalSchema` (`client.connect`, `client.offer`, `client.candidate`)
  and `toClientSignalSchema` (`client.accepted` with the ICE servers and the host's protocol version,
  `client.unavailable`, `session.answer`, `session.candidate`, `session.closed`). Paths `/signal/host` and
  `/signal/client`, a 64 KiB payload limit, the data channel label `arc` and the close codes `4400` (invalid secret)
  and `4409` (replaced) live there too.
- `protocol-version.ts`: `PROTOCOL_VERSION` must be raised by any client command or server event change the other
  side cannot read. The hosted web app talks to hosts of any release and refuses a host whose version differs.
- `remote-link.ts`: `deriveInstanceId(secret)` (first 20 hex characters of its SHA-256), `buildRemoteLink` and
  `instanceIdFromPath`. The link is `<REMOTE_URL>/i/<instance id>#fp=<fingerprint>&token=<access token>`; the
  fingerprint and the token must stay in the fragment, which the browser never sends to the page's server.
- `fingerprint.ts`: `encodeFingerprint` turns `AB:CD:…` into base64url; `sdpFingerprint(sdp)` returns the single
  SHA-256 fingerprint of an SDP, or null for none or more than one.
- `data-channel-frames.ts`: every data channel message, both ways, goes as frames `<index>/<count>\n<payload>` of at
  most 16 000 UTF-16 units (`toFrames`), never splitting a surrogate pair. `FrameAssembler(maxLength)` joins them and
  reports `invalid` for a missing header, a frame out of order or a message over the limit.

## Signaling server (`packages/p2p-server`)

- Module `signaling`: `ISignalingTransportPort` (`onHost`, `onClient`) bound to `WsSignalingTransportAdapter`, which
  upgrades `/signal/host` without an origin check and `/signal/client` only for the same origin or `P2P_ALLOWED_ORIGINS`,
  pings every 25 s and terminates a socket that missed the previous ping.
- `SignalingConnectionHandler` parses every message and closes with `1008` on an invalid signal, a signal out of order
  or no first signal within 5 s. A browser socket lives at most 60 s: once connected it needs no signaling.
- `RegisterHostUseCase` accepts a host only when its secret derives the instance id it registers (`4400` otherwise);
  a newer registration replaces the older one, closed with `4409`, and ends its sessions.
- `OpenClientSessionUseCase` answers `client.unavailable` when the host is offline or already negotiates 16 sessions.
  Otherwise it opens a session and hands the ICE servers: TURN credentials go only to peers of an online host.
- `RelayClientSignalUseCase` takes one offer, then candidates, and hands the ICE servers to the host with the offer.
  `RelayHostSignalUseCase` ignores signals about sessions of another instance. `CloseClientSessionUseCase` and
  `DisconnectHostUseCase` tell the other side with `session.closed`.
- `IceServersService`: STUN from `P2P_STUN_URLS` (Google and Cloudflare by default); TURN when `P2P_TURN_URLS` and
  `P2P_TURN_SECRET` are set, with coturn REST credentials: username `<expiry>:<instance id>`, password base64
  HMAC-SHA1 of the username under the secret, valid for `P2P_TURN_TTL_SECONDS` (default a day).
- `WebAppModule` serves `P2P_WEB_DIR` (the `p2p` build of `packages/web`) with the index fallback; `/health`,
  `/signal/host` and `/signal/client` stay excluded. State lives in memory only; `PORT` defaults to `3100`.

## Host (`packages/server/src/modules/remote`)

- `RemoteIdentityService`: `isEnabled()` (`REMOTE_ENABLED` unless `false`), `baseUrl()` (`REMOTE_URL`, default
  `https://arc-p2p-server.arc.douglasjunior.work`), `signalingUrl()` and `identity()`, created once in `<DATA_DIR>/remote`: `secret`,
  a self-signed ECDSA P-256 `certificate.pem` and `key.pem`, all `0o600`. The link stays the same across restarts.
- `ISignalingClientPort` → `WsSignalingClientAdapter`: registers on every connection, reconnects with backoff from
  1 s to 60 s, warns once while unreachable, drops a socket quiet for 70 s and stops for good on `4400` or `4409`.
- `IRemotePeerFactoryPort` → `NodeDataChannelPeerAdapter` (`node-datachannel`, an external SDK): every peer uses the
  identity's certificate files, so the answer carries the pinned fingerprint. TURN URLs become libdatachannel server
  objects, since a username holds a colon. A channel closes only after its buffered messages leave.
- `RemoteClientTransportAdapter` implements `IClientTransportPort`: it answers each offer with a peer, refuses more
  than 16 negotiating peers, gives up one without a channel in 30 s, keeps only one channel labeled `arc` and hands it
  to the web channel as a `DataChannelClientConnection`, which frames events and refuses commands over 256 KiB. The
  web channel authenticates it with the access token like any other connection.
- `WebAccessTokenService` logs `Remote access link: …` after the token, from its console-only context.

## Browser (`packages/web`)

- The `p2p` mode of Vite (`build:p2p`, `dev:p2p`) builds `dist-p2p`, where `createAppConnection` reads the link:
  routes live under `/i/<instance id>`, the token and the fingerprint are kept per instance, and a page without them
  shows `RemoteLinkMissingPage`.
- `WebRtcServerConnection` negotiates through `/signal/client` of the page's origin, refuses an answer whose
  fingerprint differs from the pinned one (`untrusted`) and a host of another protocol version (`incompatible`),
  neither retried, and reports `turn` when the selected candidate pair has a relayed end.

## Relay (`deploy/coturn`)

- coturn with `use-auth-secret` (secret `TURN_SECRET`, same as `P2P_TURN_SECRET`), relay ports 49160–49179, peers
  reached over UDP only and private, loopback and link-local peer addresses denied, so the relay never reaches the
  network of its machine.
- The entrypoint relays from one address only, the IPv4 of the default route's interface read from `/proc/net/route`
  (`docker_gwbridge` under Swarm, where host-mode ports arrive), or `TURN_RELAY_IP`, and maps `TURN_EXTERNAL_IP` to it.
  coturn would otherwise also relay from the overlay address, unreachable from outside.
- Limits come from the entrypoint: `TURN_MAX_BPS` (256 KiB/s per session), `TURN_BPS_CAPACITY` (2 MiB/s in all),
  `TURN_USER_QUOTA` (4 allocations per credential) and `TURN_TOTAL_QUOTA` (20).
- CapRover reads `dockerfilePath` from the folder of the captain definition, so both definitions sit at the
  repository root, which every Dockerfile copies from: `captain-definition-p2p-server` (`Dockerfile.p2p`) and
  `captain-definition-coturn` (`deploy/coturn/Dockerfile`). coturn's ports go in host mode through a service
  override. [docs/remote-access.md](../../../docs/remote-access.md) holds the deployment steps.
- `.github/workflows/deploy-remote-access.yml` calls the CapRover build webhooks of both apps on every published
  release (pre-releases excepted) and on manual dispatch. The webhook URLs carry a token, so they live only in the
  secrets `CAPROVER_P2P_SERVER_WEBHOOK_URL` and `CAPROVER_COTURN_WEBHOOK_URL`. Deploys follow releases because the
  hosted web app must speak the `PROTOCOL_VERSION` of released hosts.

## Tests

- `p2p-server` specs replace the transport with `FakeSignalingTransport`; the WebSocket adapter and `AppModule` run
  real sockets on port 0.
- Server specs replace the ports with `FakeSignalingClient` and `FakeRemotePeerFactory`; `node-datachannel` is mocked
  with `vi.mock` in the adapter spec only.
- Web specs stub `WebSocket` and `RTCPeerConnection` with `vi.stubGlobal`.
