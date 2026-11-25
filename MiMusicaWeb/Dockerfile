FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs subsonic.mjs session-store.mjs import-store.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/data /app/imports && chown node:node /app/data /app/imports && chmod 700 /app/data /app/imports
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
CMD ["node", "server.mjs"]
