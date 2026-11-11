FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY . .
RUN npm -w client run build
RUN npm -w server run build

FROM node:22-alpine
WORKDIR /app/server
COPY --from=build /app/server /app/server
COPY --from=build /app/client/dist /app/client/dist
# Workspace deps are COMMITTED and HOISTED to /app/node_modules by root `npm ci`
# (npm workspaces hoist by design) - the final stage must ship them so the server
# resolves `pg` and every dependency: node resolves /app/server/dist/... imports
# by walking UP to /app/node_modules.
COPY --from=build /app/node_modules /app/node_modules
EXPOSE 3000
CMD ["node", "dist/app.js"]
