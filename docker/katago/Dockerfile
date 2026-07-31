FROM node:22-bookworm-slim AS runtime

ARG KATAGO_VERSION=v1.17.0
ARG KATAGO_ARCHIVE=katago-v1.17.0-eigenavx2-linux-x64.zip
ARG KATAGO_MODEL=b10c384h6nbttflrs.bin.gz

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 unzip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/katago \
    && curl --fail --location --retry 3 \
      "https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}/${KATAGO_ARCHIVE}" \
      --output /tmp/katago.zip \
    && unzip -j /tmp/katago.zip katago -d /tmp \
    && chmod +x /tmp/katago \
    && cd /tmp \
    && ./katago --appimage-extract >/dev/null \
    && cp squashfs-root/usr/bin/katago /opt/katago/katago \
    && cp -a squashfs-root/usr/lib /opt/katago/lib \
    && chmod +x /opt/katago/katago \
    && curl --fail --location --retry 3 \
      "https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}/${KATAGO_MODEL}" \
      --output /opt/katago/model.bin.gz \
    && rm -rf /tmp/katago /tmp/katago.zip /tmp/squashfs-root

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY lib ./lib
COPY workers ./workers
COPY docker/katago/analysis.cfg /opt/katago/analysis.cfg

ENV NODE_ENV=production \
    LD_LIBRARY_PATH=/opt/katago/lib \
    KATAGO_BINARY=/opt/katago/katago \
    KATAGO_MODEL=/opt/katago/model.bin.gz \
    KATAGO_CONFIG=/opt/katago/analysis.cfg \
    KATAGO_VERSION=v1.17.0 \
    KATAGO_MODEL_NAME=b10c384h6nbttflrs

EXPOSE 8080
USER node
CMD ["npm", "run", "worker:katago"]
