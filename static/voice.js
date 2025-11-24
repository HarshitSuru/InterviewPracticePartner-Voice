let voiceMode = false;
let recognition;
let messages = [];
let lastQuestionText = "";
let silenceTimer = null;
let feedbackActive = false;  // true only when we explicitly request final feedback
let pendingTranscript = "";
let agentSpeaking = false;
let userSpeaking = false;

const captions = document.getElementById("captions");
const feedback = document.getElementById("feedback");
const roleSelect = document.getElementById("role-select");
const feedbackPanel = document.getElementById("feedback-panel");
const micIndicator = document.getElementById("mic-indicator");
const micText = document.getElementById("mic-text");

// --- Mic status helpers ---
function setMicState(state) {
  // state: "idle" | "listening" | "agent"
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

// --- Speech Recognition setup ---
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (e) => {
    // Buffer the latest utterance
    pendingTranscript = e.results[e.results.length - 1][0].transcript;
  };

  recognition.onend = () => {
    setMicState("idle");
    userSpeaking = false;
    // When recognition stops (Space released or pause), send buffered text once
    if (pendingTranscript && pendingTranscript.trim().length > 0) {
      sendVoice(pendingTranscript.trim());
      pendingTranscript = "";
    }
    if (voiceMode && !agentSpeaking) recognition.start();
  };
} else {
  console.warn("SpeechRecognition not supported in this browser.");
}

// --- Buttons ---

document.getElementById("voice-toggle-btn").onclick = () => {
  // Don't start continuous listening while agent is speaking
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

// Push-to-talk with SPACEBAR
let spacePressed = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !spacePressed) {
    spacePressed = true;
    e.preventDefault();
    // Do not allow user push-to-talk while agent is speaking
    if (agentSpeaking) return;
    if (recognition) {
      voiceMode = false; // disable continuous while using PTT
      userSpeaking = true;
      pendingTranscript = "";
      clearSilenceTimer();
      recognition.start();
      setMicState("listening");
      // Keep last agent question caption visible while user speaks
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spacePressed = false;
    e.preventDefault();
    if (recognition) {
      recognition.stop();
      // mic state & sendVoice handled in onend
    }
  }
});

// Request final feedback only when this button is clicked
document.getElementById("request-feedback-btn").onclick = () => {
  requestFinalFeedback();
};

// --- Caption handling (agent only, with fade/slide) ---

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
  }, 15000); // 15 seconds
}

// --- Silence handling (20 seconds) ---

function startSilenceTimer() {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (lastQuestionText && !userSpeaking && !agentSpeaking) {
      // Repeat the last question WITHOUT asking the model again
      speakWithCaptions(lastQuestionText);
      // Restart timer for next silence period
      startSilenceTimer();
    }
  }, 20000); // 20 seconds
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

// --- TTS with word-synced captions ---

function speakWithCaptions(text) {
  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";

  // Reset captions immediately
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
    // After entire sentence completes, keep caption for 15 seconds,
    // but don't fade if user starts speaking
    if (captionTimer) clearTimeout(captionTimer);
    captionTimer = setTimeout(() => {
      if (!userSpeaking && !agentSpeaking) {
        captions.style.opacity = 0;
        captions.style.transform = "translateY(-10px)";
      }
    }, 15000);
  };

  window.speechSynthesis.speak(utter);
}

// --- Sending user speech to backend (normal interview messages) ---

async function sendVoice(userText) {
  // Any user answer cancels silence timer
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
      // This reply is the final feedback; show in inline panel only, no TTS
      feedback.innerHTML = reply.replace(/\n/g, "<br>");
      feedbackPanel.style.display = "block";
      feedbackActive = false; // reset
    } else {
      // Normal interview question / follow-up
      lastQuestionText = reply;
      speakWithCaptions(reply);
      // After agent speaks, start silence timer waiting for the user's answer
      startSilenceTimer();
    }
  } catch (err) {
    showCaptionImmediate("Network error: " + err.message);
  }
}

// --- Requesting final feedback (button click) ---

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

    // Show feedback in inline panel, do NOT speak it
    feedback.innerHTML = reply.replace(/\n/g, "<br>");
    feedbackPanel.style.display = "block";
    feedbackActive = false;
  } catch (err) {
    showCaptionImmediate("Network error: " + err.message);
    feedbackActive = false;
  }
}
