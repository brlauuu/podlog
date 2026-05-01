# Issue #630: daily backup service for the Podlog DB + audio archive.
# Tiny image: postgresql-client (matched to the db service major version)
# + rsync + bash. The script does the rest.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# postgresql-client-15 mirrors the `pgvector/pgvector:pg15` image used by
# the `db` service. If the DB is upgraded to a new major version, bump
# this to match — pg_dump is forward-compatible but not backward.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-client-15 \
       rsync \
       ca-certificates \
       tini \
    && rm -rf /var/lib/apt/lists/*

COPY backup.sh /usr/local/bin/backup.sh
COPY restore-db.sh /usr/local/bin/restore-db.sh
COPY restore-audio.sh /usr/local/bin/restore-audio.sh
RUN chmod +x /usr/local/bin/backup.sh \
    /usr/local/bin/restore-db.sh \
    /usr/local/bin/restore-audio.sh

# tini reaps zombies and forwards signals — without it, a `docker stop`
# on a sleeping `bash` doesn't propagate cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/backup.sh"]
