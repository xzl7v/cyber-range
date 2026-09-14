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

## Kasm performance and GPU path

Dynamic Kali sessions use the CyberPod host's GPU when Docker advertises the NVIDIA runtime. The runtime checks Docker at session creation time and adds an NVIDIA device request only when available; set `CYBER_RANGE_GPU_MODE=disabled` to force the CPU/software fallback. A GPU is never required to start a lab.

The session defaults are 2 GiB shared memory, 1280x720, 30 FPS, bandwidth-first KasmVNC quality, disabled XFCE compositing, fixed `PublicIP=127.0.0.1` to avoid STUN delays in isolated networks, and server-controlled desktop sizing. Lab manifests use the `cyber-range/kali-optimized:v3` layer, which preserves the Kasm/Kali userspace but supplies the complete KasmVNC policy and an internal certificate. The legacy `student-node` service is not used by dynamic lab sessions.

The measured baseline on this host was software `llvmpipe` rendering with 64 MiB shared memory and no GPU device request. The new session reported NVIDIA Zink rendering with `Accelerated: yes`, `runtime=nvidia`, a GPU device request, and 2 GiB shared memory. The effective Xvnc command was verified at 1280x720/30 FPS with client overrides disabled. Thunar exited immediately in a direct smoke check, and the session used under 1% CPU while idle. Both sessions used the same 2 vCPU/2 GiB resource limits.

## Modular labs and CLI

Each runtime module lives under `labs/<module>/lab.json` with its catalog metadata, tasks, target definitions, healthchecks, and resource limits. The gateway discovers catalog-ready manifests and adds only missing slugs to the database; instructor edits are preserved. The runtime discovers the same manifests for environment provisioning.

Use the thin host-side client with credentials from `.env`:

```sh
export CYBERLAB_USERNAME="$DEMO_USERNAME" CYBERLAB_PASSWORD="$DEMO_PASSWORD"
./cyberlab list
./cyberlab info 01
./cyberlab start 01
./cyberlab status
./cyberlab stop
./cyberlab restart 02
```

The CLI only calls the authenticated Labs and runtime APIs; Docker orchestration remains in the runtime manager. A runtime restart removes stale resources with the CyberPod session label so orphaned Kali/target containers and networks do not accumulate.

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
