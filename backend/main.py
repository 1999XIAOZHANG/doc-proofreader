import os
import uuid
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# 先加载 .env，并在导入 llm_checker（会实例化 LLM 客户端）之前配置好代理
load_dotenv()

# 从 .env 读取代理配置，未配置则保持为空（直连）
_http_proxy = os.getenv("HTTP_PROXY") or os.getenv("http_proxy") or ""
_https_proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy") or ""
if _http_proxy:
    os.environ["HTTP_PROXY"] = _http_proxy
    os.environ["http_proxy"] = _http_proxy
if _https_proxy:
    os.environ["HTTPS_PROXY"] = _https_proxy
    os.environ["https_proxy"] = _https_proxy
if _http_proxy or _https_proxy:
    print(f"已启用代理: HTTP={_http_proxy or '(未设置)'} HTTPS={_https_proxy or '(未设置)'}")

from schemas import DocumentAnalysisResponse, CorrectionItem, ApplyCorrectionRequest
from document_store import doc_store
from llm_checker import llm_checker

app = FastAPI(title="Document Checker API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def find_available_port(start_port: int = 8000, max_tries: int = 100) -> int:
    """自动查找可用端口"""
    import socket
    for port in range(start_port, start_port + max_tries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("0.0.0.0", port))
                return port
        except OSError:
            continue
    return start_port


def kill_port(port: int):
    """杀掉占用指定端口的进程（Windows）"""
    import subprocess
    try:
        result = subprocess.run(
            f'netstat -ano | findstr :{port}',
            shell=True, capture_output=True, text=True
        )
        pids = set()
        for line in result.stdout.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 5 and (f":{port}" in parts[1]):
                pids.add(parts[-1])
        for pid in pids:
            if pid and pid != "0":
                subprocess.run(f'taskkill /F /PID {pid}', shell=True,
                               capture_output=True)
                print(f"已清理占用端口 {port} 的进程 PID={pid}")
    except Exception as e:
        print(f"清理端口失败: {e}")


@app.post("/api/upload", response_model=DocumentAnalysisResponse, summary="上传文档")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith('.docx'):
        raise HTTPException(status_code=400, detail="仅支持 .docx 文件")

    content = await file.read()
    document_id = str(uuid.uuid4())[:8]

    doc_store.save_document(document_id, file.filename, content)
    paragraphs = doc_store.get_paragraphs(document_id)
    doc_store.save_corrections(document_id, [])

    return DocumentAnalysisResponse(
        document_id=document_id,
        paragraphs=paragraphs,
        corrections=[]
    )


@app.get("/api/document/{document_id}/analyze", summary="流式分析")
def analyze_stream(document_id: str):
    import json

    paragraphs = doc_store.get_paragraphs(document_id)
    all_corrections = []

    def generate():
        # 先做领域识别（非流式）
        full_text = " ".join([p for p in paragraphs if p.strip()])
        try:
            domain_info = llm_checker.analyze_domain(full_text)
        except Exception as e:
            # LLM 连接/调用失败，明确通知前端，不再降级为 general
            yield f"data: {json.dumps({'type': 'error', 'message': f'LLM 调用失败：{e}'}, ensure_ascii=False)}\n\n"
            return
        # 把领域信息发给前端
        yield f"data: {json.dumps({'type': 'domain', 'data': domain_info}, ensure_ascii=False)}\n\n"

        # 计算实际需要分析的段落总数（用于前端进度展示）
        target_paragraphs = paragraphs[:15]
        total_to_analyze = sum(
            1 for p in target_paragraphs if p.strip() and len(p) >= 10
        )
        # 先把总数告知前端
        yield f"data: {json.dumps({'type': 'progress', 'analyzed': 0, 'total': total_to_analyze}, ensure_ascii=False)}\n\n"

        # 逐段校对
        analyzed = 0
        for idx, paragraph in enumerate(target_paragraphs):
            if not paragraph.strip() or len(paragraph) < 10:
                continue

            corrections = llm_checker.check_paragraph(idx, paragraph, domain_info)
            for c in corrections:
                all_corrections.append(c.model_dump())
                yield f"data: {json.dumps(c.model_dump(), ensure_ascii=False)}\n\n"

            doc_store.save_corrections(document_id, all_corrections)

            # 该段分析完成（无论是否发现问题），推送进度
            analyzed += 1
            yield f"data: {json.dumps({'type': 'progress', 'analyzed': analyzed, 'total': total_to_analyze}, ensure_ascii=False)}\n\n"

        yield f"data: {json.dumps({'done': True, 'total': len(all_corrections)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/document/{document_id}/corrections", summary="获取校对结果")
def get_corrections(document_id: str):
    corrections = doc_store.get_corrections(document_id)
    paragraphs = doc_store.get_paragraphs(document_id)
    items = [CorrectionItem(**c) for c in corrections]
    return DocumentAnalysisResponse(
        document_id=document_id,
        paragraphs=paragraphs,
        corrections=items
    )


@app.get("/api/document/{document_id}/preview", summary="预览文档")
def preview_document(document_id: str):
    file_path = doc_store.get_file_path(document_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="文档不存在")

    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@app.post("/api/document/{document_id}/apply", summary="应用修改")
def apply_correction(document_id: str, request: ApplyCorrectionRequest):
    corrections = doc_store.get_corrections(document_id)
    paragraphs = doc_store.get_paragraphs(document_id)

    if request.paragraph_index >= len(paragraphs):
        raise HTTPException(status_code=400, detail="段落索引无效")

    if request.correction_index >= len(corrections):
        raise HTTPException(status_code=400, detail="校对项索引无效")

    correction = corrections[request.correction_index]
    paragraph = paragraphs[request.paragraph_index]

    wrong_word = correction.get("wrong_word", "")
    suggestion = correction.get("suggestion", "")

    modified = paragraph.replace(wrong_word, suggestion, 1)
    paragraphs[request.paragraph_index] = modified
    doc_store.save_paragraphs(document_id, paragraphs)
    corrections.pop(request.correction_index)
    doc_store.save_corrections(document_id, corrections)

    return {"modified": modified, "remaining_corrections": len(corrections)}


@app.get("/api/document/{document_id}/download", summary="下载修改后的文档")
def download_document(document_id: str):
    file_path = doc_store.get_file_path(document_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="文档不存在")

    output_path = f"uploads/{document_id}_modified.docx"
    doc_store.save_modified_document(document_id, output_path)

    return FileResponse(
        output_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"fixed_{document_id}.docx"
    )


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    PORT = 6545
    # 启动前清理占用端口的旧进程，保证前端代理始终指向 6545
    kill_port(PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
