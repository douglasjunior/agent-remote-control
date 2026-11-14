# TURN relay of remote access: coturn with the configuration and limits of deploy/coturn/turnserver.conf

FROM coturn/coturn:4.18.0

COPY deploy/coturn/turnserver.conf /etc/coturn/turnserver.conf
COPY --chmod=755 deploy/coturn/entrypoint.sh /usr/local/bin/arc-turnserver

EXPOSE 3478/udp 3478/tcp

ENTRYPOINT ["/usr/local/bin/arc-turnserver"]
