import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Download, AlertCircle, Loader2, Send, Plus, Clock, ChevronRight, Sparkles, X, CheckCircle, TrendingUp } from 'lucide-react';

const App = () => {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [progress, setProgress] = useState(0);
  
  const [selectedTemplate, setSelectedTemplate] = useState('template_1');
  const [templates, setTemplates] = useState({});

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

useEffect(() => {
  loadSessions();
  loadTemplates();
}, []);

  const loadSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/history`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  const loadTemplates = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/templates`);
    const data = await res.json();
    setTemplates(data.templates || {});
  } catch (e) {
    console.error('Failed to load templates:', e);
  }
};

  const createNewSession = () => {
    const sid = `session_${Date.now()}`;
    setCurrentSessionId(sid);
    setMessages([{
      role: 'assistant',
      content: '👋 Welcome! I\'m **Velocity.ai**, your intelligent PDF extraction assistant.\n\n**I can help you:**\n• Extract fund information from PE documents\n• Analyze performance metrics (DPI, RVPI, TVPI, IRR)\n• Identify portfolio companies\n• Generate structured Excel reports\n\n**Upload your PDFs to get started!**',
      timestamp: new Date().toISOString(),
      model: 'Velocity.ai'
    }]);
    setFiles([]);
  };

  const loadSession = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${sid}`);
      const data = await res.json();
      setCurrentSessionId(sid);
      setMessages(data.messages || []);
    } catch (e) {
      console.error('Failed to load session:', e);
    }
  };

  const addMessage = (role, content, meta = {}) => {
    setMessages(prev => [...prev, {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...meta
    }]);
  };

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (selected.length !== e.target.files.length) {
      addMessage('system', '⚠️ Only PDF files are supported');
    }
    if (selected.length > 0) {
      setFiles(prev => [...prev, ...selected]);
      addMessage('user', `📎 Attached ${selected.length} PDF(s): ${selected.map(f => f.name).join(', ')}`);
    }
  };

  const removeFile = (idx) => {
    setFiles(files.filter((_, i) => i !== idx));
  };

  const handleExtraction = async () => {
    if (files.length === 0) {
      addMessage('system', '❌ Please upload at least one PDF file');
      return;
    }

    if (!currentSessionId) createNewSession();

    setIsProcessing(true);
    setProgress(10);

    try {

const formData = new FormData();
files.forEach(f => formData.append('files', f));
formData.append('template_id', selectedTemplate);
formData.append('session_id', currentSessionId);

      setProgress(30);
      const loadingIdx = messages.length;
      addMessage('assistant', '🔄 Processing PDFs with AI...', { isLoading: true, model: 'Velocity.ai' });

      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      setProgress(80);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Extraction failed');
      }

      const data = await res.json();
      setProgress(100);

      // Build response
      const sum = data.summary || {};
      let content = `✅ **Extraction Complete!**\n\n`;
      content += `**Summary:**\n`;
      content += `• Template: ${sum.template_name || selectedTemplate}\n`;
      content += `• Files processed: ${sum.files_processed || 0}\n`;
      content += `• Successful: ${sum.successful || 0}\n`;
      content += `• Failed: ${sum.failed || 0}\n`;
      content += `• Total fields: ${sum.total_fields_extracted || 0}\n`;
      content += `• Avg confidence: ${sum.average_confidence || 0}%\n\n`;

      (data.results || []).forEach(r => {
        if (r.status === 'success') {
          const meta = r.data?.metadata || {};
          content += `\n📄 **${r.filename}**\n`;
          content += `   Model: ${r.llm_model || 'unknown'}\n`;
          content += `   Fields: ${meta.total_fields_extracted || 0}\n`;
          content += `   Confidence: ${meta.average_confidence || 0}%\n`;
        } else {
          content += `\n❌ **${r.filename}**: ${r.error}\n`;
        }
      });

      setMessages(prev => {
        const updated = [...prev];
        updated[loadingIdx] = {
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
          model: 'Velocity.ai',
          results: data.results,
          excelFile: sum.excel_file,
          isResult: true
        };
        return updated;
      });

      setFiles([]);
      loadSessions();

    } catch (err) {
      console.error('Extraction error:', err);
      addMessage('system', `❌ **Error:** ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleDownload = async (filename) => {
    try {
      const res = await fetch(`${API_BASE}/api/download/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      addMessage('system', `✅ Downloaded: ${filename}`);
    } catch (err) {
      console.error('Download error:', err);
      addMessage('system', '❌ Download failed');
    }
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() && files.length === 0) return;

    if (files.length > 0) {
      handleExtraction();
    } else if (inputMessage.trim()) {
      addMessage('user', inputMessage);
      setInputMessage('');
      setTimeout(() => {
        addMessage('assistant', 'I\'m specialized in PDF extraction. Upload your Private Equity fund documents to extract structured data into Excel.', { model: 'Velocity.ai' });
      }, 500);
    }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const FormattedText = ({ content }) => {
    const format = (txt) => {
      txt = txt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      txt = txt.replace(/\*(.*?)\*/g, '<em>$1</em>');
      txt = txt.replace(/\n/g, '<br/>');
      return txt;
    };
    return <div dangerouslySetInnerHTML={{ __html: format(content) }} />;
  };

  const renderMessage = (msg, idx) => {
    const isUser = msg.role === 'user';
    const isSys = msg.role === 'system';

    return (
      <div key={idx} style={{
        display: 'flex',
        gap: '12px',
        maxWidth: '900px',
        margin: '0 auto 24px',
        animation: 'slideIn 0.3s ease-out'
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isUser ? '#10a37f' : isSys ? '#333' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#fff',
          fontSize: '14px',
          fontWeight: 600
        }}>
          {isUser ? 'U' : isSys ? '!' : <Sparkles size={18} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#ececf1' }}>
              {isUser ? 'You' : isSys ? 'System' : 'Velocity.ai'}
            </span>
            {!isUser && !isSys && msg.model && (
              <span style={{
                padding: '2px 8px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '4px',
                fontSize: '10px',
                color: '#8e8ea0',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {msg.model}
              </span>
            )}
            <span style={{ fontSize: '12px', color: '#6e6e80', marginLeft: 'auto' }}>
              {formatTime(msg.timestamp)}
            </span>
          </div>

          <div style={{ fontSize: '15px', lineHeight: '1.6', color: '#c5c5d2' }}>
            {msg.isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Processing...</span>
              </div>
            ) : (
              <FormattedText content={msg.content} />
            )}
          </div>

          {msg.isResult && msg.results && (
            <div style={{
              marginTop: '20px',
              background: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              {msg.results.map((r, i) => {
                if (r.status !== 'success' || !r.data) return null;

                const flatData = r.data._flat_data || [];
                if (flatData.length === 0) return null;

                return (
                  <div key={i} style={{ padding: '20px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '16px',
                      paddingBottom: '12px',
                      borderBottom: '1px solid #2e2e2e'
                    }}>
                      <FileText size={20} style={{ color: '#10a37f' }} />
                      <span style={{ fontSize: '16px', fontWeight: 600, color: '#ececf1' }}>
                        {r.filename}
                      </span>
                      <span style={{
                        marginLeft: 'auto',
                        padding: '4px 12px',
                        background: 'rgba(16, 163, 127, 0.15)',
                        color: '#10a37f',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600
                      }}>
                        {flatData.length} fields
                      </span>
                    </div>

                    <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      background: '#0f0f0f',
                      borderRadius: '8px',
                      border: '1px solid #2e2e2e'
                    }}>
                      <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '13px'
                      }}>
                        <thead style={{
                          position: 'sticky',
                          top: 0,
                          background: '#1a1a1a',
                          borderBottom: '2px solid #2e2e2e'
                        }}>
                          <tr>
                            <th style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: '#10a37f',
                              fontWeight: 600,
                              fontSize: '12px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>Field</th>
                            <th style={{
                              padding: '12px',
                              textAlign: 'left',
                              color: '#10a37f',
                              fontWeight: 600,
                              fontSize: '12px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>Value</th>
                            <th style={{
                              padding: '12px',
                              textAlign: 'center',
                              color: '#10a37f',
                              fontWeight: 600,
                              fontSize: '12px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              width: '100px'
                            }}>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {flatData.map((row, ri) => (
                            <tr key={ri} style={{
                              background: ri % 2 === 0 ? '#0f0f0f' : '#141414',
                              borderBottom: '1px solid #222'
                            }}>
                              <td style={{
                                padding: '12px',
                                color: '#8e8ea0',
                                fontSize: '12px',
                                maxWidth: '200px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }} title={row.field}>
                                {row.field.replace(/^[^.]*\./, '').replace(/\[(\d+)\]/g, ' [$1]')}
                              </td>
                              <td style={{
                                padding: '12px',
                                color: '#ececf1',
                                fontWeight: 500
                              }}>
                                {row.value || 'Not found'}
                              </td>
                              <td style={{
                                padding: '12px',
                                textAlign: 'center'
                              }}>
                                <span style={{
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: row.confidence >= 80 ? 'rgba(16, 163, 127, 0.15)' :
                                              row.confidence >= 60 ? 'rgba(245, 158, 11, 0.15)' :
                                              'rgba(239, 68, 68, 0.15)',
                                  color: row.confidence >= 80 ? '#10a37f' :
                                         row.confidence >= 60 ? '#f59e0b' :
                                         '#ef4444'
                                }}>
                                  {row.confidence}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {msg.excelFile && (
                <div style={{
                  padding: '16px 20px',
                  borderTop: '1px solid #2e2e2e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <button
                    onClick={() => handleDownload(msg.excelFile)}
                    style={{
                      padding: '10px 20px',
                      background: '#10a37f',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.background = '#0d8f6e'}
                    onMouseOut={e => e.currentTarget.style.background = '#10a37f'}
                  >
                    <Download size={16} />
                    Download Excel Report
                  </button>
                  <span style={{ fontSize: '12px', color: '#6e6e80' }}>
                    {msg.excelFile}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      background: '#0f0f0f',
      color: '#ececf1',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      overflow: 'hidden'
    }}>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #444; }
      `}</style>

      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? '280px' : '0',
        background: '#1a1a1a',
        borderRight: '1px solid #2e2e2e',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.3s',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #2e2e2e' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <Sparkles size={24} style={{ color: '#10a37f' }} />
            <span style={{ fontSize: '18px', fontWeight: 600 }}>Velocity.ai</span>
          </div>
          <button
            onClick={createNewSession}
            style={{
              width: '100%',
              padding: '12px',
              background: '#2a2a2a',
              border: '1px solid #3a3a3a',
              borderRadius: '8px',
              color: '#ececf1',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = '#333'}
            onMouseOut={e => e.currentTarget.style.background = '#2a2a2a'}
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <h3 style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            color: '#6e6e80',
            marginBottom: '12px',
            letterSpacing: '0.5px'
          }}>
            Recent Sessions
          </h3>
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#6e6e80' }}>
              <Clock size={32} style={{ opacity: 0.5, marginBottom: '12px' }} />
              <p style={{ fontSize: '13px' }}>No sessions yet</p>
            </div>
          ) : (
            sessions.map(s => (
              <div
                key={s.session_id}
                onClick={() => loadSession(s.session_id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: currentSessionId === s.session_id ? '1px solid #10a37f' : '1px solid transparent',
                  background: currentSessionId === s.session_id ? '#1a2a24' : 'transparent',
                  marginBottom: '4px',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => {
                  if (currentSessionId !== s.session_id) {
                    e.currentTarget.style.background = '#2a2a2a';
                  }
                }}
                onMouseOut={e => {
                  if (currentSessionId !== s.session_id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <FileText size={16} style={{ color: '#8e8ea0' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#ececf1',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    Session {s.session_id.slice(-8)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6e6e80' }}>
                    {formatTime(s.created_at)}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: '#6e6e80' }} />
              </div>
            ))
          )}
        </div>

        <div style={{
          padding: '16px',
          borderTop: '1px solid #2e2e2e',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <span style={{ fontSize: '10px', color: '#6e6e80', textTransform: 'uppercase' }}>
            Powered by
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{
              padding: '4px 8px',
              background: 'rgba(255, 112, 0, 0.15)',
              color: '#ff7000',
              border: '1px solid rgba(255, 112, 0, 0.3)',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600
            }}>
              MISTRAL
            </span>
            <span style={{
              padding: '4px 8px',
              background: 'rgba(245, 80, 54, 0.15)',
              color: '#f55036',
              border: '1px solid rgba(245, 80, 54, 0.3)',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600
            }}>
              GROQ
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '16px 24px',
          borderBottom: '1px solid #2e2e2e',
          background: '#1a1a1a'
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #3a3a3a',
              borderRadius: '6px',
              background: 'transparent',
              color: '#8e8ea0',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = '#2a2a2a';
              e.currentTarget.style.borderColor = '#10a37f';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '#3a3a3a';
            }}
          >
            <ChevronRight size={20} style={{
              transition: 'transform 0.3s',
              transform: sidebarOpen ? 'rotate(180deg)' : 'rotate(0)'
            }} />
          </button>
          <span style={{ fontSize: '15px', fontWeight: 500 }}>
            {currentSessionId ? `Session: ${currentSessionId.slice(-8)}` : 'Welcome to Velocity.ai'}
          </span>
        </header>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px'
        }}>
          {messages.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              padding: '48px'
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px',
                boxShadow: '0 10px 30px rgba(102, 126, 234, 0.3)'
              }}>
                <Sparkles size={40} style={{ color: '#fff' }} />
              </div>
              <h1 style={{
                fontSize: '42px',
                fontWeight: 700,
                marginBottom: '12px',
                background: 'linear-gradient(135deg, #ececf1 0%, #10a37f 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Welcome to Velocity.ai
              </h1>
              <p style={{
                fontSize: '16px',
                color: '#8e8ea0',
                marginBottom: '48px',
                maxWidth: '500px'
              }}>
                Your intelligent PDF extraction assistant for Private Equity fund documents
              </p>
              <button
                onClick={createNewSession}
                style={{
                  padding: '14px 32px',
                  background: '#10a37f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(16, 163, 127, 0.3)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => {
                  e.currentTarget.style.background = '#0d8f6e';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(16, 163, 127, 0.4)';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.background = '#10a37f';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 163, 127, 0.3)';
                }}
              >
                Get Started
              </button>
            </div>
          ) : (
            <>
              {messages.map((m, i) => renderMessage(m, i))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {files.length > 0 && (
          <div style={{
            padding: '12px 24px',
            background: '#1a1a1a',
            borderTop: '1px solid #2e2e2e',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '6px',
                fontSize: '13px'
              }}>
                <FileText size={14} style={{ color: '#10a37f' }} />
                <span style={{ color: '#ececf1' }}>{f.name}</span>
                <span style={{ color: '#6e6e80' }}>({(f.size / 1024).toFixed(1)} KB)</span>
                <button
                  onClick={() => removeFile(i)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: '0',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {isProcessing && progress > 0 && (
          <div style={{
            padding: '0 24px 12px',
            background: '#1a1a1a',
            borderTop: '1px solid #2e2e2e'
          }}>
            <div style={{
              height: '4px',
              background: '#2a2a2a',
              borderRadius: '2px',
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #10a37f 0%, #0d8f6e 100%)',
                transition: 'width 0.3s',
                borderRadius: '2px'
              }} />
            </div>
            <div style={{
              fontSize: '12px',
              color: '#6e6e80',
              marginTop: '4px',
              textAlign: 'center'
            }}>
              Processing... {progress}%
            </div>
          </div>
        )}

        <div style={{
          padding: '16px 24px',
          background: '#1a1a1a',
          borderTop: '1px solid #2e2e2e'
        }}>
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          <div style={{
  padding: '12px 24px',
  background: '#1a1a1a',
  borderTop: '1px solid #2e2e2e',
  display: 'flex',
  alignItems: 'center',
  gap: '12px'
}}>
  <label style={{
    fontSize: '13px',
    color: '#8e8ea0',
    fontWeight: 500
  }}>
    Extraction Template:
  </label>
  <select
    value={selectedTemplate}
    onChange={(e) => setSelectedTemplate(e.target.value)}
    disabled={isProcessing}
    style={{
      padding: '8px 12px',
      background: '#2a2a2a',
      border: '1px solid #3a3a3a',
      borderRadius: '6px',
      color: '#ececf1',
      fontSize: '13px',
      cursor: isProcessing ? 'not-allowed' : 'pointer',
      outline: 'none',
      minWidth: '250px'
    }}
  >
    {Object.entries(templates).map(([id, info]) => (
      <option key={id} value={id}>
        {info.name} - {info.description}
      </option>
    ))}
  </select>
</div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              style={{
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                color: '#ececf1',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                opacity: isProcessing ? 0.5 : 1
              }}
              onMouseOver={e => {
                if (!isProcessing) {
                  e.currentTarget.style.background = '#333';
                  e.currentTarget.style.borderColor = '#10a37f';
                }
              }}
              onMouseOut={e => {
                if (!isProcessing) {
                  e.currentTarget.style.background = '#2a2a2a';
                  e.currentTarget.style.borderColor = '#3a3a3a';
                }
              }}
            >
              <Upload size={18} />
            </button>

<input
              type="text"
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              disabled={isProcessing}
              placeholder={files.length > 0 ? "Press Enter to extract..." : "Ask a question or upload PDFs..."}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                color: '#ececf1',
                fontSize: '14px',
                outline: 'none',
                transition: 'all 0.2s'
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#10a37f'}
              onBlur={e => e.currentTarget.style.borderColor = '#3a3a3a'}
            />

            <button
              onClick={handleSendMessage}
              disabled={isProcessing || (files.length === 0 && !inputMessage.trim())}
              style={{
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#10a37f',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                cursor: (isProcessing || (files.length === 0 && !inputMessage.trim())) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                opacity: (isProcessing || (files.length === 0 && !inputMessage.trim())) ? 0.5 : 1
              }}
              onMouseOver={e => {
                if (!isProcessing && (files.length > 0 || inputMessage.trim())) {
                  e.currentTarget.style.background = '#0d8f6e';
                }
              }}
              onMouseOut={e => {
                if (!isProcessing) {
                  e.currentTarget.style.background = '#10a37f';
                }
              }}
            >
              {isProcessing ? (
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>

<div style={{
  marginTop: '8px',
  fontSize: '12px',
  color: '#6e6e80',
  textAlign: 'center'
}}>
  {files.length > 0
    ? `${files.length} file(s) attached • Template: ${templates[selectedTemplate]?.name || selectedTemplate}`
    : 'Upload PDF documents to extract structured data'}
</div>
        </div>
      </main>
    </div>
  );
};

export default App;