FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs subsonic.mjs session-store.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
ENV NODE_ENV=production HOST=127.0.0.1 PORT=4173
CMD ["node", "server.mjs"]
