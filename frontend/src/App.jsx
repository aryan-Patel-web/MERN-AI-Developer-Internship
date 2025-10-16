import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Download, Loader2, Send, Plus, X } from 'lucide-react';

const App = () => {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [progress, setProgress] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState('template_1');
  const [templates, setTemplates] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [extractionComplete, setExtractionComplete] = useState(false);
  const [pdfContext, setPdfContext] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    loadSessions();
    loadTemplates();
    
    const handleResize = () => setSidebarOpen(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
      content: '👋 Welcome! Upload PDFs to extract data into Excel.',
      timestamp: new Date().toISOString()
    }]);
    setFiles([]);
    setExtractionComplete(false);
    setPdfContext(null);
  };

  const loadSession = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${sid}`);
      const data = await res.json();
      setCurrentSessionId(sid);
      setMessages(data.messages || []);
      
      const hasExtraction = data.messages?.some(m => m.excelFile);
      setExtractionComplete(hasExtraction);
      if (hasExtraction) {
        const extractionMsg = data.messages.find(m => m.excelFile);
        setPdfContext(extractionMsg?.summary?.pdf_names?.join(', '));
      }
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
      addMessage('user', `📎 ${selected.length} PDF(s): ${selected.map(f => f.name).join(', ')}`);
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
      setStatusMessage('Extracting text from PDF...');
      
      const loadingIdx = messages.length;
      addMessage('assistant', '🔄 Processing with AI...', { isLoading: true });

      setProgress(60);

      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      setProgress(90);
      setStatusMessage('Creating Excel file...');

      if (!res.ok) throw new Error('Extraction failed');

      const data = await res.json();
      setProgress(100);

      const sum = data.summary || {};
      let content = `✅ **Extraction Complete!**\n\n`;
      content += `• Files: ${sum.successful || 0}/${sum.files_processed || 0} extracted\n`;
      content += `• Time: ${sum.processing_time || 0}s\n`;
      
      // DISPLAY ACCURACY AND CONFIDENCE
      if (sum.accuracy !== undefined) {
        content += `• Accuracy: ${sum.accuracy}%\n`;
      }
      if (sum.confidence !== undefined) {
        content += `• Confidence: ${sum.confidence}%\n`;
      }
      
      content += `\n💡 You can now download the Excel or ask questions!`;

      setMessages(prev => {
        const updated = [...prev];
        updated[loadingIdx] = {
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
          results: data.results,
          excelFile: sum.excel_file,
          summary: sum,
          isResult: true
        };
        return updated;
      });

      setFiles([]);
      setExtractionComplete(true);
      setPdfContext(sum.pdf_names?.join(', '));
      loadSessions();

    } catch (err) {
      console.error('Extraction error:', err);
      addMessage('system', `❌ ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setStatusMessage('');
    }
  };

  const handleChat = async () => {
    if (!inputMessage.trim()) return;

    const userMsg = inputMessage;
    addMessage('user', userMsg);
    setInputMessage('');

    if (!extractionComplete) {
      setTimeout(() => {
        addMessage('assistant', '💡 Please extract a PDF first, then ask questions.');
      }, 500);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('message', userMsg);
      formData.append('session_id', currentSessionId);
      formData.append('pdf_context', pdfContext || '');

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      addMessage('assistant', data.response || 'Sorry, I could not process that.');
    } catch (e) {
      addMessage('assistant', 'Error processing your question.');
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
      addMessage('system', '❌ Download failed');
    }
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
        margin: '0 auto 20px',
        padding: '0 16px'
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isUser ? '#10a37f' : isSys ? '#ef4444' : '#667eea',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 600
        }}>
          {isUser ? 'U' : isSys ? '!' : 'AI'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#ececf1' }}>
              {isUser ? 'You' : isSys ? 'System' : 'Velocity.ai'}
            </span>
            <span style={{ fontSize: '11px', color: '#6e6e80' }}>
              {formatTime(msg.timestamp)}
            </span>
          </div>

          <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#c5c5d2', wordWrap: 'break-word' }}>
            {msg.isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Processing with AI...</span>
              </div>
            ) : (
              <FormattedText content={msg.content} />
            )}
          </div>

          {msg.isResult && msg.excelFile && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              background: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '8px'
            }}>
              <button
                onClick={() => handleDownload(msg.excelFile)}
                style={{
                  padding: '8px 16px',
                  background: '#10a37f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Download size={14} />
                Download Excel
              </button>
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
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        @media (max-width: 768px) {
          .sidebar { position: fixed; z-index: 1000; height: 100%; }
          .sidebar-closed { transform: translateX(-100%); }
        }
      `}</style>

      {/* Sidebar */}
      <aside className={`sidebar ${!sidebarOpen && 'sidebar-closed'}`} style={{
        width: '280px',
        background: '#1a1a1a',
        borderRight: '1px solid #2e2e2e',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.3s'
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #2e2e2e' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px', color: '#10a37f' }}>
            Velocity.ai
          </div>
          <button onClick={createNewSession} style={{
            width: '100%',
            padding: '10px',
            background: '#2a2a2a',
            border: '1px solid #3a3a3a',
            borderRadius: '6px',
            color: '#ececf1',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}>
            <Plus size={16} />
            New Chat
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 12px', color: '#6e6e80' }}>
              <FileText size={24} style={{ opacity: 0.5, marginBottom: '8px' }} />
              <p style={{ fontSize: '12px' }}>No sessions yet</p>
            </div>
          ) : (
            sessions.slice().reverse().map(s => {
              const lastMsg = s.messages?.[s.messages.length - 1];
              const sessionName = lastMsg?.summary?.session_name || `Session ${s.session_id.slice(-8)}`;
              
              return (
                <div key={s.session_id} onClick={() => {
                  loadSession(s.session_id);
                  if (window.innerWidth <= 768) setSidebarOpen(false);
                }} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: currentSessionId === s.session_id ? '1px solid #10a37f' : 'none',
                  background: currentSessionId === s.session_id ? '#1a2a24' : 'transparent',
                  marginBottom: '4px'
                }}>
                  <FileText size={14} style={{ color: '#10a37f', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: '#ececf1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {sessionName}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6e6e80' }}>
                      {formatTime(s.created_at)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          borderBottom: '1px solid #2e2e2e',
          background: '#1a1a1a'
        }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #3a3a3a',
            borderRadius: '6px',
            background: 'transparent',
            color: '#8e8ea0',
            cursor: 'pointer'
          }}>☰</button>
          <span style={{ fontSize: '14px', fontWeight: 500, flex: 1 }}>
            {pdfContext || 'Velocity.ai'}
          </span>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
          {messages.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              padding: '20px'
            }}>
              <h1 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '8px' }}>Velocity.ai</h1>
              <p style={{ fontSize: '14px', color: '#8e8ea0', marginBottom: '32px' }}>
                AI-powered PDF to Excel in 15-20 seconds
              </p>
              <button onClick={createNewSession} style={{
                padding: '12px 24px',
                background: '#10a37f',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}>
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
          <div style={{ padding: '8px 16px', background: '#1a1a1a', borderTop: '1px solid #2e2e2e', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '4px',
                fontSize: '12px'
              }}>
                <FileText size={12} style={{ color: '#10a37f' }} />
                <span>{f.name}</span>
                <button onClick={() => removeFile(i)} style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  padding: '0',
                  display: 'flex'
                }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {isProcessing && progress > 0 && (
          <div style={{ padding: '10px 16px', background: '#1a1a1a', borderTop: '1px solid #2e2e2e' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Loader2 size={14} style={{ color: '#10a37f', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '12px', color: '#ececf1' }}>{statusMessage}</span>
            </div>
            <div style={{ height: '3px', background: '#2a2a2a', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#10a37f', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        <div style={{ padding: '12px 16px', background: '#1a1a1a', borderTop: '1px solid #2e2e2e' }}>
          <input type="file" ref={fileInputRef} multiple accept=".pdf" onChange={handleFileSelect} style={{ display: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} disabled={isProcessing} style={{
              flex: 1,
              padding: '6px 10px',
              background: '#2a2a2a',
              border: '1px solid #3a3a3a',
              borderRadius: '4px',
              color: '#ececf1',
              fontSize: '12px',
              cursor: 'pointer'
            }}>
              {Object.entries(templates).map(([id, info]) => (
                <option key={id} value={id}>{info.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} style={{
              width: '36px',
              height: '36px',
              background: '#2a2a2a',
              border: '1px solid #3a3a3a',
              borderRadius: '6px',
              color: '#ececf1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Upload size={16} />
            </button>

            <input type="text" value={inputMessage} onChange={e => setInputMessage(e.target.value)} onKeyPress={e => {
              if (e.key === 'Enter') {
                if (files.length > 0) handleExtraction();
                else if (inputMessage.trim()) handleChat();
              }
            }} disabled={isProcessing} placeholder={extractionComplete ? "Ask about the data..." : "Upload PDFs..."} style={{
              flex: 1,
              padding: '10px 12px',
              background: '#2a2a2a',
              border: '1px solid #3a3a3a',
              borderRadius: '6px',
              color: '#ececf1',
              fontSize: '13px',
              outline: 'none'
            }} />

            <button onClick={() => {
              if (files.length > 0) handleExtraction();
              else if (inputMessage.trim()) handleChat();
            }} disabled={isProcessing || (files.length === 0 && !inputMessage.trim())} style={{
              width: '36px',
              height: '36px',
              background: '#10a37f',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isProcessing || (files.length === 0 && !inputMessage.trim()) ? 0.5 : 1
            }}>
              {isProcessing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
            </button>
          </div>

          <div style={{ marginTop: '6px', fontSize: '11px', color: '#6e6e80', textAlign: 'center' }}>
            {extractionComplete 
              ? '💡 Excel ready - Download or ask questions'
              : files.length > 0
              ? `${files.length} file(s) ready - Extraction in 15-20 sec`
              : 'Upload PDFs to start'}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;