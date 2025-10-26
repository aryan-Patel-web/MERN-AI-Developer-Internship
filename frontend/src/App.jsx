import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Download, Loader2, Send, Plus, X, Menu } from 'lucide-react';

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
  const API_BASE = import.meta.env.VITE_API_URL || 'https://velocity-ai-1aqo.onrender.com';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    loadSessions();
    loadTemplates();
    
    const handleResize = () => {
      if (window.innerWidth > 768 && !sidebarOpen) {
        setSidebarOpen(true);
      }
    };
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
    
    // Close sidebar on mobile after creating session
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
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
      
      // Close sidebar on mobile after loading session
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
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

  const handleDownloadExcel = async (fileName) => {
    try {
      const res = await fetch(`${API_BASE}/api/download/${fileName}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
    } catch (e) {
      console.error('Download error:', e);
    }
  };

  const formatTime = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderMessage = (msg, idx) => {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    
    return (
      <div key={idx} style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '16px',
        padding: '0 16px',
        animation: 'messageSlide 0.3s ease-out'
      }}>
        <div style={{
          maxWidth: window.innerWidth <= 768 ? '85%' : '70%',
          padding: '12px 16px',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isUser ? '#10a37f' : isSystem ? '#2a2a2a' : '#2a2a2a',
          color: '#ececf1',
          fontSize: '14px',
          lineHeight: '1.6',
          wordWrap: 'break-word',
          boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
        }}>
          {msg.isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <span>{msg.content}</span>
            </div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {msg.content.split('\n').map((line, i) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                  return <div key={i} style={{ fontWeight: 700, marginBottom: '8px' }}>{line.slice(2, -2)}</div>;
                }
                return <div key={i}>{line}</div>;
              })}
            </div>
          )}

          {msg.excelFile && (
            <button onClick={() => handleDownloadExcel(msg.excelFile)} style={{
              marginTop: '12px',
              padding: '8px 16px',
              background: '#10a37f',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              justifyContent: 'center'
            }}>
              <Download size={14} />
              Download Excel
            </button>
          )}

          <div style={{ 
            fontSize: '10px', 
            color: isUser ? 'rgba(255,255,255,0.7)' : '#6e6e80', 
            marginTop: '6px',
            textAlign: 'right'
          }}>
            {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    );
  };

  const isMobile = window.innerWidth <= 768;

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#0d0d0d',
      color: '#ececf1',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Add CSS animations */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes messageSlide {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        /* Scrollbar styling */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #1a1a1a;
        }
        ::-webkit-scrollbar-thumb {
          background: #3a3a3a;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #4a4a4a;
        }

        /* Button hover effects */
        button:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
          transition: all 0.2s ease;
        }
        button:active:not(:disabled) {
          transform: translateY(0);
        }

        /* Input focus effects */
        input:focus, select:focus {
          border-color: #10a37f !important;
          outline: none;
          box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.1);
        }
      `}</style>

      {/* Mobile overlay */}
      {sidebarOpen && isMobile && (
        <div 
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 999,
            backdropFilter: 'blur(2px)'
          }}
        />
      )}

      {/* Sidebar - Desktop uses flex, Mobile uses fixed overlay */}
      <aside style={{
        width: isMobile ? '280px' : (sidebarOpen ? '300px' : '0'),
        background: '#0d0d0d',
        borderRight: sidebarOpen ? '1px solid #2e2e2e' : 'none',
        display: 'flex',
        flexDirection: 'column',
        position: isMobile ? 'fixed' : 'relative',
        left: 0,
        top: 0,
        height: '100vh',
        zIndex: 1000,
        transform: isMobile ? (sidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
        transition: isMobile ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        boxShadow: sidebarOpen && isMobile ? '2px 0 8px rgba(0, 0, 0, 0.3)' : 'none',
        flexShrink: 0
      }}>
        {/* Sidebar Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #2e2e2e',
          display: sidebarOpen ? 'flex' : 'none',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '60px'
        }}>
          <h2 style={{
            fontSize: '16px',
            fontWeight: 700,
            margin: 0,
            color: '#10a37f',
            whiteSpace: 'nowrap'
          }}>
            Velocity.ai
          </h2>
          {isMobile && (
            <button 
              onClick={() => setSidebarOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8e8ea0',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* New Session Button */}
        <div style={{ 
          padding: sidebarOpen ? '12px 16px' : '0', 
          display: sidebarOpen ? 'block' : 'none' 
        }}>
          <button onClick={createNewSession} style={{
            width: '100%',
            padding: '12px',
            background: '#10a37f',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap'
          }}>
            <Plus size={18} />
            New Session
          </button>
        </div>

        {/* Session List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: sidebarOpen ? '8px 12px' : '0',
          display: sidebarOpen ? 'block' : 'none'
        }}>
          {sessions.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '20px',
              color: '#6e6e80',
              fontSize: '13px'
            }}>
              No sessions yet
            </div>
          ) : (
            sessions.map((s) => {
              const firstMsg = s.messages?.[0]?.content || 'New Session';
              const sessionName = firstMsg.length > 40 ? firstMsg.substring(0, 40) + '...' : firstMsg;
              
              return (
                <div key={s.session_id} onClick={() => loadSession(s.session_id)} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: currentSessionId === s.session_id ? '1px solid #10a37f' : '1px solid transparent',
                  background: currentSessionId === s.session_id ? '#1a2a24' : 'transparent',
                  marginBottom: '6px',
                  transition: 'all 0.2s ease'
                }}>
                  <FileText size={16} style={{ color: '#10a37f', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: '#ececf1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {sessionName}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6e6e80', marginTop: '2px' }}>
                      {formatTime(s.created_at)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer */}
        <div style={{
          padding: sidebarOpen ? '12px 16px' : '0',
          borderTop: '1px solid #2e2e2e',
          fontSize: '11px',
          color: '#6e6e80',
          textAlign: 'center',
          display: sidebarOpen ? 'block' : 'none'
        }}>
          Made with ❤️ by Velocity.ai
        </div>
      </aside>

      {/* Main Content - Expands to full width when sidebar is closed */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        width: isMobile ? '100%' : (sidebarOpen ? 'calc(100% - 300px)' : '100%'),
        position: 'relative',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        {/* Header */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
          borderBottom: '1px solid #2e2e2e',
          background: '#0d0d0d',
          position: 'sticky',
          top: 0,
          zIndex: 100
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
              borderRadius: '8px',
              background: 'transparent',
              color: '#8e8ea0',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
          >
            <Menu size={18} />
          </button>
          <span style={{ 
            fontSize: '15px', 
            fontWeight: 600, 
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#ececf1'
          }}>
            {pdfContext || 'Velocity.ai'}
          </span>
        </header>

        {/* Messages Area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 0',
          background: '#0d0d0d'
        }}>
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
              <h1 style={{
                fontSize: window.innerWidth <= 768 ? '28px' : '36px',
                fontWeight: 700,
                marginBottom: '12px',
                background: 'linear-gradient(135deg, #10a37f 0%, #0d8c6a 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Velocity.ai
              </h1>
              <p style={{
                fontSize: '15px',
                color: '#8e8ea0',
                marginBottom: '32px',
                maxWidth: '400px'
              }}>
                AI-powered PDF to Excel conversion in 15-20 seconds
              </p>
              <button onClick={createNewSession} style={{
                padding: '14px 32px',
                background: '#10a37f',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(16, 163, 127, 0.2)'
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

        {/* File Chips */}
        {files.length > 0 && (
          <div style={{
            padding: '10px 16px',
            background: '#0d0d0d',
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
                borderRadius: '8px',
                fontSize: '13px',
                maxWidth: '200px'
              }}>
                <FileText size={14} style={{ color: '#10a37f', flexShrink: 0 }} />
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1
                }}>
                  {f.name}
                </span>
                <button onClick={() => removeFile(i)} style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  padding: '0',
                  display: 'flex',
                  flexShrink: 0
                }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Progress Bar */}
        {isProcessing && progress > 0 && (
          <div style={{
            padding: '12px 16px',
            background: '#0d0d0d',
            borderTop: '1px solid #2e2e2e'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '8px'
            }}>
              <Loader2 size={16} style={{ color: '#10a37f', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '13px', color: '#ececf1' }}>{statusMessage}</span>
            </div>
            <div style={{
              height: '4px',
              background: '#2a2a2a',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #10a37f 0%, #0d8c6a 100%)',
                transition: 'width 0.3s ease',
                borderRadius: '4px'
              }} />
            </div>
          </div>
        )}

        {/* Input Area */}
        <div style={{
          padding: '16px',
          background: '#0d0d0d',
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

          {/* Template Selector */}
          <div style={{
            marginBottom: '12px'
          }}>
            <select 
              value={selectedTemplate} 
              onChange={(e) => setSelectedTemplate(e.target.value)} 
              disabled={isProcessing} 
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1a1a1a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                color: '#ececf1',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {Object.entries(templates).map(([id, info]) => (
                <option key={id} value={id}>{info.name}</option>
              ))}
            </select>
          </div>

          {/* Input Row */}
          <div style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end'
          }}>
            <button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isProcessing} 
              style={{
                width: '44px',
                height: '44px',
                background: '#1a1a1a',
                border: '1px solid #3a3a3a',
                borderRadius: '10px',
                color: '#ececf1',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s ease'
              }}
            >
              <Upload size={18} />
            </button>

            <input 
              type="text" 
              value={inputMessage} 
              onChange={e => setInputMessage(e.target.value)} 
              onKeyPress={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (files.length > 0) handleExtraction();
                  else if (inputMessage.trim()) handleChat();
                }
              }} 
              disabled={isProcessing} 
              placeholder={extractionComplete ? "Ask about the data..." : "Upload PDFs to start..."} 
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#1a1a1a',
                border: '1px solid #3a3a3a',
                borderRadius: '10px',
                color: '#ececf1',
                fontSize: '14px',
                outline: 'none',
                transition: 'all 0.2s ease'
              }} 
            />

            <button 
              onClick={() => {
                if (files.length > 0) handleExtraction();
                else if (inputMessage.trim()) handleChat();
              }} 
              disabled={isProcessing || (files.length === 0 && !inputMessage.trim())} 
              style={{
                width: '44px',
                height: '44px',
                background: '#10a37f',
                border: 'none',
                borderRadius: '10px',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                opacity: isProcessing || (files.length === 0 && !inputMessage.trim()) ? 0.5 : 1,
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(16, 163, 127, 0.2)'
              }}
            >
              {isProcessing ? (
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>

          {/* Status Text */}
          <div style={{
            marginTop: '10px',
            fontSize: '12px',
            color: '#6e6e80',
            textAlign: 'center'
          }}>
            {extractionComplete 
              ? '💡 Excel ready - Download or ask questions'
              : files.length > 0
              ? `${files.length} file(s) ready - Press Enter to extract`
              : 'Upload PDFs to start extraction'}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;