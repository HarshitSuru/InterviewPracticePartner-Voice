const feedbackModal = document.getElementById("feedback-modal");
const closeModal = document.getElementById("close-modal");

closeModal.onclick = function () {
  feedbackModal.style.display = "none";
};

window.onclick = function (event) {
  if (event.target === feedbackModal) {
    feedbackModal.style.display = "none";
  }
};
