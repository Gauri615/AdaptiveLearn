FROM eclipse-temurin:17-jdk-alpine

RUN addgroup -S -g 10001 sandbox \
    && adduser -S -D -u 10001 -G sandbox sandbox \
    && mkdir -p /work /tmp \
    && chown -R 10001:10001 /work /tmp

USER 10001:10001
WORKDIR /work
