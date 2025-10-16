import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Download, Loader2, Send, Plus, Clock, ChevronRight, Sparkles, X } from 'lucide-react';

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
  const [statusMessage, setStatusMessage] = useState('');

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
      content: '👋 **Welcome to Velocity.ai!**\n\n**Templates:**\n• **Template 1**: PE Fund (Horizon/Linolex) - 8 sheets\n• **Template 2**: ILPA Best Practices - 9 sheets with Reference\n• **Template 3**: Invoice/Report\n• **Template 4**: General Document\n\n**Upload PDFs to start extracting!**',
      timestamp: new Date().toISOString()
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
      addMessage('system', '❌ Please upload PDF files first');
      return;
    }

    if (!currentSessionId) createNewSession();

    setIsProcessing(true);
    setProgress(10);
    setStatusMessage('Uploading PDFs...');

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      formData.append('template_id', selectedTemplate);
      formData.append('session_id', currentSessionId);

      setProgress(30);
      setStatusMessage('Extracting text from PDFs...');
      
      const loadingIdx = messages.length;
      addMessage('assistant', '🔄 Processing with AI...', { isLoading: true });

      setProgress(60);
      setStatusMessage(`Using ${templates[selectedTemplate]?.name || selectedTemplate}...`);

      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      setProgress(90);
      setStatusMessage('Generating Excel...');

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Extraction failed');
      }

      const data = await res.json();
      setProgress(100);
      setStatusMessage('Complete!');

      const sum = data.summary || {};
      let content = `✅ **Extraction Complete!**\n\n`;
      content += `**Summary:**\n`;
      content += `• Template: ${sum.template_name}\n`;
      content += `• Files: ${sum.successful}/${sum.files_processed} successful\n`;
      content += `• Processing time: ${sum.processing_time}s\n\n`;

      (data.results || []).forEach(r => {
        if (r.status === 'success') {
          content += `\n📄 **${r.filename}** - ✓ Extracted\n`;
        } else {
          content += `\n❌ **${r.filename}** - ${r.error}\n`;
        }
      });

      setMessages(prev => {
        const updated = [...prev];
        updated[loadingIdx] = {
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
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
      setStatusMessage('');
    }
  };

  const handleDownload = async (filename) => {
    try {
      setStatusMessage('Downloading...');
      
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
    } finally {
      setStatusMessage('');
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
        addMessage('assistant', 'I extract data from PDFs. Please upload documents to start.');
      }, 500);
    }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const FormattedText = ({ content }) => {
    const format = (txt) => {
      txt = txt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
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
        margin: '0 auto 24px'
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

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#ececf1' }}>
              {isUser ? 'You' : isSys ? 'System' : 'Velocity.ai'}
            </span>
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

          {msg.isResult && msg.excelFile && (
            <div style={{
              marginTop: '20px',
              padding: '16px',
              background: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '8px',
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
                  gap: '8px'
                }}
              >
                <Download size={16} />
                Download Excel
              </button>
              <span style={{ fontSize: '12px', color: '#6e6e80' }}>
                {msg.excelFile}
              </span>
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
      background: '#0f0f0f',
      color: '#ececf1',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden'
    }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
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
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
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
            marginBottom: '12px'
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
                  border: currentSessionId === s.session_id ? '1px solid #10a37f' : 'none',
                  background: currentSessionId === s.session_id ? '#1a2a24' : 'transparent',
                  marginBottom: '4px'
                }}
              >
                <FileText size={16} style={{ color: '#8e8ea0' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#ececf1' }}>
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
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
              cursor: 'pointer'
            }}
          >
            <ChevronRight size={20} style={{
              transform: sidebarOpen ? 'rotate(180deg)' : 'rotate(0)'
            }} />
          </button>
          <span style={{ fontSize: '15px', fontWeight: 500 }}>
            {currentSessionId ? `Session: ${currentSessionId.slice(-8)}` : 'Velocity.ai'}
          </span>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {messages.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center'
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <Sparkles size={40} style={{ color: '#fff' }} />
              </div>
              <h1 style={{
                fontSize: '42px',
                fontWeight: 700,
                marginBottom: '12px',
                background: 'linear-gradient(135deg, #ececf1 0%, #10a37f 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>
                Velocity.ai
              </h1>
              <p style={{ fontSize: '16px', color: '#8e8ea0', marginBottom: '48px' }}>
                AI-powered PDF extraction
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
                  cursor: 'pointer'
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
                <span>{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: '0',
                    display: 'flex'
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Inline Progress Bar (NO BLUR) */}
        {isProcessing && progress > 0 && (
          <div style={{
            padding: '12px 24px',
            background: '#1a1a1a',
            borderTop: '1px solid #2e2e2e'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '8px'
            }}>
              <Loader2 size={16} style={{ color: '#10a37f', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '13px', color: '#ececf1' }}>{statusMessage}</span>
            </div>
            <div style={{
              height: '4px',
              background: '#2a2a2a',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: '#10a37f',
                transition: 'width 0.3s'
              }} />
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
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <label style={{ fontSize: '13px', color: '#8e8ea0' }}>Template:</label>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '6px',
                color: '#ececf1',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              {Object.entries(templates).map(([id, info]) => (
                <option key={id} value={id}>
                  {info.name} - {info.description}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              style={{
                width: '40px',
                height: '40px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                color: '#ececf1',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Upload size={18} />
            </button>

            <input
              type="text"
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
              disabled={isProcessing}
              placeholder="Ask about data or upload PDFs..."
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                color: '#ececf1',
                fontSize: '14px',
                outline: 'none'
              }}
            />

            <button
              onClick={handleSendMessage}
              disabled={isProcessing || (files.length === 0 && !inputMessage.trim())}
              style={{
                width: '40px',
                height: '40px',
                background: '#10a37f',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
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
              ? `${files.length} file(s) attached • ${templates[selectedTemplate]?.name}`
              : 'Upload PDFs to extract data'}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;