import os
import json
import requests
from urllib.parse import urlencode
from concurrent.futures import ThreadPoolExecutor, as_completed
import re
import openai
import os

import dotenv
dotenv.load_dotenv()

PARATERA_API_KEY = os.getenv("PARATERA_API_KEY")
SERPER_API_KEY = os.getenv("SERPER_API_KEY")
JINA_API_KEY = os.getenv("JINA_API_KEY")
CACHE_FILE = ".cache/search_cache.json"

deepseek_client = openai.OpenAI(
    api_key=PARATERA_API_KEY,
    base_url="https://llmapi.paratera.com/v1/"
)

def load_cache() -> dict:
    """Load local cache."""
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(cache: dict):
    """Save cache to local file."""
    if "/" in CACHE_FILE:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def serper_search(query: str, api_key: str, top_k: int = 5):
    """
    Search Google using Serper.dev.
    Returns a list of: [{'title': ..., 'url': ..., 'snippet': ...}, ...]
    """
    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    payload = {"q": query}

    print(f"🌐 Searching Google (via Serper) for: '{query}'")
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        if not response.ok:
            raise RuntimeError(
                f"Serper API failed: {response.status_code} - {response.text[:200]}"
            )

        data = response.json()
        organic = data.get("organic", [])
        if not organic:
            print("⚠️ No organic search results found.")
            return []

        results = []
        for item in organic[:top_k]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            })

        print(f"✅ Got {len(results)} search results.")
        return results

    except Exception as e:
        print(f"[ERROR] serper_search failed: {e}")
        return []


def fetch_page_content(url: str, jina_api_key: str = None) -> str:
    """Fetch main text content from a web page using ONLY Jina (Markdown extraction)."""
    try:
        headers = {
            "Authorization": f"Bearer {jina_api_key}",
            "X-Return-Format": "markdown",
        }
        resp = requests.get(f"https://r.jina.ai/{url}", headers=headers, timeout=30)

        if resp.status_code == 200:
            # Clean Markdown URL artifacts
            text = re.sub(r"\(https?:.*?\)|\[https?:.*?\]", "", resp.text)
            return text.strip()
        else:
            return f"[Error] Jina error {resp.status_code}: {resp.text[:200]}"

    except Exception as e:
        return f"[Error] Failed fetching {url}: {e}"


def fetch_multiple_pages(urls, jina_api_key=None, max_workers=8):
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {
            executor.submit(fetch_page_content, url, jina_api_key): url
            for url in urls
        }
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                results[url] = future.result()
            except Exception as exc:
                results[url] = f"[Error] {exc}"
    return results


def search_and_fetch(query: str, top_k: int = 5):
    """Search + crawl web pages with caching."""
    cache = load_cache()

    if query in cache and len(cache[query]) >= top_k:
        print(f"📦 Using cached results for '{query}' ({len(cache[query])} results)")
        return cache[query][:top_k]

    # Call Serper
    search_results = serper_search(query, SERPER_API_KEY, top_k)
    urls = [item["url"] for item in search_results if item["url"]]

    print(f"🕸️ Fetching {len(urls)} pages...")
    page_texts = fetch_multiple_pages(urls, jina_api_key=JINA_API_KEY, max_workers=5)

    # Combine results
    output = []
    for item in search_results:
        url = item["url"]
        output.append({
            "title": item["title"],
            "url": url,
            "snippet": item["snippet"],
            "content": page_texts.get(url, "")
        })

    # Save cache
    cache[query] = output
    save_cache(cache)
    print(f"💾 Cached {len(output)} results for '{query}'")

    return output


def summarize_pages(pages, model="DeepSeek-V3.1-Terminus"):
    """
    Summarize multiple web pages (fetched via Jina) using DeepSeek.
    """
    combined_texts = []
    for i, item in enumerate(pages, 1):
        content = item.get("content", "")
        if not content or content.startswith("[Error]"):
            continue
        combined_texts.append(
            f"### Page {i}: {item.get('title', '')}\n{content[:10000]}"
        )

    if not combined_texts:
        return "[Error] No valid page content to summarize."

    prompt = (
        "你将看到若干来自互联网的网页内容，这些网页是围绕同一主题抓取的。\n"
        "请基于所有网页内容进行【综合性总结】，要求：\n"
        "1. 融合所有网页的信息，而不是逐条复述；\n"
        "2. 去除重复内容，保留关键信息；\n"
        "3. 保持客观、中立、以事实为主；\n"
        "4. 用清晰、连贯的自然语言表述。\n"
        "5. 直接给出总结内容，不要说明过程。\n\n"
        "以下是网页内容：\n\n"
        + "\n\n".join(combined_texts)
    )

    print("🧠 Summarizing pages with DeepSeek...")
    response = deepseek_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "user", "content": prompt}
        ],
    )

    return response.choices[0].message.content



def clean_cache():
    """Clean cache by removing entries whose content begins with '[Error]'."""
    cache = load_cache()
    changed = False

    for query, results in list(cache.items()):
        if not isinstance(results, list):
            continue

        cleaned_results = [
            item for item in results
            if not (isinstance(item, dict) and str(item.get("content", "")).startswith("[Error]"))
        ]

        if len(cleaned_results) != len(results):
            cache[query] = cleaned_results
            changed = True

    if changed:
        save_cache(cache)
        print("Cache cleaned and saved.")
    else:
        print("Cache is already clean. Nothing to remove.")



if __name__ == "__main__":

    
    query = "中国人民大学"
    top_k = 5

    # clean_cache()

    results = search_and_fetch(query, top_k)

    summary = summarize_pages(results)

    print(summary)
