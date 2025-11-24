let voiceMode = false;
let recognition;
let messages = [];
let lastQuestionText = "";
let silenceTimer = null;
let feedbackActive = false;
let pendingTranscript = "";
let agentSpeaking = false;
let userSpeaking = false;

const captions = document.getElementById("captions");
const feedback = document.getElementById("feedback");
const roleSelect = document.getElementById("role-select");
const feedbackPanel = document.getElementById("feedback-panel");
const micIndicator = document.getElementById("mic-indicator");
const micText = document.getElementById("mic-text");

function setMicState(state) {
  micIndicator.classList.remove("listening", "agent-speaking");
  if (state === "idle") {
    micText.textContent = "Idle";
  } else if (state === "listening") {
    micIndicator.classList.add("listening");
    micText.textContent = "Listening…";
  } else if (state === "agent") {
    micIndicator.classList.add("agent-speaking");
    micText.textContent = "Interviewer speaking…";
  }
}


const hideFeedbackBtn = document.getElementById("hide-feedback-btn");
if (hideFeedbackBtn) {
  hideFeedbackBtn.onclick = () => {
    feedbackPanel.style.display = "none";
  };
}

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (e) => {
    pendingTranscript = e.results[e.results.length - 1][0].transcript;
  };

  recognition.onend = () => {
    setMicState("idle");
    userSpeaking = false;
    if (pendingTranscript && pendingTranscript.trim().length > 0) {
      sendVoice(pendingTranscript.trim());
      pendingTranscript = "";
    }
    if (voiceMode && !agentSpeaking) recognition.start();
  };
} else {
  console.warn("SpeechRecognition not supported in this browser.");
}


document.getElementById("voice-toggle-btn").onclick = () => {
  if (!voiceMode && agentSpeaking) {
    return;
  }
  voiceMode = !voiceMode;
  if (voiceMode && recognition) {
    recognition.start();
    setMicState("listening");
    showCaptionImmediate("🎤 Continuous voice mode ON");
  } else if (recognition) {
    recognition.stop();
    setMicState("idle");
    showCaptionImmediate("🛑 Continuous mode OFF");
  }
};

let spacePressed = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !spacePressed) {
    spacePressed = true;
    e.preventDefault();
    if (agentSpeaking) return;
    if (recognition) {
      voiceMode = false; // disable continuous while using PTT
      userSpeaking = true;
      pendingTranscript = "";
      clearSilenceTimer();
      recognition.start();
      setMicState("listening");
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spacePressed = false;
    e.preventDefault();
    if (recognition) {
      recognition.stop();
    }
  }
});

document.getElementById("request-feedback-btn").onclick = () => {
  requestFinalFeedback();
};


let captionTimer = null;

function showCaptionImmediate(text) {
  captions.innerText = text;
  captions.style.opacity = 1;
  captions.style.transform = "translateY(0px)";
  captions.classList.add("visible");

  if (captionTimer) clearTimeout(captionTimer);

  captionTimer = setTimeout(() => {
    if (!userSpeaking && !agentSpeaking) {
      captions.style.opacity = 0;
      captions.style.transform = "translateY(-10px)";
    }
  }, 35000); // 15 seconds
}


function startSilenceTimer() {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (lastQuestionText && !userSpeaking && !agentSpeaking) {
      speakWithCaptions(lastQuestionText);
      startSilenceTimer();
    }
  }, 35000); // 35 seconds
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}


function speakWithCaptions(text) {
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";

  captions.innerText = "";
  captions.style.opacity = 1;
  captions.style.transform = "translateY(0px)";
  captions.classList.add("visible");

  if (captionTimer) clearTimeout(captionTimer);

  agentSpeaking = true;
  userSpeaking = false;
  setMicState("agent");

  utter.onboundary = (event) => {
    try {
      const partial = text.substring(0, event.charIndex);
      captions.innerText = partial.trim();
    } catch (e) {
      captions.innerText = text;
    }
  };

  utter.onstart = () => {
    captions.style.opacity = 1;
    captions.style.transform = "translateY(0px)";
  };

  utter.onend = () => {
    agentSpeaking = false;
    setMicState("idle");

    if (captionTimer) clearTimeout(captionTimer);
    captionTimer = setTimeout(() => {
      if (!userSpeaking && !agentSpeaking) {
        captions.style.opacity = 0;
        captions.style.transform = "translateY(-10px)";
      }
    }, 35000);
  };

  window.speechSynthesis.speak(utter);
}


async function sendVoice(userText) {
  clearSilenceTimer();

  messages.push({ role: "user", content: userText });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages,
        role: roleSelect.value,
      }),
    });

    const data = await res.json();
    if (data.error) {
      showCaptionImmediate("Error: " + data.error);
      return;
    }

    const reply = data.reply || "";

    messages.push({ role: "assistant", content: reply });

    if (feedbackActive) {
      feedback.innerHTML = reply.replace(/\n/g, "<br>");
      feedbackPanel.style.display = "block";
      feedbackActive = false; // reset
    } else {
      lastQuestionText = reply;
      speakWithCaptions(reply);
      startSilenceTimer();
    }
  } catch (err) {
    showCaptionImmediate("Network error: " + err.message);
  }
}


async function requestFinalFeedback() {
  clearSilenceTimer();
  feedbackActive = true;

  messages.push({
    role: "user",
    content:
      "Please stop asking questions and provide final overall interview feedback with a 1–5 score breakdown for Communication, Content Quality, and Confidence, plus strengths and areas to improve, based on our entire conversation so far.",
  });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages,
        role: roleSelect.value,
      }),
    });

    const data = await res.json();
    if (data.error) {
      showCaptionImmediate("Error: " + data.error);
      feedbackActive = false;
      return;
    }

    const reply = data.reply || "";
    messages.push({ role: "assistant", content: reply });

    feedback.innerHTML = reply.replace(/\n/g, "<br>");
    feedbackPanel.style.display = "block";
    feedbackActive = false;
  } catch (err) {
    showCaptionImmediate("Network error: " + err.message);
    feedbackActive = false;
  }
}
