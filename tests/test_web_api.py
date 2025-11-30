import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch, AsyncMock
from autoagent.web_app import app, session

client = TestClient(app)

# Mocking the heavy environment setup
@pytest.fixture
def mock_env_setup():
    with patch('autoagent.web_app.DockerEnv') as MockDockerEnv, \
         patch('autoagent.web_app.BrowserEnv') as MockBrowserEnv, \
         patch('autoagent.web_app.RequestsMarkdownBrowser') as MockFileEnv, \
         patch('autoagent.web_app.get_config') as mock_get_config, \
         patch('autoagent.web_app.get_system_triage_agent') as mock_get_agent, \
         patch('autoagent.web_app.MetaChain') as MockMetaChain:

        # Setup mocks
        mock_get_config.return_value = MagicMock(
            workplace_name="test_workplace",
            local_root="/tmp",
            container_name="test_container"
        )

        mock_agent = MagicMock()
        mock_agent.name = "System Triage Agent"
        mock_agent.agent_teams = {"Weather Agent": MagicMock}

        # We need to make sure the mocked agent team returns an object with an .agent attribute
        mock_team_agent = MagicMock()
        mock_team_agent.agent = MagicMock()
        mock_agent.agent_teams = {"Weather Agent": lambda x: mock_team_agent}

        mock_get_agent.return_value = mock_agent

        mock_mc_instance = MockMetaChain.return_value
        # Mock run to return a response object
        mock_response = MagicMock()
        mock_response.messages = [{"role": "assistant", "content": "Hello user"}]
        mock_response.agent = mock_agent
        mock_mc_instance.run.return_value = mock_response

        yield {
            "get_config": mock_get_config,
            "mc": mock_mc_instance
        }

def test_get_state_uninitialized():
    response = client.get("/api/state")
    assert response.status_code == 200
    assert response.json()["initialized"] == False

def test_init_session(mock_env_setup):
    init_data = {
        "container_name": "test_container",
        "port": 12345,
        "local_env": True
    }
    response = client.post("/api/init", json=init_data)
    if response.status_code != 200:
        print(response.json())
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Check state after init
    response = client.get("/api/state")
    assert response.status_code == 200
    assert response.json()["initialized"] == True
    assert response.json()["agent_name"] == "System Triage Agent"

def test_chat(mock_env_setup):
    # Ensure initialized
    client.post("/api/init", json={"local_env": True})

    chat_data = {"message": "Hello"}
    response = client.post("/api/chat", json=chat_data)
    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert "messages" in data
    assert len(data["messages"]) > 0
    assert data["messages"][-1]["content"] == "Hello user"

def test_upload(mock_env_setup):
    client.post("/api/init", json={"local_env": True})

    # Mock file upload
    files = {'files': ('test.txt', b'content', 'text/plain')}
    with patch('builtins.open', MagicMock()) as mock_open:
        response = client.post("/api/upload", files=files)
        assert response.status_code == 200
        assert "uploaded_files" in response.json()
