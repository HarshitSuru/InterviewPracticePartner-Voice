from flask import Flask, render_template, request, jsonify
import os
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY is not set. Set it in a .env file or environment variable.")

SYSTEM_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
with open(SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
    SYSTEM_PROMPT = f.read()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(force=True)
    msgs = data.get("messages", [])
    role = data.get("role", "software engineer")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"The candidate is interviewing for the role: {role}. "
                       f"This is a voice-only mock interview. Begin or continue the interview based on the conversation."
        }
    ]

    for m in msgs:
        role_m = m.get("role", "user")
        if role_m not in ("user", "assistant", "system"):
            role_m = "user"
        messages.append({"role": role_m, "content": m.get("content", "")})

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 512
    }

    try:
        resp = requests.post(GROQ_URL, headers=headers, json=payload, timeout=60)
        if resp.status_code != 200:
            return jsonify({"error": f"Groq API error {resp.status_code}: {resp.text}"}), 500
        data = resp.json()
        reply = data["choices"][0]["message"]["content"]
        return jsonify({"reply": reply})
    except Exception as e:
        print("Error calling Groq API:", e)
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
