import requests
import json
from urllib.parse import urlencode
import langid
import json

from dotenv import load_dotenv
import os
import time

load_dotenv()
BING_API_KEY = os.getenv("BING_API_KEY")
if not BING_API_KEY:
    raise RuntimeError("Missing BING_API_KEY in .env")

def make_search_request(query, api_key=BING_API_KEY, zone="zmf_serp_test"):
    """
    通过BrightData API获取搜索结果。

    参数：
    - query: 搜索查询字符串，可以是中文。
    - api_key: BrightData API密钥。
    - zone: 使用的BrightData API区域，默认为"serp_api1"。

    返回：
    - API响应的文本内容。
    """
    # 对查询字符串进行URL编码
    if langid.classify(query)[0] == "zh":
        mkt, setLang = "zh-CN", "zh"
    else:
        mkt, setLang = "en-US", "en"
    # mkt, setLang = "zh-CN", "zh"
    input_obj = {
        "q": query,  # 设置查询内容
        "mkt": mkt,  # 设置市场
        "setLang": setLang,  # 设置语言
        "num": 10,  # 使用配置的搜索结果数量
        "textDecorations": True,  # 启用文本装饰
        "textFormat": "HTML",  # 设置文本格式
    }
    encoded_query = urlencode(input_obj)

    # 构造目标URL
    url = f"https://www.bing.com/search?{encoded_query}&brd_json=1&cc=cn"

    # BrightData API请求参数和头部
    api_url = "https://api.brightdata.com/request"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    req_payload = {
        "zone": zone,
        "url": url,
        "format": "raw"
    }

    # 重试逻辑：若返回的 general.language 为 en-US，则认为失败，最多重试4次
    attempts = 4
    data = None
    for _ in range(attempts):
        response = requests.post(api_url, headers=headers, data=json.dumps(req_payload))
        if response.status_code != 200:
            continue
        json_data = response.text
        try:
            response_data = json.loads(json_data)
        except Exception as e:
            response_data = None
            print(e)
            print(query)
            print(response)
        if response_data is not None:
            data = response_data
            break
        else:
            continue

    if data is None:
        return data

    # Format results as a list of dicts with keys: title, text, rank
    results = []
    for idx, item in enumerate(data.get('organic', [])[:10], start=1):
        results.append({
            "title": item.get("title", ""),
            "text": item.get("description", ""),  # rename description -> text
            "rank": idx,
        })

    return results


def agentic_search(query: str, question: str, previous_reasoning: str, refine_model):
    """
    流式检索 + 精炼。逐 token yield。
    """
    Integrate_PROMPT = r"""你是一名高级推理代理。面对一道【高考题】（可能含图）、【先前推理】、【当前检索查询】与【检索文档】，请完成：
1) 读懂先前推理与当前查询，明确本轮需要补充的关键信息点（定义/定理/性质/背景事实/时间地点等）。
2) 阅读检索文档，只提取与当前查询**直接相关**的内容，忽略无关信息与冗余叙述。
3) 将提取内容**用自然中文重述并融入推理链**，**不得逐字引用或粘贴**原句。可使用“据外部资料”“检索结果显示”“常识可知”“资料表明”等表达，将信息作为已知依据呈现。
4) 不得引入文档未支持的新结论；若资料存在冲突，点明冲突并优先采用更权威/贴近教材的说法。

输出要求（这是对查询的“知识补全”，而非题目的最终数值/结论）：
- 只回答**当前检索查询**所需的信息，语言简洁，1–4 句为宜。
- 数学题用 LaTeX 书写公式/符号（如 \sqrt、\angle、\dfrac），变量名与题干一致；除非查询本身要求计算，否则不进行数值运算。
- 历史/地理/政治题保留关键时间与专有名词；必要时给出标准定义或分类。
- 需要列举要点时，用分号分隔的短句；避免重复题干内容。

示例：
问题：
求 x 使给定四边形成为平行四边形。

先前推理：
需要利用平行四边形的判定性质，把左右两边长度建立方程。

当前检索查询：
平行四边形的判定性质

检索文档：
文段 1：
简单四边形成为平行四边形当且仅当满足任一条件：两组对边分别平行；两组对边分别相等；两组对角分别相等；对角线互相平分；一组对边既平行又相等；相邻角互补。

输出：
据检索结果显示，平行四边形可用“对角线互相平分”或“两组对边分别相等”等性质判定；本题可直接采用“两组对边分别相等”建立方程。

—— 现在根据以下输入完成同样的任务 ——
问题：
{question}

先前推理：
{previous_reasoning}

当前检索查询：
{calling}

检索文档：
{raw_result}

输出：
"""
    print(f"Executing search for query: {query}")
    start_time = time.time()
    results = make_search_request(query)
    elapsed = time.time() - start_time
    print(f"Search took {elapsed:.2f}s")

    if not results:
        yield "没有检索到有效信息。"
        return

    raw_result = "\n".join([
        f"检索结果 {i+1}: {x['text']}" for i, x in enumerate(results)
    ])
    text_content = Integrate_PROMPT.format(
        question=question,
        previous_reasoning=previous_reasoning,
        calling=query,
        raw_result=raw_result
    )
    messages = [{"role": "user", "content": [{"type": "text", "text": text_content}]}]

    yield "<result>"
    for delta in refine_model.stream_generate(messages):
        yield delta
    yield "</result>"

