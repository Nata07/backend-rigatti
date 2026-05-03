FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/typescript ./node_modules/typescript
COPY src ./src
COPY scripts ./scripts
COPY uploads/samples ./uploads/samples

RUN mkdir -p uploads/products

EXPOSE 3001

CMD ["npm", "start"]
