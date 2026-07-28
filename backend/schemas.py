from pydantic import BaseModel, Field
from typing import List, Optional


class CorrectionItem(BaseModel):
    paragraph_index: int = Field(..., description="段落索引")
    wrong_word: str = Field(..., description="错误的词汇")
    suggestion: str = Field(..., description="建议修改的词汇")
    reason: str = Field(..., description="修改原因")


class ApplyCorrectionRequest(BaseModel):
    paragraph_index: int = Field(..., description="段落索引")
    correction_index: int = Field(..., description="校对项索引")


class DocumentAnalysisResponse(BaseModel):
    document_id: str
    paragraphs: List[str]
    corrections: List[CorrectionItem]
