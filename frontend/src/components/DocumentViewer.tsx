import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Tag, message, Statistic, Card, Row, Col, Spin, Empty, Typography } from 'antd';
import { EditOutlined, LoadingOutlined, FileTextOutlined } from '@ant-design/icons';
import * as docx from 'docx-preview';

import { CorrectionItem } from '../types';
import { DomainInfo } from '../api';

const { Sider, Content } = Layout;
const { Text } = Typography;

interface DocumentViewerProps {
  documentId: string;
  paragraphs: string[];
  corrections: CorrectionItem[];
  analyzing?: boolean;
  analyzeDone?: boolean;
  domainInfo?: DomainInfo | null;
  analyzedCount?: number;
  totalToAnalyze?: number;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({
  documentId,
  paragraphs,
  corrections,
  analyzing = false,
  analyzeDone = false,
  domainInfo = null,
  analyzedCount = 0,
  totalToAnalyze = 0,
}) => {
  const [localParagraphs] = useState(paragraphs);
  const [localCorrections, setLocalCorrections] = useState<CorrectionItem[]>(corrections);
  const [docLoading, setDocLoading] = useState(true);
  const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalCorrections(corrections);
  }, [corrections]);

  useEffect(() => {
    if (listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [localCorrections.length]);

  // 加载 Word 文档
  useEffect(() => {
    const loadDocument = async () => {
      setDocLoading(true);
      try {
        const response = await fetch(`/api/document/${documentId}/preview`);
        const blob = await response.blob();

        if (docRef.current) {
          docRef.current.innerHTML = '';
          await docx.renderAsync(blob, docRef.current, undefined, {
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
          });
        }
      } catch (error) {
        console.error('Load document preview failed:', error);
      } finally {
        setDocLoading(false);
      }
    };

    loadDocument();
  }, [documentId]);

  // 归一化文本：去除多余空白，便于比较
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

  // 高亮并滚动到目标元素
  const highlightElement = useCallback((el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    el.style.transition = 'all 0.3s';
    el.style.backgroundColor = '#fff3cd';
    el.style.outline = '3px solid #ffc107';
    el.style.borderRadius = '4px';
    el.style.boxShadow = '0 0 10px rgba(255, 193, 7, 0.5)';

    setTimeout(() => {
      el.style.backgroundColor = '';
      el.style.outline = '';
      el.style.boxShadow = '';
    }, 3000);
  }, []);

  // 通过段落完整文本匹配渲染后的段落元素（严格匹配，避免跳到相似段落）
  const findParagraphElement = useCallback((paragraphText: string): HTMLElement | null => {
    if (!docRef.current) return null;

    const target = normalize(paragraphText);
    if (!target || target.length < 3) return null;

    // docx-preview 将每个段落渲染为 <p>
    const candidates = Array.from(docRef.current.querySelectorAll('p')) as HTMLElement[];

    // 1) 整段文本完全相等（最可靠）
    const exact = candidates.filter((el) => normalize(el.textContent || '') === target);
    if (exact.length >= 1) return exact[0];

    // 2) 唯一的整段包含匹配：段落文本必须足够长且具备区分度，
    //    并且候选中有且仅有一个匹配，才认为定位可靠；出现歧义则不跳转
    if (target.length >= 12) {
      const contains = candidates.filter((el) => {
        const t = normalize(el.textContent || '');
        if (t.length < 12) return false;
        return t.includes(target) || target.includes(t);
      });
      if (contains.length === 1) return contains[0];
    }

    return null;
  }, []);

  // 点击卡片跳转
  const handleCardClick = useCallback((correction: CorrectionItem, index: number) => {
    setActiveCardIndex(index);

    // 仅用该段完整原文精确定位，匹配不到宁可不跳转，避免定位到错误的相似位置
    const paragraphText = localParagraphs[correction.paragraph_index] || '';
    const el = findParagraphElement(paragraphText);

    if (el) {
      highlightElement(el);
    } else {
      message.warning('未能在文档中精确定位该段落，请手动查看');
    }
  }, [localParagraphs, findParagraphElement, highlightElement]);

  return (
    <Layout style={{ background: '#fff', borderRadius: 8 }}>
      <Sider
        width={450}
        style={{
          background: '#fafafa',
          padding: 16,
          borderRight: '1px solid #e8e8e8',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 200px)',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <Row gutter={12}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="总段落" value={localParagraphs.length} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="已分析"
                  value={analyzedCount}
                  suffix={totalToAnalyze > 0 ? `/ ${totalToAnalyze}` : undefined}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="已发现建议"
                  value={localCorrections.length}
                  valueStyle={{ color: localCorrections.length > 0 ? '#ff4d4f' : '#52c41a' }}
                />
              </Card>
            </Col>
          </Row>
        </div>

        <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <EditOutlined /> 校对建议列表
          {analyzing && (
            <Tag color="processing" icon={<LoadingOutlined />}>
              分析中...
            </Tag>
          )}
          {analyzeDone && (
            <Tag color="success">分析完成</Tag>
          )}
        </h3>

        {/* 领域识别结果 */}
        {domainInfo && (
          <Card
            size="small"
            style={{ marginBottom: 12, background: '#f0f7ff', borderColor: '#91caff' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Tag color="geekblue" style={{ margin: 0 }}>识别领域</Tag>
              <Text strong style={{ fontSize: 13 }}>{domainInfo.domain}</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {domainInfo.description}
            </Text>
          </Card>
        )}

        {localCorrections.length === 0 && !analyzing ? (
          <Empty description="暂无校对建议" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {localCorrections.map((correction, index) => (
              <Card
                key={`${correction.paragraph_index}-${correction.wrong_word}-${index}`}
                size="small"
                hoverable
                onClick={() => handleCardClick(correction, index)}
                style={{
                  cursor: 'pointer',
                  borderLeft: '3px solid #ff4d4f',
                  backgroundColor: activeCardIndex === index ? '#e6f7ff' : '#fff',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag color="blue" icon={<FileTextOutlined />} style={{ margin: 0 }}>
                      段落 {correction.paragraph_index + 1}
                    </Tag>
                  </div>
                </div>

                <div style={{ marginBottom: 8, padding: '8px', background: '#f9f9f9', borderRadius: 4 }}>
                  <Text delete style={{ color: '#ff4d4f', fontSize: 14, marginRight: 8 }}>
                    {correction.wrong_word}
                  </Text>
                  <span style={{ margin: '0 6px', color: '#999' }}>→</span>
                  <Text strong style={{ color: '#52c41a', fontSize: 14 }}>
                    {correction.suggestion}
                  </Text>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: '#666', fontSize: 12, fontWeight: 500 }}>理由：</span>
                  <Text type="secondary" style={{ fontSize: 12, lineHeight: '18px' }}>
                    {correction.reason}
                  </Text>
                </div>

                <div style={{ marginTop: 8, textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    ↗ 点击跳转到文档对应位置
                  </Text>
                </div>
              </Card>
            ))}
            <div ref={listEndRef} />
          </div>
        )}
      </Sider>

      <Content style={{ padding: 24, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
        <h3 style={{ marginBottom: 16 }}>文档内容预览（原生 Word 渲染）</h3>

        {docLoading ? (
          <div style={{ textAlign: 'center', padding: '100px 0' }}>
            <Spin size="large" tip="正在加载文档预览..." />
          </div>
        ) : (
          <div
            ref={docRef}
            style={{
              border: '1px solid #e8e8e8',
              borderRadius: 4,
              padding: 16,
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }}
          />
        )}
      </Content>
    </Layout>
  );
};

export default DocumentViewer;
