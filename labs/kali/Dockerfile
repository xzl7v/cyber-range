FROM kasmweb/core-kali-rolling:1.19.0

USER root

RUN apt-get update \
	&& (apt-get install -y --no-install-recommends \
		xfce4-terminal \
		nmap \
		hydra \
		curl \
		netcat-openbsd \
		whatweb \
		gobuster \
		ffuf \
		tcpdump \
		iproute2 \
		iputils-ping \
		net-tools \
		openssh-client \
		wget \
		ca-certificates \
		firefox-esr \
		thunar \
		|| (sed -i '/u!/d' /usr/lib/sysusers.d/tcpdump.conf && dpkg --configure -a)) \
	&& apt-mark manual \
		xfce4-terminal nmap hydra curl netcat-openbsd whatweb gobuster ffuf tcpdump \
		iproute2 iputils-ping net-tools openssh-client wget ca-certificates firefox-esr thunar \
	&& apt-get purge -y burpsuite john john-data metasploit-framework \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/* /var/tmp/* \
		/home/kasm-user/.cache /root/.cache \
	&& openssl req -x509 -newkey rsa:2048 -nodes \
			-keyout /etc/kasmvnc/cyberpod.key \
			-out /etc/kasmvnc/cyberpod.crt \
			-subj '/CN=cyberpod-kasm' -days 3650 \
		&& chmod 644 /etc/kasmvnc/cyberpod.key /etc/kasmvnc/cyberpod.crt

COPY kasmvnc.yaml /etc/kasmvnc/kasmvnc.yaml

RUN printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Hidden=true' > /etc/xdg/autostart/xfce4-power-manager.desktop \
	&& printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Hidden=true' > /etc/xdg/autostart/xfce4-screensaver.desktop

USER 1000
