FROM kasmweb/kali-rolling-desktop:1.16.0

USER root
RUN openssl req -x509 -newkey rsa:2048 -nodes \
			-keyout /etc/kasmvnc/cyberpod.key \
			-out /etc/kasmvnc/cyberpod.crt \
			-subj '/CN=cyberpod-kasm' -days 3650 \
		&& chmod 644 /etc/kasmvnc/cyberpod.key /etc/kasmvnc/cyberpod.crt

COPY kasmvnc.yaml /etc/kasmvnc/kasmvnc.yaml

USER 1000
