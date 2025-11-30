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

  useEffect(() => {
    checkState();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
    }
  };

  const handleInit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/init`, config);
      await checkState();
    } catch (err) {
      alert('Initialization failed: ' + (err.response?.data?.detail || err.message));
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
    } catch (err) {
      alert('Message failed: ' + (err.response?.data?.detail || err.message));
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
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.detail || err.message));
    }
    setUploading(false);
  };

  if (!initialized) {
    return (
      <div className="container">
        <h1>AutoAgent Setup</h1>
        <form onSubmit={handleInit} className="setup-form">
          <label>
            Container Name:
            <input
              type="text"
              value={config.container_name}
              onChange={e => setConfig({...config, container_name: e.target.value})}
            />
          </label>
          <label>
            Port:
            <input
              type="number"
              value={config.port}
              onChange={e => setConfig({...config, port: parseInt(e.target.value)})}
            />
          </label>
          <label>
            Test Pull Name:
            <input
              type="text"
              value={config.test_pull_name}
              onChange={e => setConfig({...config, test_pull_name: e.target.value})}
            />
          </label>
          <label>
            Model:
            <input
              type="text"
              value={config.model}
              onChange={e => setConfig({...config, model: e.target.value})}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.git_clone}
              onChange={e => setConfig({...config, git_clone: e.target.checked})}
            />
            Git Clone
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.local_env}
              onChange={e => setConfig({...config, local_env: e.target.checked})}
            />
            Local Env
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Initializing...' : 'Start Session'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="chat-header">
        <h1>AutoAgent Web</h1>
        <div className="status">
          <span>Agent: <strong>{currentAgent || 'None'}</strong></span>
        </div>
      </header>

      <div className="chat-area">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-content">
              <strong>{msg.role === 'user' ? 'You' : msg.role}: </strong>
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <form onSubmit={handleSend}>
          <input
            type="text"
            placeholder="Type a message or @agent..."
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>Send</button>
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
            {uploading ? 'Uploading...' : 'Upload Files'}
          </label>
        </div>
      </div>

      <div className="agents-list">
        <small>Available Agents: {availableAgents.join(', ')}</small>
      </div>
    </div>
  );
}

export default App;
