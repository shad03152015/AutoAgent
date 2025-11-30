from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
import asyncio
import os
import shutil
import re
from autoagent.types import Response
from autoagent.environment.docker_env import DockerEnv, DockerConfig
from autoagent.environment.local_env import LocalEnv
from autoagent.environment.browser_env import BrowserEnv
from autoagent.environment.markdown_browser import RequestsMarkdownBrowser
from autoagent.agents import get_system_triage_agent
from autoagent import MetaChain
from autoagent.logger import LoggerManager, MetaChainLogger
from constant import DOCKER_WORKPLACE_NAME, COMPLETION_MODEL
from autoagent.cli import get_config
import os.path as osp

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class InitRequest(BaseModel):
    container_name: str = "auto_agent"
    port: int = 12347
    test_pull_name: str = "autoagent_mirror"
    git_clone: bool = True
    local_env: bool = False
    model: str = COMPLETION_MODEL

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str
    agent_name: str
    messages: List[Dict[str, str]]

class SessionManager:
    def __init__(self):
        self.code_env = None
        self.web_env = None
        self.file_env = None
        self.mc = None
        self.messages = []
        self.agents = {}
        self.current_agent = None
        self.context_variables = {}
        self.docker_config = None
        self.initialized = False

    async def initialize(self, config: InitRequest):
        try:
            self.docker_config = get_config(
                config.container_name,
                config.port,
                config.test_pull_name,
                config.git_clone
            )

            # Setup logger
            log_path = osp.join("casestudy_results", 'logs', f'agent_{config.container_name}_{config.model}.log')
            LoggerManager.set_logger(MetaChainLogger(log_path=None))

            # Create environments
            if config.local_env:
                self.code_env = LocalEnv(self.docker_config)
            else:
                self.code_env = DockerEnv(self.docker_config)
                self.code_env.init_container()

            self.web_env = BrowserEnv(
                browsergym_eval_env=None,
                local_root=self.docker_config.local_root,
                workplace_name=self.docker_config.workplace_name
            )
            self.file_env = RequestsMarkdownBrowser(
                viewport_size=1024 * 5,
                local_root=self.docker_config.local_root,
                workplace_name=self.docker_config.workplace_name,
                downloads_folder=os.path.join(self.docker_config.local_root, self.docker_config.workplace_name, "downloads")
            )

            self.context_variables = {
                "working_dir": self.docker_config.workplace_name,
                "code_env": self.code_env,
                "web_env": self.web_env,
                "file_env": self.file_env
            }

            # Setup Agents
            system_triage_agent = get_system_triage_agent(config.model)
            self.agents = {system_triage_agent.name.replace(' ', '_'): system_triage_agent}
            for agent_name in system_triage_agent.agent_teams.keys():
                self.agents[agent_name.replace(' ', '_')] = system_triage_agent.agent_teams[agent_name]("placeholder").agent

            self.current_agent = system_triage_agent
            self.mc = MetaChain(log_path=LoggerManager.get_logger())
            self.initialized = True
            return {"status": "success", "message": "Environment initialized"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def process_message(self, message: str):
        if not self.initialized:
            raise HTTPException(status_code=400, detail="Session not initialized")

        words = message.split()
        target_agent = self.current_agent

        # Check for @mentions
        for word in words:
            if word.startswith('@'):
                agent_key = word[1:]
                if agent_key in self.agents:
                    target_agent = self.agents[agent_key]

        if hasattr(target_agent, "name"):
            self.messages.append({"role": "user", "content": message})

            # Run the agent
            # MetaChain.run is synchronous, so we run it in a thread pool if needed,
            # but for now we can call it directly since we are in an async function but fastapi handles it.
            # Ideally: await asyncio.to_thread(...)
            response = await asyncio.to_thread(
                self.mc.run,
                target_agent,
                self.messages,
                self.context_variables,
                debug=True
            )

            self.messages.extend(response.messages)
            model_answer_raw = response.messages[-1]['content']

            # Parse solution if present (similar to CLI)
            if model_answer_raw.startswith('Case resolved'):
                model_answer = re.findall(r'<solution>(.*?)</solution>', model_answer_raw, re.DOTALL)
                if len(model_answer) == 0:
                    model_answer = model_answer_raw
                else:
                    model_answer = model_answer[0]
            else:
                model_answer = model_answer_raw

            self.current_agent = response.agent

            return {
                "response": model_answer,
                "agent_name": self.current_agent.name,
                "messages": self.messages
            }
        else:
            return {
                "response": f"Unknown or invalid agent selected: {target_agent}",
                "agent_name": "System",
                "messages": self.messages
            }

    async def handle_upload(self, files: List[UploadFile]):
        if not self.initialized:
            raise HTTPException(status_code=400, detail="Session not initialized")

        code_env = self.context_variables["code_env"]
        local_workplace = code_env.local_workplace
        docker_workplace = code_env.docker_workplace

        files_dir = os.path.join(local_workplace, "files")
        docker_files_dir = os.path.join(docker_workplace, "files")
        os.makedirs(files_dir, exist_ok=True)

        uploaded_infos = []
        for file in files:
            file_path = os.path.join(files_dir, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # Since we are essentially "copying" to the docker env via volume mount (implied by LocalEnv or DockerEnv structure in cli.py),
            # we just need to ensure the files are in the right place.
            # If using DockerEnv, the volume mount handles it.

            uploaded_infos.append(f"File uploaded: {docker_files_dir}/{file.filename}")

        # Notify the agent about the upload by appending to the last user message or context?
        # In CLI, it appends to the query. Since this is a separate action, we might just return info.
        return {"uploaded_files": uploaded_infos}

session = SessionManager()

@app.post("/api/init")
async def init_session(request: InitRequest):
    return await session.initialize(request)

@app.post("/api/chat")
async def chat(request: ChatRequest):
    return await session.process_message(request.message)

@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    return await session.handle_upload(files)

@app.get("/api/state")
async def get_state():
    if not session.initialized:
        return {"initialized": False}
    return {
        "initialized": True,
        "agent_name": session.current_agent.name if session.current_agent else None,
        "messages": session.messages,
        "available_agents": list(session.agents.keys())
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
