from typing import List, AsyncGenerator, Dict, Any
from model.model_client import ModelClient


async def stream_direct_reasoning(
    client: ModelClient,
    query: str,
    image_paths: List[str],
) -> AsyncGenerator[Dict[str, Any], None]:

    messages = [
        {
            "role": "user",
            "content": (
                [{"type": "text", "text": query}]
                + [{"type": "image_path", "image_path": p} for p in image_paths]
            ),
        }
    ]

    for token in client.stream_generate(
        messages,
    ):
        yield {
            "type": "token",
            "content": token,
        }

    yield {
        "type": "done",
    }
