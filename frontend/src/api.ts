import { DocumentAnalysisResponse } from './types';

const API_BASE_URL = '/api';

export async function uploadDocument(file: File): Promise<DocumentAnalysisResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('上传失败');
  }

  return response.json();
}

export async function getCorrections(documentId: string): Promise<DocumentAnalysisResponse> {
  const response = await fetch(`${API_BASE_URL}/document/${documentId}/corrections`);
  if (!response.ok) {
    throw new Error('获取校对结果失败');
  }
  return response.json();
}

/**
 * 领域识别结果
 */
export interface DomainInfo {
  domain: string;
  description: string;
  keywords: string[];
  proofreading_tips: string[];
}

/**
 * 流式分析文档
 */
export function analyzeDocumentStream(
  documentId: string,
  onCorrection: (correction: any) => void,
  onDomainFound: (domain: DomainInfo) => void,
  onDone: (total: number) => void,
  onError?: (error: Error) => void,
  onProgress?: (analyzed: number, total: number) => void
) {
  const eventSource = new EventSource(`${API_BASE_URL}/document/${documentId}/analyze`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'domain') {
        // 领域识别事件
        onDomainFound(data.data);
      } else if (data.type === 'error') {
        // LLM 调用失败事件
        eventSource.close();
        if (onError) onError(new Error(data.message || 'LLM 调用失败'));
      } else if (data.type === 'progress') {
        // 分析进度事件
        if (onProgress) onProgress(data.analyzed, data.total);
      } else if (data.done) {
        // 完成事件
        onDone(data.total);
        eventSource.close();
      } else if (data.paragraph_index !== undefined) {
        // 真正的校对建议（有 paragraph_index 字段）
        onCorrection(data);
      }
      // 其他忽略
    } catch (e) {
      // ignore parse errors
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    if (onError) onError(new Error('分析连接出错'));
  };

  return () => eventSource.close();
}

export async function applyCorrection(
  documentId: string,
  paragraphIndex: number,
  correctionIndex: number
): Promise<{ modified: string; remaining_corrections: number }> {
  const response = await fetch(`${API_BASE_URL}/document/${documentId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paragraph_index: paragraphIndex,
      correction_index: correctionIndex,
    }),
  });

  if (!response.ok) {
    throw new Error('应用修改失败');
  }

  return response.json();
}

export function downloadDocument(documentId: string) {
  window.open(`${API_BASE_URL}/document/${documentId}/download`);
}
