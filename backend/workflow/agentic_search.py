from typing import List, AsyncGenerator, Dict, Any
from model.model_client import ModelClient
from utils.search import search_and_fetch, summarize_pages
import re

SEARCH_PATTERN = re.compile(r"<search>(.*?)</search>", re.DOTALL)

def extract_search_query(text: str) -> str | None:
    if not text:
        return None

    close_tag = "</search>"
    open_tag = "<search>"

    close_idx = text.rfind(close_tag)
    if close_idx == -1:
        return None

    open_idx = text.rfind(open_tag, 0, close_idx)
    if open_idx == -1:
        return None

    start = open_idx + len(open_tag)
    return text[start:close_idx].strip()


async def stream_agentic_search(
    client: ModelClient,
    query: str,
    image_paths: List[str],
) -> AsyncGenerator[Dict[str, Any], None]:

    # ✅ 初始问题内容：文本 + 图片一起给模型（支持图片参与推理/决定搜索）
    history = [
        {
            "role": "user",
            "content": (
                [
                    {
                        "type": "text",
                        "text": (
                            "你是一个具备自主搜索能力的智能助理。\n"
                            "当你认为需要外部信息时，请用以下格式提出搜索请求：\n"
                            "<search>具体搜索问题</search>\n\n"
                            "当信息已经足够时，请给出最终答案，不要再输出 <search></search>。\n\n"
                            f"用户问题：{query}"
                        ),
                    }
                ]
                + [{"type": "image_path", "image_path": p} for p in image_paths]
            ),
        }
    ]

    max_rounds = 20

    for _ in range(max_rounds):
        output = ""

        for token in client.stream_generate(
            history,
            stop=["</search>"],
            include_stop_str_in_output=True,
        ):
            output += token
            yield {
                "type": "token",
                "content": token,
            }

        search_query = extract_search_query(output)
        if not search_query:
            yield {"type": "done"}
            return

        pages = search_and_fetch(search_query, top_k=5)
        summary = summarize_pages(pages)

        # 给模型看的：把刚才 assistant 输出加入历史
        history.append(
            {
                "role": "assistant",
                "content": [{"type": "text", "text": output}],
            }
        )

        # 流式给前端（保持你原来的输出形式）
        yield {
            "type": "token",
            "content": f"\n<search_result>{summary}</search_result>\n",
        }

        # 给模型看的：把搜索结果作为 assistant 内容加入历史
        history.append(
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": f"<search_result>{summary}</search_result>",
                    }
                ],
            }
        )

    yield {"type": "done"}
