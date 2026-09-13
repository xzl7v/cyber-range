# Cyber Range

Local, isolated cybersecurity training platform. The repository combines the existing CyberPod Labs module with a host authentication gateway and a Docker runtime manager that creates one isolated Kali and training-target environment per student attempt.

## Architecture

```text
Browser
  -> Nginx gateway (:80)
       -> web-app (:3000)
            -> login / role authentication
            -> Labs module (instructor and student interfaces)
            -> runtime API forwarder
       -> runtime-manager (:3001)
            -> Docker Engine
                 -> session network
                 -> Kali desktop
                 -> training target
```

The Nginx gateway exposes only the web application and the Kali noVNC proxy routes. The runtime manager is the only service with access to the Docker socket, and it exposes a restricted session API rather than raw Docker control.

## Quick start

Prerequisites:

- Docker Engine with Compose v2
- Node.js 24 and npm for local Labs-module verification

From the repository root:

```sh
cp .env.example .env
# Edit .env with local training credentials and a strong session secret.
docker compose build
docker compose up -d
docker compose ps
```

Open `http://localhost` and sign in with the centralized demo credentials:

```text
Username: bisha
Password: bisha
```

After login, choose the Student or Instructor workspace inside the application. These credentials are configured only in `.env` and must be changed before any non-local use.

The first Hydra session may take time while Docker pulls the Kali image and builds the isolated SSH target. Sessions are removed automatically by the runtime manager after the configured TTL or when the student ends the lab.

## Local Labs-module checks

```sh
cd labs-module
npm ci
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The development identities used by the standalone module are separate from the host login system and are disabled in production mode.
