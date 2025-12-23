from typing import List, AsyncGenerator, Dict, Any
from model.model_client import ModelClient
from utils.search import search_and_fetch, summarize_pages


async def stream_naive_rag(
    client: ModelClient,
    query: str,
    image_paths: List[str],
) -> AsyncGenerator[Dict[str, Any], None]:
    yield {
        "type": "status",
        "stage": "search",
        "message": "正在搜索相关资料...",
    }

    yield {
        "type": "token",
        "content": f"\n<search>{query}</search>\n",
    }

    pages = search_and_fetch(query, top_k=5)
    summary = summarize_pages(pages)

    yield {
        "type": "token",
        "content": f"\n<search_result>{summary}</search_result>\n",
    }

    prompt = (
        "请基于这些资料回答问题，要求：\n"
        "1. 仅依据给定资料作答，不要编造信息；\n"
        "2. 如果资料中无法得到答案，请明确说明；\n"
        "3. 回答应简洁、准确、结构清晰。\n\n"
        f"【参考资料】\n{summary}\n\n"
        f"【用户问题】\n{query}"
    )

    messages = [
        {
            "role": "user",
            "content": (
                [{"type": "text", "text": prompt}]
                + [{"type": "image_path", "image_path": p} for p in image_paths]
            ),
        }
    ]



    for token in client.stream_generate(messages):
        yield {
            "type": "token",
            "content": token,
        }

    yield {
        "type": "done",
    }
