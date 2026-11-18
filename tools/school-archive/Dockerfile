FROM node:22-bookworm-slim AS node
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
FROM postgres:18-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /runner
# The project's lockfile already pins pg and aws4fetch. No account-wide SDKs,
# database URLs or deployment secrets are baked into this image.
COPY --from=node /deps/node_modules/pg ./node_modules/pg
COPY --from=node /deps/node_modules/pg-cloudflare ./node_modules/pg-cloudflare
COPY --from=node /deps/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=node /deps/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=node /deps/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=node /deps/node_modules/pg-types ./node_modules/pg-types
COPY --from=node /deps/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=node /deps/node_modules/pgpass ./node_modules/pgpass
COPY --from=node /deps/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=node /deps/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=node /deps/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=node /deps/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=node /deps/node_modules/split2 ./node_modules/split2
COPY --from=node /deps/node_modules/xtend ./node_modules/xtend
COPY --from=node /deps/node_modules/aws4fetch ./node_modules/aws4fetch
COPY tools/school-archive/*.cjs ./
RUN node -e "require('./runner.cjs')"
USER postgres
ENTRYPOINT ["node", "/runner/runner.cjs"]
