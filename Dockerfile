FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY engine ./engine
COPY tools ./tools

USER node

CMD ["node", "src/server.mjs"]
