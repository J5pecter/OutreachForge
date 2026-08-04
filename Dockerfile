# Single image for the backend. The same image runs the API, the send worker,
# the scheduler, or migrations — selected by the compose `command`.

# ---- builder: install everything, generate Prisma client, compile TS ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runner: production deps only + compiled output ----
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY prisma ./prisma
# `prisma` is a runtime dependency here, so the client can be generated and
# `migrate deploy` can run inside the container.
RUN npx prisma generate
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
