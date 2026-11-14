# Remote access: signaling server and TURN relay

A server with remote access on (`REMOTE_ENABLED=true`, off by default) keeps a WebSocket open to the signaling server
at `REMOTE_URL` and prints a link at startup. The browser that opens the link loads the web app from the signaling
server, which introduces it to the server; from then on they talk over a WebRTC data channel, encrypted end to end.

```text
Server ──(WebSocket it opens, /signal/host)──────► p2p-server ◄──(page + /signal/client)── Browser
Server ◄════════ WebRTC data channel, DTLS ═══════════════════════════════════════════════► Browser
                 (through coturn when no direct path exists)
```

Two pieces run on a machine with a public address:

- **`packages/p2p-server`**: the NestJS signaling server. It serves the `p2p` build of `packages/web` and relays the
  offer, the answer and the candidates. It keeps no data and sees no message after the data channel opens.
- **coturn** (`deploy/coturn`): the TURN relay for the networks where no direct path exists, such as a mobile carrier
  or a corporate firewall on both ends. Optional: without it those connections fail.

## Trust model

- **The signaling server never holds what controls a host.** A host registers by signing a random challenge with the
  key of its DTLS certificate, whose fingerprint derives the instance id; it never sends a secret. A browser proves it
  holds the access token with an HMAC bound to its own certificate before the host creates any peer connection, so the
  signaling server relays the proof without learning the token, and the host answers nobody else.
- **The data channel is end to end.** The link pins the host's certificate, so neither the signaling server nor the
  TURN relay can read the messages or stand in for the host.
- **The page is the exception.** The browser runs the web app the signaling server serves, and that page reads the
  access token. Whoever operates the signaling server (or controls its deployment, domain or repository) could serve a
  page that sends the token elsewhere. That is why remote access is off by default: turning it on trusts the operator of
  `REMOTE_URL`, and self-hosting this server removes that trust.

## p2p-server

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3100` |
| `P2P_WEB_DIR` | Directory with the `p2p` build of the web app (`packages/web/dist-p2p`); the image sets it | *(not served)* |
| `P2P_STUN_URLS` | STUN servers handed to both peers (comma-separated) | Google and Cloudflare |
| `P2P_TURN_URLS` | TURN URLs (comma-separated), such as `turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp` | *(no relay)* |
| `P2P_TURN_SECRET` | Secret shared with coturn (`TURN_SECRET`); TURN is off without it | *(no relay)* |
| `P2P_TURN_TTL_SECONDS` | Window of the TURN credentials: each one lasts until the end of the window after the one it was issued in | `3600` |
| `P2P_ALLOWED_ORIGINS` | Extra browser origins (comma-separated) allowed to open `/signal/client` | *(same origin only)* |
| `P2P_ALLOWED_INSTANCES` | Instance ids (comma-separated) this server introduces browsers to; any other host is refused | *(any instance)* |
| `P2P_TRUSTED_PROXY_HOPS` | Proxies in front of the server, whose `X-Forwarded-For` entries give the client's address for the limits per address | `0` |

A browser gets the ICE servers, with a TURN credential, only once the host of its link accepted its proof of the
access token. Each credential is `<expiry>:<instance id>` signed with the shared secret, so it expires by itself and
coturn needs no user list; every peer of an instance gets the same one within a window, so coturn's quota per user
counts per instance. A relayed connection drops when its credential expires, and the web app reconnects with a new one.

`P2P_ALLOWED_INSTANCES` turns a public server into a private one: with it, nobody else can register a host and get
relay credentials. A host prints its instance id in its remote link (`/i/<instance id>`).

The server caps the sockets it holds (2 000 in all, 20 per address), the sockets an address opens in a burst and the
messages each socket sends. Behind a proxy every socket comes from the proxy's address, so `P2P_TRUSTED_PROXY_HOPS`
must count the proxies that append to `X-Forwarded-For`: `1` behind CapRover, `2` with a CDN proxy in front of it.
Every page goes out with a strict Content Security Policy, no framing and `index.html` uncached.

Locally, `pnpm dev:p2p-server` starts it on port 3100 and `pnpm dev:web:p2p` serves the web app in `p2p` mode with
`/signal` proxied to it; a server with `REMOTE_URL=http://localhost:5173` prints a link to that page.

## coturn

`deploy/coturn` builds coturn with `turnserver.conf` and an entrypoint that reads:

| Variable | Description | Default |
|---|---|---|
| `TURN_SECRET` | Same value as `P2P_TURN_SECRET` | *(required)* |
| `TURN_REALM` | Domain of the relay, such as `turn.example.com` | *(required)* |
| `TURN_EXTERNAL_IP` | Public IP of the machine, when coturn runs behind NAT or in a container; the relay never forwards to it | *(detected)* |
| `TURN_RELAY_IP` | Address coturn relays from, mapped to `TURN_EXTERNAL_IP` | The address of the default route's interface |
| `TURN_MAX_BPS` | Bytes per second each session may relay | `262144` (256 KiB/s) |
| `TURN_BPS_CAPACITY` | Bytes per second the whole relay may carry | `2097152` (2 MiB/s) |
| `TURN_USER_QUOTA` | Allocations at once per credential | `4` |
| `TURN_TOTAL_QUOTA` | Allocations at once on the relay | `20` |

The relay listens on 3478 (UDP and TCP) and relays through ports 49160–49179 (UDP), one per allocation, from a
single address: the one of the default route's interface, which under Docker Swarm is `docker_gwbridge`, where the
ports published in host mode arrive. The log shows it as `Relay address to use`. It relays to
public addresses only, and never to `TURN_EXTERNAL_IP`, so nobody reaches the network of its machine, nor the services
its firewall hides, through it.

## Deploying with CapRover

Each app points at its own definition in its **Deployment** tab (**Captain Definition Path**). Both definitions sit
at the repository root, since CapRover reads the Dockerfile path from the folder of the definition and the
Dockerfiles copy from the root.

**Signaling server (`arc.example.com`)**

1. Create an app with **Websocket Support** on, connect your domain, enable HTTPS and **Force HTTPS**.
2. Set the Captain Definition Path to `./captain-definition-p2p-server` and the **Container HTTP Port** to `3100`.
3. Set `P2P_TRUSTED_PROXY_HOPS=1` (CapRover's nginx), or `2` when a CDN proxy sits in front of it.
4. For a private server, set `P2P_ALLOWED_INSTANCES` to the instance ids of your hosts.
5. Set `P2P_TURN_URLS` and `P2P_TURN_SECRET` once the relay is up.

**TURN relay (`turn.example.com`)**

1. Point `turn.example.com` straight at the machine: TURN does not go through CapRover's HTTP proxy.
2. Create an app with **Do not expose as web-app** checked and the Captain Definition Path `./captain-definition-coturn`.
3. Set `TURN_SECRET`, `TURN_REALM` and `TURN_EXTERNAL_IP` (the public IP of the machine).
4. Publish the ports in host mode through **Service Update Override**: CapRover's port mapping takes no ranges, and
   host mode keeps the client addresses coturn needs.
5. Open 3478/udp, 3478/tcp and 49160–49179/udp in the firewall of the machine and of the cloud provider.

```yaml
EndpointSpec:
  Ports:
    - Protocol: udp
      TargetPort: 3478
      PublishedPort: 3478
      PublishMode: host
    - Protocol: tcp
      TargetPort: 3478
      PublishedPort: 3478
      PublishMode: host
    - Protocol: udp
      TargetPort: 49160
      PublishedPort: 49160
      PublishMode: host
    - Protocol: udp
      TargetPort: 49161
      PublishedPort: 49161
      PublishMode: host
    - Protocol: udp
      TargetPort: 49162
      PublishedPort: 49162
      PublishMode: host
    - Protocol: udp
      TargetPort: 49163
      PublishedPort: 49163
      PublishMode: host
    - Protocol: udp
      TargetPort: 49164
      PublishedPort: 49164
      PublishMode: host
    - Protocol: udp
      TargetPort: 49165
      PublishedPort: 49165
      PublishMode: host
    - Protocol: udp
      TargetPort: 49166
      PublishedPort: 49166
      PublishMode: host
    - Protocol: udp
      TargetPort: 49167
      PublishedPort: 49167
      PublishMode: host
    - Protocol: udp
      TargetPort: 49168
      PublishedPort: 49168
      PublishMode: host
    - Protocol: udp
      TargetPort: 49169
      PublishedPort: 49169
      PublishMode: host
    - Protocol: udp
      TargetPort: 49170
      PublishedPort: 49170
      PublishMode: host
    - Protocol: udp
      TargetPort: 49171
      PublishedPort: 49171
      PublishMode: host
    - Protocol: udp
      TargetPort: 49172
      PublishedPort: 49172
      PublishMode: host
    - Protocol: udp
      TargetPort: 49173
      PublishedPort: 49173
      PublishMode: host
    - Protocol: udp
      TargetPort: 49174
      PublishedPort: 49174
      PublishMode: host
    - Protocol: udp
      TargetPort: 49175
      PublishedPort: 49175
      PublishMode: host
    - Protocol: udp
      TargetPort: 49176
      PublishedPort: 49176
      PublishMode: host
    - Protocol: udp
      TargetPort: 49177
      PublishedPort: 49177
      PublishMode: host
    - Protocol: udp
      TargetPort: 49178
      PublishedPort: 49178
      PublishMode: host
    - Protocol: udp
      TargetPort: 49179
      PublishedPort: 49179
      PublishMode: host
```

**Deploys**

Point both apps at this repository in their Deployment tab, on the branch the releases come from. The workflow
`Deploy remote access` calls their build webhooks whenever a release is published (pre-releases excepted), or on
demand from the Actions tab for one app or both. It reads the webhooks from the repository secrets
`CAPROVER_P2P_SERVER_WEBHOOK_URL` and `CAPROVER_COTURN_WEBHOOK_URL`. The hosted web app refuses hosts of another
protocol version, so it follows releases rather than every push.

To try the relay alone, open the [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
page with the TURN URL and a credential: a candidate of type `relay` means it works. In the web app, the connection
badge reads "WebRTC through a TURN relay" when a session goes through it.
