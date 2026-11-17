FROM ghcr.io/astral-sh/uv:0.13.8 AS uv_src
FROM node:22.23.1-bookworm-slim AS node_src
FROM sonarsource/sonar-scanner-cli:12.4.0.4321_8.4.0 AS sonar_src

FROM jenkins/inbound-agent:3395.v6e5377b_0fb_3c-5-jdk21

USER root

ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    UV_PYTHON=3.13.18 \
    UV_CACHE_DIR=/tmp/uv-cache \
    SONAR_SCANNER_HOME=/opt/sonar-scanner \
    PATH="/opt/uv/bin:/opt/sonar-scanner/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# uv 0.13.8 + Python 3.13.18 portable para el proyecto (sin usar el Python del anfitrión)
COPY --from=uv_src /uv /uvx /usr/local/bin/
RUN mkdir -p /opt/uv/python /opt/uv/bin \
    && uv python install 3.13.18 \
    && ln -sf "$(uv python find 3.13.18)" /opt/uv/bin/python3.13 \
    && ln -sf /opt/uv/bin/python3.13 /opt/uv/bin/python3 \
    && ln -sf /opt/uv/bin/python3.13 /opt/uv/bin/python \
    && chmod -R a+rX /opt/uv

# Node.js 22.23.1 + npm
COPY --from=node_src /usr/local/bin/node /usr/local/bin/node
COPY --from=node_src /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# SonarScanner CLI 8.4.0
COPY --from=sonar_src /opt/sonar-scanner /opt/sonar-scanner
RUN ln -sf /opt/sonar-scanner/bin/sonar-scanner /usr/local/bin/sonar-scanner \
    && chmod -R a+rX /opt/sonar-scanner

USER jenkins
WORKDIR /home/jenkins/agent
