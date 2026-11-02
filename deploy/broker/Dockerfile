FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium xvfb ca-certificates coreutils bash && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/duet
RUN npm install --omit=dev --no-audit --no-fund playwright-core@1.64.1
COPY src/server/computer/vm/duet-browser.mjs /opt/duet/duet-browser.mjs
COPY src/server/broker/egress.mjs /opt/duet/egress.mjs
USER 1000:1000
ENV HOME=/data/home DISPLAY=:1
CMD ["Xvfb", ":1", "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"]
