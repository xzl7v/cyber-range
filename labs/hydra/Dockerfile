FROM debian:bookworm-slim AS ssh-target

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash trainee \
    && echo 'trainee:Lab12345' | chpasswd \
    && mkdir -p /run/sshd \
    && rm -f /etc/ssh/ssh_host_*

COPY sshd_config /etc/ssh/sshd_config

CMD ["sh", "-c", "ssh-keygen -A && exec /usr/sbin/sshd -D -e"]

FROM debian:bookworm-slim AS hydra-client

RUN apt-get update \
    && apt-get install -y --no-install-recommends hydra openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /lab
COPY passwords.txt /lab/passwords.txt

ENTRYPOINT ["hydra"]
