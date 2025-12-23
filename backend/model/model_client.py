import base64
import json
import requests
from typing import Any, Dict, List
import mimetypes


class ModelClient():
    def __init__(
        self,
        base_url: str="http://localhost:8000/v1/chat/completions",
        model_name: str="Qwen/Qwen3-VL-8B-Thinking",
    ):
        self.base_url = base_url
        self.model_name = model_name

    def prepare_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        formatted_messages = []
        for message in messages:
            role = message["role"]
            content = []
            for c in message["content"]:
                if c["type"] == "text":
                    content.append({"type": "text", "text": c["text"]})
                elif c["type"] == "image_path":
                    with open(c["image_path"], "rb") as f:
                        raw = f.read()
                        img_b64 = base64.b64encode(raw).decode("utf-8")

                    mime, _ = mimetypes.guess_type(c["image_path"])
                    mime = mime or "image/png"

                    content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{img_b64}"
                        }
                    })

            formatted_messages.append({"role": role, "content": content})
        return formatted_messages

    def stream_generate(self, messages: List[Dict[str, Any]], **kwargs: Any):
        vllm_messages = self.prepare_messages(messages)

        payload = {
            "model": self.model_name,
            "messages": vllm_messages,
            "stream": True,
            "stop": kwargs.get("stop", None),
            "temperature": kwargs.get("temperature", 0.0),
            "top_p": kwargs.get("top_p", 0.8),
            "top_k": kwargs.get("top_k", 20),
            "repetition_penalty": kwargs.get("repetition_penalty", 1.0),
            "presence_penalty": kwargs.get("presence_penalty", 1.0),
            "include_stop_str_in_output": kwargs.get("include_stop_str_in_output", False),
        }

        headers = {"Content-Type": "application/json"}

        yield "<think>"

        with requests.post(self.base_url, headers=headers, json=payload, stream=True) as resp:
            if resp.status_code != 200:
                raise RuntimeError(f"vLLM request failed: {resp.status_code}, {resp.text}")

            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data = line[len("data: "):].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except Exception as e:
                    print("Stream parse error:", e, "line=", data)
                continue


def main():
    client = ModelClient(
        base_url="http://localhost:8000/v1/chat/completions",
        model_name="/public/huggingface-models/Qwen/Qwen3-VL-8B-Thinking",
    )

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Tell me how to solve x^2 + 2x + 1 = 0?"},
            ]
        }
    ]

    for token in client.stream_generate(
        messages, 
        stop=["quadratic"], 
        temperature=0.7,
        repetition_penalty=1.0,
        presence_penalty=1.5):
        print(token, end="", flush=True)


if __name__ == "__main__":
    main()
