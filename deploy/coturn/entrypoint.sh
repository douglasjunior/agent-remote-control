#!/bin/sh
# Starts coturn with the shared secret of the p2p-server and the limits that keep the relay within the host's means.
# Arguments given to the container are appended to turnserver's.
set -eu

: "${TURN_SECRET:?TURN_SECRET must hold the same value as P2P_TURN_SECRET of the p2p-server}"
: "${TURN_REALM:?TURN_REALM must hold the domain of the relay, such as turn.example.com}"

exec turnserver -c /etc/coturn/turnserver.conf \
  --static-auth-secret="$TURN_SECRET" \
  --realm="$TURN_REALM" \
  ${TURN_EXTERNAL_IP:+--external-ip="$TURN_EXTERNAL_IP"} \
  --max-bps="${TURN_MAX_BPS:-262144}" \
  --bps-capacity="${TURN_BPS_CAPACITY:-2097152}" \
  --user-quota="${TURN_USER_QUOTA:-4}" \
  --total-quota="${TURN_TOTAL_QUOTA:-20}" \
  "$@"
