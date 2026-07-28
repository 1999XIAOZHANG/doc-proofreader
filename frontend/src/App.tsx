import React, { useState, useRef } from 'react';
import { Layout, Button, Upload, message } from 'antd';
import { UploadOutlined, FileSearchOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';

import { uploadDocument, analyzeDocumentStream, DomainInfo } from './api';
import { DocumentAnalysisResponse, CorrectionItem } from './types';
import DocumentViewer from './components/DocumentViewer';

const { Header, Content } = Layout;

const App: React.FC = () => {
  const [documentData, setDocumentData] = useState<DocumentAnalysisResponse | null>(null);
  const [corrections, setCorrections] = useState<CorrectionItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeDone, setAnalyzeDone] = useState(false);
  const [domainInfo, setDomainInfo] = useState<DomainInfo | null>(null);
  const [progress, setProgress] = useState<{ analyzed: number; total: number }>({ analyzed: 0, total: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleUpload: UploadProps['customRequest'] = async (options) => {
    const { file } = options;
    if (!file) return;

    // 重新上传时，先停止当前文档正在进行的分析流
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    setUploading(true);
    setAnalyzing(false);
    setAnalyzeDone(false);
    setCorrections([]);
    setDomainInfo(null);
    setProgress({ analyzed: 0, total: 0 });

    try {
      const result = await uploadDocument(file as File);
      setDocumentData(result);

      setAnalyzing(true);
      cleanupRef.current = analyzeDocumentStream(
        result.document_id,
        (correction: CorrectionItem) => {
          setCorrections((prev) => [...prev, correction]);
        },
        (domain: DomainInfo) => {
          setDomainInfo(domain);
          message.info(`已识别文档领域：${domain.domain}`);
        },
        (total) => {
          setAnalyzing(false);
          setAnalyzeDone(true);
          if (total > 0) {
            message.success(`分析完成！共发现 ${total} 处建议`);
          } else {
            message.info('分析完成！文档没有发现问题');
          }
        },
        (error) => {
          setAnalyzing(false);
          message.error('分析出错: ' + error.message);
        },
        (analyzed, total) => {
          setProgress({ analyzed, total });
        }
      );
    } catch (error) {
      message.error('文档上传失败');
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '20px' }}>
            <FileSearchOutlined style={{ marginRight: 8 }} />
            English Document Proofreader
          </h1>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Upload
              accept=".docx"
              showUploadList={false}
              customRequest={handleUpload}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                Upload Document
              </Button>
            </Upload>
          </div>
        </div>
      </Header>

      <Layout>
        <Content style={{ padding: '24px' }}>
          {!documentData ? (
            <div style={{ textAlign: 'center', padding: '100px 0', background: '#fff', borderRadius: 8 }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
              <h2>Upload Word Document to Start Proofreading</h2>
              <p style={{ color: '#666' }}>
                AI will check for spelling errors, grammar issues, and word usage
              </p>
              <Upload
                accept=".docx"
                showUploadList={false}
                customRequest={handleUpload}
                style={{ marginTop: '24px' }}
              >
                <Button type="primary" size="large" icon={<UploadOutlined />} loading={uploading}>
                  Select .docx File
                </Button>
              </Upload>
            </div>
          ) : (
            <DocumentViewer
              documentId={documentData.document_id}
              paragraphs={documentData.paragraphs}
              corrections={corrections}
              analyzing={analyzing}
              analyzeDone={analyzeDone}
              domainInfo={domainInfo}
              analyzedCount={progress.analyzed}
              totalToAnalyze={progress.total}
            />
          )}
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;
