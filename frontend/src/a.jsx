// import { useState, useEffect, useRef } from 'react';
// import { Upload, FileText, Download, AlertCircle, CheckCircle, Loader2, Send, Plus, Clock, ChevronRight, Sparkles, X } from 'lucide-react';
// import './App.css';

// function App() {
//   const [sessions, setSessions] = useState([]);
//   const [currentSessionId, setCurrentSessionId] = useState(null);
//   const [messages, setMessages] = useState([]);
//   const [files, setFiles] = useState([]);
//   const [inputMessage, setInputMessage] = useState('');
//   const [isProcessing, setIsProcessing] = useState(false);
//   const [sidebarOpen, setSidebarOpen] = useState(true);
//   const [uploadProgress, setUploadProgress] = useState(0);
//   const messagesEndRef = useRef(null);
//   const fileInputRef = useRef(null);

//   const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

//   // Auto-scroll to bottom
//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   }, [messages]);

//   // Load sessions on mount
//   useEffect(() => {
//     loadSessions();
//   }, []);

//   const loadSessions = async () => {
//     try {
//       const response = await fetch(`${API_BASE_URL}/api/history`);
//       const data = await response.json();
//       setSessions(data.sessions || []);
//     } catch (error) {
//       console.error('Failed to load sessions:', error);
//     }
//   };

//   const createNewSession = () => {
//     const newSessionId = `session_${Date.now()}`;
//     setCurrentSessionId(newSessionId);
//     setMessages([{
//       role: 'assistant',
//       content: 'Hello! I\'m **Velocity.ai**, your intelligent PDF extraction assistant. Upload Private Equity fund documents and I\'ll extract structured data into Excel format.\n\n**What I can do:**\n- Extract fund information\n- Analyze performance metrics\n- Identify portfolio companies\n- Generate comprehensive Excel reports',
//       timestamp: new Date().toISOString(),
//       model: 'Velocity.ai'
//     }]);
//     setFiles([]);
//   };

//   const loadSession = async (sessionId) => {
//     try {
//       const response = await fetch(`${API_BASE_URL}/api/history/${sessionId}`);
//       const data = await response.json();
//       setCurrentSessionId(sessionId);
//       setMessages(data.messages || []);
//     } catch (error) {
//       console.error('Failed to load session:', error);
//     }
//   };

//   const handleFileSelect = (e) => {
//     const selectedFiles = Array.from(e.target.files);
//     const pdfFiles = selectedFiles.filter(file => file.name.toLowerCase().endsWith('.pdf'));
    
//     if (pdfFiles.length !== selectedFiles.length) {
//       addMessage('system', '⚠️ Only PDF files are supported. Non-PDF files were filtered out.');
//     }
    
//     setFiles(prev => [...prev, ...pdfFiles]);
    
//     if (pdfFiles.length > 0) {
//       addMessage('user', `📎 Attached ${pdfFiles.length} PDF file(s): ${pdfFiles.map(f => f.name).join(', ')}`);
//     }
//   };

//   const removeFile = (index) => {
//     setFiles(files.filter((_, i) => i !== index));
//   };

//   const addMessage = (role, content, metadata = {}) => {
//     const message = {
//       role,
//       content,
//       timestamp: new Date().toISOString(),
//       ...metadata
//     };
//     setMessages(prev => [...prev, message]);
//   };

//   // =======================
//   // Extraction & XLSX Download
//   // =======================
//   const handleExtraction = async () => {
//     if (files.length === 0) {
//       addMessage('system', '❌ Please upload at least one PDF file to extract.');
//       return;
//     }

//     if (!currentSessionId) {
//       createNewSession();
//     }

//     setIsProcessing(true);
//     setUploadProgress(10);

//     try {
//       const formData = new FormData();
//       files.forEach(file => formData.append('files', file));
//       formData.append('template_id', 'extraction_template_1');
//       formData.append('session_id', currentSessionId);

//       setUploadProgress(30);
      
//       const loadingMessageIndex = messages.length;
//       addMessage('assistant', '🔄 Processing your PDFs with AI...', { 
//         model: 'Velocity.ai',
//         isLoading: true 
//       });

//       const response = await fetch(`${API_BASE_URL}/api/extract`, {
//         method: 'POST',
//         body: formData,
//       });

//       setUploadProgress(80);

//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new Error(errorData.detail || 'Extraction failed');
//       }

//       const data = await response.json();
//       setUploadProgress(100);

//       // Compute summary safely
//       const successfulResults = data.results.filter(r => r.status === 'success');
//       const successCount = successfulResults.length;
//       const failedCount = data.results.filter(r => r.status === 'error').length;
//       const totalFields = successfulResults.reduce((sum, r) => sum + (r.data?.metadata?.total_fields_extracted || 0), 0);
//       const avgConfidence = successfulResults.length 
//         ? successfulResults.reduce((sum, r) => sum + (r.data?.metadata?.average_confidence || 0), 0) / successfulResults.length 
//         : 0;

//       // Prepare message content
//       let responseContent = `✅ **Extraction Complete!**\n\n**Summary:**\n`;
//       responseContent += `- Files processed: ${data.summary?.files_processed || files.length}\n`;
//       responseContent += `- Successful: ${successCount}\n`;
//       responseContent += `- Failed: ${failedCount}\n`;
//       responseContent += `- Total data points extracted: ${totalFields}\n`;
//       responseContent += `- Average confidence: ${(avgConfidence * 100).toFixed(1)}%\n\n`;

//       data.results.forEach(result => {
//         if (result.status === 'success') {
//           const model = result.llm_model || 'unknown';
//           const fields = result.data?.metadata?.total_fields_extracted || 0;
//           const conf = result.data?.metadata?.average_confidence || 0;
//           responseContent += `📄 **${result.filename}**\n`;
//           responseContent += `   - Model: ${model}\n`;
//           responseContent += `   - Fields: ${fields}\n`;
//           responseContent += `   - Confidence: ${(conf * 100).toFixed(1)}%\n`;
//         } else {
//           responseContent += `❌ **${result.filename}**: ${result.error}\n`;
//         }
//       });

//       // Update the previous loading message
//       setMessages(prev => {
//         const updated = [...prev];
//         updated[loadingMessageIndex] = {
//           role: 'assistant',
//           content: responseContent,
//           timestamp: new Date().toISOString(),
//           model: 'Velocity.ai',
//           results: data.results,
//           isResult: true
//         };
//         return updated;
//       });

//       // Clear files after extraction
//       setFiles([]);

//       // Reload sessions
//       loadSessions();

//     } catch (error) {
//       console.error('Extraction error:', error);
//       addMessage('system', `❌ **Error:** ${error.message}`);
//     } finally {
//       setIsProcessing(false);
//       setUploadProgress(0);
//     }
//   };

// const handleDownload = async (filename) => {
//   try {
//     // Use path parameter instead of query parameter
//     const url = `${API_BASE_URL}/api/download/${encodeURIComponent(filename)}`;
//     const response = await fetch(url);

//     if (!response.ok) throw new Error('Download failed');

//     const blob = await response.blob();
//     const downloadUrl = window.URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = downloadUrl;
//     a.download = filename; // Excel filename
//     document.body.appendChild(a);
//     a.click();
//     document.body.removeChild(a);
//     window.URL.revokeObjectURL(downloadUrl);

//     addMessage('system', `✅ Downloaded: ${filename}`);
//   } catch (error) {
//     console.error('Download error:', error);
//     addMessage('system', '❌ Download failed. Please try again.');
//   }
// };


//   // =======================
//   // Sending messages
//   // =======================
//   const handleSendMessage = async () => {
//     if (!inputMessage.trim() && files.length === 0) return;

//     if (files.length > 0) {
//       handleExtraction();
//     } else if (inputMessage.trim()) {
//       addMessage('user', inputMessage);
//       setInputMessage('');
//       setTimeout(() => {
//         addMessage('assistant', 'I\'m focused on PDF extraction. Upload your fund PDFs to extract structured Excel data.', { model: 'Velocity.ai' });
//       }, 500);
//     }
//   };

//   const formatTimestamp = (timestamp) => {
//     const date = new Date(timestamp);
//     const today = new Date();
//     return date.toDateString() === today.toDateString() 
//       ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
//       : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
//   };

//   const renderMessage = (message, index) => {
//     const isUser = message.role === 'user';
//     const isSystem = message.role === 'system';

//     return (
//       <div key={index} className={`message ${message.role}`}>
//         <div className="message-avatar">
//           {isUser ? <div className="avatar-user">U</div> 
//           : isSystem ? <AlertCircle size={20}/> 
//           : <div className="avatar-ai"><Sparkles size={16}/></div>}
//         </div>

//         <div className="message-content">
//           <div className="message-header">
//             <span className="message-sender">{isUser ? 'You' : isSystem ? 'System' : 'Velocity.ai'}</span>
//             {!isUser && !isSystem && message.model && (
//               <span className="message-model">{message.model}</span>
//             )}
//             <span className="message-time">{formatTimestamp(message.timestamp)}</span>
//           </div>

//           <div className="message-text">
//             {message.isLoading ? (
//               <div className="loading-indicator">
//                 <Loader2 className="spinner" size={16} />
//                 <span>Processing...</span>
//               </div>
//             ) : (
//               <FormattedText content={message.content} />
//             )}
//           </div>




// {message.isResult && message.results?.length > 0 && (
//   <div style={{
//     backgroundColor: "#000",
//     color: "#fff",
//     padding: "25px",
//     borderRadius: "10px",
//     marginTop: "20px",
//     fontFamily: "Arial, sans-serif"
//   }}>
//     {message.results.map((r, idx) => {
//       if (r.status !== "success" || !r.data) return null;

//       const rows = Array.isArray(r.data)
//         ? r.data
//         : Object.values(r.data).flat();

//       return (
//         <div key={idx} style={{
//           backgroundColor: "#111",
//           padding: "20px",
//           borderRadius: "10px",
//           marginBottom: "25px",
//           boxShadow: "0 0 12px rgba(255,255,255,0.1)"
//         }}>
//           <h3 style={{
//             color: "#00e0ff",
//             borderBottom: "2px solid #00e0ff",
//             paddingBottom: "10px",
//             marginBottom: "20px"
//           }}>
//             📄 Extracted Fields from {r.filename}
//           </h3>

//           <table style={{
//             width: "100%",
//             borderCollapse: "collapse",
//             backgroundColor: "#1a1a1a",
//             borderRadius: "8px",
//             overflow: "hidden"
//           }}>
//             <thead>
//               <tr style={{ backgroundColor: "#222" }}>
//                 <th style={{
//                   padding: "10px",
//                   border: "1px solid #333",
//                   color: "#00e0ff",
//                   textAlign: "left"
//                 }}>Field</th>
//                 <th style={{
//                   padding: "10px",
//                   border: "1px solid #333",
//                   color: "#00e0ff",
//                   textAlign: "left"
//                 }}>Value</th>
//               </tr>
//             </thead>
//             <tbody>
//               {rows.map((row, i) => (
//                 <tr key={i} style={{
//                   backgroundColor: i % 2 === 0 ? "#181818" : "#0f0f0f",
//                   borderBottom: "1px solid #333"
//                 }}>
//                   <td style={{ padding: "10px", border: "1px solid #333" }}>{row.field}</td>
//                   <td style={{ padding: "10px", border: "1px solid #333" }}>{row.value}</td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         </div>
//       );
//     })}
//   </div>
// )}




          
//         </div>
//       </div>
//     );
//   };

//   const FormattedText = ({ content }) => {
//     const formatText = (text) => {
//       text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
//       text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
//       text = text.replace(/\n/g, '<br/>');
//       return text;
//     };
//     return <div dangerouslySetInnerHTML={{ __html: formatText(content) }}/>;
//   };

//   return (
//     <div className="app">
//       {/* Sidebar */}
//       <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
//         <div className="sidebar-header">
//           <div className="logo"><Sparkles className="logo-icon"/><span className="logo-text">Velocity.ai</span></div>
//           <button className="new-chat-button" onClick={createNewSession}><Plus size={18}/> New Chat</button>
//         </div>

//         <div className="sidebar-content">
//           <h3 className="sidebar-section-title">Recent Sessions</h3>
//           {sessions.length === 0 ? (
//             <div className="empty-state"><Clock size={32}/><p>No sessions yet</p></div>
//           ) : (
//             sessions.map(session => (
//               <div key={session.session_id} className={`session-item ${currentSessionId === session.session_id ? 'active' : ''}`} onClick={() => loadSession(session.session_id)}>
//                 <FileText size={16}/>
//                 <div className="session-info">
//                   <div className="session-title">Session {session.session_id.slice(-8)}</div>
//                   <div className="session-meta">{formatTimestamp(session.created_at)} · {session.message_count} messages</div>
//                 </div>
//                 <ChevronRight size={16}/>
//               </div>
//             ))
//           )}
//         </div>

//         <div className="sidebar-footer">
//           <span>Powered by</span>
//           <span className="model-badge mistral">Mistral</span>
//           <span className="model-badge groq">Groq</span>
//         </div>
//       </aside>

//       {/* Main Content */}
//       <main className="main-content">
//         <header className="header">
//           <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}><ChevronRight size={20} className={sidebarOpen ? 'rotated' : ''}/></button>
//           <div className="header-title">{currentSessionId ? `Session: ${currentSessionId.slice(-8)}` : 'Welcome to Velocity.ai'}</div>
//         </header>

//         {/* Messages */}
//         <div className="messages-container">
//           {messages.length === 0 ? (
//             <div className="welcome-screen">
//               <Sparkles size={64}/>
//               <h1>Welcome to Velocity.ai</h1>
//               <p>Your intelligent PDF extraction assistant for Private Equity fund documents</p>
//             </div>
//           ) : (
//             <div className="messages-list">
//               {messages.map((m,i) => renderMessage(m,i))}
//               <div ref={messagesEndRef}/>
//             </div>
//           )}
//         </div>

//         {/* File Attachments */}
//         {files.length > 0 && (
//           <div className="file-attachments">
//             {files.map((file, index) => (
//               <div key={index} className="file-chip">
//                 <FileText size={14}/>
//                 <span>{file.name} ({(file.size/1024).toFixed(1)} KB)</span>
//                 <button onClick={() => removeFile(index)}><X size={14}/></button>
//               </div>
//             ))}
//           </div>
//         )}

//         {/* Progress Bar */}
//         {isProcessing && uploadProgress > 0 && (
//           <div className="progress-container">
//             <div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadProgress}%` }}/></div>
//             <span className="progress-text">{uploadProgress}%</span>
//           </div>
//         )}

//         {/* Input */}


// <div 
//   className="input-container" 
//   style={{
//     display: 'flex',
//     alignItems: 'center',
//     padding: '10px 12px',
//     gap: '8px',
//     borderTop: '1px solid #333',
//     backgroundColor: '#121212',
//     borderRadius: '0 0 12px 12px',
//     position: 'relative'
//   }}
// >
//   {/* Hidden File Input */}
//   <input 
//     type="file" 
//     ref={fileInputRef} 
//     multiple 
//     accept=".pdf" 
//     onChange={handleFileSelect} 
//     style={{ display:'none' }}
//   />

//   {/* Upload Button */}
//   <button 
//     onClick={() => fileInputRef.current?.click()} 
//     disabled={isProcessing}
//     style={{
//       backgroundColor: '#1E1E1E',
//       color: '#fff',
//       border: '1px solid #333',
//       padding: '8px',
//       borderRadius: '8px',
//       cursor: isProcessing ? 'not-allowed' : 'pointer',
//       transition: 'all 0.2s',
//     }}
//     onMouseOver={e => e.currentTarget.style.backgroundColor = '#2A2A2A'}
//     onMouseOut={e => e.currentTarget.style.backgroundColor = '#1E1E1E'}
//   >
//     <Upload size={20}/>
//   </button>

//   {/* Chat Input */}
//   <input 
//     type="text" 
//     value={inputMessage} 
//     onChange={(e)=>setInputMessage(e.target.value)} 
//     onKeyPress={(e)=>e.key==='Enter' && !e.shiftKey && handleSendMessage()} 
//     disabled={isProcessing} 
//     placeholder={files.length > 0 ? "Press Enter or click Send to extract..." : "Ask a question or upload PDFs..."}
//     style={{
//       flex: 1,
//       backgroundColor: '#1E1E1E',
//       color: '#FFF',
//       border: '1px solid #333',
//       borderRadius: '12px',
//       padding: '10px 14px',
//       fontSize: '14px',
//       outline: 'none',
//       transition: 'all 0.2s',
//     }}
//     onFocus={e => e.currentTarget.style.borderColor = '#10A37F'}
//     onBlur={e => e.currentTarget.style.borderColor = '#333'}
//   />

//   {/* Send Button */}
//   <button 
//     onClick={handleSendMessage} 
//     disabled={isProcessing || (files.length === 0 && !inputMessage.trim())}
//     style={{
//       backgroundColor: '#10A37F',
//       color: '#fff',
//       border: 'none',
//       padding: '8px 12px',
//       borderRadius: '8px',
//       cursor: isProcessing ? 'not-allowed' : 'pointer',
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//       transition: 'all 0.2s',
//     }}
//     onMouseOver={e => e.currentTarget.style.backgroundColor = '#0D7C66'}
//     onMouseOut={e => e.currentTarget.style.backgroundColor = '#10A37F'}
//   >
//     {isProcessing ? <Loader2 size={20}/> : <Send size={20}/>}
//   </button>
// </div>

//       </main>
//     </div>
//   );
// }

// export default App;
