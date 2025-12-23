from fastapi import FastAPI, UploadFile, Form
from fastapi.responses import StreamingResponse, JSONResponse
import asyncio
from fastapi.middleware.cors import CORSMiddleware
import json
import yaml
from model.model_client import ModelClient
from workflow.direct_reasoning import stream_direct_reasoning
from workflow.naive_rag import stream_naive_rag
from workflow.agentic_search import stream_agentic_search

from typing import List, Optional


from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="RUC-Xiaomi Backend", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_tasks: dict[str, asyncio.Event] = {}

config_path = 'config.yaml'
with open(config_path, 'r', encoding='utf-8') as f:
    config = yaml.safe_load(f)

clients = {}
for model, cfg in config.items():
    clients[model] = ModelClient(
        base_url=cfg["base_url"],
        model_name=cfg["model_name"]
    )

@app.get("/health")
async def health():
    """Simple health check endpoint."""
    return {"status": "ok"}

@app.get("/models")
async def list_models():
    """
    List available models for frontend selection
    """
    return {
        "models": [
            {
                "model": model,
                "display_name": cfg["display_name"],
                "base_url": cfg["base_url"],
                "model_name": cfg["model_name"],
            }
            for model, cfg in config.items()
        ]
    }

@app.post("/infer")
async def infer(
    query: str = Form(...),
    model: str = Form(...),
    mode: str = Form(...),
    files: Optional[List[UploadFile]] = None,
):
    if model not in clients:
        return JSONResponse(
            {"error": f"Unknown model: {model}"},
            status_code=400,
        )

    client = clients[model]

    image_paths: List[str] = []
    if files:
        for f in files:
            if not f.filename:
                continue
            tmp_path = f"/tmp/{f.filename}"
            with open(tmp_path, "wb") as out:
                out.write(await f.read())
            image_paths.append(tmp_path)

    if mode == "direct_reasoning":
        stream_fn = stream_direct_reasoning
    elif mode == "agentic_search":
        stream_fn = stream_agentic_search
    elif mode == "naive_rag":
        stream_fn = stream_naive_rag
    else:
        return JSONResponse(
            {"error": f"Unknown mode: {mode}"},
            status_code=400,
        )

    async def sse():
        try:
            async for event in stream_fn(client, query, image_paths):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


@app.post("/stop")
async def stop(task_id: str = Form(...)):
    """Stop an ongoing inference task"""
    cancel_event = active_tasks.get(task_id)
    if cancel_event:
        cancel_event.set()
        return JSONResponse({"status": "stopping", "task_id": task_id})
    else:
        return JSONResponse({"status": "not_found", "task_id": task_id})
