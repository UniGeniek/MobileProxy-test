FROM node:20-alpine

RUN apk add --no-cache curl openssh-client

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/logs

EXPOSE 4000

CMD ["node", "src/index.js"]
