import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import './App.css';

const API_BASE = '/api';

function App() {
  const [initialized, setInitialized] = useState(false);
  const [config, setConfig] = useState({
    container_name: 'auto_agent',
    port: 12347,
    test_pull_name: 'autoagent_mirror',
    git_clone: true,
    local_env: false,
    model: 'gpt-4o-2024-08-06'
  });
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [availableAgents, setAvailableAgents] = useState([]);
  const [currentAgent, setCurrentAgent] = useState(null);
  const messagesEndRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const checkState = async () => {
    try {
      const res = await axios.get(`${API_BASE}/state`);
      if (res.data.initialized) {
        setInitialized(true);
        setMessages(res.data.messages || []);
        setAvailableAgents(res.data.available_agents || []);
        setCurrentAgent(res.data.agent_name);
      }
    } catch (err) {
      console.error("Failed to check state", err);
      setErrorMessage('Could not refresh the session state.');
    }
  };

  useEffect(() => {
    // Fetch session state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkState();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (initialized) {
      inputRef.current?.focus();
    }
  }, [initialized]);

  const handleInit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/init`, config);
      await checkState();
      setStatusMessage('Session initialized successfully.');
    } catch (err) {
      alert('Initialization failed: ' + (err.response?.data?.detail || err.message));
      setErrorMessage('Initialization failed. Please verify your settings.');
    }
    setLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/chat`, { message: userMsg.content });
      // The backend returns the full history, but we might just append the new messages if we tracked them
      // But let's trust the backend state for now or just append the last response
      // Actually the backend returns { response, agent_name, messages }
      // where messages is the updated full list.
      setMessages(res.data.messages);
      setCurrentAgent(res.data.agent_name);
      setStatusMessage('Response received.');
    } catch (err) {
      alert('Message failed: ' + (err.response?.data?.detail || err.message));
      setErrorMessage('Message failed. Please try again.');
    }
    setLoading(false);
  };

  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    setUploading(true);
    try {
      const res = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert(`Uploaded: ${res.data.uploaded_files.join(', ')}`);
      setStatusMessage(`Uploaded ${res.data.uploaded_files.length} file(s).`);
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.detail || err.message));
      setErrorMessage('Upload failed. Please retry.');
    }
    setUploading(false);
  };

  const handleCopyMessage = async (content) => {
    try {
      await navigator.clipboard?.writeText(content);
      setStatusMessage('Message copied to clipboard.');
    } catch (err) {
      console.error('Copy failed', err);
      setErrorMessage('Unable to copy.');
    }
  };

  const renderStatus = () => {
    if (errorMessage) {
      return <div className="status-banner error">{errorMessage}</div>;
    }
    if (statusMessage) {
      return <div className="status-banner info">{statusMessage}</div>;
    }
    if (loading || uploading) {
      return <div className="status-banner muted">Working on your request...</div>;
    }
    return null;
  };

  const formatRoleLabel = (role) => {
    if (role === 'assistant') return 'Assistant';
    if (role === 'system') return 'System';
    if (role === 'tool') return 'Tool';
    return 'You';
  };

  if (!initialized) {
    return (
      <div className="app-shell">
        <div className="setup-card">
          <div>
            <p className="eyebrow">Welcome to</p>
            <h1>AutoAgent Control Panel</h1>
            <p className="lede">Configure your container, preferred model, and start an interactive session with your agents.</p>
          </div>
          <form onSubmit={handleInit} className="setup-form">
            <div className="grid">
              <label>
                Container Name
                <input
                  type="text"
                  value={config.container_name}
                  onChange={e => setConfig({...config, container_name: e.target.value})}
                />
              </label>
              <label>
                Port
                <input
                  type="number"
                  value={config.port}
                  onChange={e => setConfig({...config, port: parseInt(e.target.value)})}
                />
              </label>
              <label>
                Test Pull Name
                <input
                  type="text"
                  value={config.test_pull_name}
                  onChange={e => setConfig({...config, test_pull_name: e.target.value})}
                />
              </label>
              <label>
                Model
                <input
                  type="text"
                  value={config.model}
                  onChange={e => setConfig({...config, model: e.target.value})}
                />
              </label>
            </div>
            <div className="toggle-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.git_clone}
                  onChange={e => setConfig({...config, git_clone: e.target.checked})}
                />
                Git clone on start
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.local_env}
                  onChange={e => setConfig({...config, local_env: e.target.checked})}
                />
                Use local environment
              </label>
            </div>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? 'Initializing session…' : 'Launch session'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        <header className="chat-header">
          <div>
            <p className="eyebrow">AutoAgent Web</p>
            <h1>Interactive session</h1>
          </div>
          <div className="status-group">
            <span className="pill">Agent: <strong>{currentAgent || 'None'}</strong></span>
            <span className="pill subtle">{messages.length} messages</span>
            <span className={`pill ${uploading || loading ? 'live' : 'subtle'}`}>
              {uploading ? 'Uploading files…' : loading ? 'Working…' : 'Ready'}
            </span>
          </div>
        </header>

        <div className="toolbar">
          <div>
            <div className="chip-row">
              <span className="chip">Available agents</span>
              {availableAgents.length === 0 && <span className="chip muted">No agents reported</span>}
              {availableAgents.map((agent) => (
                <span key={agent} className="chip ghost">{agent}</span>
              ))}
            </div>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="ghost" onClick={checkState} disabled={loading}>
              Refresh state
            </button>
            <button type="button" className="ghost" onClick={() => setMessages([])}>
              Clear view
            </button>
          </div>
        </div>

        {renderStatus()}

        <div className="layout">
          <aside className="session-panel">
            <div className="panel-section">
              <h3>Session details</h3>
              <dl>
                <div className="row">
                  <dt>Container</dt>
                  <dd>{config.container_name}</dd>
                </div>
                <div className="row">
                  <dt>Port</dt>
                  <dd>{config.port}</dd>
                </div>
                <div className="row">
                  <dt>Model</dt>
                  <dd>{config.model}</dd>
                </div>
              </dl>
            </div>
            <div className="panel-section">
              <h3>Tips</h3>
              <ul>
                <li>Use <strong>@agent</strong> in your message to target a specific agent.</li>
                <li>Upload supporting files before asking complex questions.</li>
                <li>Refresh the state if you update the backend session.</li>
              </ul>
            </div>
          </aside>

          <section className="chat-panel">
            <div className="chat-area">
              {messages.length === 0 && (
                <div className="empty-state">
                  <h3>Start the conversation</h3>
                  <p>Ask AutoAgent to run tasks, analyze files, or collaborate with different agents.</p>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <div className="message-header">
                    <span className={`role ${msg.role}`}>{formatRoleLabel(msg.role)}</span>
                    <div className="message-actions">
                      <button type="button" className="icon" onClick={() => handleCopyMessage(msg.content)} aria-label="Copy message">Copy</button>
                    </div>
                  </div>
                  <div className="message-content">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
              {(loading || uploading) && (
                <div className="typing">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="label">Preparing response…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
              <form onSubmit={handleSend}>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Type a message or @agent..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  disabled={loading}
                />
                <button type="submit" className="primary" disabled={loading}>Send</button>
              </form>
              <div className="upload-section">
                <input
                  type="file"
                  multiple
                  onChange={handleUpload}
                  disabled={uploading}
                  id="file-upload"
                  style={{display: 'none'}}
                />
                <label htmlFor="file-upload" className="upload-btn">
                  {uploading ? 'Uploading...' : 'Upload files'}
                </label>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
