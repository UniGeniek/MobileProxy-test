FROM alpine:3.19

RUN apk add --no-cache 3proxy netcat-openbsd

RUN adduser -D -H proxyuser && \
    mkdir -p /var/log/3proxy && \
    mkdir -p /etc/3proxy && \
    chown -R proxyuser:proxyuser /var/log/3proxy /etc/3proxy

COPY 3proxy.cfg /etc/3proxy/3proxy.cfg
COPY users.txt /etc/3proxy/users.txt
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && \
    chown -R proxyuser:proxyuser /etc/3proxy

EXPOSE 3001-3050

USER proxyuser
ENTRYPOINT ["/entrypoint.sh"]
