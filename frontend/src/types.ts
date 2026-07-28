export interface CorrectionItem {
  paragraph_index: number;
  sentence_index: number;
  original_text: string;
  wrong_word: string;
  suggestion: string;
  reason: string;
  start_pos: number;
  end_pos: number;
}

export interface DocumentAnalysisResponse {
  document_id: string;
  paragraphs: string[];
  corrections: CorrectionItem[];
}
