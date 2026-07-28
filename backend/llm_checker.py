import os
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from typing import List
from dotenv import load_dotenv

load_dotenv()


class CorrectionItem(BaseModel):
    paragraph_index: int = Field(description="段落索引")
    wrong_word: str = Field(description="有问题的原文片段")
    suggestion: str = Field(description="建议修改为")
    reason: str = Field(description="修改理由（用中文说明）")


class LLMChecker:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=os.getenv("LLM_MODEL", "gpt-3.5-turbo"),
            temperature=0.3,
            max_tokens=2048,
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            openai_api_base=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            default_headers={
                "HTTP-Referer": "https://document-checker.app",
                "X-Title": "Document Checker",
            },
        )

        # 领域识别 Prompt
        self.domain_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a document classification expert. Analyze the given text and determine:

1. What is the document type/domain? (e.g., academic paper, technical report, chemistry, biology, engineering, business, legal, etc.)
2. What are the key terminology characteristics of this field?
3. What should a proofreader pay special attention to for this type of document?

Return a JSON object with these fields:
{{
  "domain": "领域名称",
  "description": "这个领域的文档特点",
  "keywords": ["关键术语1", "关键术语2", "..."],
  "proofreading_tips": ["注意事项1", "注意事项2", "..."]
}}

Only return the JSON, no other text."""),
            ("user", "{text}")
        ])

        # 校对 Prompt 模板（接受领域参数）
        self.proofread_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert {domain} document proofreader.

Document domain context:
- Description: {description}
- Key terms: {keywords}
- Special attention: {proofreading_tips}

Your task: Check the English paragraph for these issues ONLY:
1. **Spelling errors** - Real misspelled words
2. **Grammar errors** - Subject-verb agreement, tense, articles, prepositions
3. **Wrong word usage** - Incorrect word choice that changes meaning
4. **Awkward phrasing** - Unnatural expressions in {domain} writing

IMPORTANT RULES - Do NOT flag:
- Single characters, numbers, or short symbols
- Minor formatting issues (spaces, tabs, punctuation style)
- Correct content even if it looks unusual
- Page numbers, figure numbers, or labels
- Chemical formulas or technical abbreviations
- Content that is correct but could be written differently (subjective)

For each issue found, provide:
- wrong_word: the exact problematic text
- suggestion: the corrected version
- reason: brief explanation in Chinese (1-2 sentences)

Return a JSON array:
[
  {{"wrong_word": "...", "suggestion": "...", "reason": "..."}},
  ...
]

Return empty array [] if no issues found. Only return the JSON."""),
            ("user", "Paragraph {paragraph_index}:\n{text}")
        ])

    def analyze_domain(self, text: str) -> dict:
        """分析文档领域"""
        try:
            print("\n" + "="*60)
            print("【步骤1】开始领域识别分析...")
            print(f"输入文本长度: {len(text)} 字符")

            chain = self.domain_prompt | self.llm
            response = chain.invoke({"text": text[:1000]})

            content = response.content.strip()
            print(f"\nLLM 领域分析返回:\n{content[:400]}")

            import json

            # 处理 JSON 解析
            if content.startswith("```"):
                parts = content.split("```")
                if len(parts) >= 2:
                    content = parts[1]
                    if content.startswith("json"):
                        content = content[4:]
                    elif content.startswith("\\njson"):
                        content = content[5:]

            content = content.strip()

            try:
                result = json.loads(content)
            except json.JSONDecodeError:
                # 尝试提取 JSON 对象
                start = content.find('{')
                end = content.rfind('}')
                if start >= 0 and end >= 0:
                    content = content[start:end+1]
                    result = json.loads(content)
                else:
                    raise

            print(f"\n✅ 识别成功!")
            print(f"  领域: {result.get('domain', 'Unknown')}")
            print(f"  描述: {result.get('description', '')[:80]}...")
            print(f"  关键词: {result.get('keywords', [])[:5]}")
            print("="*60)
            return result

        except Exception as e:
            print(f"❌ 领域识别失败: {e}")
            # 不再静默降级为 general，直接抛出，让上层返回明确的失败信息
            raise RuntimeError(f"LLM 服务调用失败: {e}") from e

    def check_paragraph(self, paragraph_index: int, text: str, domain_info: dict = None) -> List[CorrectionItem]:
        """检查单个段落（接受领域信息）"""
        if not domain_info:
            domain_info = {
                "domain": "general",
                "description": "通用英文文档",
                "keywords": [],
                "proofreading_tips": []
            }

        try:
            print(f"\n=== 开始校对段落 {paragraph_index} (领域: {domain_info['domain']}) ===")
            print(f"段落内容: {text[:100]}{'...' if len(text) > 100 else ''}")

            chain = self.proofread_prompt | self.llm
            response = chain.invoke({
                "paragraph_index": paragraph_index,
                "text": text,
                "domain": domain_info.get("domain", "general"),
                "description": domain_info.get("description", ""),
                "keywords": ", ".join(domain_info.get("keywords", [])),
                "proofreading_tips": "; ".join(domain_info.get("proofreading_tips", []))
            })

            content = response.content.strip()
            print(f"\nLLM 返回内容长度: {len(content)}")
            print(f"LLM 返回内容首行: {repr(content[:200])}")

            if not content:
                print(f"LLM段落{paragraph_index}返回空内容，跳过")
                return []

            import json
            # 尝试提取 JSON
            if content.startswith("```"):
                print("检测到 markdown code block，提取内容")
                parts = content.split("```")
                if len(parts) >= 2:
                    content = parts[1]
                    if content.startswith("json"):
                        content = content[4:]
                    elif content.startswith("\\njson"):
                        content = content[5:]
                print(f"提取后内容长度: {len(content)}")

            # 去除前后空白
            content = content.strip()
            print(f"处理后内容: {repr(content[:300])}")

            # 尝试解析
            try:
                items = json.loads(content)
                print(f"JSON解析成功，共 {len(items)} 条")
            except json.JSONDecodeError as e:
                print(f"JSON解析失败: {e}")
                # 尝试找第一个 [ 和最后一个 ]
                start = content.find('[')
                end = content.rfind(']')
                if start >= 0 and end >= 0:
                    print(f"提取 [ 到 ] 之间: start={start}, end={end}")
                    content = content[start:end+1]
                    print(f"提取后: {repr(content[:200])}")
                    items = json.loads(content)
                else:
                    print(f"LLM段落{paragraph_index}无法解析JSON，跳过")
                    return []

            if not isinstance(items, list):
                print(f"结果不是数组，跳过")
                return []

            corrections = []
            for item in items:
                if isinstance(item, dict) and "wrong_word" in item and "suggestion" in item:
                    wrong = str(item["wrong_word"])
                    # 过滤掉单个字符或太短的内容
                    if len(wrong.strip()) <= 2:
                        print(f"跳过太短: {wrong} (长度 {len(wrong.strip())})")
                        continue
                    # 过滤掉纯数字
                    if wrong.strip().isdigit():
                        print(f"跳过纯数字: {wrong}")
                        continue
                    corrections.append(CorrectionItem(
                        paragraph_index=paragraph_index,
                        wrong_word=wrong,
                        suggestion=str(item["suggestion"]),
                        reason=str(item.get("reason", "需要修改"))
                    ))
                    print(f"添加建议: {wrong} → {item['suggestion']}")
                else:
                    print(f"跳过无效item: {item}")

            print(f"\n段落 {paragraph_index} 完成，共 {len(corrections)} 条建议")
            print("=" * 50)
            return corrections

        except Exception as e:
            import traceback
            print(f"LLM校对段落{paragraph_index}异常: {e}")
            print(traceback.format_exc())
            return []

    def check_document(self, paragraphs: List[str]) -> List[CorrectionItem]:
        """检查整个文档"""
        all_corrections = []

        # 步骤1: 拼接前 1000 字符做领域识别
        full_text = " ".join([p for p in paragraphs if p.strip()])
        domain_info = self.analyze_domain(full_text)

        # 步骤2: 用领域专家身份逐段校对
        for idx, paragraph in enumerate(paragraphs[:15]):
            if not paragraph.strip() or len(paragraph) < 10:
                continue
            corrections = self.check_paragraph(idx, paragraph, domain_info)
            all_corrections.extend(corrections)

        return all_corrections


llm_checker = LLMChecker()
