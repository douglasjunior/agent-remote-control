#!/bin/sh
# Starts coturn with the shared secret of the p2p-server and the limits that keep the relay within the host's means.
# Arguments given to the container are appended to turnserver's.
set -eu

: "${TURN_SECRET:?TURN_SECRET must hold the same value as P2P_TURN_SECRET of the p2p-server}"
: "${TURN_REALM:?TURN_REALM must hold the domain of the relay, such as turn.example.com}"

# The IPv4 address of the interface the default route leaves through. Under Docker Swarm that is docker_gwbridge,
# where the ports published in host mode arrive; the overlay address that coturn would also relay from is
# unreachable from outside, and a single relay address is what lets TURN_EXTERNAL_IP map to it.
default_route_ip() {
  awk -v addresses="$(hostname -I)" '
    function hex(h,  i, n) {
      n = 0
      for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789ABCDEF", toupper(substr(h, i, 1))) - 1
      return n
    }
    function le(h) { return ((hex(substr(h, 7, 2)) * 256 + hex(substr(h, 5, 2))) * 256 + hex(substr(h, 3, 2))) * 256 + hex(substr(h, 1, 2)) }
    function dotted(a,  p) { split(a, p, "."); return ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4] }
    NR > 1 && $2 == "00000000" { device = $1 }
    NR > 1 && $2 != "00000000" { iface[NR] = $1; net[NR] = le($2); size[NR] = 4294967296 - le($8) }
    END {
      count = split(addresses, list, " ")
      for (r in iface) {
        if (iface[r] != device) continue
        for (i = 1; i <= count; i++) {
          if (list[i] ~ /^[0-9.]+$/ && int(dotted(list[i]) / size[r]) == int(net[r] / size[r])) { print list[i]; exit }
        }
      }
    }' /proc/net/route
}

RELAY_IP="${TURN_RELAY_IP:-$(default_route_ip)}"

exec turnserver -c /etc/coturn/turnserver.conf \
  --static-auth-secret="$TURN_SECRET" \
  --realm="$TURN_REALM" \
  ${RELAY_IP:+--relay-ip="$RELAY_IP"} \
  ${TURN_EXTERNAL_IP:+--external-ip="$TURN_EXTERNAL_IP${RELAY_IP:+/$RELAY_IP}"} \
  ${TURN_EXTERNAL_IP:+--denied-peer-ip="$TURN_EXTERNAL_IP"} \
  --max-bps="${TURN_MAX_BPS:-262144}" \
  --bps-capacity="${TURN_BPS_CAPACITY:-2097152}" \
  --user-quota="${TURN_USER_QUOTA:-4}" \
  --total-quota="${TURN_TOTAL_QUOTA:-20}" \
  "$@"
