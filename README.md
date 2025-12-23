# A Minimal Multimodal Chatbot Web Demo

## Overview

This repository contains a minimal web-based multimodal chatbot demo that supports **three reasoning modes**:

* **Direct Reasoning**
* **Naive RAG**
* **Agentic Search**

The chatbot accepts **text-only** input as well as **image + text** input.
This demo was built for the final presentation of a Beijing Natural Science Foundation project.

### Deployment Scenario (as used in this project)

In our setup:

* A **rented GPU server** runs the **VLM (Vision-Language Model)** using **vLLM**
* A local **MacBook** runs:

  * the **FastAPI backend** (orchestrates model + tools)
  * the **React frontend** (web UI)
  * **Caddy** (serves frontend + reverse-proxies backend as one site)
  * **Cloudflare Tunnel (cloudflared)** (exposes the local site to the public)

This makes the web demo accessible to users from anywhere, without requiring router port forwarding.

---

## Architecture

```
Internet Users
   |
   |  https://<random>.trycloudflare.com  (Cloudflare Tunnel)
   v
cloudflared (on MacBook)
   |
   v
Caddy (on MacBook, :8080)
   |                   \
   |                    \  /api/* -> FastAPI backend (127.0.0.1:7860)
   |
   v
React static site (frontend/build)
```

Backend to GPU inference path:

```
FastAPI backend (MacBook) --> SSH port-forward --> vLLM on GPU server (localhost:8000)
```

---

## Repository Structure

```
project_dir/
  frontend/   # React app
  backend/    # FastAPI app
```

---

## Prerequisites

### On the GPU Server

* NVIDIA GPU + CUDA drivers
* Python environment suitable for vLLM
* vLLM installed

### On the Local MacBook

* Node.js + npm
* Python 3.10+ recommended
* `cloudflared` installed
* `caddy` installed (recommended for clean single-domain routing)

---

## 1) Deploy the VLM on the GPU Server (vLLM)

Example command:

```bash
export CUDA_VISIBLE_DEVICES=0

vllm serve /public/huggingface-models/Qwen/Qwen3-VL-8B-Thinking \
  --limit-mm-per-prompt.video 0 \
  --port 8000
```

> Tip: ensure the vLLM service is bound to `0.0.0.0` if you intend to access it from other machines directly.
> In our workflow we access it via SSH port forwarding, so binding to localhost on the server is also fine.

---

## 2) SSH Port Forwarding (GPU Server → Local MacBook)

On the MacBook, create SSH tunnels so local ports map to the remote vLLM ports:

```bash
ssh -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=999 \
  -L 8000:localhost:8000 \
  -L 8001:localhost:8001 \
  my-gpu-host
```

After this:

* `http://localhost:8000` on your MacBook points to the GPU server’s vLLM service.

---

## 3) Backend Setup (FastAPI)

### 3.1 Configure API Keys

Create `backend/.env` and set the following environment variables (placeholders shown):

```bash
SERPER_API_KEY=xxxxxxxx
JINA_API_KEY=jina_xxxxxxxxx
PARATERA_API_KEY=sk-xxxxxxxx
```

### 3.2 Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3.3 Run Backend (Port 7860)

You can run it for local testing:

```bash
uvicorn main:app --host 127.0.0.1 --port 7860 --reload
```

> Recommended: keep backend bound to `127.0.0.1` when using Caddy + cloudflared.
> This avoids exposing the API directly and reduces attack surface.

Health check:

```bash
curl http://127.0.0.1:7860/health
```

---

## 4) Frontend Build (React)

Build the frontend into static files:

```bash
cd frontend
npm install
npm run build
```

The production build output will be in:

* `frontend/build` (Create React App)
* or `frontend/dist` (Vite)

In this project, it is:

* `frontend/build`

### Important: API Base URL

For public access via Cloudflare Tunnel, the frontend **must not** call:

* `http://localhost:7860/...`

Because on someone else’s computer, `localhost` refers to *their* machine.

Instead, the frontend should call the backend using a **same-origin path**:

* `/api/models`
* `/api/infer`
* `/api/stop`
* `/api/health`

Caddy will route `/api/*` to the backend.

---

## 5) Serve Frontend + Proxy Backend with Caddy (Recommended)

Caddy acts as a single entrypoint server:

* Serves static frontend files at `/`
* Reverse-proxies backend endpoints under `/api/*`

### 5.1 Install Caddy (macOS)

```bash
brew install caddy
```

### 5.2 Create `Caddyfile`

Create `Caddyfile` in the repo root:

```caddy
:8080

# Serve React production build
root * /Users/david/Workspace/gaokao_demo/frontend/build
file_server

# Proxy API requests to FastAPI backend
# handle_path removes the /api prefix before proxying
handle_path /api/* {
  reverse_proxy 127.0.0.1:7860
}
```

> Replace the `root` path if your local directory differs.

### 5.3 Run Caddy

From the repo root:

```bash
caddy run --config ./Caddyfile
```

Local verification:

```bash
curl -I http://127.0.0.1:8080
curl http://127.0.0.1:8080/api/health
```

---

## 6) Expose Your Local Demo to the Public with Cloudflare Tunnel (cloudflared)

###### This is the fastest way to demo:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

You’ll get a public URL like:

* `https://<random-words>.trycloudflare.com`

Share that link with anyone.

> Note: Quick Tunnel links may change after restarting and have no uptime guarantee.

---

## Running the Full Demo (Recommended Order)

Open multiple terminals:

1. **SSH port forwarding** (Mac → GPU server)
2. **Backend** (FastAPI on `127.0.0.1:7860`)
3. **Caddy** (serving site on `127.0.0.1:8080`)
4. **cloudflared** (public tunnel → `127.0.0.1:8080`)

---